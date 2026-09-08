package dev.agentscanner.ai.discussion;

import com.fasterxml.jackson.databind.JsonNode;
import dev.agentscanner.ai.AiExecutionCoordinator;
import dev.agentscanner.ai.AiExecutionException;
import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.ai.CopilotProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/ai/round-discussions")
public final class RoundDiscussionController {
    private final RoundDiscussionService service;
    private final RoundDiscussionEvidenceService evidence;
    private final CopilotCompletion completion;
    private final CopilotProperties properties;
    private final AiExecutionCoordinator coordinator;

    public RoundDiscussionController(RoundDiscussionService service, RoundDiscussionEvidenceService evidence,
                                     CopilotCompletion completion, CopilotProperties properties,
                                     AiExecutionCoordinator coordinator) {
        this.service = service;
        this.evidence = evidence;
        this.completion = completion;
        this.properties = properties;
        this.coordinator = coordinator;
    }

    @GetMapping("/models")
    public CompletableFuture<ResponseEntity<?>> models() {
        if (!properties.credentialsConfigured()) {
            return CompletableFuture.completedFuture(error(503,
                    "Ustaw agent-scanner.ai.github-token, aby pobrać modele dostępne dla konta Copilot."));
        }
        return coordinator.<ResponseEntity<?>>submit(() -> {
            try {
                return ResponseEntity.ok(new RoundDiscussion.ModelsResponse(true, properties.model(), false,
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
    public RoundDiscussion.DiscussionView create(@RequestParam long sessionId, @RequestBody JsonNode body) {
        return service.create(sessionId, evidence.readAndValidate(body));
    }

    @GetMapping
    public java.util.List<RoundDiscussion.DiscussionView> list(@RequestParam long sessionId) {
        return service.list(sessionId);
    }

    @GetMapping("/{id}")
    public RoundDiscussion.DiscussionView get(@RequestParam long sessionId, @PathVariable String id) {
        return service.get(sessionId, id);
    }

    @PostMapping("/{id}/turns")
    public CompletableFuture<ResponseEntity<?>> ask(@RequestParam long sessionId, @PathVariable String id,
                                                     @RequestBody JsonNode body) {
        RoundDiscussion.TurnRequest request = evidence.readTurn(body);
        if (!properties.credentialsConfigured()) {
            return CompletableFuture.completedFuture(error(503,
                    "Ustaw agent-scanner.ai.github-token, aby rozpocząć rozmowę z Copilotem."));
        }
        return coordinator.<ResponseEntity<?>>submit(() -> executeTurn(sessionId, id, request))
                .orElseGet(() -> CompletableFuture.completedFuture(error(409,
                        "Trwa inne działanie AI. Poczekaj na jego zakończenie.")));
    }

    private ResponseEntity<?> executeTurn(long sessionId, String id, RoundDiscussion.TurnRequest request) {
        try {
            return ResponseEntity.ok(service.ask(sessionId, id, request));
        } catch (RoundDiscussionException failure) {
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

    @ExceptionHandler(RoundDiscussionException.class)
    ResponseEntity<?> invalid(RoundDiscussionException failure) {
        return error(failure.status().value(), failure.getMessage());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> invalidRequest() {
        return error(400, "Żądanie rozmowy ma niepoprawną strukturę.");
    }

    private ResponseEntity<?> error(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }
}
