package dev.agentscanner.ai;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class AiExecutionCoordinatorTest {
    @Test
    void exposesOneGlobalExecutionSlot() throws Exception {
        var coordinator = new AiExecutionCoordinator();
        var started = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            var first = coordinator.submit(() -> {
                started.countDown();
                release.await(2, TimeUnit.SECONDS);
                return "done";
            }).orElseThrow();
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(coordinator.running()).isTrue();
            assertThat(coordinator.submit(() -> "duplicate")).isEmpty();
            release.countDown();
            assertThat(first.get(2, TimeUnit.SECONDS)).isEqualTo("done");
            assertThat(coordinator.running()).isFalse();
        } finally {
            release.countDown();
            coordinator.close();
        }
    }
}
