package dev.agentscanner;

import dev.agentscanner.config.ScannerProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(ScannerProperties.class)
public class AgentScannerApplication {
    public static void main(String[] args) {
        SpringApplication.run(AgentScannerApplication.class, args);
    }
}
