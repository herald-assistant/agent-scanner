package dev.agentscanner.ai;

import com.github.copilot.CopilotClient;
import com.github.copilot.rpc.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** One text-only turn. No tools, skills, repository instructions or conversation resume. */
@Component
public class CopilotCompletion {
    private static final Logger LOG = LoggerFactory.getLogger(CopilotCompletion.class);
    private final CopilotProperties properties;
    public CopilotCompletion(CopilotProperties properties) { this.properties = properties; }

    public String complete(String prompt) throws Exception {
        Path home = Files.createDirectories(Path.of(properties.dataDirectory()).toAbsolutePath());
        Path work = Files.createDirectories(home.resolve("work"));
        var options = new CopilotClientOptions().setCliPath(properties.cliPath()).setCwd(work.toString())
            .setCopilotHome(home.toString()).setGitHubToken(properties.githubToken()).setUseLoggedInUser(false)
            .setAutoRestart(false).setMode(CopilotClientMode.EMPTY);
        var client = new CopilotClient(options);
        String stage = "start";
        try {
            client.start().get(30, TimeUnit.SECONDS);
            stage = "status";
            var status = client.getStatus().get(10, TimeUnit.SECONDS);
            LOG.info("Copilot runtime gotowy: CLI {}, protokół {}", status.getVersion(), status.getProtocolVersion());
            stage = "auth";
            if (!client.getAuthStatus().get(10, TimeUnit.SECONDS).isAuthenticated()) {
                throw new RuntimeFailure("Copilot nie zaakceptował skonfigurowanego tokena. Sprawdź uprawnienie Copilot Requests i dostęp konta do Copilota.");
            }
            stage = "models";
            var models = client.listModels().get(20, TimeUnit.SECONDS);
            if (models.stream().noneMatch(model -> properties.model().equals(model.getId()))) {
                String available = models.stream().map(ModelInfo::getId).filter(java.util.Objects::nonNull).limit(12)
                    .collect(java.util.stream.Collectors.joining(", "));
                throw new RuntimeFailure("Model „" + properties.model() + "” nie jest dostępny dla tego konta. Dostępne modele: "
                    + (available.isBlank() ? "brak danych" : available) + ".");
            }
            stage = "session";
            try (var session = client.createSession(sessionConfig(properties.model(), work)).get(30, TimeUnit.SECONDS)) {
                try {
                    stage = "inference";
                    var answer = session.sendAndWait(new MessageOptions().setPrompt(prompt), properties.timeoutSeconds() * 1000L)
                        .get(properties.timeoutSeconds() + 5L, TimeUnit.SECONDS);
                    if (answer == null || answer.getData() == null || answer.getData().content() == null) {
                        throw new RuntimeFailure("Copilot zakończył analizę bez odpowiedzi.");
                    }
                    return answer.getData().content();
                } catch (Exception failure) {
                    try { session.abort().get(5, TimeUnit.SECONDS); } catch (Exception ignored) { /* Stop the client below. */ }
                    throw failure;
                }
            }
        } catch (RuntimeFailure failure) {
            throw failure;
        } catch (InterruptedException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new RuntimeFailure(messageFor(stage), failure);
        } finally {
            // Klient jest jednorazowy, a store sesji wyłączony. forceStop omija nieobsługiwane
            // przez starsze CLI RPC runtime.shutdown i zawsze kończy lokalny proces runtime.
            try { client.forceStop().get(10, TimeUnit.SECONDS); }
            catch (Exception cleanupFailure) { LOG.debug("Nie udało się domknąć procesu Copilot runtime", cleanupFailure); }
        }
    }

    private static String messageFor(String stage) {
        return switch (stage) {
            case "start" -> "Nie udało się uruchomić Copilot CLI. Sprawdź agent-scanner.ai.cli-path i zgodność wersji CLI z Java SDK.";
            case "status" -> "Copilot CLI uruchomił się, ale nie zwrócił informacji o wersji protokołu.";
            case "auth" -> "Nie udało się sprawdzić autoryzacji Copilota. Sprawdź token i połączenie sieciowe.";
            case "models" -> "Nie udało się pobrać modeli dostępnych dla konta Copilot.";
            case "session" -> "Copilot nie utworzył sesji klasyfikacji.";
            default -> "Copilot nie zakończył klasyfikacji. Sprawdź połączenie i spróbuj ponownie.";
        };
    }

    static final class RuntimeFailure extends Exception {
        RuntimeFailure(String message) { super(message); }
        RuntimeFailure(String message, Throwable cause) { super(message, cause); }
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
            .setHooks(new SessionHooks().setOnPreToolUse((input, invocation) ->
                CompletableFuture.completedFuture(PreToolUseHookOutput.deny("Narzędzia są wyłączone."))))
            .setOnPermissionRequest((request, invocation) -> CompletableFuture.completedFuture(
                new PermissionRequestResult().setKind(PermissionRequestResultKind.REJECTED)));
    }
}
