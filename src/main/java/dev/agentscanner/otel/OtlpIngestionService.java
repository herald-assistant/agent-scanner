package dev.agentscanner.otel;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.protobuf.InvalidProtocolBufferException;
import com.google.protobuf.MessageOrBuilder;
import com.google.protobuf.util.JsonFormat;
import dev.agentscanner.store.ScannerStore;
import io.opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest;
import io.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest;
import io.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
import io.opentelemetry.proto.common.v1.KeyValue;
import io.opentelemetry.proto.logs.v1.LogRecord;
import io.opentelemetry.proto.metrics.v1.Metric;
import io.opentelemetry.proto.resource.v1.Resource;
import io.opentelemetry.proto.trace.v1.ResourceSpans;
import io.opentelemetry.proto.trace.v1.Span;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

import static dev.agentscanner.otel.OtelJson.*;

@Service
public class OtlpIngestionService {
    private final ScannerStore store;
    private final ObjectMapper mapper;
    private final AtomicBoolean paused = new AtomicBoolean(false);
    private final JsonFormat.Printer jsonPrinter = JsonFormat.printer()
        .preservingProtoFieldNames().includingDefaultValueFields();

    public OtlpIngestionService(ScannerStore store, ObjectMapper mapper) {
        this.store = store;
        this.mapper = mapper;
    }

    @Transactional
    public IngestionResult ingestTraces(byte[] payload, String contentType, String encoding) {
        return ingestTraces(payload, contentType, encoding, true);
    }

    @Transactional
    public IngestionResult importTracesJson(byte[] payload) {
        return ingestTraces(payload, "application/json", null, false);
    }

    private IngestionResult ingestTraces(byte[] payload, String contentType, String encoding, boolean honorPause) {
        if (honorPause && paused.get()) return new IngestionResult("traces", 0, true);
        try {
            ExportTraceServiceRequest request = parseTraces(payload, contentType);
            Instant receivedAt = Instant.now();
            int spanCount = request.getResourceSpansList().stream()
                .mapToInt(r -> r.getScopeSpansList().stream().mapToInt(s -> s.getSpansCount()).sum()).sum();
            ArrayNode resources = resources(request.getResourceSpansList().stream().map(ResourceSpans::getResource).toList());
            long signalId = store.insertSignal("traces", receivedAt, contentType, encoding, resources,
                print(request), payload, spanCount);

            Map<String, List<SpanEnvelope>> byTrace = new LinkedHashMap<>();
            for (ResourceSpans resourceSpans : request.getResourceSpansList()) {
                ObjectNode resource = attributes(mapper, resourceSpans.getResource().getAttributesList());
                resourceSpans.getScopeSpansList().forEach(scope -> scope.getSpansList().forEach(span -> {
                    String traceId = hex(span.getTraceId());
                    ObjectNode attrs = attributes(mapper, span.getAttributesList());
                    byTrace.computeIfAbsent(traceId, ignored -> new ArrayList<>())
                        .add(new SpanEnvelope(span, attrs, resource));
                }));
            }

            byTrace.forEach((traceId, spans) -> {
                Map<String, SpanEnvelope> byId = new HashMap<>();
                spans.forEach(item -> byId.put(hex(item.span().getSpanId()), item));
                Set<String> identities = new HashSet<>();
                spans.stream().map(item -> explicitSessionKey(item.attributes())).filter(Objects::nonNull).forEach(identities::add);
                Map<String, List<SpanEnvelope>> byConversation = new LinkedHashMap<>();
                for (SpanEnvelope item : spans) {
                    String conversation = explicitSessionKey(item.attributes());
                    SpanEnvelope ancestor = item;
                    Set<String> visited = new HashSet<>();
                    while (conversation == null && ancestor != null && visited.add(hex(ancestor.span().getSpanId()))) {
                        ancestor = byId.get(hex(ancestor.span().getParentSpanId()));
                        if (ancestor != null) conversation = explicitSessionKey(ancestor.attributes());
                    }
                    if (conversation == null) conversation = identities.size() == 1 ? identities.iterator().next() : "trace:" + traceId;
                    byConversation.computeIfAbsent(conversation, ignored -> new ArrayList<>()).add(item);
                }
                byConversation.forEach((conversation, members) -> {
                    SpanEnvelope root = members.stream()
                        .filter(item -> "invoke_agent".equals(text(item.attributes(), "gen_ai.operation.name")))
                        .min(Comparator.comparingLong(item -> item.span().getStartTimeUnixNano())).orElse(members.get(0));
                    SessionAggregate aggregate = aggregate(conversation, members, root, receivedAt);
                    long sessionId = store.upsertSession(aggregate.values());
                    members.forEach(item -> persistSpan(signalId, sessionId, conversation, item));
                });
            });
            return new IngestionResult("traces", spanCount, false);
        } catch (InvalidProtocolBufferException exception) {
            throw new InvalidOtlpPayloadException("Invalid OTLP trace protobuf", exception);
        }
    }

    /** copilot-episode-v1: resolve child ownership without modifying emitted attributes. */
    private static String explicitSessionKey(ObjectNode attrs) {
        String conversation = text(attrs, "gen_ai.conversation.id");
        String chat = text(attrs, "copilot_chat.chat_session_id");
        String parent = text(attrs, "copilot_chat.parent_chat_session_id");
        if (conversation != null && !conversation.isBlank() && conversation.equals(parent) && chat != null && !chat.isBlank() && !chat.equals(parent)) return chat;
        return conversation == null || conversation.isBlank() ? null : conversation;
    }

    @Transactional
    public IngestionResult ingestMetrics(byte[] payload, String contentType, String encoding) {
        if (paused.get()) return new IngestionResult("metrics", 0, true);
        try {
            ExportMetricsServiceRequest request = parseMetrics(payload, contentType);
            int count = request.getResourceMetricsList().stream()
                .mapToInt(r -> r.getScopeMetricsList().stream().mapToInt(s -> s.getMetricsCount()).sum()).sum();
            ArrayNode resources = resources(request.getResourceMetricsList().stream().map(r -> r.getResource()).toList());
            long signalId = store.insertSignal("metrics", Instant.now(), contentType, encoding, resources,
                print(request), payload, count);
            request.getResourceMetricsList().forEach(resource -> resource.getScopeMetricsList().forEach(scope ->
                scope.getMetricsList().forEach(metric -> persistMetric(signalId, metric))));
            return new IngestionResult("metrics", count, false);
        } catch (InvalidProtocolBufferException exception) {
            throw new InvalidOtlpPayloadException("Invalid OTLP metrics protobuf", exception);
        }
    }

    @Transactional
    public IngestionResult ingestLogs(byte[] payload, String contentType, String encoding) {
        if (paused.get()) return new IngestionResult("logs", 0, true);
        try {
            ExportLogsServiceRequest request = parseLogs(payload, contentType);
            int count = request.getResourceLogsList().stream()
                .mapToInt(r -> r.getScopeLogsList().stream().mapToInt(s -> s.getLogRecordsCount()).sum()).sum();
            ArrayNode resources = resources(request.getResourceLogsList().stream().map(r -> r.getResource()).toList());
            long signalId = store.insertSignal("logs", Instant.now(), contentType, encoding, resources,
                print(request), payload, count);
            request.getResourceLogsList().forEach(resource -> resource.getScopeLogsList().forEach(scope ->
                scope.getLogRecordsList().forEach(log -> persistLog(signalId, log))));
            return new IngestionResult("logs", count, false);
        } catch (InvalidProtocolBufferException exception) {
            throw new InvalidOtlpPayloadException("Invalid OTLP logs protobuf", exception);
        }
    }

    private void persistSpan(long signalId, long sessionId, String conversation, SpanEnvelope envelope) {
        Span span = envelope.span();
        ObjectNode attrs = envelope.attributes();
        Instant started = instant(span.getStartTimeUnixNano());
        Instant ended = instant(span.getEndTimeUnixNano());
        Double duration = started == null || ended == null ? null : (span.getEndTimeUnixNano() - span.getStartTimeUnixNano()) / 1_000_000d;
        ArrayNode events = mapper.createArrayNode();
        span.getEventsList().forEach(event -> {
            ObjectNode node = events.addObject();
            node.put("name", event.getName());
            Instant time = instant(event.getTimeUnixNano());
            if (time != null) node.put("time", time.toString());
            node.set("attributes", attributes(mapper, event.getAttributesList()));
        });
        String model = first(text(attrs, "gen_ai.response.model"), text(attrs, "gen_ai.request.model"));
        ScannerStore.SpanValues values = new ScannerStore.SpanValues(signalId, sessionId, hex(span.getTraceId()),
            hex(span.getSpanId()), span.getParentSpanId().isEmpty() ? null : hex(span.getParentSpanId()), span.getName(),
            text(attrs, "gen_ai.operation.name"), span.getKind().name(), started, ended, duration,
            span.getStatus().getCode().name(), span.getStatus().getMessage(), model,
            text(attrs, "gen_ai.agent.name"), conversation,
            number(attrs, "gen_ai.usage.input_tokens"), number(attrs, "gen_ai.usage.output_tokens"),
            number(attrs, "gen_ai.usage.cache_read.input_tokens"), cacheWrite(attrs),
            Math.max(number(attrs, "gen_ai.usage.reasoning.output_tokens"), number(attrs, "gen_ai.usage.reasoning_tokens")),
            decimal(attrs, "copilot_chat.time_to_first_token"), attrs.toString(), events.toString());
        long spanDatabaseId = store.insertSpan(values);
        extractMessages(spanDatabaseId, attrs, "gen_ai.input.messages", "input");
        extractMessages(spanDatabaseId, attrs, "gen_ai.output.messages", "output");
        extractMessages(spanDatabaseId, attrs, "gen_ai.tool.definitions", "definition");
    }

    private SessionAggregate aggregate(String conversation, List<SpanEnvelope> spans, SpanEnvelope root, Instant receivedAt) {
        ObjectNode attrs = root.attributes();
        long input = number(attrs, "gen_ai.usage.input_tokens");
        long output = number(attrs, "gen_ai.usage.output_tokens");
        long cacheRead = number(attrs, "gen_ai.usage.cache_read.input_tokens");
        long cacheCreate = cacheWrite(attrs);
        long reasoning = Math.max(number(attrs, "gen_ai.usage.reasoning.output_tokens"), number(attrs, "gen_ai.usage.reasoning_tokens"));
        if (input == 0) input = sum(spans, "gen_ai.usage.input_tokens", "chat");
        if (output == 0) output = sum(spans, "gen_ai.usage.output_tokens", "chat");
        if (cacheRead == 0) cacheRead = sum(spans, "gen_ai.usage.cache_read.input_tokens", "chat");
        if (cacheCreate == 0) cacheCreate = spans.stream()
            .filter(item -> "chat".equals(text(item.attributes(), "gen_ai.operation.name")))
            .mapToLong(item -> cacheWrite(item.attributes())).sum();
        if (reasoning == 0) reasoning = Math.max(sum(spans, "gen_ai.usage.reasoning.output_tokens", "chat"),
            sum(spans, "gen_ai.usage.reasoning_tokens", "chat"));
        Instant started = spans.stream().map(item -> instant(item.span().getStartTimeUnixNano())).filter(Objects::nonNull)
            .min(Comparator.naturalOrder()).orElse(receivedAt);
        Instant ended = spans.stream().map(item -> instant(item.span().getEndTimeUnixNano())).filter(Objects::nonNull)
            .max(Comparator.naturalOrder()).orElse(receivedAt);
        int tools = (int) spans.stream().filter(item -> "execute_tool".equals(text(item.attributes(), "gen_ai.operation.name"))).count();
        int errors = (int) spans.stream().filter(item -> item.span().getStatus().getCode() == io.opentelemetry.proto.trace.v1.Status.StatusCode.STATUS_CODE_ERROR || text(item.attributes(), "error.type") != null).count();
        int turns = (int) Math.max(Math.max(number(attrs, "copilot_chat.turn_count"), number(attrs, "github.copilot.turn_count")),
            spans.stream().filter(item -> "chat".equals(text(item.attributes(), "gen_ai.operation.name"))).count());
        boolean captured = spans.stream().anyMatch(item -> item.attributes().has("gen_ai.input.messages")
            || item.attributes().has("gen_ai.output.messages") || item.attributes().has("gen_ai.tool.call.arguments"));
        ObjectNode resource = root.resource();
        return new SessionAggregate(new ScannerStore.SessionValues(conversation,
            first(text(attrs, "gen_ai.agent.name"), text(resource, "service.name")),
            text(attrs, "github.copilot.agent.type"), text(attrs, "gen_ai.request.model"),
            text(attrs, "gen_ai.response.model"), first(text(attrs, "github.copilot.git.repository"), text(attrs, "copilot_chat.repo.remote_url")),
            first(text(attrs, "github.copilot.git.branch"), text(attrs, "copilot_chat.repo.head_branch_name")),
            first(text(attrs, "github.copilot.git.commit_sha"), text(attrs, "copilot_chat.repo.head_commit_hash")),
            started, ended, receivedAt, input, output, cacheRead, cacheCreate, reasoning, turns, tools, errors, captured));
    }

    private long sum(List<SpanEnvelope> spans, String key, String operation) {
        return spans.stream().filter(item -> operation.equals(text(item.attributes(), "gen_ai.operation.name")))
            .mapToLong(item -> number(item.attributes(), key)).sum();
    }

    private long cacheWrite(ObjectNode attributes) {
        return number(attributes, attributes.has("gen_ai.usage.cache_creation.input_tokens")
            ? "gen_ai.usage.cache_creation.input_tokens" : "gen_ai.usage.cache_write.input_tokens");
    }

    private void extractMessages(long spanId, ObjectNode attrs, String key, String direction) {
        JsonNode value = attrs.get(key);
        if (value == null || value.isNull()) return;
        JsonNode parsed = value;
        if (value.isTextual()) {
            try { parsed = mapper.readTree(value.textValue()); }
            catch (JsonProcessingException ignored) { /* preserve as plain text below */ }
        }
        if (parsed.isArray()) {
            int sequence = 0;
            for (JsonNode item : parsed) {
                String role = item.has("role") ? item.get("role").asText() : null;
                store.insertMessage(spanId, direction, sequence++, role, messageContent(item), provenance(direction));
            }
        } else {
            store.insertMessage(spanId, direction, 0, parsed.has("role") ? parsed.get("role").asText() : null,
                messageContent(parsed), provenance(direction));
        }
    }

    private String messageContent(JsonNode node) {
        if (node.isTextual()) return node.textValue();
        JsonNode content = node.get("content");
        return content == null ? node.toString() : (content.isTextual() ? content.textValue() : content.toString());
    }

    private String provenance(String direction) {
        return "definition".equals(direction) ? "explicit" : "telemetry";
    }

    private void persistMetric(long signalId, Metric metric) {
        store.insertMetricOrEvent(signalId, "metric", metric.getName(), null, print(metric), "{}");
    }

    private void persistLog(long signalId, LogRecord log) {
        ObjectNode attrs = attributes(mapper, log.getAttributesList());
        String name = first(text(attrs, "event.name"), log.getEventName(), log.getSeverityText());
        store.insertMetricOrEvent(signalId, "log", name, instant(log.getTimeUnixNano()),
            print(log), attrs.toString());
    }

    private ArrayNode resources(List<Resource> resourceList) {
        ArrayNode array = mapper.createArrayNode();
        resourceList.forEach(resource -> array.add(attributes(mapper, resource.getAttributesList())));
        return array;
    }

    private String print(MessageOrBuilder message) {
        try { return jsonPrinter.print(message); }
        catch (InvalidProtocolBufferException exception) { throw new IllegalStateException("Cannot render protobuf JSON", exception); }
    }

    private ExportTraceServiceRequest parseTraces(byte[] payload, String contentType) throws InvalidProtocolBufferException {
        if (!isJson(contentType)) return ExportTraceServiceRequest.parseFrom(payload);
        ExportTraceServiceRequest.Builder builder = ExportTraceServiceRequest.newBuilder();
        JsonFormat.parser().ignoringUnknownFields().merge(new String(payload, StandardCharsets.UTF_8), builder);
        return builder.build();
    }

    private ExportMetricsServiceRequest parseMetrics(byte[] payload, String contentType) throws InvalidProtocolBufferException {
        if (!isJson(contentType)) return ExportMetricsServiceRequest.parseFrom(payload);
        ExportMetricsServiceRequest.Builder builder = ExportMetricsServiceRequest.newBuilder();
        JsonFormat.parser().ignoringUnknownFields().merge(new String(payload, StandardCharsets.UTF_8), builder);
        return builder.build();
    }

    private ExportLogsServiceRequest parseLogs(byte[] payload, String contentType) throws InvalidProtocolBufferException {
        if (!isJson(contentType)) return ExportLogsServiceRequest.parseFrom(payload);
        ExportLogsServiceRequest.Builder builder = ExportLogsServiceRequest.newBuilder();
        JsonFormat.parser().ignoringUnknownFields().merge(new String(payload, StandardCharsets.UTF_8), builder);
        return builder.build();
    }

    private boolean isJson(String contentType) {
        return contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("application/json");
    }

    @SafeVarargs
    private static <T> T first(T... values) {
        return Arrays.stream(values).filter(value -> value != null && !(value instanceof String s && s.isBlank())).findFirst().orElse(null);
    }

    public boolean isPaused() { return paused.get(); }
    public boolean setPaused(boolean value) {
        paused.set(value);
        return value;
    }

    public record IngestionResult(String signal, int items, boolean ignoredBecausePaused) {}
    private record SpanEnvelope(Span span, ObjectNode attributes, ObjectNode resource) {}
    private record SessionAggregate(ScannerStore.SessionValues values) {}
}
