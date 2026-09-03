package dev.agentscanner.otel;

import dev.agentscanner.config.ScannerProperties;
import io.opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse;
import io.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse;
import io.opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Map;
import java.util.zip.GZIPInputStream;

@RestController
public class OtlpController {
    private static final MediaType PROTOBUF = MediaType.parseMediaType("application/x-protobuf");
    private final OtlpIngestionService ingestion;
    private final ScannerProperties properties;

    public OtlpController(OtlpIngestionService ingestion, ScannerProperties properties) {
        this.ingestion = ingestion;
        this.properties = properties;
    }

    @PostMapping(path = "/v1/traces", consumes = {"application/x-protobuf", "application/protobuf", "application/octet-stream", "application/json"})
    public ResponseEntity<byte[]> traces(@RequestBody byte[] body, HttpServletRequest request) {
        byte[] payload = decode(body, request.getHeader(HttpHeaders.CONTENT_ENCODING));
        ingestion.ingestTraces(payload, request.getContentType(), request.getHeader(HttpHeaders.CONTENT_ENCODING));
        return success(request.getContentType(), ExportTraceServiceResponse.getDefaultInstance().toByteArray());
    }

    @PostMapping(path = "/v1/metrics", consumes = {"application/x-protobuf", "application/protobuf", "application/octet-stream", "application/json"})
    public ResponseEntity<byte[]> metrics(@RequestBody byte[] body, HttpServletRequest request) {
        byte[] payload = decode(body, request.getHeader(HttpHeaders.CONTENT_ENCODING));
        ingestion.ingestMetrics(payload, request.getContentType(), request.getHeader(HttpHeaders.CONTENT_ENCODING));
        return success(request.getContentType(), ExportMetricsServiceResponse.getDefaultInstance().toByteArray());
    }

    @PostMapping(path = "/v1/logs", consumes = {"application/x-protobuf", "application/protobuf", "application/octet-stream", "application/json"})
    public ResponseEntity<byte[]> logs(@RequestBody byte[] body, HttpServletRequest request) {
        byte[] payload = decode(body, request.getHeader(HttpHeaders.CONTENT_ENCODING));
        ingestion.ingestLogs(payload, request.getContentType(), request.getHeader(HttpHeaders.CONTENT_ENCODING));
        return success(request.getContentType(), ExportLogsServiceResponse.getDefaultInstance().toByteArray());
    }

    private ResponseEntity<byte[]> success(String contentType, byte[] protobufResponse) {
        if (contentType != null && contentType.toLowerCase().startsWith("application/json")) {
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        return ResponseEntity.ok().contentType(PROTOBUF).body(protobufResponse);
    }

    private byte[] decode(byte[] body, String encoding) {
        if (body.length > properties.maxPayloadBytes()) throw new PayloadTooLargeException();
        if (encoding == null || encoding.isBlank() || "identity".equalsIgnoreCase(encoding)) return body;
        if (!"gzip".equalsIgnoreCase(encoding)) throw new UnsupportedEncodingException(encoding);
        try (GZIPInputStream input = new GZIPInputStream(new ByteArrayInputStream(body));
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            input.transferTo(output);
            byte[] decoded = output.toByteArray();
            if (decoded.length > properties.maxPayloadBytes()) throw new PayloadTooLargeException();
            return decoded;
        } catch (IOException exception) {
            throw new InvalidOtlpPayloadException("Invalid gzip payload", exception);
        }
    }

    @ExceptionHandler(InvalidOtlpPayloadException.class)
    ResponseEntity<Map<String, String>> invalid(InvalidOtlpPayloadException exception) {
        return ResponseEntity.badRequest().body(Map.of("error", exception.getMessage()));
    }

    @ExceptionHandler(PayloadTooLargeException.class)
    ResponseEntity<Map<String, String>> tooLarge() {
        return ResponseEntity.status(413).body(Map.of("error", "OTLP payload exceeds configured limit"));
    }

    @ExceptionHandler(UnsupportedEncodingException.class)
    ResponseEntity<Map<String, String>> unsupported(UnsupportedEncodingException exception) {
        return ResponseEntity.status(415).body(Map.of("error", exception.getMessage()));
    }

    private static final class PayloadTooLargeException extends RuntimeException {}
    private static final class UnsupportedEncodingException extends RuntimeException {
        UnsupportedEncodingException(String encoding) { super("Unsupported Content-Encoding: " + encoding); }
    }
}
