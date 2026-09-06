package dev.agentscanner.ai;

import jakarta.annotation.PreDestroy;
import jakarta.validation.Valid;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@RestController
@RequestMapping("/api/ai/tool-classification")
@EnableConfigurationProperties(CopilotProperties.class)
public class ToolClassificationController {
    private final CopilotProperties properties;
    private final ToolClassificationService service;
    private final AtomicBoolean running = new AtomicBoolean();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    public ToolClassificationController(CopilotProperties properties, ToolClassificationService service) {
        this.properties = properties; this.service = service;
    }
    @GetMapping("/status")
    public Map<String, Object> status() { return Map.of("configured", properties.configured(), "model", properties.model(), "running", running.get()); }

    @PostMapping("/cached")
    public ResponseEntity<?> cached(@RequestParam long sessionId, @Valid @RequestBody ToolClassification.Request request) {
        try { return service.cached(sessionId, request).<ResponseEntity<?>>map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build()); }
        catch (IllegalArgumentException failure) { return error(400, "Definicje narzędzi lub cele są niepoprawne albo przekraczają limit analizy."); }
        catch (Exception failure) { return error(500, "Nie udało się odczytać zapisanej klasyfikacji."); }
    }

    @PostMapping
    public CompletableFuture<ResponseEntity<?>> classify(@RequestParam long sessionId, @Valid @RequestBody ToolClassification.Request request) {
        if (!properties.configured()) return CompletableFuture.completedFuture(error(503, "Ustaw agent-scanner.ai.github-token i agent-scanner.ai.model w lokalnym application.properties, a następnie uruchom aplikację ponownie."));
        if (!running.compareAndSet(false, true)) return CompletableFuture.completedFuture(error(409, "Trwa klasyfikacja narzędzi. Poczekaj na jej zakończenie."));
        return CompletableFuture.supplyAsync(() -> {
            try { return ResponseEntity.ok(service.classify(sessionId, request)); }
            catch (IllegalArgumentException failure) { return error(400, "Definicje narzędzi lub cele są niepoprawne albo przekraczają limit analizy."); }
            catch (InterruptedException failure) { Thread.currentThread().interrupt(); return error(503, "Analiza została przerwana. Spróbuj ponownie."); }
            catch (CopilotCompletion.RuntimeFailure failure) { return error(502, failure.getMessage()); }
            catch (Exception failure) { return error(502, "Nie uzyskano poprawnej klasyfikacji. Sprawdź token, model, instalację Copilot CLI i połączenie. Możesz ponowić analizę przyciskiem."); }
            finally { running.set(false); }
        }, worker);
    }
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<?> invalid() { return error(400, "Niepoprawny katalog narzędzi lub celów analizy."); }
    private ResponseEntity<?> error(int code, String message) { return ResponseEntity.status(code).body(Map.of("error", message)); }
    @PreDestroy public void close() { worker.shutdownNow(); }
}
