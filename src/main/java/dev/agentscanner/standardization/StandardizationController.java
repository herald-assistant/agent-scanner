package dev.agentscanner.standardization;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.ai.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

import static dev.agentscanner.standardization.Standardization.*;

@RestController
@RequestMapping("/api/standardization")
public final class StandardizationController {
    private final StandardizationCatalog catalog;
    private final StandardizationService service;
    private final StandardizationHistoryStore history;
    private final CopilotProperties properties;
    private final AiExecutionCoordinator coordinator;
    private final ObjectMapper mapper;

    public StandardizationController(StandardizationCatalog catalog, StandardizationService service,
                                     StandardizationHistoryStore history, CopilotProperties properties,
                                     AiExecutionCoordinator coordinator, ObjectMapper mapper) {
        this.catalog = catalog; this.service = service; this.history = history;
        this.properties = properties; this.coordinator = coordinator;
        this.mapper = mapper.copy().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
                DeserializationFeature.FAIL_ON_TRAILING_TOKENS, DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    }
    @GetMapping("/catalog")
    public Catalog catalog() { return catalog.get(); }

    @GetMapping("/repositories")
    public java.util.List<RepositorySummary> repositories() { return history.repositories(); }

    @PostMapping("/snapshots")
    public ResponseEntity<?> saveSnapshot(HttpServletRequest request) throws Exception {
        byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) return error(413, "Migawka przekracza dozwolony rozmiar.");
        SnapshotRequest parsed;
        try { parsed = mapper.readValue(body, SnapshotRequest.class); }
        catch (Exception failure) { return error(400, "Migawka plików ma niepoprawną strukturę."); }
        return ResponseEntity.ok(history.saveSnapshot(parsed));
    }

    @GetMapping("/repositories/{repositoryId}/inputs/{snapshotId}")
    public RepositorySnapshot snapshot(@PathVariable String repositoryId, @PathVariable String snapshotId) {
        return history.snapshot(repositoryId, snapshotId);
    }

    @DeleteMapping("/repositories/{repositoryId}/inputs/{snapshotId}")
    public ResponseEntity<?> deleteSnapshot(@PathVariable String repositoryId, @PathVariable String snapshotId) {
        if (!history.deleteSnapshot(repositoryId, snapshotId)) return error(404, "Nie znaleziono zapisanych plików repozytorium.");
        history.checkpoint();
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/repositories/{repositoryId}/inputs/{snapshotId}/prepare")
    public Preview prepareSnapshot(@PathVariable String repositoryId, @PathVariable String snapshotId,
                                   @RequestBody SnapshotModelRequest request) {
        RepositorySnapshot snapshot = history.snapshot(repositoryId, snapshotId);
        Preview preview = service.prepare(new PrepareRequest(Profile.AUTO, "", request == null ? null : request.model(),
                snapshot.files().stream().filter(SnapshotFile::selected).map(file -> new InputFile(file.path(), file.content())).toList(),
                snapshot.files().stream().filter(file -> !file.selected()).map(file -> new Omission(file.path(),
                        file.omissionReason() == null ? "EXCLUDED" : file.omissionReason())).toList(), snapshot.inventoryComplete()));
        try { history.attachInput(snapshot, preview.id()); }
        catch (RuntimeException failure) { service.discard(preview.id()); throw failure; }
        return preview;
    }

    @GetMapping("/repositories/{repositoryId}/analyses/{analysisId}")
    public SavedAnalysis savedAnalysis(@PathVariable String repositoryId, @PathVariable String analysisId) {
        return history.get(repositoryId, analysisId);
    }

    @GetMapping(value = "/repositories/{repositoryId}/analyses/{analysisId}/export", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> exportAnalysis(@PathVariable String repositoryId, @PathVariable String analysisId) throws Exception {
        SavedAnalysis saved = history.get(repositoryId, analysisId);
        byte[] bytes = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(
                new AnalysisExport("agent-scanner-standardization-analysis", 1, saved));
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=agent-scanner-analysis-" + saved.analysisId() + ".json")
                .contentType(MediaType.APPLICATION_JSON).body(bytes);
    }

    @DeleteMapping("/repositories/{repositoryId}/analyses/{analysisId}")
    public ResponseEntity<?> deleteAnalysis(@PathVariable String repositoryId, @PathVariable String analysisId) {
        if (!history.deleteAnalysis(repositoryId, analysisId)) return error(404, "Nie znaleziono zapisanej analizy tego repozytorium.");
        history.checkpoint();
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/prepare")
    public ResponseEntity<?> prepare(HttpServletRequest request) throws Exception {
        byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) return error(413, "Pakiet przekracza dozwolony rozmiar.");
        PrepareRequest parsed;
        try { parsed = mapper.readValue(body, PrepareRequest.class); }
        catch (Exception failure) { return error(400, "Pakiet plików ma niepoprawną strukturę."); }
        return ResponseEntity.ok(service.prepare(parsed));
    }

    @PostMapping("/analyze")
    public CompletableFuture<ResponseEntity<?>> analyze(@RequestBody ExecuteRequest request) {
        String id = id(request);
        if (!properties.credentialsConfigured()) return CompletableFuture.completedFuture(error(503,
                "Skonfiguruj token GitHub Copilot, aby uruchomić analizę. Podgląd plików pozostaje dostępny."));
        return coordinator.<ResponseEntity<?>>submit(() -> {
            try { return ResponseEntity.ok(service.analyze(id)); }
            catch (IllegalArgumentException failure) { return error(409, failure.getMessage()); }
            catch (InterruptedException failure) { Thread.currentThread().interrupt(); return error(409, "Analiza została anulowana. Pliki pozostają dostępne."); }
            catch (AiExecutionException failure) {
                return error(failure.code() == AiExecutionException.Code.TIMEOUT ? 504 : 502, failure.getMessage());
            } catch (Exception failure) {
                return error(502, "Nie uzyskano poprawnych ocen z dowodami. Przygotuj nowy podgląd, aby ponowić analizę; wyniki lokalne pozostają dostępne.");
            }
        }).orElseGet(() -> CompletableFuture.completedFuture(error(409, "Trwa inne działanie AI. Poczekaj na jego zakończenie.")));
    }

    @PostMapping("/analyze-and-save")
    public CompletableFuture<ResponseEntity<?>> analyzeAndSave(@RequestBody SaveRequest request) {
        String previewId = id(request == null ? null : new ExecuteRequest(request.previewId()));
        if (request.repositoryId() == null || request.repositoryId().isBlank()) {
            if (request.repositoryName() == null || request.repositoryName().isBlank()
                    || request.repositoryName().length() > 200
                    || request.repositoryName().chars().anyMatch(Character::isISOControl)) {
                return CompletableFuture.completedFuture(error(400, "Podaj poprawną nazwę repozytorium."));
            }
        } else if (!request.repositoryId().matches("[a-f0-9-]{36}") || !history.hasRepository(request.repositoryId())) {
            return CompletableFuture.completedFuture(error(404, "Wybrane repozytorium nie istnieje."));
        }
        try { history.validateInputRepository(previewId, request.repositoryId()); }
        catch (IllegalArgumentException failure) { return CompletableFuture.completedFuture(error(409, failure.getMessage())); }
        String snapshotId = history.inputSnapshotId(previewId);
        if (!properties.credentialsConfigured()) return CompletableFuture.completedFuture(error(503,
                "Skonfiguruj token GitHub Copilot, aby uruchomić analizę. Podgląd plików pozostaje dostępny."));
        return coordinator.<ResponseEntity<?>>submit(() -> {
            try {
                Preview preview = service.preview(previewId);
                Result result = service.analyze(previewId);
                return ResponseEntity.ok(snapshotId == null ? history.save(preview, result,
                        request.repositoryId(), request.repositoryName()) : history.saveWithInput(preview, result,
                        request.repositoryId(), request.repositoryName(), snapshotId));
            } catch (IllegalArgumentException failure) { return error(409, failure.getMessage()); }
            catch (InterruptedException failure) { Thread.currentThread().interrupt(); return error(409, "Analiza została anulowana. Pliki pozostają dostępne."); }
            catch (AiExecutionException failure) {
                return error(failure.code() == AiExecutionException.Code.TIMEOUT ? 504 : 502, failure.getMessage());
            } catch (Exception failure) {
                return error(502, "Nie udało się ukończyć lub zapisać analizy. Ponów zapis tego samego podglądu albo przygotuj nowy.");
            }
        }).orElseGet(() -> CompletableFuture.completedFuture(error(409, "Trwa inne działanie AI. Poczekaj na jego zakończenie.")));
    }
    @PostMapping("/cancel")
    public ResponseEntity<Void> cancel(@RequestBody ExecuteRequest request) {
        service.cancel(id(request));
        return ResponseEntity.noContent().build();
    }
    @DeleteMapping("/previews/{id}")
    public ResponseEntity<Void> discard(@PathVariable String id) {
        service.discard(id);
        return ResponseEntity.noContent().build();
    }
    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<?> invalid(IllegalArgumentException failure) { return error(400, failure.getMessage()); }
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> malformed() { return error(400, "Niepoprawne żądanie analizy."); }
    private String id(ExecuteRequest request) {
        if (request == null || request.previewId() == null || !request.previewId().matches("[a-f0-9-]{36}"))
            throw new IllegalArgumentException("Brak poprawnego identyfikatora podglądu.");
        return request.previewId();
    }
    private ResponseEntity<?> error(int status, String message) { return ResponseEntity.status(status).body(Map.of("error", message)); }
}
