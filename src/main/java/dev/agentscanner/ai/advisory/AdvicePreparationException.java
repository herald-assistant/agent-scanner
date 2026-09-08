package dev.agentscanner.ai.advisory;

import org.springframework.http.HttpStatus;

final class AdvicePreparationException extends RuntimeException {
    private final HttpStatus status;

    AdvicePreparationException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    HttpStatus status() {
        return status;
    }
}
