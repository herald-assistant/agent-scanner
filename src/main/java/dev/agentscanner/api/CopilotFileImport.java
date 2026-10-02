package dev.agentscanner.api;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.google.protobuf.ByteString;
import io.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
import io.opentelemetry.proto.common.v1.AnyValue;
import io.opentelemetry.proto.common.v1.ArrayValue;
import io.opentelemetry.proto.common.v1.InstrumentationScope;
import io.opentelemetry.proto.common.v1.KeyValue;
import io.opentelemetry.proto.common.v1.KeyValueList;
import io.opentelemetry.proto.resource.v1.Resource;
import io.opentelemetry.proto.trace.v1.ResourceSpans;
import io.opentelemetry.proto.trace.v1.ScopeSpans;
import io.opentelemetry.proto.trace.v1.Span;
import io.opentelemetry.proto.trace.v1.Status;
import dev.agentscanner.otel.OtlpIngestionService;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Copilot FileSpanExporter public ReadableSpan JSON, one record per line. No writes. */
final class CopilotFileImport {
    record FileSpan(JsonNode raw, String line, Span span, Resource resource, InstrumentationScope scope,
                    String resourceSchemaUrl, String scopeSchemaUrl, ObjectNode attributes) {
        String key() { return HexFormat.of().formatHex(span.getTraceId().toByteArray()) + ":"
            + HexFormat.of().formatHex(span.getSpanId().toByteArray()); }
    }
    record Parsed(List<FileSpan> spans, Map<String, List<FileSpan>> sessions,
                  Map<String, Set<String>> children, Map<String, Set<String>> supporting,
                  int ignoredRecords, int duplicateRecords) {
        Set<String> sessionTree(String conversationId) {
            if (!sessions.containsKey(conversationId)) throw SessionImportException.invalid("Wybranej sesji nie ma w pliku JSONL.");
            Set<String> result = new LinkedHashSet<>();
            Deque<String> pending = new ArrayDeque<>();
            pending.add(conversationId);
            while (!pending.isEmpty()) {
                String id = pending.removeFirst();
                if (result.add(id)) pending.addAll(children.getOrDefault(id, Set.of()));
            }
            return result;
        }
        Set<String> included(String conversationId) {
            Set<String> result = sessionTree(conversationId);
            for (String id : List.copyOf(result)) result.addAll(supporting.getOrDefault(id, Set.of()));
            return result;
        }
        List<String> roots() {
            Set<String> linked = new HashSet<>();
            children.values().forEach(linked::addAll);
            return sessions.keySet().stream().filter(id -> !linked.contains(id) && sessionEvidence(sessions.get(id))).toList();
        }
        List<FileSpan> selected(String id) {
            Set<String> included = included(id);
            Set<FileSpan> selected = new HashSet<>();
            included.forEach(key -> selected.addAll(sessions.get(key)));
            return spans.stream().filter(selected::contains).toList();
        }
        int unassignedSpans() {
            Set<FileSpan> assigned = new HashSet<>();
            roots().forEach(id -> assigned.addAll(selected(id)));
            return spans.size() - assigned.size();
        }
    }

    static Parsed parse(byte[] body, ObjectMapper mapper) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(body)).toString();
        } catch (Exception failure) { throw SessionImportException.invalid("Plik JSONL musi mieć kodowanie UTF-8."); }
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        var reader = mapper.copy().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).reader();
        Map<String, FileSpan> unique = new LinkedHashMap<>();
        int ignored = 0, duplicates = 0, number = 0;
        for (String line : text.split("\\r?\\n", -1)) {
            number++;
            if (line.isBlank()) continue;
            try {
                JsonNode raw = reader.readTree(line);
                if (raw == null || !raw.isObject()) throw new IllegalArgumentException();
                if (!raw.has("startTime") && !raw.has("endTime")) { ignored++; continue; }
                FileSpan record = convert(raw, line);
                FileSpan previous = unique.putIfAbsent(record.key(), record);
                if (previous != null) {
                    if (!previous.raw().equals(raw)) throw SessionImportException.invalid("Sprzeczne rekordy tego samego spanu w wierszu " + number + ".");
                    duplicates++;
                }
            } catch (SessionImportException failure) { throw failure; }
            catch (Exception failure) {
                throw SessionImportException.invalid("Niepoprawny rekord JSONL w wierszu " + number + ". Sprawdź składnię i dane spanu.");
            }
        }
        if (unique.isEmpty()) throw SessionImportException.invalid("Plik nie zawiera odczytywalnych spanów Copilot OTel JSONL. Eksport Agent Scanner nie jest obsługiwany.");
        List<FileSpan> spans = List.copyOf(unique.values());
        Map<String, List<FileSpan>> sessions = ownership(spans);
        return new Parsed(spans, sessions, children(sessions), supporting(sessions), ignored, duplicates);
    }

    private static boolean sessionEvidence(List<FileSpan> spans) {
        return spans.stream().anyMatch(span -> "invoke_agent".equals(operation(span)))
            || spans.stream().anyMatch(span -> OtlpIngestionService.explicitSessionKey(span.attributes()) != null
                && Set.of("chat", "execute_tool").contains(operation(span)) && !auxiliaryChat(span, spans));
    }

    static List<FileSpan> primaryChats(List<FileSpan> spans) {
        return spans.stream().filter(span -> "chat".equals(operation(span)) && !auxiliaryChat(span, spans)).toList();
    }

    static int auxiliaryCalls(List<FileSpan> spans) {
        return (int) spans.stream().filter(span -> auxiliaryChat(span, spans)).count();
    }

    private static boolean auxiliaryChat(FileSpan span, List<FileSpan> group) {
        if (!"chat".equals(operation(span))) return false;
        String agent = span.attributes().path("gen_ai.agent.name").asText("").toLowerCase(Locale.ROOT);
        // An executionSubagentTool chat inside an actual agent invocation is a child round.
        if (agent.equals("executionsubagenttool") && group.stream().anyMatch(item -> "invoke_agent".equals(operation(item)))) return false;
        return Set.of("title", "progressmessages", "copilot-chat", "backgroundtodoagent", "copilotlanguagemodelwrapper",
            "healapplypatch", "executionsubagenttool", "summarizeconversationhistory-full").contains(agent);
    }

    private static String operation(FileSpan span) {
        return span.attributes().path("gen_ai.operation.name").asText("");
    }

    private static Map<String, Set<String>> supporting(Map<String, List<FileSpan>> sessions) {
        Map<String, Set<String>> result = new LinkedHashMap<>();
        sessions.forEach((id, spans) -> {
            if (sessionEvidence(spans)) return;
            Set<String> parents = new HashSet<>();
            spans.forEach(span -> {
                String parent = span.attributes().path("copilot_chat.parent_chat_session_id").asText("");
                if (!parent.isBlank()) parents.add(parent);
            });
            // Only an explicit, unique chat-session reference can attach a detached technical group.
            // Runtime resource session.id and temporal proximity do not identify a conversation.
            if (parents.size() == 1) {
                String parent = parents.iterator().next();
                if (!parent.equals(id) && sessions.containsKey(parent) && sessionEvidence(sessions.get(parent))) {
                    result.computeIfAbsent(parent, unused -> new LinkedHashSet<>()).add(id);
                }
            }
        });
        return result;
    }

    static ExportTraceServiceRequest request(List<FileSpan> selected) {
        var result = ExportTraceServiceRequest.newBuilder();
        for (FileSpan item : selected) {
            result.addResourceSpans(ResourceSpans.newBuilder().setResource(item.resource())
                .setSchemaUrl(item.resourceSchemaUrl()).addScopeSpans(ScopeSpans.newBuilder()
                    .setScope(item.scope()).setSchemaUrl(item.scopeSchemaUrl()).addSpans(item.span())));
        }
        return result.build();
    }

    private static FileSpan convert(JsonNode raw, String line) {
        var attrs = object(raw.path("attributes"));
        long start = nanos(raw.path("startTime")), end = nanos(raw.path("endTime"));
        if (start <= 0 || end < start) throw new IllegalArgumentException();
        var span = Span.newBuilder().setTraceId(id(raw.path("traceId"), 32))
            .setSpanId(id(raw.path("spanId"), 16)).setName(required(raw, "name"))
            .setStartTimeUnixNano(start).setEndTimeUnixNano(end).addAllAttributes(attributes(attrs));
        JsonNode parent = raw.path("parentSpanContext");
        if (!parent.isMissingNode() && !parent.isNull()) {
            if (!id(parent.path("traceId"), 32).equals(span.getTraceId())) throw new IllegalArgumentException();
            span.setParentSpanId(id(parent.path("spanId"), 16));
        }
        if (raw.has("kind")) {
            int kind = integer(raw.get("kind"));
            if (kind > 4) throw new IllegalArgumentException();
            span.setKindValue(kind + 1); // SDK INTERNAL=0; OTLP UNSPECIFIED=0, INTERNAL=1.
        }
        if (raw.has("traceFlags")) span.setFlags(integer(raw.get("traceFlags")));
        if (raw.path("traceState").isTextual()) span.setTraceState(raw.get("traceState").textValue());
        JsonNode status = raw.path("status");
        if (status.isObject()) {
            int code = integer(status.path("code"));
            if (code > 2) throw new IllegalArgumentException();
            span.setStatus(Status.newBuilder().setCodeValue(code).setMessage(status.path("message").asText("")));
        }
        for (JsonNode event : array(raw, "events")) {
            var converted = Span.Event.newBuilder().setName(required(event, "name"))
                .addAllAttributes(attributes(optionalObject(event, "attributes")));
            if (event.has("time")) converted.setTimeUnixNano(nanos(event.get("time")));
            if (event.has("droppedAttributesCount")) converted.setDroppedAttributesCount(integer(event.get("droppedAttributesCount")));
            span.addEvents(converted);
        }
        for (JsonNode link : array(raw, "links")) {
            JsonNode context = link.path("context");
            var converted = Span.Link.newBuilder().setTraceId(id(context.path("traceId"), 32))
                .setSpanId(id(context.path("spanId"), 16)).addAllAttributes(attributes(optionalObject(link, "attributes")));
            if (context.has("traceFlags")) converted.setFlags(integer(context.get("traceFlags")));
            if (context.path("traceState").isTextual()) converted.setTraceState(context.get("traceState").textValue());
            if (link.has("droppedAttributesCount")) converted.setDroppedAttributesCount(integer(link.get("droppedAttributesCount")));
            span.addLinks(converted);
        }
        if (raw.has("droppedAttributesCount")) span.setDroppedAttributesCount(integer(raw.get("droppedAttributesCount")));
        if (raw.has("droppedEventsCount")) span.setDroppedEventsCount(integer(raw.get("droppedEventsCount")));
        if (raw.has("droppedLinksCount")) span.setDroppedLinksCount(integer(raw.get("droppedLinksCount")));
        JsonNode resource = raw.path("resource"), scope = raw.path("instrumentationScope");
        var resourceBuilder = Resource.newBuilder().addAllAttributes(attributes(optionalObject(resource, "attributes")));
        var scopeBuilder = InstrumentationScope.newBuilder().setName(scope.path("name").asText(""))
            .setVersion(scope.path("version").asText(""))
            .addAllAttributes(attributes(optionalObject(scope, "attributes")));
        return new FileSpan(raw, line, span.build(), resourceBuilder.build(), scopeBuilder.build(),
            resource.path("schemaUrl").asText(""), scope.path("schemaUrl").asText(""), attrs);
    }

    private static Map<String, List<FileSpan>> ownership(List<FileSpan> spans) {
        Map<ByteString, List<FileSpan>> traces = new LinkedHashMap<>();
        spans.forEach(item -> traces.computeIfAbsent(item.span().getTraceId(), unused -> new ArrayList<>()).add(item));
        Map<String, List<FileSpan>> result = new LinkedHashMap<>();
        for (var trace : traces.entrySet()) {
            Map<ByteString, FileSpan> byId = new HashMap<>();
            Set<String> identities = new HashSet<>();
            trace.getValue().forEach(item -> {
                byId.put(item.span().getSpanId(), item);
                String explicit = OtlpIngestionService.explicitSessionKey(item.attributes());
                if (explicit != null) identities.add(explicit);
            });
            for (FileSpan item : trace.getValue()) {
                String owner = null;
                FileSpan ancestor = item;
                Set<ByteString> visited = new HashSet<>();
                while (owner == null && ancestor != null && visited.add(ancestor.span().getSpanId())) {
                    owner = OtlpIngestionService.explicitSessionKey(ancestor.attributes());
                    ancestor = byId.get(ancestor.span().getParentSpanId());
                }
                if (owner == null) owner = identities.size() == 1 ? identities.iterator().next()
                    : "trace:" + HexFormat.of().formatHex(trace.getKey().toByteArray());
                result.computeIfAbsent(owner, unused -> new ArrayList<>()).add(item);
            }
        }
        return result;
    }

    private static Map<String, Set<String>> children(Map<String, List<FileSpan>> sessions) {
        Map<String, Set<String>> parents = new LinkedHashMap<>();
        sessions.forEach((parent, spans) -> spans.stream()
            .filter(span -> "execute_tool".equals(span.attributes().path("gen_ai.operation.name").asText()))
            .forEach(tool -> {
                String callId = tool.attributes().path("gen_ai.tool.call.id").asText("");
                if (!callId.equals(parent) && sessions.containsKey(callId)
                    && sessions.get(callId).stream().anyMatch(child -> "invoke_agent".equals(child.attributes().path("gen_ai.operation.name").asText()))) {
                    parents.computeIfAbsent(callId, unused -> new LinkedHashSet<>()).add(parent);
                }
            }));
        Map<String, Set<String>> result = new LinkedHashMap<>();
        parents.forEach((child, candidates) -> {
            if (candidates.size() == 1) result.computeIfAbsent(candidates.iterator().next(), unused -> new LinkedHashSet<>()).add(child);
        });
        // Remove all cycle-closing relations; no time-based or name-based fallback.
        Map<String, Set<String>> safe = new LinkedHashMap<>();
        result.forEach((parent, linked) -> linked.forEach(child -> {
            if (!reaches(result, child, parent)) safe.computeIfAbsent(parent, unused -> new LinkedHashSet<>()).add(child);
        }));
        return safe;
    }

    private static boolean reaches(Map<String, Set<String>> graph, String start, String target) {
        Set<String> seen = new HashSet<>();
        Deque<String> pending = new ArrayDeque<>();
        pending.add(start);
        while (!pending.isEmpty()) {
            String next = pending.removeFirst();
            if (next.equals(target)) return true;
            if (seen.add(next)) pending.addAll(graph.getOrDefault(next, Set.of()));
        }
        return false;
    }

    private static List<KeyValue> attributes(ObjectNode node) {
        List<KeyValue> result = new ArrayList<>();
        node.fields().forEachRemaining(field -> result.add(KeyValue.newBuilder().setKey(field.getKey())
            .setValue(value(field.getValue(), 0)).build()));
        return result;
    }
    private static AnyValue value(JsonNode node, int depth) {
        if (depth > 30) throw new IllegalArgumentException();
        var result = AnyValue.newBuilder();
        if (node.isTextual()) result.setStringValue(node.textValue());
        else if (node.isBoolean()) result.setBoolValue(node.booleanValue());
        else if (node.isIntegralNumber()) {
            if (!node.canConvertToLong()) throw new IllegalArgumentException();
            result.setIntValue(node.longValue());
        } else if (node.isNumber()) result.setDoubleValue(node.doubleValue());
        else if (node.isArray()) {
            var array = ArrayValue.newBuilder();
            node.forEach(item -> array.addValues(value(item, depth + 1)));
            result.setArrayValue(array);
        } else if (node.isObject()) {
            var map = KeyValueList.newBuilder();
            node.fields().forEachRemaining(field -> map.addValues(KeyValue.newBuilder().setKey(field.getKey())
                .setValue(value(field.getValue(), depth + 1))));
            result.setKvlistValue(map);
        }
        return result.build();
    }
    private static ByteString id(JsonNode node, int length) {
        if (!node.isTextual() || !node.textValue().matches("[0-9a-fA-F]{" + length + "}")
            || node.textValue().matches("0+")) throw new IllegalArgumentException();
        return ByteString.copyFrom(HexFormat.of().parseHex(node.textValue()));
    }
    private static long nanos(JsonNode node) {
        if (!node.isArray() || node.size() != 2 || !node.get(0).isIntegralNumber()
            || !node.get(0).canConvertToLong()) throw new IllegalArgumentException();
        long seconds = node.get(0).longValue();
        int nanos = integer(node.get(1));
        if (seconds < 0 || nanos >= 1_000_000_000) throw new IllegalArgumentException();
        return Math.addExact(Math.multiplyExact(seconds, 1_000_000_000L), nanos);
    }
    private static int integer(JsonNode node) {
        if (!node.isIntegralNumber() || !node.canConvertToInt() || node.intValue() < 0) throw new IllegalArgumentException();
        return node.intValue();
    }
    private static String required(JsonNode node, String field) {
        if (!node.path(field).isTextual() || node.get(field).textValue().isBlank()) throw new IllegalArgumentException();
        return node.get(field).textValue();
    }
    private static ObjectNode object(JsonNode node) {
        if (!(node instanceof ObjectNode result)) throw new IllegalArgumentException();
        return result;
    }
    private static ObjectNode optionalObject(JsonNode node, String field) {
        return node.has(field) ? object(node.get(field)) : JsonNodeFactory.instance.objectNode();
    }
    private static Iterable<JsonNode> array(JsonNode node, String field) {
        if (!node.has(field)) return List.of();
        if (!node.get(field).isArray()) throw new IllegalArgumentException();
        return node.get(field);
    }
}
