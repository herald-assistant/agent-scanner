package dev.agentscanner.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "agent-scanner")
public record ScannerProperties(int retentionDays, int maxPayloadBytes) {
    public ScannerProperties {
        if (retentionDays <= 0) retentionDays = 30;
        if (maxPayloadBytes <= 0) maxPayloadBytes = 64 * 1024 * 1024;
    }
}
