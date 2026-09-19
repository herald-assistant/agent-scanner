package dev.agentscanner.ai.sessionchat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.analysis.SessionAnalysisQueryService;
import dev.agentscanner.store.ScannerStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
final class SessionChatService {
    private final ObjectMapper mapper;
    private final ScannerStore store;
    private final SessionAnalysisQueryService queries;
    private final SessionAnalysisToolFactory tools;
    private final CopilotCompletion completion;
    private final SessionChatPrompt prompt;
    private final SessionChatAnswerValidator validator;

    SessionChatService(ObjectMapper mapper, ScannerStore store, SessionAnalysisQueryService queries,
                       SessionAnalysisToolFactory tools, CopilotCompletion completion,
                       SessionChatPrompt prompt, SessionChatAnswerValidator validator) {
        this.mapper = mapper;
        this.store = store;
        this.queries = queries;
        this.tools = tools;
        this.completion = completion;
        this.prompt = prompt;
        this.validator = validator;
    }

    SessionChat.ChatView create(long sessionId, SessionChat.CreateRequest request) {
        if (request == null || request.model() == null || request.model().isBlank()) {
            throw new SessionChatException(HttpStatus.BAD_REQUEST, "Wybierz model dla rozmowy.");
        }
        SessionAnalysisQueryService.Scope scope = queries.createScope(sessionId);
        var bootstrap = queries.bootstrap(scope);
        Instant now = now();
        String id = UUID.randomUUID().toString();
        store.saveSessionChat(id, sessionId, request.model().trim(), scope.cutoffSignalId(),
                scope.reconstructionVersion(), SessionChat.PROMPT_VERSION,
                SessionAnalysisQueryService.TOOLSET_CONTRACT, scope.redactionVersion(),
                json(bootstrap), String.valueOf(bootstrap.get("contextHash")), now);
        return get(sessionId, id);
    }

    List<SessionChat.ChatSummary> list(long sessionId) {
        if (store.session(sessionId).isEmpty()) {
            throw new SessionChatException(HttpStatus.NOT_FOUND, "Nie znaleziono sesji.");
        }
        long currentCutoff;
        try { currentCutoff = queries.createScope(sessionId).cutoffSignalId(); }
        catch (RuntimeException ignored) { currentCutoff = -1; }
        long cutoff = currentCutoff;
        return store.sessionChatIndex(sessionId).stream().map(source -> summary(source, cutoff)).toList();
    }

    SessionChat.ChatView get(long sessionId, String id) {
        return view(load(sessionId, id));
    }

    SessionChat.TurnView ask(long sessionId, String id, SessionChat.TurnRequest request) throws Exception {
        ScannerStore.SessionChatSource chat = load(sessionId, id);
        String question = request.question() == null ? "" : request.question().trim();
        if (question.isBlank() || question.length() > 4_000) {
            throw new SessionChatException(HttpStatus.BAD_REQUEST, "Pytanie musi mieć od 1 do 4000 znaków.");
        }
        String questionHash = queries.hash(question);
        Optional<ScannerStore.SessionChatTurnSource> existing = store.sessionChatTurn(id, request.clientRequestId());
        if (existing.isPresent()) {
            if (!existing.get().questionHash().equals(questionHash)) {
                throw new SessionChatException(HttpStatus.CONFLICT,
                        "Ten klucz wysyłki został już użyty dla innego pytania.");
            }
            return turnView(existing.get());
        }
        if (store.sessionChatTurns(id).stream().anyMatch(turn -> "RUNNING".equals(turn.status()))) {
            throw new SessionChatException(HttpStatus.CONFLICT, "Poprzednia wiadomość w tej rozmowie nadal jest przetwarzana.");
        }

        SessionAnalysisQueryService.Scope scope = scope(chat);
        // Fails before persistence if the frozen source is no longer available.
        queries.overview(scope);
        String turnId = UUID.randomUUID().toString();
        store.saveSessionChatTurn(turnId, id, request.clientRequestId(), question, questionHash, now());
        try {
            JsonNode bootstrap = readTree(chat.bootstrapJson(), "Zapisany bootstrap rozmowy jest uszkodzony.");
            for (String ref : collectEvidenceRefs(bootstrap)) {
                store.saveSessionChatEvidence(id, ref, "bootstrap", turnId);
            }
            var scannerTools = tools.create(scope, id, turnId);
            CopilotCompletion.ConversationReply reply = chat.copilotSessionId() == null || chat.copilotSessionId().isBlank()
                    ? completion.startToolConversation("scanner-session-chat-" + id, chat.model(), prompt.systemMessage(),
                        prompt.initialPrompt(mapper.convertValue(bootstrap, mapper.getTypeFactory()
                            .constructMapType(java.util.LinkedHashMap.class, String.class, Object.class)), question), scannerTools)
                    : completion.continueToolConversation(chat.copilotSessionId(), chat.model(), prompt.systemMessage(),
                        prompt.followUpPrompt(question), scannerTools);
            // Persist the SDK conversation before validating presentation output. A malformed
            // answer must not orphan an otherwise valid multi-turn Copilot session.
            store.saveSessionChatCopilotSession(id, reply.sessionId(), now());
            Set<String> allowedEvidence = store.sessionChatEvidenceRefs(id);
            SessionChat.Answer answer = validator.validate(reply.content(), allowedEvidence);
            queries.overview(scope);
            store.completeSessionChatTurn(id, turnId, reply.sessionId(), json(answer), now());
            return store.sessionChatTurn(id, request.clientRequestId()).map(this::turnView)
                    .orElseThrow(() -> new IllegalStateException("Nie udało się odczytać zapisanej odpowiedzi."));
        } catch (Exception failure) {
            store.failSessionChatTurn(id, turnId, safeMessage(failure), now());
            throw failure;
        }
    }

    private ScannerStore.SessionChatSource load(long sessionId, String id) {
        ScannerStore.SessionChatSource source = store.sessionChat(id).orElseThrow(() ->
                new SessionChatException(HttpStatus.NOT_FOUND, "Nie znaleziono tej rozmowy."));
        if (source.sessionId() != sessionId) {
            throw new SessionChatException(HttpStatus.NOT_FOUND, "Nie znaleziono tej rozmowy w wybranej sesji.");
        }
        return source;
    }

    private SessionAnalysisQueryService.Scope scope(ScannerStore.SessionChatSource source) {
        return new SessionAnalysisQueryService.Scope(source.sessionId(), source.cutoffSignalId(),
                source.reconstructionVersion(), source.redactionVersion(), "local-user");
    }

    private SessionChat.ChatView view(ScannerStore.SessionChatSource source) {
        long currentCutoff;
        try { currentCutoff = queries.createScope(source.sessionId()).cutoffSignalId(); }
        catch (RuntimeException ignored) { currentCutoff = source.cutoffSignalId(); }
        return new SessionChat.ChatView(source.id(), source.sessionId(), source.model(), source.cutoffSignalId(),
                source.contextHash(),
                readTree(source.bootstrapJson(), "Zapisany bootstrap rozmowy jest uszkodzony."), source.revision(),
                source.createdAt().toString(), source.updatedAt().toString(), currentCutoff > source.cutoffSignalId(),
                store.sessionChatTurns(source.id()).stream().map(this::turnView).toList());
    }

    private SessionChat.ChatSummary summary(ScannerStore.SessionChatIndexSource source, long currentCutoff) {
        return new SessionChat.ChatSummary(source.id(), source.sessionId(), source.model(), source.revision(),
                source.createdAt().toString(), source.updatedAt().toString(), currentCutoff > source.cutoffSignalId(),
                source.turnCount(), source.lastQuestion(), source.lastTurnStatus());
    }

    private SessionChat.TurnView turnView(ScannerStore.SessionChatTurnSource source) {
        return new SessionChat.TurnView(source.id(), source.clientRequestId(), source.question(), source.status(),
                source.answerJson() == null ? null : read(source.answerJson(), SessionChat.Answer.class,
                    "Zapisana odpowiedź rozmowy jest uszkodzona."), source.errorMessage(),
                source.createdAt().toString(), source.completedAt() == null ? null : source.completedAt().toString(),
                store.sessionChatToolCalls(source.id()).stream().map(this::toolCallView).toList());
    }

    private SessionChat.ToolCallView toolCallView(ScannerStore.SessionChatToolCallSource source) {
        return new SessionChat.ToolCallView(source.id(), source.toolName(), activityLabel(source.toolName()),
                source.status(), readTree(source.argumentsJson(), "Zapisane parametry narzędzia są uszkodzone."),
                source.resultJson() == null ? null : readTree(source.resultJson(), "Zapisany wynik narzędzia jest uszkodzony."),
                source.resultCharacters(), source.truncated(), source.errorMessage(), source.startedAt().toString(),
                source.completedAt() == null ? null : source.completedAt().toString());
    }

    private String activityLabel(String name) {
        return switch (name) {
            case "scanner_get_session_overview" -> "Sprawdzono podsumowanie sesji";
            case "scanner_get_configuration" -> "Sprawdzono konfigurację środowiska";
            case "scanner_list_interactions" -> "Przejrzano interakcje";
            case "scanner_list_rounds" -> "Przejrzano rundy";
            case "scanner_get_round_evidence" -> "Odczytano dowody rundy";
            case "scanner_get_subagent_tree" -> "Sprawdzono delegowanie";
            case "scanner_get_cost_summary" -> "Przeliczono metryki sesji";
            case "scanner_search_session" -> "Przeszukano sesję";
            default -> "Odczytano dane Scannera";
        };
    }

    private Set<String> collectEvidenceRefs(JsonNode node) {
        Set<String> refs = new LinkedHashSet<>();
        collectEvidenceRefs(node, null, refs, 0);
        return refs;
    }

    private void collectEvidenceRefs(JsonNode node, String key, Set<String> refs, int depth) {
        if (node == null || depth > 30) return;
        if (node.isTextual() && key != null && (key.equals("roundRef") || key.equals("evidenceRef") || key.equals("ref"))) {
            if (node.asText().contains("/")) refs.add(node.asText());
            return;
        }
        if (node.isArray()) node.forEach(child -> collectEvidenceRefs(child, key, refs, depth + 1));
        else if (node.isObject()) node.fields().forEachRemaining(entry ->
                collectEvidenceRefs(entry.getValue(), entry.getKey(), refs, depth + 1));
    }

    private <T> T read(String json, Class<T> type, String message) {
        try {
            return mapper.readerFor(type).with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readValue(json);
        } catch (JsonProcessingException failure) { throw new IllegalStateException(message, failure); }
    }

    private JsonNode readTree(String json, String message) {
        try { return mapper.readTree(json); }
        catch (JsonProcessingException failure) { throw new IllegalStateException(message, failure); }
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (JsonProcessingException failure) { throw new IllegalStateException("Nie udało się zapisać rozmowy.", failure); }
    }

    private String safeMessage(Exception failure) {
        if (failure instanceof SessionChatException || failure instanceof IllegalArgumentException) return failure.getMessage();
        return failure.getMessage() == null || failure.getMessage().isBlank()
                ? "Nie udało się zakończyć tury rozmowy." : failure.getMessage();
    }

    private Instant now() { return Instant.now().truncatedTo(ChronoUnit.MILLIS); }
}
