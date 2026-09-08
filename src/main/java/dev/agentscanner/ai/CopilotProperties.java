package dev.agentscanner.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "agent-scanner.ai")
public record CopilotProperties(String githubToken, String model, String cliPath, String dataDirectory, int timeoutSeconds) {
    public CopilotProperties {
        githubToken = githubToken == null ? "" : githubToken.trim();
        model = model == null ? "" : model.trim();
        cliPath = cliPath == null || cliPath.isBlank() ? "copilot" : cliPath;
        dataDirectory = dataDirectory == null || dataDirectory.isBlank() ? "agent-scanner-data/copilot" : dataDirectory;
        timeoutSeconds = timeoutSeconds <= 0 ? 120 : Math.min(timeoutSeconds, 300);
    }
    public boolean credentialsConfigured() { return !githubToken.isBlank(); }
    public boolean configured() { return !githubToken.isBlank() && !model.isBlank(); }
    @Override public String toString() { return "CopilotProperties[credentials=redacted]"; }
}
