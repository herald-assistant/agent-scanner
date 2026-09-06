package dev.agentscanner.fixture;

import com.google.protobuf.ByteString;
import io.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
import io.opentelemetry.proto.common.v1.AnyValue;
import io.opentelemetry.proto.common.v1.KeyValue;
import io.opentelemetry.proto.trace.v1.ResourceSpans;
import io.opentelemetry.proto.trace.v1.ScopeSpans;
import io.opentelemetry.proto.trace.v1.Span;
import io.opentelemetry.proto.trace.v1.Status;
import java.util.List;

/** copilot-episode-v1: synthetic IDs/content; shape documented in fixtures/README.md. */
public final class MixedEpisodeTraceFixture {
    public static final String ROOT = "fixture-parent-v1";
    public static final String CHILD = "fixture-child-v1";
    private MixedEpisodeTraceFixture() {}

    public static List<Span> spans() {
        return List.of(
            span("root0001", "", "invoke_agent", ROOT, 0).addAttributes(attr("copilot_chat.chat_session_id", ROOT)).build(),
            span("chat0001", "root0001", "chat", ROOT, 1).build(),
            span("tool0001", "root0001", "execute_tool", ROOT, 2)
                .addAttributes(attr("gen_ai.tool.call.id", CHILD)).addAttributes(attr("copilot_chat.chat_session_id", ROOT)).build(),
            child("root0002", "tool0001", "invoke_agent", 3).build(),
            child("chat0002", "root0002", "chat", 4).build(),
            span("tool0002", "root0002", "execute_tool", CHILD, 5).addAttributes(attr("gen_ai.tool.call.id", "fixture-result-v1")).build(),
            child("chat0003", "root0002", "chat", 6).build()
        );
    }

    public static ExportTraceServiceRequest request(List<Span> spans) {
        return ExportTraceServiceRequest.newBuilder().addResourceSpans(ResourceSpans.newBuilder()
            .addScopeSpans(ScopeSpans.newBuilder().addAllSpans(spans))).build();
    }

    private static Span.Builder child(String id, String parent, String operation, int second) {
        return span(id, parent, operation, ROOT, second)
            .addAttributes(attr("copilot_chat.chat_session_id", CHILD))
            .addAttributes(attr("copilot_chat.parent_chat_session_id", ROOT));
    }

    private static Span.Builder span(String id, String parent, String operation, String conversation, int second) {
        long start = 1_750_000_000_000_000_000L + second * 1_000_000_000L;
        return Span.newBuilder().setTraceId(ByteString.copyFromUtf8("synthetictrace01"))
            .setSpanId(ByteString.copyFromUtf8(id)).setParentSpanId(ByteString.copyFromUtf8(parent))
            .setName(operation).setStartTimeUnixNano(start).setEndTimeUnixNano(start + 500_000_000L)
            .setStatus(Status.newBuilder().setCode(Status.StatusCode.STATUS_CODE_OK))
            .addAttributes(attr("gen_ai.operation.name", operation))
            .addAttributes(attr("gen_ai.conversation.id", conversation));
    }

    private static KeyValue attr(String key, String value) {
        return KeyValue.newBuilder().setKey(key).setValue(AnyValue.newBuilder().setStringValue(value)).build();
    }
}
