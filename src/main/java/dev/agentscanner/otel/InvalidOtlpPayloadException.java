package dev.agentscanner.otel;

public class InvalidOtlpPayloadException extends RuntimeException {
    public InvalidOtlpPayloadException(String message, Throwable cause) {
        super(message, cause);
    }
}
