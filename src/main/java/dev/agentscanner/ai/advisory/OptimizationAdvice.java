package dev.agentscanner.ai.advisory;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class OptimizationAdvice {
    private OptimizationAdvice() {
    }

    public static final String VERSION = "optimization-advice-v1";
    public static final String EVIDENCE_VERSION = "guidance-evidence-v2";
    public static final String REDACTION_VERSION = "guidance-redaction-v1";

    public enum Provenance { EMITTED, DERIVED, ESTIMATED, AI_CLASSIFICATION, MISSING }

    public record Request(
            @NotBlank String version,
            @NotBlank String catalogVersion,
            @NotNull @Valid Scope scope,
            @NotNull @Valid Manifest manifest,
            @NotEmpty List<@Valid Observation> observations,
            @NotEmpty @Size(max = 3) List<@NotBlank String> candidateTechniqueIds,
            @NotNull @Valid UserContext userContext
    ) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Scope(
            @NotBlank String kind,
            @Positive long rootSessionId,
            String interactionTraceId,
            List<@NotBlank @Size(max = 160) String> roundRefs,
            @Size(max = 16) List<@NotBlank String> actions,
            @Size(max = 160) String compactionRef
    ) {
    }

    public record Manifest(
            @NotBlank String capturedAt,
            @NotBlank @Pattern(regexp = "[0-9a-f]{64}") String dataFingerprint,
            @NotNull List<@NotBlank @Size(max = 160) String> selectedRefs,
            @NotNull List<@NotBlank @Size(max = 160) String> supportingRefs,
            @NotNull List<@Valid Omission> omitted,
            @Pattern(regexp = "[0-9a-f]{64}") String classificationFingerprint,
            @NotBlank String evidenceVersion,
            @NotBlank String redactionVersion,
            @NotBlank String upstreamCompleteness
    ) {
    }

    public record Omission(@NotBlank @Size(max = 240) String ref, @NotBlank @Size(max = 120) String reason) {
    }

    public record Observation(
            @NotBlank @Size(max = 240) String id,
            @NotBlank @Size(max = 120) String kind,
            @NotNull Provenance provenance,
            @NotEmpty @Size(max = 8) List<@Valid SourceRef> sources,
            @Size(max = 120) String ruleVersion,
            @Valid Metric metric,
            @Valid Excerpt excerpt,
            @NotNull @Size(max = 32) List<@NotBlank @Size(max = 120) String> limitationCodes
    ) {
    }

    public record SourceRef(
            @Positive long sessionId,
            @Positive long spanId,
            @Positive long signalId,
            @NotBlank @Size(max = 64) String traceId,
            @NotBlank @Size(max = 32) String rawSpanId,
            @NotBlank @Size(max = 320) String sourcePointer,
            @NotBlank @Pattern(regexp = "[0-9a-f]{64}") String sourceContentHash,
            @Size(max = 160) String roundRef,
            @Size(max = 512) String callId,
            @Positive Long messageId,
            @Size(max = 512) String attribute
    ) {
    }

    public record Metric(
            Double value,
            @NotBlank @Size(max = 40) String unit,
            @NotBlank @Size(max = 160) String population,
            int covered,
            int total,
            @Size(max = 160) String formulaId
    ) {
    }

    public record Excerpt(
            @NotNull @Size(max = 4_000) String text,
            int originalCharacters,
            boolean truncated,
            boolean redacted
    ) {
    }

    public record UserContext(
            @Size(max = 4_000) String goal,
            @NotBlank String frequency,
            @NotBlank String effort,
            @NotNull @Size(max = 16) List<@NotBlank @Size(max = 500) String> constraints
    ) {
    }

    public record Preparation(
            String previewId,
            String preparedAt,
            String expiresAt,
            String requestHash,
            String sourceValidation
    ) {
    }

    public record Summary(
            int selectedRounds,
            int supportingRounds,
            int observations,
            int contentFragments,
            int payloadCharacters,
            int estimatedInputTokens,
            boolean sendBlocked
    ) {
    }

    public record PreparedPreview(
            Preparation preparation,
            Request request,
            Summary summary,
            List<String> warnings
    ) {
    }

    public record ExecuteRequest(
            @NotBlank @Pattern(regexp = "[0-9a-fA-F-]{36}") String previewId
    ) {
    }

    public enum AdviceStatus { SUGGESTIONS, INSUFFICIENT_EVIDENCE, NO_SUITABLE_TECHNIQUE }

    public record Proposal(
            String techniqueId,
            List<String> observationIds,
            String rationale,
            List<String> conditionsToCheck,
            List<String> experimentSteps,
            List<String> setupWork,
            List<String> maintenanceWork,
            List<String> qualityChecks,
            List<String> comparisonPlan,
            List<String> limitations,
            String alternativeTechniqueId
    ) {
    }

    public record Answer(
            AdviceStatus status,
            List<Proposal> proposals,
            List<String> missingInformation
    ) {
    }

    public record Result(
            String version,
            String catalogVersion,
            String promptVersion,
            String model,
            String analyzedAt,
            String previewId,
            String requestHash,
            String dataFingerprint,
            String sourceValidation,
            AdviceStatus status,
            List<Proposal> proposals,
            List<String> missingInformation,
            boolean aiCallMetricsAvailable
    ) {
    }
}
