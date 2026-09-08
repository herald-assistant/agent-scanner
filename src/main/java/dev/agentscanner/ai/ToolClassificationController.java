package dev.agentscanner.ai;

import jakarta.validation.Valid;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/ai/tool-classification")
@EnableConfigurationProperties(CopilotProperties.class)
public class ToolClassificationController {
    private final CopilotProperties properties;
    private final ToolClassificationService service;
    private final AiExecutionCoordinator coordinator;
    public ToolClassificationController(CopilotProperties properties, ToolClassificationService service,
                                        AiExecutionCoordinator coordinator) {
        this.properties = properties; this.service = service; this.coordinator = coordinator;
    }
    @GetMapping("/status")
    public Map<String, Object> status() { return Map.of("configured", properties.configured(), "model", properties.model(), "running", coordinator.running()); }

    @PostMapping("/cached")
    public ResponseEntity<?> cached(@RequestParam long sessionId, @Valid @RequestBody ToolClassification.Request request) {
        try { return service.cached(sessionId, request).<ResponseEntity<?>>map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build()); }
        catch (IllegalArgumentException failure) { return error(400, "Definicje narzędzi lub cele analizy są niepoprawne."); }
        catch (Exception failure) { return error(500, "Nie udało się odczytać zapisanej klasyfikacji."); }
    }

    @PostMapping
    public CompletableFuture<ResponseEntity<?>> classify(@RequestParam long sessionId, @Valid @RequestBody ToolClassification.Request request) {
        if (!properties.configured()) return CompletableFuture.completedFuture(error(503, "Ustaw agent-scanner.ai.github-token i agent-scanner.ai.model w lokalnym application.properties, a następnie uruchom aplikację ponownie."));
        return coordinator.submit(() -> {
            try { return ResponseEntity.ok(service.classify(sessionId, request)); }
            catch (IllegalArgumentException failure) { return error(400, "Definicje narzędzi lub cele analizy są niepoprawne."); }
            catch (InterruptedException failure) { Thread.currentThread().interrupt(); return error(503, "Analiza została przerwana. Spróbuj ponownie."); }
            catch (AiExecutionException failure) { return error(failure.code() == AiExecutionException.Code.TIMEOUT ? 504 : 502, failure.getMessage()); }
            catch (Exception failure) { return error(502, "Nie uzyskano poprawnej klasyfikacji. Sprawdź token, model, instalację Copilot CLI i połączenie. Możesz ponowić analizę przyciskiem."); }
        }).orElseGet(() -> CompletableFuture.completedFuture(error(409, "Trwa inne działanie AI. Poczekaj na jego zakończenie.")));
    }
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<?> invalid() { return error(400, "Niepoprawny katalog narzędzi lub celów analizy."); }
    private ResponseEntity<?> error(int code, String message) { return ResponseEntity.status(code).body(Map.of("error", message)); }
}
