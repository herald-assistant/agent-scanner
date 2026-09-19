package dev.agentscanner.ai.sessionchat;

import dev.agentscanner.ai.AiExecutionCoordinator;
import dev.agentscanner.ai.AiExecutionException;
import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.ai.CopilotProperties;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/ai/session-chats")
public final class SessionChatController {
    private final SessionChatService service;
    private final CopilotCompletion completion;
    private final CopilotProperties properties;
    private final AiExecutionCoordinator coordinator;
    private final SessionChatCleanupService cleanup;

    SessionChatController(SessionChatService service, CopilotCompletion completion,
                          CopilotProperties properties, AiExecutionCoordinator coordinator,
                          SessionChatCleanupService cleanup) {
        this.service = service;
        this.completion = completion;
        this.properties = properties;
        this.coordinator = coordinator;
        this.cleanup = cleanup;
    }

    @GetMapping("/models")
    public CompletableFuture<ResponseEntity<?>> models() {
        if (!properties.credentialsConfigured()) {
            return CompletableFuture.completedFuture(error(503,
                    "Ustaw agent-scanner.ai.github-token, aby pobrać modele dostępne dla konta Copilot."));
        }
        return coordinator.<ResponseEntity<?>>submit(() -> {
            try {
                return ResponseEntity.ok(new SessionChat.ModelsResponse(true, properties.model(), false,
                        completion.availableModels()));
            } catch (InterruptedException failure) {
                Thread.currentThread().interrupt();
                return error(503, "Pobieranie modeli zostało przerwane.");
            } catch (AiExecutionException failure) {
                return error(failure.code() == AiExecutionException.Code.TIMEOUT ? 504 : 502, failure.getMessage());
            } catch (Exception failure) {
                return error(502, "Nie udało się pobrać modeli dostępnych dla konta Copilot.");
            }
        }).orElseGet(() -> CompletableFuture.completedFuture(error(409,
                "Trwa inne działanie AI. Poczekaj na jego zakończenie.")));
    }

    @PostMapping
    public SessionChat.ChatView create(@RequestParam long sessionId,
                                       @Valid @RequestBody SessionChat.CreateRequest request) {
        return service.create(sessionId, request);
    }

    @GetMapping
    public List<SessionChat.ChatSummary> list(@RequestParam long sessionId) {
        return service.list(sessionId);
    }

    @GetMapping("/{id}")
    public SessionChat.ChatView get(@RequestParam long sessionId, @PathVariable String id) {
        return service.get(sessionId, id);
    }

    @org.springframework.web.bind.annotation.DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@RequestParam long sessionId, @PathVariable String id) {
        cleanup.deleteChat(sessionId, id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/turns")
    public CompletableFuture<ResponseEntity<?>> ask(@RequestParam long sessionId, @PathVariable String id,
                                                     @Valid @RequestBody SessionChat.TurnRequest request) {
        if (!properties.credentialsConfigured()) {
            return CompletableFuture.completedFuture(error(503,
                    "Ustaw agent-scanner.ai.github-token, aby rozpocząć rozmowę z Copilotem."));
        }
        return coordinator.<ResponseEntity<?>>submit(() -> executeTurn(sessionId, id, request))
                .orElseGet(() -> CompletableFuture.completedFuture(error(409,
                        "Trwa inne działanie AI. Poczekaj na jego zakończenie.")));
    }

    private ResponseEntity<?> executeTurn(long sessionId, String id, SessionChat.TurnRequest request) {
        try {
            return ResponseEntity.ok(service.ask(sessionId, id, request));
        } catch (SessionChatException failure) {
            return error(failure.status().value(), failure.getMessage());
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            return error(503, "Rozmowa została przerwana. Możesz spróbować ponownie.");
        } catch (AiExecutionException failure) {
            return error(failure.code() == AiExecutionException.Code.TIMEOUT ? 504 : 502, failure.getMessage());
        } catch (Exception failure) {
            return error(502, "Model nie zwrócił poprawnej odpowiedzi dla tej rozmowy.");
        }
    }

    @ExceptionHandler(SessionChatException.class)
    ResponseEntity<?> invalid(SessionChatException failure) {
        return error(failure.status().value(), failure.getMessage());
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentNotValidException.class})
    ResponseEntity<?> invalidRequest() {
        return error(400, "Żądanie rozmowy ma niepoprawną strukturę.");
    }

    private ResponseEntity<?> error(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }
}
