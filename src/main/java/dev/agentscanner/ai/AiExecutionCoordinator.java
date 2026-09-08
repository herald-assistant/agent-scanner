package dev.agentscanner.ai;

import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** One global execution slot shared by every feature that can invoke the AI runtime. */
@Component
public final class AiExecutionCoordinator implements AutoCloseable {
    private final AtomicBoolean running = new AtomicBoolean();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    public boolean running() {
        return running.get();
    }

    public <T> Optional<CompletableFuture<T>> submit(Task<T> task) {
        if (!running.compareAndSet(false, true)) return Optional.empty();
        return Optional.of(CompletableFuture.supplyAsync(() -> {
            try {
                return task.run();
            } catch (RuntimeException failure) {
                throw failure;
            } catch (Exception failure) {
                throw new java.util.concurrent.CompletionException(failure);
            } finally {
                running.set(false);
            }
        }, worker));
    }

    @PreDestroy
    @Override
    public void close() {
        worker.shutdownNow();
    }

    @FunctionalInterface
    public interface Task<T> {
        T run() throws Exception;
    }
}
