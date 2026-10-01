package dev.agentscanner.ai;

import com.github.copilot.CopilotClient;
import com.github.copilot.SystemMessageMode;
import com.github.copilot.rpc.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Text-only Copilot transport. Advisory turns are isolated; discussion turns may use the SDK session store. */
@Component
public class CopilotCompletion {
    private static final Logger LOG = LoggerFactory.getLogger(CopilotCompletion.class);
    private final CopilotProperties properties;

    public CopilotCompletion(CopilotProperties properties) {
        this.properties = properties;
    }

    public record AvailableModel(String id, String name, Integer maxPromptTokens,
                                 Integer maxContextWindowTokens, List<String> reasoningEfforts) {
    }

    public record ConversationReply(String sessionId, String content) {
    }

    public String complete(String prompt) throws Exception {
        return complete(properties.model(), null, prompt);
    }

    /** Isolated, non-persisted analysis using an explicitly selected account model. */
    public String complete(String model, String systemMessage, String prompt) throws Exception {
        Path work = workDirectory("work");
        var client = new CopilotClient(clientOptions());
        String stage = "start";
        try {
            client.start().get(30, TimeUnit.SECONDS);
            stage = "status";
            logStatus(client);
            stage = "auth";
            requireAuthenticated(client);
            stage = "models";
            requireModel(client, model);
            stage = "session";
            var config = sessionConfig(model, work);
            if (systemMessage != null) {
                config.setSystemMessage(new SystemMessageConfig().setMode(SystemMessageMode.REPLACE).setContent(systemMessage));
            }
            try (var session = client.createSession(config).get(30, TimeUnit.SECONDS)) {
                try {
                    stage = "inference";
                    var answer = session.sendAndWait(new MessageOptions().setPrompt(prompt), properties.timeoutSeconds() * 1000L)
                            .get(properties.timeoutSeconds() + 5L, TimeUnit.SECONDS);
                    if (answer == null || answer.getData() == null || answer.getData().content() == null) {
                        throw new AiExecutionException(AiExecutionException.Code.RUNTIME, "Copilot zakończył analizę bez odpowiedzi.");
                    }
                    return answer.getData().content();
                } catch (Exception failure) {
                    try {
                        session.abort().get(5, TimeUnit.SECONDS);
                    } catch (Exception ignored) {
                        // Stop the client below.
                    }
                    throw failure;
                }
            }
        } catch (AiExecutionException failure) {
            throw failure;
        } catch (TimeoutException failure) {
            throw new AiExecutionException(AiExecutionException.Code.TIMEOUT,
                    "Copilot nie zakończył analizy w dozwolonym czasie. Spróbuj ponownie później.", failure);
        } catch (InterruptedException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new AiExecutionException(AiExecutionException.Code.RUNTIME, messageFor(stage), failure);
        } finally {
            stop(client);
        }
    }

    /** Reads the account's current model catalogue without invoking inference. */
    public List<AvailableModel> availableModels() throws Exception {
        var client = new CopilotClient(clientOptions());
        String stage = "start";
        try {
            client.start().get(30, TimeUnit.SECONDS);
            stage = "status";
            logStatus(client);
            stage = "auth";
            requireAuthenticated(client);
            stage = "models";
            return client.listModels().get(20, TimeUnit.SECONDS).stream()
                    .filter(model -> model.getId() != null && !model.getId().isBlank())
                    .map(model -> new AvailableModel(model.getId(),
                            model.getName() == null || model.getName().isBlank() ? model.getId() : model.getName(),
                            model.getCapabilities() == null || model.getCapabilities().getLimits() == null
                                    ? null : model.getCapabilities().getLimits().getMaxPromptTokens(),
                            model.getCapabilities() == null || model.getCapabilities().getLimits() == null
                                    ? null : model.getCapabilities().getLimits().getMaxContextWindowTokens(),
                            model.getSupportedReasoningEfforts() == null ? List.of() : List.copyOf(model.getSupportedReasoningEfforts())))
                    .toList();
        } catch (AiExecutionException failure) {
            throw failure;
        } catch (TimeoutException failure) {
            throw new AiExecutionException(AiExecutionException.Code.TIMEOUT,
                    "Copilot nie zwrócił katalogu modeli w dozwolonym czasie.", failure);
        } catch (InterruptedException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new AiExecutionException(AiExecutionException.Code.RUNTIME, messageFor(stage), failure);
        } finally {
            stop(client);
        }
    }

    /** Starts a persisted conversation that can call only the supplied read-only Scanner tools. */
    public ConversationReply startToolConversation(String sessionId, String model, String systemMessage, String prompt,
                                                   List<ToolDefinition> tools) throws Exception {
        if (sessionId == null || sessionId.isBlank()) {
            throw new AiExecutionException(AiExecutionException.Code.RUNTIME, "Brakuje identyfikatora rozmowy Scannera.");
        }
        return toolConversation(null, sessionId, model, systemMessage, prompt, tools);
    }

    /** Resumes the same SDK conversation with the same explicitly supplied Scanner tools. */
    public ConversationReply continueToolConversation(String sessionId, String model, String systemMessage, String prompt,
                                                      List<ToolDefinition> tools) throws Exception {
        if (sessionId == null || sessionId.isBlank()) {
            throw new AiExecutionException(AiExecutionException.Code.RUNTIME,
                    "Brakuje identyfikatora zapisanej rozmowy Copilota.");
        }
        return toolConversation(sessionId, null, model, systemMessage, prompt, tools);
    }

    /** Permanently removes one SDK session store entry created for Scanner chat. */
    public void deleteStoredConversation(String sessionId) throws Exception {
        if (sessionId == null || sessionId.isBlank()) return;
        var client = new CopilotClient(clientOptions());
        try {
            client.start().get(30, TimeUnit.SECONDS);
            client.deleteSession(sessionId).get(20, TimeUnit.SECONDS);
        } finally {
            stop(client);
        }
    }

    private ConversationReply toolConversation(String resumeSessionId, String requestedSessionId, String model,
                                               String systemMessage, String prompt, List<ToolDefinition> tools) throws Exception {
        Path work = workDirectory("session-chat-work");
        var client = new CopilotClient(clientOptions());
        String stage = "start";
        try {
            client.start().get(30, TimeUnit.SECONDS);
            stage = "status";
            logStatus(client);
            stage = "auth";
            requireAuthenticated(client);
            stage = "models";
            requireModel(client, model);
            stage = resumeSessionId == null ? "session" : "resume";
            var session = resumeSessionId == null
                    ? client.createSession(toolSessionConfig(requestedSessionId, model, work, systemMessage, tools))
                        .get(30, TimeUnit.SECONDS)
                    : client.resumeSession(resumeSessionId, toolResumeConfig(model, work, systemMessage, tools))
                        .get(30, TimeUnit.SECONDS);
            try (session) {
                try {
                    stage = "inference";
                    var answer = session.sendAndWait(new MessageOptions().setPrompt(prompt), properties.timeoutSeconds() * 1000L)
                            .get(properties.timeoutSeconds() + 5L, TimeUnit.SECONDS);
                    if (answer == null || answer.getData() == null || answer.getData().content() == null) {
                        throw new AiExecutionException(AiExecutionException.Code.RUNTIME,
                                "Copilot zakończył turę rozmowy bez odpowiedzi.");
                    }
                    return new ConversationReply(session.getSessionId(), answer.getData().content());
                } catch (Exception failure) {
                    try { session.abort().get(5, TimeUnit.SECONDS); } catch (Exception ignored) { }
                    throw failure;
                }
            }
        } catch (AiExecutionException failure) {
            throw failure;
        } catch (TimeoutException failure) {
            throw new AiExecutionException(AiExecutionException.Code.TIMEOUT,
                    "Copilot nie zakończył tury rozmowy w dozwolonym czasie.", failure);
        } catch (InterruptedException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new AiExecutionException(AiExecutionException.Code.RUNTIME, messageFor(stage), failure);
        } finally {
            stop(client);
        }
    }

    private CopilotClientOptions clientOptions() throws Exception {
        Path home = Files.createDirectories(Path.of(properties.dataDirectory()).toAbsolutePath());
        Path work = Files.createDirectories(home.resolve("work"));
        return new CopilotClientOptions().setCliPath(properties.cliPath()).setCwd(work.toString())
                .setCopilotHome(home.toString()).setGitHubToken(properties.githubToken()).setUseLoggedInUser(false)
                .setAutoRestart(false).setMode(CopilotClientMode.EMPTY);
    }

    private Path workDirectory(String name) throws Exception {
        Path home = Files.createDirectories(Path.of(properties.dataDirectory()).toAbsolutePath());
        return Files.createDirectories(home.resolve(name));
    }

    private void logStatus(CopilotClient client) throws Exception {
        var status = client.getStatus().get(10, TimeUnit.SECONDS);
        LOG.info("Copilot runtime gotowy: CLI {}, protokół {}", status.getVersion(), status.getProtocolVersion());
    }

    private void requireAuthenticated(CopilotClient client) throws Exception {
        if (!client.getAuthStatus().get(10, TimeUnit.SECONDS).isAuthenticated()) {
            throw new AiExecutionException(AiExecutionException.Code.RUNTIME,
                    "Copilot nie zaakceptował skonfigurowanego tokena. Sprawdź uprawnienie Copilot Requests i dostęp konta do Copilota.");
        }
    }

    private void requireModel(CopilotClient client, String model) throws Exception {
        var models = client.listModels().get(20, TimeUnit.SECONDS);
        if (models.stream().noneMatch(candidate -> model.equals(candidate.getId()))) {
            String available = models.stream().map(ModelInfo::getId).filter(java.util.Objects::nonNull).limit(12)
                    .collect(java.util.stream.Collectors.joining(", "));
            throw new AiExecutionException(AiExecutionException.Code.RUNTIME,
                    "Model „" + model + "” nie jest dostępny dla tego konta. Dostępne modele: "
                            + (available.isBlank() ? "brak danych" : available) + ".");
        }
    }

    private void stop(CopilotClient client) {
        try {
            client.forceStop().get(10, TimeUnit.SECONDS);
        } catch (Exception cleanupFailure) {
            LOG.debug("Nie udało się domknąć procesu Copilot runtime", cleanupFailure);
        }
    }

    private static String messageFor(String stage) {
        return switch (stage) {
            case "start" -> "Nie udało się uruchomić Copilot CLI. Sprawdź agent-scanner.ai.cli-path i zgodność wersji CLI z Java SDK.";
            case "status" -> "Copilot CLI uruchomił się, ale nie zwrócił informacji o wersji protokołu.";
            case "auth" -> "Nie udało się sprawdzić autoryzacji Copilota. Sprawdź token i połączenie sieciowe.";
            case "models" -> "Nie udało się pobrać modeli dostępnych dla konta Copilot.";
            case "session" -> "Copilot nie utworzył izolowanej sesji analizy.";
            case "resume" -> "Copilot nie wznowił zapisanej rozmowy. Nie utworzono nowej sesji zastępczej.";
            default -> "Copilot nie zakończył analizy. Sprawdź połączenie i spróbuj ponownie.";
        };
    }

    static SessionConfig sessionConfig(String model, Path work) {
        return new SessionConfig().setModel(model).setWorkingDirectory(work.toString()).setStreaming(false)
                .setTools(List.of()).setAvailableTools(List.of()).setMcpServers(Map.of()).setCustomAgents(List.of())
                .setSkillDirectories(List.of()).setPluginDirectories(List.of()).setInstructionDirectories(List.of())
                .setEnableSkills(false).setSkipCustomInstructions(true).setEnableConfigDiscovery(false)
                .setEnableOnDemandInstructionDiscovery(false).setAdditionalDirectories(List.of())
                .setEnableFileHooks(false).setEnableHostGitOperations(false).setEnableSessionStore(false)
                .setEnableSessionTelemetry(false).setMemory(new MemoryConfiguration().setEnabled(false))
                .setInfiniteSessions(new InfiniteSessionConfig().setEnabled(false))
                .setHooks(deniedToolHooks())
                .setOnPermissionRequest((request, invocation) -> CompletableFuture.completedFuture(
                        new PermissionRequestResult().setKind(PermissionRequestResultKind.REJECTED)));
    }

    static SessionConfig conversationSessionConfig(String model, Path work, String systemMessage) {
        return sessionConfig(model, work)
                .setSystemMessage(new SystemMessageConfig().setMode(SystemMessageMode.REPLACE).setContent(systemMessage))
                .setEnableSessionStore(true);
    }

    static ResumeSessionConfig conversationResumeConfig(String model, Path work, String systemMessage) {
        return new ResumeSessionConfig().setModel(model).setWorkingDirectory(work.toString()).setStreaming(false)
                .setSystemMessage(new SystemMessageConfig().setMode(SystemMessageMode.REPLACE).setContent(systemMessage))
                .setTools(List.of()).setAvailableTools(List.of()).setMcpServers(Map.of()).setCustomAgents(List.of())
                .setSkillDirectories(List.of()).setPluginDirectories(List.of()).setInstructionDirectories(List.of())
                .setEnableSkills(false).setSkipCustomInstructions(true).setEnableConfigDiscovery(false)
                .setEnableOnDemandInstructionDiscovery(false).setAdditionalDirectories(List.of())
                .setEnableFileHooks(false).setEnableHostGitOperations(false).setEnableSessionStore(true)
                .setEnableSessionTelemetry(false).setMemory(new MemoryConfiguration().setEnabled(false))
                .setInfiniteSessions(new InfiniteSessionConfig().setEnabled(false))
                .setHooks(deniedToolHooks())
                .setOnPermissionRequest((request, invocation) -> CompletableFuture.completedFuture(
                        new PermissionRequestResult().setKind(PermissionRequestResultKind.REJECTED)));
    }

    static SessionConfig toolSessionConfig(String sessionId, String model, Path work, String systemMessage,
                                           List<ToolDefinition> tools) {
        List<String> allowed = tools.stream().map(ToolDefinition::name).toList();
        return conversationSessionConfig(model, work, systemMessage)
                .setSessionId(sessionId)
                .setTools(List.copyOf(tools))
                .setAvailableTools(allowed)
                .setHooks(allowedToolHooks(Set.copyOf(allowed)));
    }

    static ResumeSessionConfig toolResumeConfig(String model, Path work, String systemMessage,
                                                List<ToolDefinition> tools) {
        List<String> allowed = tools.stream().map(ToolDefinition::name).toList();
        return conversationResumeConfig(model, work, systemMessage)
                .setTools(List.copyOf(tools))
                .setAvailableTools(allowed)
                .setHooks(allowedToolHooks(Set.copyOf(allowed)));
    }

    private static SessionHooks deniedToolHooks() {
        return new SessionHooks().setOnPreToolUse((input, invocation) ->
                CompletableFuture.completedFuture(PreToolUseHookOutput.deny("Narzędzia są wyłączone.")));
    }

    private static SessionHooks allowedToolHooks(Set<String> allowed) {
        return new SessionHooks().setOnPreToolUse((input, invocation) -> CompletableFuture.completedFuture(
                allowed.contains(input.getToolName())
                        ? PreToolUseHookOutput.allow()
                        : PreToolUseHookOutput.deny("To narzędzie nie należy do dozwolonego zestawu Scannera.")));
    }
}
