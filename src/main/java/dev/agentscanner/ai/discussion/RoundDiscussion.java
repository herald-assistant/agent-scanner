package dev.agentscanner.ai.discussion;

import com.fasterxml.jackson.databind.JsonNode;
import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.ai.advisory.OptimizationAdvice;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class RoundDiscussion {
    private RoundDiscussion() {
    }

    public static final String VERSION = "round-discussion-v1";
    public static final String EVIDENCE_VERSION = "round-discussion-evidence-v1";
    public static final String REDACTION_VERSION = "guidance-redaction-v1";

    public record CreateRequest(
            @NotBlank String version,
            @NotBlank @Size(max = 512) String model,
            @NotNull @Valid EvidenceSnapshot snapshot
    ) {
    }

    public record EvidenceSnapshot(
            @NotBlank String version,
            @NotBlank String capturedAt,
            @NotBlank @Pattern(regexp = "[0-9a-f]{64}") String contentHash,
            @NotNull @Valid Selection selection,
            @NotEmpty List<@Valid RoundEvidence> rounds,
            @NotEmpty List<@Valid Boundary> boundaries,
            @NotBlank String redactionVersion,
            @NotBlank String upstreamCompleteness
    ) {
    }

    public record Selection(
            @Positive long rootSessionId,
            @NotBlank @Size(max = 512) String streamId,
            @NotBlank @Size(max = 512) String actorLabel,
            @NotBlank @Size(max = 64) String interactionTraceId,
            @NotBlank @Size(max = 160) String startRoundRef,
            @NotBlank @Size(max = 160) String endRoundRef,
            @NotEmpty List<@NotBlank @Size(max = 160) String> roundRefs,
            @Size(max = 4_000) String initialPrompt
    ) {
    }

    public record RoundEvidence(
            @NotBlank @Size(max = 160) String roundRef,
            int sequenceIndex,
            int interactionTurnIndex,
            @Size(max = 160) String nextRoundRef,
            @Size(max = 512) String model,
            @NotNull JsonNode metrics,
            @NotNull @Valid OptimizationAdvice.SourceRef source
    ) {
    }

    public record Boundary(
            @NotBlank @Size(max = 240) String id,
            @NotBlank @Size(max = 160) String roundRef,
            @NotBlank @Size(max = 80) String kind,
            @NotNull @Valid OptimizationAdvice.SourceRef source,
            @NotNull JsonNode value,
            @NotNull List<@NotBlank @Size(max = 120) String> limitationCodes
    ) {
    }

    public record CreateResponse(String id, String version, String model, String evidenceHash,
                                 String createdAt, DiscussionView discussion) {
    }

    public record TurnRequest(
            @NotBlank @Size(max = 4_000) String question,
            @NotBlank @Pattern(regexp = "[0-9a-fA-F-]{36}") String clientRequestId
    ) {
    }

    public enum AnswerStatus { ANSWER, CLARIFICATION_NEEDED, INSUFFICIENT_EVIDENCE, OUT_OF_SCOPE }

    public enum BlockKind { EXPLANATION, HYPOTHESIS, GENERAL_GUIDANCE }

    public record AnswerBlock(
            BlockKind kind,
            String text,
            List<String> boundaryIds,
            List<String> roundRefs
    ) {
    }

    public record Answer(
            AnswerStatus status,
            List<AnswerBlock> blocks,
            List<String> questionsToUser,
            List<String> limitations
    ) {
    }

    public record TurnView(
            String id,
            String clientRequestId,
            String question,
            String status,
            Answer answer,
            String error,
            String createdAt,
            String completedAt
    ) {
    }

    public record DiscussionView(
            String id,
            long sessionId,
            String version,
            String model,
            String evidenceHash,
            EvidenceSnapshot snapshot,
            int revision,
            String createdAt,
            String updatedAt,
            List<TurnView> turns
    ) {
    }

    public record ModelsResponse(boolean configured, String defaultModel, boolean running,
                                 List<CopilotCompletion.AvailableModel> models) {
    }
}
