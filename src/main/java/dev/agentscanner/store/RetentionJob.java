package dev.agentscanner.store;

import dev.agentscanner.config.ScannerProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Component
public class RetentionJob {
    private static final Logger log = LoggerFactory.getLogger(RetentionJob.class);
    private final ScannerStore store;
    private final ScannerProperties properties;

    public RetentionJob(ScannerStore store, ScannerProperties properties) {
        this.store = store;
        this.properties = properties;
    }

    @Scheduled(initialDelayString = "PT5M", fixedDelayString = "PT24H")
    public void cleanExpired() {
        int deleted = store.deleteBefore(Instant.now().minus(properties.retentionDays(), ChronoUnit.DAYS));
        if (deleted > 0) {
            store.checkpoint();
            log.info("Retention removed {} telemetry batches", deleted);
        }
    }
}
