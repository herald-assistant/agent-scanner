package dev.agentscanner.ai.advisory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.ai.CopilotProperties;
import dev.agentscanner.store.ScannerStore;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

@Service
public final class OptimizationAdviceService {
    private final ObjectMapper mapper;
    private final CopilotCompletion completion;
    private final CopilotProperties properties;
    private final ScannerStore store;
    private final OptimizationAdvicePreparationService preparation;
    private final OptimizationAdvicePrompt prompt;
    private final OptimizationAdviceValidator validator;

    public OptimizationAdviceService(ObjectMapper mapper, CopilotCompletion completion, CopilotProperties properties,
                                     ScannerStore store, OptimizationAdvicePreparationService preparation,
                                     OptimizationAdvicePrompt prompt, OptimizationAdviceValidator validator) {
        this.mapper = mapper;
        this.completion = completion;
        this.properties = properties;
        this.store = store;
        this.preparation = preparation;
        this.prompt = prompt;
        this.validator = validator;
    }

    public Optional<OptimizationAdvice.Result> cached(long sessionId, String previewId) {
        OptimizationAdvice.PreparedPreview preview = preparation.loadAndRevalidate(sessionId, previewId);
        return cachedByHash(sessionId, adviceHash(preview));
    }

    public OptimizationAdvice.Result advise(long sessionId, String previewId) throws Exception {
        OptimizationAdvice.PreparedPreview preview = preparation.loadAndRevalidate(sessionId, previewId);
        String adviceHash = adviceHash(preview);
        Optional<OptimizationAdvice.Result> cached = cachedByHash(sessionId, adviceHash);
        if (cached.isPresent()) return cached.get();

        OptimizationAdvice.Answer answer = validator.validate(completion.complete(prompt.build(preview)), preview.request());
        preparation.revalidate(sessionId, preview);
        Optional<OptimizationAdvice.Result> wonRace = cachedByHash(sessionId, adviceHash);
        if (wonRace.isPresent()) return wonRace.get();

        Instant analyzedAt = Instant.now();
        OptimizationAdvice.Result result = new OptimizationAdvice.Result(
                OptimizationAdvice.VERSION, preview.request().catalogVersion(), OptimizationAdvicePrompt.VERSION,
                properties.model(), analyzedAt.toString(), preview.preparation().previewId(),
                preview.preparation().requestHash(), preview.request().manifest().dataFingerprint(),
                "RAW_AND_NORMALIZED", answer.status(), List.copyOf(answer.proposals()),
                List.copyOf(answer.missingInformation()), false
        );
        store.saveOptimizationAdviceResult(sessionId, adviceHash, result.requestHash(), result.dataFingerprint(),
                result.version(), result.catalogVersion(), result.promptVersion(), result.model(), analyzedAt,
                mapper.writeValueAsString(result));
        return result;
    }

    private Optional<OptimizationAdvice.Result> cachedByHash(long sessionId, String adviceHash) {
        return store.optimizationAdviceResult(sessionId, adviceHash).map(json -> {
            try {
                return mapper.readerFor(OptimizationAdvice.Result.class)
                        .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                        .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                        .readValue(json);
            } catch (JsonProcessingException failure) {
                throw new IllegalStateException("Zapisany wynik doradztwa jest uszkodzony.", failure);
            }
        });
    }

    String adviceHash(OptimizationAdvice.PreparedPreview preview) {
        String material = OptimizationAdvice.VERSION + "\n" + OptimizationAdvicePrompt.VERSION + "\n"
                + properties.model() + "\n" + preview.request().catalogVersion() + "\n"
                + preview.preparation().requestHash() + "\n" + preview.request().manifest().dataFingerprint();
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(material.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new IllegalStateException("Brak algorytmu SHA-256.", failure);
        }
    }
}
