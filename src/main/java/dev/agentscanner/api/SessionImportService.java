package dev.agentscanner.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.protobuf.util.JsonFormat;
import dev.agentscanner.otel.OtlpIngestionService;
import dev.agentscanner.otel.OtelJson;
import dev.agentscanner.store.ScannerStore;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
class SessionImportService {
    private final ScannerStore store;
    private final OtlpIngestionService ingestion;
    private final ObjectMapper mapper;

    SessionImportService(ScannerStore store, OtlpIngestionService ingestion, ObjectMapper mapper) {
        this.store = store;
        this.ingestion = ingestion;
        this.mapper = mapper;
    }

    ImportPreview preview(byte[] body) {
        var parsed = CopilotFileImport.parse(body, mapper);
        var sessions = parsed.roots().stream().map(id -> {
            var selected = parsed.selected(id);
            var own = parsed.sessions().get(id);
            var root = own.stream().filter(span -> "invoke_agent".equals(text(span.attributes(), "gen_ai.operation.name")))
                .min(Comparator.comparingLong(span -> span.span().getStartTimeUnixNano())).orElse(own.get(0));
            var primaryChats = CopilotFileImport.primaryChats(own);
            String model = primaryChats.stream().map(span -> first(text(span.attributes(), "gen_ai.response.model"),
                text(span.attributes(), "gen_ai.request.model"))).filter(Objects::nonNull).distinct().collect(Collectors.joining(", "));
            long start = own.stream().mapToLong(span -> span.span().getStartTimeUnixNano()).min().orElseThrow();
            long end = own.stream().mapToLong(span -> span.span().getEndTimeUnixNano()).max().orElseThrow();
            int relatedTurns = parsed.sessionTree(id).stream().filter(child -> !child.equals(id))
                .mapToInt(child -> CopilotFileImport.primaryChats(parsed.sessions().get(child)).size()).sum();
            int auxiliaryCalls = parsed.included(id).stream()
                .mapToInt(key -> CopilotFileImport.auxiliaryCalls(parsed.sessions().get(key))).sum();
            boolean captured = selected.stream().anyMatch(span -> span.attributes().has("gen_ai.input.messages")
                || span.attributes().has("gen_ai.output.messages") || span.attributes().has("gen_ai.tool.call.arguments"));
            return new ImportCandidate(id, text(root.attributes(), "gen_ai.agent.name"),
                first(text(root.attributes(), "github.copilot.git.repository"), text(root.attributes(), "copilot_chat.repo.remote_url")),
                model.isBlank() ? null : model, OtelJson.instant(start), OtelJson.instant(end), selected.size(), primaryChats.size(),
                parsed.sessionTree(id).size() - 1, relatedTurns, auxiliaryCalls, captured, conflict(parsed.included(id), selected));
        }).sorted(Comparator.comparing(ImportCandidate::startedAt).reversed().thenComparing(ImportCandidate::conversationId)).toList();
        return new ImportPreview(sessions, parsed.ignoredRecords(), parsed.duplicateRecords(), parsed.unassignedSpans());
    }

    @Transactional
    ImportResult importSession(byte[] body, String conversationId) {
        var parsed = CopilotFileImport.parse(body, mapper);
        if (!parsed.roots().contains(conversationId)) throw SessionImportException.invalid("Wybierz jedną sesję z listy podglądu importu.");
        var selected = parsed.selected(conversationId);
        if (conflict(parsed.included(conversationId), selected)) {
            throw SessionImportException.conflict("Ta sesja, jej subagent lub jeden z jej spanów jest już zapisany w lokalnej bazie.");
        }
        try {
            var request = CopilotFileImport.request(selected);
            String otlp = JsonFormat.printer().preservingProtoFieldNames().includingDefaultValueFields().print(request);
            ObjectNode raw = (ObjectNode) mapper.readTree(otlp);
            raw.put("sourceFormat", "copilot-otel-jsonl");
            var records = raw.putArray("fileRecords");
            selected.forEach(span -> records.add(span.raw()));
            byte[] original = selected.stream().map(CopilotFileImport.FileSpan::line)
                .collect(Collectors.joining("\n", "", "\n")).getBytes(StandardCharsets.UTF_8);
            var result = ingestion.importFileTraces(otlp.getBytes(StandardCharsets.UTF_8), raw.toString(), original);
            long sessionId = store.sessionIdByConversationId(conversationId)
                .orElseThrow(() -> SessionImportException.invalid("Nie udało się odtworzyć wybranej sesji."));
            return new ImportResult(sessionId, 1, result.items());
        } catch (SessionImportException failure) { throw failure; }
        catch (Exception failure) { throw SessionImportException.invalid("Nie można odtworzyć telemetrii wybranej sesji JSONL."); }
    }

    private boolean conflict(Set<String> conversations, List<CopilotFileImport.FileSpan> selected) {
        return conversations.stream().anyMatch(id -> store.sessionIdByConversationId(id).isPresent())
            || selected.stream().anyMatch(span -> store.hasSpan(OtelJson.hex(span.span().getTraceId()), OtelJson.hex(span.span().getSpanId())));
    }
    private static String text(ObjectNode attrs, String key) { return OtelJson.text(attrs, key); }
    private static String first(String... values) {
        return Arrays.stream(values).filter(value -> value != null && !value.isBlank()).findFirst().orElse(null);
    }
    record ImportCandidate(String conversationId, String agentName, String repository, String model,
                           Instant startedAt, Instant endedAt, int spans, int turns, int relatedSessions,
                           int relatedTurns, int auxiliaryCalls,
                           boolean contentCaptured, boolean alreadyImported) {}
    record ImportPreview(List<ImportCandidate> sessions, int ignoredRecords, int duplicateRecords, int unassignedSpans) {}
    record ImportResult(long sessionId, int signals, int spans) {}
}

final class SessionImportException extends RuntimeException {
    private final boolean conflict;
    private SessionImportException(String message, boolean conflict) { super(message); this.conflict = conflict; }
    static SessionImportException invalid(String message) { return new SessionImportException(message, false); }
    static SessionImportException conflict(String message) { return new SessionImportException(message, true); }
    boolean conflict() { return conflict; }
}
