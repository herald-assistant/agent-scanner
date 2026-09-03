package dev.agentscanner.fixture;

import com.google.protobuf.ByteString;
import io.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
import io.opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest;
import io.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest;
import io.opentelemetry.proto.common.v1.AnyValue;
import io.opentelemetry.proto.common.v1.KeyValue;
import io.opentelemetry.proto.resource.v1.Resource;
import io.opentelemetry.proto.trace.v1.ResourceSpans;
import io.opentelemetry.proto.trace.v1.ScopeSpans;
import io.opentelemetry.proto.trace.v1.Span;
import io.opentelemetry.proto.trace.v1.Status;
import io.opentelemetry.proto.logs.v1.LogRecord;
import io.opentelemetry.proto.logs.v1.ResourceLogs;
import io.opentelemetry.proto.logs.v1.ScopeLogs;
import io.opentelemetry.proto.metrics.v1.AggregationTemporality;
import io.opentelemetry.proto.metrics.v1.Metric;
import io.opentelemetry.proto.metrics.v1.NumberDataPoint;
import io.opentelemetry.proto.metrics.v1.ResourceMetrics;
import io.opentelemetry.proto.metrics.v1.ScopeMetrics;
import io.opentelemetry.proto.metrics.v1.Sum;

import java.nio.charset.StandardCharsets;

public final class CopilotTraceFixture {
    public static final String CONVERSATION = "fixture-conversation-001";
    public static final ByteString TRACE_ID = bytes("0123456789abcdef");
    public static final ByteString ROOT_SPAN_ID = bytes("root0001");
    public static final ByteString CHAT_SPAN_ID = bytes("chat0001");
    public static final ByteString TOOL_SPAN_ID = bytes("tool0001");

    private CopilotTraceFixture() {}

    public static ExportTraceServiceRequest request() {
        long start = 1_750_000_000_000_000_000L;
        Span root = Span.newBuilder()
            .setTraceId(TRACE_ID).setSpanId(ROOT_SPAN_ID).setName("invoke_agent GitHub Copilot Chat")
            .setStartTimeUnixNano(start).setEndTimeUnixNano(start + 3_000_000_000L)
            .setStatus(Status.newBuilder().setCode(Status.StatusCode.STATUS_CODE_OK))
            .addAttributes(string("gen_ai.operation.name", "invoke_agent"))
            .addAttributes(string("gen_ai.agent.name", "GitHub Copilot Chat"))
            .addAttributes(string("gen_ai.conversation.id", CONVERSATION))
            .addAttributes(string("gen_ai.request.model", "gpt-4.1"))
            .addAttributes(string("gen_ai.response.model", "gpt-4.1-2025-04-14"))
            .addAttributes(string("github.copilot.agent.type", "builtin"))
            .addAttributes(string("github.copilot.git.repository", "https://github.com/example/anonymized"))
            .addAttributes(string("github.copilot.git.branch", "feature/otel-spike"))
            .addAttributes(number("gen_ai.usage.input_tokens", 1200))
            .addAttributes(number("gen_ai.usage.output_tokens", 180))
            .addAttributes(number("gen_ai.usage.cache_read.input_tokens", 800))
            .addAttributes(number("gen_ai.usage.cache_creation.input_tokens", 100))
            .addAttributes(number("copilot_chat.turn_count", 1))
            .addAttributes(string("gen_ai.input.messages", "[{\"role\":\"system\",\"content\":\"You are a coding agent.\"},{\"role\":\"user\",\"content\":\"Inspect the fixture.\"}]"))
            .addAttributes(string("gen_ai.output.messages", "[{\"role\":\"assistant\",\"content\":\"Fixture inspected.\"}]"))
            .addAttributes(string("gen_ai.tool.definitions", "[{\"name\":\"readFile\",\"description\":\"Read a workspace file\"}]"))
            .build();

        Span chat = Span.newBuilder()
            .setTraceId(TRACE_ID).setSpanId(CHAT_SPAN_ID).setParentSpanId(ROOT_SPAN_ID).setName("chat gpt-4.1")
            .setStartTimeUnixNano(start + 100_000_000L).setEndTimeUnixNano(start + 1_000_000_000L)
            .setStatus(Status.newBuilder().setCode(Status.StatusCode.STATUS_CODE_OK))
            .addAttributes(string("gen_ai.operation.name", "chat"))
            .addAttributes(string("gen_ai.request.model", "gpt-4.1"))
            .addAttributes(number("gen_ai.usage.input_tokens", 1200))
            .addAttributes(number("gen_ai.usage.output_tokens", 180))
            .addAttributes(number("gen_ai.usage.reasoning.output_tokens", 40))
            .addAttributes(decimal("copilot_chat.time_to_first_token", 221.5))
            .build();

        Span tool = Span.newBuilder()
            .setTraceId(TRACE_ID).setSpanId(TOOL_SPAN_ID).setParentSpanId(ROOT_SPAN_ID).setName("execute_tool readFile")
            .setStartTimeUnixNano(start + 1_100_000_000L).setEndTimeUnixNano(start + 1_150_000_000L)
            .setStatus(Status.newBuilder().setCode(Status.StatusCode.STATUS_CODE_OK))
            .addAttributes(string("gen_ai.operation.name", "execute_tool"))
            .addAttributes(string("gen_ai.tool.name", "readFile"))
            .addAttributes(string("gen_ai.tool.call.id", "call-fixture-1"))
            .addAttributes(string("gen_ai.tool.call.arguments", "{\"path\":\"README.md\"}"))
            .addAttributes(string("gen_ai.tool.call.result", "# Example"))
            .addAttributes(string("github.copilot.tool.parameters.skill_name", "fixture-skill"))
            .build();

        Resource resource = Resource.newBuilder()
            .addAttributes(string("service.name", "copilot-chat"))
            .addAttributes(string("service.version", "fixture-version"))
            .addAttributes(string("session.id", "fixture-window"))
            .build();
        ScopeSpans scope = ScopeSpans.newBuilder().addSpans(root).addSpans(chat).addSpans(tool).build();
        return ExportTraceServiceRequest.newBuilder()
            .addResourceSpans(ResourceSpans.newBuilder().setResource(resource).addScopeSpans(scope))
            .build();
    }

    public static ExportMetricsServiceRequest metricsRequest() {
        Metric metric = Metric.newBuilder().setName("copilot_chat.session.count")
            .setSum(Sum.newBuilder().setAggregationTemporality(AggregationTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE)
                .setIsMonotonic(true).addDataPoints(NumberDataPoint.newBuilder().setAsInt(1)
                    .setTimeUnixNano(1_750_000_003_000_000_000L))).build();
        return ExportMetricsServiceRequest.newBuilder().addResourceMetrics(ResourceMetrics.newBuilder()
            .setResource(Resource.newBuilder().addAttributes(string("service.name", "copilot-chat")))
            .addScopeMetrics(ScopeMetrics.newBuilder().addMetrics(metric))).build();
    }

    public static ExportLogsServiceRequest logsRequest() {
        LogRecord log = LogRecord.newBuilder().setTimeUnixNano(1_750_000_003_000_000_000L)
            .setEventName("copilot_chat.session.start")
            .setBody(AnyValue.newBuilder().setStringValue("anonymized fixture event"))
            .addAttributes(string("gen_ai.conversation.id", CONVERSATION)).build();
        return ExportLogsServiceRequest.newBuilder().addResourceLogs(ResourceLogs.newBuilder()
            .setResource(Resource.newBuilder().addAttributes(string("service.name", "copilot-chat")))
            .addScopeLogs(ScopeLogs.newBuilder().addLogRecords(log))).build();
    }

    private static KeyValue string(String key, String value) {
        return KeyValue.newBuilder().setKey(key).setValue(AnyValue.newBuilder().setStringValue(value)).build();
    }

    private static KeyValue number(String key, long value) {
        return KeyValue.newBuilder().setKey(key).setValue(AnyValue.newBuilder().setIntValue(value)).build();
    }

    private static KeyValue decimal(String key, double value) {
        return KeyValue.newBuilder().setKey(key).setValue(AnyValue.newBuilder().setDoubleValue(value)).build();
    }

    private static ByteString bytes(String value) {
        return ByteString.copyFrom(value.getBytes(StandardCharsets.UTF_8));
    }
}
