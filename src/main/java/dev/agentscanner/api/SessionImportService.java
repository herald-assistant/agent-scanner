package dev.agentscanner.api;

import com.fasterxml.jackson.databind.JsonNode;
import dev.agentscanner.otel.InvalidOtlpPayloadException;
import dev.agentscanner.otel.OtlpIngestionService;
import dev.agentscanner.store.ScannerStore;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;

@Service
class SessionImportService {
    private static final String FORMAT = "agent-scanner-session";
    private static final int VERSION = 1;

    private final ScannerStore store;
    private final OtlpIngestionService ingestion;

    SessionImportService(ScannerStore store, OtlpIngestionService ingestion) {
        this.store = store;
        this.ingestion = ingestion;
    }

    @Transactional
    ImportResult importSession(JsonNode document) {
        if (document == null || !document.isObject()) {
            throw SessionImportException.invalid("Plik nie zawiera obiektu JSON eksportu Agent Scanner.");
        }
        if (!FORMAT.equals(document.path("format").asText()) || document.path("version").asInt(-1) != VERSION) {
            throw SessionImportException.invalid("Nieobsługiwany format eksportu. Wymagany agent-scanner-session w wersji 1.");
        }

        JsonNode session = document.path("session");
        String conversationId = requiredText(session, "conversationId", "Brak identyfikatora conversationId w eksporcie.");
        if (store.sessionIdByConversationId(conversationId).isPresent()) {
            throw SessionImportException.conflict("Ta sesja jest już zapisana w lokalnej bazie.");
        }

        JsonNode signals = document.path("signals");
        if (!signals.isArray() || signals.isEmpty()) {
            throw SessionImportException.invalid("Eksport nie zawiera surowych sygnałów OTLP potrzebnych do odtworzenia sesji.");
        }

        int importedSignals = 0;
        int importedItems = 0;
        try {
            for (JsonNode signal : signals) {
                String signalType = requiredText(signal, "signalType", "Sygnał eksportu nie ma typu.");
                if (!"traces".equals(signalType)) {
                    throw SessionImportException.invalid("Eksport sesji zawiera nieobsługiwany sygnał: " + signalType + ".");
                }
                String rawJson = requiredText(signal, "rawJson", "Sygnał eksportu nie zawiera rawJson.");
                OtlpIngestionService.IngestionResult result = ingestion.importTracesJson(rawJson.getBytes(StandardCharsets.UTF_8));
                importedSignals++;
                importedItems += result.items();
            }
        } catch (InvalidOtlpPayloadException exception) {
            throw SessionImportException.invalid("Nie można odtworzyć telemetrii z eksportu: " + exception.getMessage());
        }

        long sessionId = store.sessionIdByConversationId(conversationId)
            .orElseThrow(() -> SessionImportException.invalid("Sygnały OTLP nie zawierają deklarowanej sesji."));
        return new ImportResult(sessionId, importedSignals, importedItems);
    }

    private String requiredText(JsonNode parent, String field, String error) {
        if (!parent.isObject() || !parent.hasNonNull(field) || !parent.get(field).isTextual()
            || parent.get(field).textValue().isBlank()) {
            throw SessionImportException.invalid(error);
        }
        return parent.get(field).textValue();
    }

    record ImportResult(long sessionId, int signals, int spans) {}
}

final class SessionImportException extends RuntimeException {
    private final boolean conflict;

    private SessionImportException(String message, boolean conflict) {
        super(message);
        this.conflict = conflict;
    }

    static SessionImportException invalid(String message) { return new SessionImportException(message, false); }
    static SessionImportException conflict(String message) { return new SessionImportException(message, true); }
    boolean conflict() { return conflict; }
}
