package dev.agentscanner.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.config.ScannerProperties;
import dev.agentscanner.analysis.SessionReconstructionService;
import dev.agentscanner.ai.sessionchat.SessionChatCleanupService;
import dev.agentscanner.otel.OtlpIngestionService;
import dev.agentscanner.store.ScannerStore;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ScannerApiController {
    private final ScannerStore store;
    private final OtlpIngestionService ingestion;
    private final ScannerProperties properties;
    private final ObjectMapper mapper;
    private final SessionImportService sessionImport;
    private final SessionReconstructionService reconstruction;
    private final SessionChatCleanupService sessionChatCleanup;

    public ScannerApiController(ScannerStore store, OtlpIngestionService ingestion,
                                ScannerProperties properties, ObjectMapper mapper,
                                SessionImportService sessionImport,
                                SessionReconstructionService reconstruction,
                                SessionChatCleanupService sessionChatCleanup) {
        this.store = store;
        this.ingestion = ingestion;
        this.properties = properties;
        this.mapper = mapper;
        this.sessionImport = sessionImport;
        this.reconstruction = reconstruction;
        this.sessionChatCleanup = sessionChatCleanup;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Map<String, Object> result = ApiView.row(store.status(ingestion.isPaused()));
        result.put("connected", result.get("lastSignalAt") != null);
        result.put("retentionDays", properties.retentionDays());
        return result;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        Map<String, Object> settings = new LinkedHashMap<>();
        settings.put("github.copilot.chat.otel.enabled", true);
        settings.put("github.copilot.chat.otel.exporterType", "otlp-http");
        settings.put("github.copilot.chat.otel.protocol", "http/protobuf");
        settings.put("github.copilot.chat.otel.otlpEndpoint", "http://localhost:8081");
        settings.put("github.copilot.chat.otel.captureContent", true);
        settings.put("github.copilot.chat.otel.maxAttributeSizeChars", 0);
        return Map.of(
            "settings", settings,
            "warning", "Pełna telemetria może zawierać kod, prompty, ścieżki plików, komendy i wyniki narzędzi.",
            "precedence", "Ustawienia zarządzane przez organizację i zmienne środowiskowe mogą nadpisać settings.json."
        );
    }

    @GetMapping("/sessions")
    public List<Map<String, Object>> sessions() {
        Map<Long, List<String>> resources = store.sessionResourceAttributes();
        return store.sessions().stream().map(row -> sessionView(row,
            resources.getOrDefault(((Number) row.get("ID")).longValue(), List.of()))).toList();
    }

    @GetMapping("/sessions/{id}")
    public ResponseEntity<Map<String, Object>> session(@PathVariable long id) {
        return store.session(id).map(session -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("session", sessionView(session, store.sessionResourceAttributes(id)));
            result.put("spans", ApiView.rows(store.spans(id)));
            result.put("messages", ApiView.rows(store.messages(id)));
            result.put("signals", ApiView.rows(store.signals(id)));
            return ResponseEntity.ok(result);
        }).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/sessions/{id}/analysis")
    public ResponseEntity<Map<String, Object>> sessionAnalysis(@PathVariable long id) {
        return reconstruction.reconstruct(id).map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/sessions/{id}/workflow-sources")
    public ResponseEntity<Map<String, Object>> sessionWorkflowSources(@PathVariable long id) {
        return reconstruction.workflowSources(id).map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    private Map<String, Object> sessionView(Map<String, Object> row, List<String> resources) {
        Map<String, Object> result = ApiView.row(row);
        SessionSourceView.addTo(result, resources, mapper);
        return result;
    }

    @GetMapping(value = "/sessions/{id}/export", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> export(@PathVariable long id) throws Exception {
        ResponseEntity<Map<String, Object>> response = session(id);
        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) return ResponseEntity.notFound().build();
        Map<String, Object> export = new LinkedHashMap<>();
        export.put("format", "agent-scanner-session");
        export.put("version", 1);
        export.put("exportedAt", Instant.now());
        export.putAll(response.getBody());
        byte[] bytes = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(export);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=agent-scanner-session-" + id + ".json")
            .contentType(MediaType.APPLICATION_JSON).body(bytes);
    }

    @PostMapping(value = "/sessions/import/preview", consumes = "application/x-ndjson",
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> previewSessionImport(@RequestBody byte[] body) {
        if (body.length > properties.maxPayloadBytes()) {
            return ResponseEntity.status(413).body(Map.of("error", "Plik przekracza dozwolony rozmiar importu."));
        }
        try {
            return ResponseEntity.ok(sessionImport.preview(body));
        } catch (SessionImportException exception) {
            return ResponseEntity.badRequest().body(Map.of("error", exception.getMessage()));
        }
    }

    @PostMapping(value = "/sessions/import", consumes = "application/x-ndjson",
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> importSession(@RequestBody byte[] body, @RequestParam String conversationId) {
        if (body.length > properties.maxPayloadBytes()) {
            return ResponseEntity.status(413).body(Map.of("error", "Plik przekracza dozwolony rozmiar importu."));
        }
        try {
            SessionImportService.ImportResult result = sessionImport.importSession(body, conversationId);
            store.checkpoint();
            return ResponseEntity.status(201).body(Map.of(
                "sessionId", result.sessionId(),
                "signals", result.signals(),
                "spans", result.spans()
            ));
        } catch (SessionImportException exception) {
            return ResponseEntity.status(exception.conflict() ? 409 : 400)
                .body(Map.of("error", exception.getMessage()));
        } catch (Exception exception) {
            return ResponseEntity.badRequest().body(Map.of("error", "Nie udało się zaimportować sesji Copilot OTel JSONL."));
        }
    }

    @DeleteMapping("/sessions/{id}")
    public ResponseEntity<Void> deleteSession(@PathVariable long id) {
        if (store.session(id).isEmpty()) return ResponseEntity.notFound().build();
        sessionChatCleanup.cleanupSession(id);
        store.deleteSession(id);
        store.checkpoint();
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/data")
    public ResponseEntity<Void> deleteAll() {
        sessionChatCleanup.cleanupAll();
        store.deleteAll();
        store.checkpoint();
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/pause")
    public Map<String, Boolean> pause(@RequestBody PauseRequest request) {
        return Map.of("paused", ingestion.setPaused(request.paused()));
    }

    public record PauseRequest(boolean paused) {}
}
