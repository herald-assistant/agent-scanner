package dev.agentscanner.ai;

/** Safe, user-facing failure raised by the isolated text-only AI transport. */
public final class AiExecutionException extends Exception {
    public enum Code { RUNTIME, TIMEOUT }

    private final Code code;

    public AiExecutionException(Code code, String message) {
        super(message);
        this.code = code;
    }

    public AiExecutionException(Code code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public Code code() {
        return code;
    }
}
