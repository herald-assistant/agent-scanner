package dev.agentscanner.ai.sessionchat;

import org.springframework.http.HttpStatus;

final class SessionChatException extends RuntimeException {
    private final HttpStatus status;

    SessionChatException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    HttpStatus status() { return status; }
}
