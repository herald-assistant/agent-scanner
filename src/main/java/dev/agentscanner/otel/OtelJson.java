package dev.agentscanner.otel;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.protobuf.ByteString;
import io.opentelemetry.proto.common.v1.AnyValue;
import io.opentelemetry.proto.common.v1.KeyValue;

import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

public final class OtelJson {
    private OtelJson() {}

    public static ObjectNode attributes(ObjectMapper mapper, List<KeyValue> values) {
        ObjectNode result = mapper.createObjectNode();
        values.forEach(value -> result.set(value.getKey(), value(mapper, value.getValue())));
        return result;
    }

    public static JsonNode value(ObjectMapper mapper, AnyValue value) {
        return switch (value.getValueCase()) {
            case STRING_VALUE -> mapper.getNodeFactory().textNode(value.getStringValue());
            case BOOL_VALUE -> mapper.getNodeFactory().booleanNode(value.getBoolValue());
            case INT_VALUE -> mapper.getNodeFactory().numberNode(value.getIntValue());
            case DOUBLE_VALUE -> mapper.getNodeFactory().numberNode(value.getDoubleValue());
            case BYTES_VALUE -> mapper.getNodeFactory().textNode(Base64.getEncoder().encodeToString(value.getBytesValue().toByteArray()));
            case ARRAY_VALUE -> {
                ArrayNode array = mapper.createArrayNode();
                value.getArrayValue().getValuesList().forEach(item -> array.add(value(mapper, item)));
                yield array;
            }
            case KVLIST_VALUE -> attributes(mapper, value.getKvlistValue().getValuesList());
            case VALUE_NOT_SET -> mapper.nullNode();
        };
    }

    public static String hex(ByteString bytes) {
        return HexFormat.of().formatHex(bytes.toByteArray());
    }

    public static Instant instant(long unixNanos) {
        if (unixNanos == 0) return null;
        return Instant.ofEpochSecond(unixNanos / 1_000_000_000L, unixNanos % 1_000_000_000L);
    }

    public static String text(ObjectNode attributes, String key) {
        JsonNode value = attributes.get(key);
        if (value == null || value.isNull()) return null;
        return value.isTextual() ? value.textValue() : value.asText();
    }

    public static long number(ObjectNode attributes, String key) {
        JsonNode value = attributes.get(key);
        return value == null || !value.isNumber() ? 0 : value.longValue();
    }

    public static Double decimal(ObjectNode attributes, String key) {
        JsonNode value = attributes.get(key);
        return value == null || !value.isNumber() ? null : value.doubleValue();
    }
}
