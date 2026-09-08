package dev.agentscanner.ai.discussion;

import org.springframework.http.HttpStatus;

final class RoundDiscussionException extends RuntimeException {
    private final HttpStatus status;

    RoundDiscussionException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    HttpStatus status() {
        return status;
    }
}
