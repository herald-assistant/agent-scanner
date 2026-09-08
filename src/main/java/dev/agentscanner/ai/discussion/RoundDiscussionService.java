package dev.agentscanner.ai.discussion;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.store.ScannerStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
final class RoundDiscussionService {
    private final ObjectMapper mapper;
    private final ScannerStore store;
    private final CopilotCompletion completion;
    private final RoundDiscussionEvidenceService evidence;
    private final RoundDiscussionPrompt prompt;
    private final RoundDiscussionAnswerValidator answerValidator;

    RoundDiscussionService(ObjectMapper mapper, ScannerStore store, CopilotCompletion completion,
                           RoundDiscussionEvidenceService evidence, RoundDiscussionPrompt prompt,
                           RoundDiscussionAnswerValidator answerValidator) {
        this.mapper = mapper;
        this.store = store;
        this.completion = completion;
        this.evidence = evidence;
        this.prompt = prompt;
        this.answerValidator = answerValidator;
    }

    RoundDiscussion.DiscussionView create(long sessionId, RoundDiscussion.CreateRequest request) {
        if (request.snapshot().selection().rootSessionId() != sessionId) {
            throw new RoundDiscussionException(HttpStatus.BAD_REQUEST, "Migawka wskazuje inną sesję główną.");
        }
        Instant now = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        String id = UUID.randomUUID().toString();
        store.saveRoundDiscussion(id, sessionId, RoundDiscussion.VERSION, request.model(),
                request.snapshot().contentHash(), evidence.snapshotJson(request.snapshot()), now);
        return get(sessionId, id);
    }

    List<RoundDiscussion.DiscussionView> list(long sessionId) {
        if (store.session(sessionId).isEmpty()) {
            throw new RoundDiscussionException(HttpStatus.NOT_FOUND, "Nie znaleziono sesji.");
        }
        return store.roundDiscussions(sessionId).stream().map(this::view).toList();
    }

    RoundDiscussion.DiscussionView get(long sessionId, String id) {
        ScannerStore.RoundDiscussionSource source = load(sessionId, id);
        return view(source);
    }

    RoundDiscussion.TurnView ask(long sessionId, String id, RoundDiscussion.TurnRequest request) throws Exception {
        ScannerStore.RoundDiscussionSource discussion = load(sessionId, id);
        Optional<ScannerStore.RoundDiscussionTurnSource> existing =
                store.roundDiscussionTurn(id, request.clientRequestId());
        if (existing.isPresent()) {
            if (!existing.get().question().equals(request.question())) {
                throw new RoundDiscussionException(HttpStatus.CONFLICT,
                        "Ten klucz wysyłki został już użyty dla innego pytania.");
            }
            return turnView(existing.get());
        }

        RoundDiscussion.EvidenceSnapshot snapshot = evidence.readSnapshot(discussion.snapshotJson());
        evidence.revalidate(sessionId, snapshot);
        String turnId = UUID.randomUUID().toString();
        Instant startedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        store.saveRoundDiscussionTurn(turnId, id, request.clientRequestId(), request.question(), startedAt);
        try {
            CopilotCompletion.ConversationReply reply;
            if (discussion.copilotSessionId() == null || discussion.copilotSessionId().isBlank()) {
                reply = completion.startConversation(discussion.model(), prompt.systemMessage(),
                        prompt.initialPrompt(snapshot, request.question()));
            } else {
                reply = completion.continueConversation(discussion.copilotSessionId(), discussion.model(),
                        prompt.systemMessage(), prompt.followUpPrompt(request.question()));
            }
            RoundDiscussion.Answer answer = answerValidator.validate(reply.content(), snapshot);
            evidence.revalidate(sessionId, snapshot);
            Instant completedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
            store.completeRoundDiscussionTurn(id, turnId, reply.sessionId(), mapper.writeValueAsString(answer), completedAt);
            return store.roundDiscussionTurn(id, request.clientRequestId()).map(this::turnView)
                    .orElseThrow(() -> new IllegalStateException("Nie udało się odczytać zapisanej odpowiedzi."));
        } catch (Exception failure) {
            String message = failure instanceof RoundDiscussionException ? failure.getMessage()
                    : failure.getMessage() == null || failure.getMessage().isBlank()
                    ? "Nie udało się zakończyć tury rozmowy." : failure.getMessage();
            store.failRoundDiscussionTurn(id, turnId, message, Instant.now().truncatedTo(ChronoUnit.MILLIS));
            throw failure;
        }
    }

    private ScannerStore.RoundDiscussionSource load(long sessionId, String id) {
        ScannerStore.RoundDiscussionSource source = store.roundDiscussion(id).orElseThrow(() ->
                new RoundDiscussionException(HttpStatus.NOT_FOUND, "Nie znaleziono tej rozmowy."));
        if (source.sessionId() != sessionId) {
            throw new RoundDiscussionException(HttpStatus.NOT_FOUND, "Nie znaleziono tej rozmowy w wybranej sesji.");
        }
        if (!RoundDiscussion.VERSION.equals(source.version())) {
            throw new RoundDiscussionException(HttpStatus.CONFLICT, "Wersja zapisanej rozmowy nie jest obsługiwana.");
        }
        return source;
    }

    private RoundDiscussion.DiscussionView view(ScannerStore.RoundDiscussionSource source) {
        return new RoundDiscussion.DiscussionView(
                source.id(), source.sessionId(), source.version(), source.model(), source.evidenceHash(),
                evidence.readSnapshot(source.snapshotJson()), source.revision(), source.createdAt().toString(),
                source.updatedAt().toString(), store.roundDiscussionTurns(source.id()).stream().map(this::turnView).toList());
    }

    private RoundDiscussion.TurnView turnView(ScannerStore.RoundDiscussionTurnSource source) {
        return new RoundDiscussion.TurnView(source.id(), source.clientRequestId(), source.question(), source.status(),
                readAnswer(source.answerJson()), source.errorMessage(), source.createdAt().toString(),
                source.completedAt() == null ? null : source.completedAt().toString());
    }

    private RoundDiscussion.Answer readAnswer(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return mapper.readerFor(RoundDiscussion.Answer.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readValue(json);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Zapisana odpowiedź rozmowy jest uszkodzona.", failure);
        }
    }
}
