package dev.agentscanner.ai.sessionchat;

import com.fasterxml.jackson.databind.JsonNode;
import dev.agentscanner.ai.CopilotCompletion;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public final class SessionChat {
    private SessionChat() {}

    public static final String PROMPT_VERSION = "session-analysis-chat-prompt";

    public record CreateRequest(
        @NotBlank @Size(max = 512) String model,
        @Valid Focus focus
    ) {}

    public record Focus(
        @Size(max = 50) List<@NotBlank @Size(max = 160) String> roundRefs
    ) {}

    public record TurnRequest(
        @NotBlank @Size(max = 4_000) String question,
        @NotBlank @Pattern(regexp = "[0-9a-fA-F-]{36}") String clientRequestId
    ) {}

    public enum AnswerStatus { ANSWER, CLARIFICATION_NEEDED, INSUFFICIENT_EVIDENCE, OUT_OF_SCOPE }

    public record Evidence(
        String ref,
        String label
    ) {}

    public record Answer(
        String contract,
        AnswerStatus status,
        String answerMarkdown,
        List<Evidence> evidence,
        List<String> hypotheses,
        List<String> limitations,
        List<String> suggestedFollowUps
    ) {}

    public record ToolCallView(
        String id,
        String toolName,
        String activityLabel,
        String status,
        JsonNode arguments,
        JsonNode result,
        Integer resultCharacters,
        boolean truncated,
        String error,
        String startedAt,
        String completedAt
    ) {}

    public record TurnView(
        String id,
        String clientRequestId,
        String question,
        String status,
        Answer answer,
        String error,
        String createdAt,
        String completedAt,
        List<ToolCallView> toolCalls
    ) {}

    public record ChatView(
        String id,
        long sessionId,
        String model,
        long cutoffSignalId,
        String contextHash,
        Focus focus,
        JsonNode bootstrap,
        int revision,
        String createdAt,
        String updatedAt,
        boolean newerTelemetryAvailable,
        List<TurnView> turns
    ) {}

    public record ModelsResponse(boolean configured, String defaultModel, boolean running,
                                 List<CopilotCompletion.AvailableModel> models) {}
}
