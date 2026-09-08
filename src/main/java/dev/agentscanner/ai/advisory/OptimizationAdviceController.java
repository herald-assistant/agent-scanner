package dev.agentscanner.ai.advisory;

import com.fasterxml.jackson.databind.JsonNode;
import dev.agentscanner.ai.AiExecutionCoordinator;
import dev.agentscanner.ai.AiExecutionException;
import dev.agentscanner.ai.CopilotProperties;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/ai/optimization-advice")
public final class OptimizationAdviceController {
    private final OptimizationAdvicePreparationService preparationService;
    private final OptimizationAdviceService adviceService;
    private final CopilotProperties properties;
    private final AiExecutionCoordinator coordinator;

    public OptimizationAdviceController(OptimizationAdvicePreparationService preparationService,
                                        OptimizationAdviceService adviceService,
                                        CopilotProperties properties,
                                        AiExecutionCoordinator coordinator) {
        this.preparationService = preparationService;
        this.adviceService = adviceService;
        this.properties = properties;
        this.coordinator = coordinator;
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of("configured", properties.configured(), "model", properties.model(), "running", coordinator.running());
    }

    @PostMapping("/prepare")
    public OptimizationAdvice.PreparedPreview prepare(@RequestParam long sessionId, @RequestBody JsonNode request) {
        return preparationService.prepare(sessionId, request);
    }

    @PostMapping("/cached")
    public ResponseEntity<?> cached(@RequestParam long sessionId,
                                    @RequestBody JsonNode body) {
        try {
            OptimizationAdvice.ExecuteRequest request = executeRequest(body);
            return adviceService.cached(sessionId, request.previewId())
                    .<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(() -> ResponseEntity.noContent().build());
        } catch (AdvicePreparationException failure) {
            return error(failure.status().value(), failure.getMessage());
        } catch (Exception failure) {
            return error(500, "Nie udało się odczytać zapisanej rekomendacji.");
        }
    }

    @PostMapping
    public CompletableFuture<ResponseEntity<?>> advise(@RequestParam long sessionId,
                                                        @RequestBody JsonNode body) {
        OptimizationAdvice.ExecuteRequest request = executeRequest(body);
        if (!properties.configured()) {
            return CompletableFuture.completedFuture(error(503,
                    "Ustaw agent-scanner.ai.github-token i agent-scanner.ai.model, a następnie uruchom aplikację ponownie."));
        }
        return coordinator.<ResponseEntity<?>>submit(() -> execute(sessionId, request.previewId()))
                .orElseGet(() -> CompletableFuture.completedFuture(error(409,
                        "Trwa inne działanie AI. Poczekaj na jego zakończenie.")));
    }

    private ResponseEntity<?> execute(long sessionId, String previewId) {
        try {
            return ResponseEntity.ok(adviceService.advise(sessionId, previewId));
        } catch (AdvicePreparationException failure) {
            return error(failure.status().value(), failure.getMessage());
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            return error(503, "Doradztwo zostało przerwane. Spróbuj ponownie.");
        } catch (AiExecutionException failure) {
            return error(failure.code() == AiExecutionException.Code.TIMEOUT ? 504 : 502, failure.getMessage());
        } catch (Exception failure) {
            return error(502, "Model nie zwrócił poprawnej rekomendacji. Lokalny poradnik pozostaje dostępny.");
        }
    }

    @ExceptionHandler(AdvicePreparationException.class)
    ResponseEntity<Map<String, String>> invalid(AdvicePreparationException failure) {
        return ResponseEntity.status(failure.status()).body(Map.of("error", failure.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> invalidRequest() {
        return error(400, "Żądanie doradztwa ma niepoprawną strukturę.");
    }

    private ResponseEntity<?> error(int status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }

    private OptimizationAdvice.ExecuteRequest executeRequest(JsonNode body) {
        if (body == null || !body.isObject() || body.size() != 1 || !body.path("previewId").isTextual()
                || !body.path("previewId").asText().matches("[0-9a-fA-F-]{36}")) {
            throw new AdvicePreparationException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "Żądanie doradztwa ma niepoprawną strukturę.");
        }
        return new OptimizationAdvice.ExecuteRequest(body.path("previewId").asText());
    }
}
