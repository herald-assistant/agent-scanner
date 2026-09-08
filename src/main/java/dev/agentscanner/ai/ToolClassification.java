package dev.agentscanner.ai;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

public final class ToolClassification {
    private ToolClassification() {}
    public static final String VERSION = "model-actions-v5";
    public enum Category { DATA_ACCESS, ANALYSIS, MODIFICATION, VALIDATION, EXECUTION, EXTERNAL, COORDINATION, DELEGATION, OTHER }
    public enum Specialization { GENERAL_PURPOSE, DOMAIN_SPECIFIC, TASK_SPECIFIC, UNKNOWN }
    public enum Fit { DIRECT, SUPPORTING, WEAK, UNKNOWN }
    public enum Action { ACQUIRE_DATA, MODIFY, WRITE_INTERMEDIATE, WRITE_FINAL, VALIDATE, DELEGATE, MANAGE_CONTEXT, RESPOND, OTHER, UNKNOWN }
    public record Definition(@NotBlank @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String id, @NotBlank @Size(max = 250) String name,
                             @NotNull JsonNode definition) {}
    public record Invocation(@NotBlank @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String id,
                             @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String toolId,
                             @NotBlank @Size(max = 250) String name, JsonNode arguments, boolean argumentsTruncated) {}
    public record RoundInput(@NotBlank @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String id, @Min(1) int order,
                             @Size(max = 1000) String modelOutput, boolean outputObserved,
                             @NotNull List<@Valid Invocation> invocations) {}
    public record Context(@NotBlank @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String id,
                          @NotBlank @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String agentId,
                          @Size(max = 4000) String goal, @NotEmpty List<@Valid RoundInput> rounds) {}
    public record AgentInput(@NotBlank @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String id,
                             @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String parentId,
                             @NotEmpty List<@NotBlank @Pattern(regexp = "[a-zA-Z0-9-]{1,80}") String> contextIds) {}
    public record Request(@NotNull List<@Valid Definition> tools,
                          @NotEmpty List<@Valid AgentInput> agents,
                          @NotEmpty List<@Valid Context> contexts) {}
    public record ToolResult(String id, Category category, Specialization specialization, String reason) {}
    public record Assessment(String contextId, String invocationId, String toolId, List<Action> actions, Fit fit, String reason) {}
    public record RoundResult(String roundId, List<Action> actions, List<String> evidenceInvocationIds, String reason) {}
    public record Answer(List<ToolResult> tools, List<Assessment> assessments, List<RoundResult> rounds) {}
    public record Result(String version, String model, String analyzedAt, List<ToolResult> tools, List<Assessment> assessments,
                         List<RoundResult> rounds) {}
}
