package dev.agentscanner;

import dev.agentscanner.fixture.CopilotTraceFixture;
import dev.agentscanner.fixture.MixedEpisodeTraceFixture;
import dev.agentscanner.store.ScannerStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.zip.GZIPOutputStream;
import com.google.protobuf.util.JsonFormat;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@AutoConfigureMockMvc
class OtlpFlowIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ScannerStore store;

    @BeforeEach
    void clearDatabase() { store.deleteAll(); }

    @Test
    void persistsClassificationWithTheSessionAndDeletesItByCascade() throws Exception {
        mvc.perform(post("/v1/traces").contentType("application/x-protobuf")
            .content(CopilotTraceFixture.request().toByteArray())).andExpect(status().isOk());
        long sessionId = store.sessionIdByConversationId(CopilotTraceFixture.CONVERSATION).orElseThrow();
        String hash = "a".repeat(64);
        store.saveToolClassification(sessionId, hash, "tool-usage-v2", "test-model", Instant.parse("2026-01-01T00:00:00Z"), "{\"version\":\"tool-usage-v2\"}");
        assertTrue(store.toolClassification(sessionId, hash).isPresent());
        store.deleteSession(sessionId);
        assertTrue(store.toolClassification(sessionId, hash).isEmpty());
    }

    @Test
    void listsLightweightSessionChatIndexWithLatestTurnMetadata() throws Exception {
        mvc.perform(post("/v1/traces").contentType("application/x-protobuf")
            .content(CopilotTraceFixture.request().toByteArray())).andExpect(status().isOk());
        long sessionId = store.sessionIdByConversationId(CopilotTraceFixture.CONVERSATION).orElseThrow();
        Instant created = Instant.parse("2026-01-01T00:00:00Z");
        store.saveSessionChat("chat-1", sessionId, "test-model", 1L, "copilot-episode-v1",
            "prompt", "tools", "redaction", "{\"large\":\"bootstrap\"}", "hash", created);
        store.saveSessionChatTurn("turn-1", "chat-1", "11111111-1111-1111-1111-111111111111",
            "Pierwsze pytanie", "hash-1", created.plusSeconds(1));
        store.failSessionChatTurn("chat-1", "turn-1", "test", created.plusSeconds(2));
        store.saveSessionChatTurn("turn-2", "chat-1", "22222222-2222-2222-2222-222222222222",
            "Ostatnie pytanie", "hash-2", created.plusSeconds(3));

        var index = store.sessionChatIndex(sessionId);

        assertEquals(1, index.size());
        assertEquals(2, index.get(0).turnCount());
        assertEquals("Ostatnie pytanie", index.get(0).lastQuestion());
        assertEquals("RUNNING", index.get(0).lastTurnStatus());
    }

    @Test
    void preservesPerSpanSessionOwnershipAcrossMixedAndReorderedBatches() throws Exception {
        var original = MixedEpisodeTraceFixture.spans();
        for (int mode = 0; mode < 3; mode++) {
            store.deleteAll();
            var spans = new java.util.ArrayList<>(original);
            if (mode > 0) java.util.Collections.reverse(spans);
            var batches = mode == 2 ? spans.stream().map(java.util.List::of).toList() : java.util.List.of(spans);
            for (var batch : batches) {
                mvc.perform(post("/v1/traces").contentType("application/x-protobuf")
                    .content(MixedEpisodeTraceFixture.request(batch).toByteArray())).andExpect(status().isOk());
            }
            assertEquals(2, store.sessions().size());
            long parentId = store.sessionIdByConversationId(MixedEpisodeTraceFixture.ROOT).orElseThrow();
            long childId = store.sessionIdByConversationId(MixedEpisodeTraceFixture.CHILD).orElseThrow();
            assertEquals(3, store.spans(parentId).size());
            assertEquals(4, store.spans(childId).size());
            assertEquals(1, store.spans(parentId).stream().filter(row -> "chat".equals(row.get("OPERATION_NAME"))).count());
            assertEquals(2, store.spans(childId).stream().filter(row -> "chat".equals(row.get("OPERATION_NAME"))).count());
            // The normalized owner changes, but raw child chat attributes retain the emitted parent ID.
            mvc.perform(get("/api/sessions/{id}", childId)).andExpect(status().isOk())
                .andExpect(jsonPath("$.signals[0].rawJson", containsString(MixedEpisodeTraceFixture.ROOT)))
                .andExpect(jsonPath("$.spans", hasSize(4)));
            mvc.perform(get("/api/sessions/{id}/analysis", parentId)).andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value("session-reconstruction-v1"))
                .andExpect(jsonPath("$.reconstructionVersion").value("copilot-episode-v1"))
                .andExpect(jsonPath("$.view.primaryModelSpans", hasSize(1)))
                .andExpect(jsonPath("$.view.billingModelSpans", hasSize(3)))
                .andExpect(jsonPath("$.view.costGroups", hasSize(2)))
                .andExpect(jsonPath("$.view.costGroups[0].kind").value("main"))
                .andExpect(jsonPath("$.view.costGroups[1].kind").value("subagent"))
                .andExpect(jsonPath("$.workflowSources").doesNotExist())
                .andExpect(jsonPath("$.view.source").doesNotExist())
                .andExpect(jsonPath("$.relatedDetails[0].signals[0].rawJson").doesNotExist());
            mvc.perform(get("/api/sessions/{id}/workflow-sources", parentId)).andExpect(status().isOk())
                .andExpect(jsonPath("$.sources", hasSize(1)))
                .andExpect(jsonPath("$.sources[0].session.conversationId").value(MixedEpisodeTraceFixture.CHILD));
        }
    }

    @Test
    void ingestsCopilotTraceAndExposesNormalizedSession() throws Exception {
        mvc.perform(post("/v1/traces")
                .contentType("application/x-protobuf")
                .content(CopilotTraceFixture.request().toByteArray()))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("application/x-protobuf"));

        mvc.perform(get("/api/status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.connected").value(true))
            .andExpect(jsonPath("$.traces").value(1))
            .andExpect(jsonPath("$.contentCaptured").value(true));

        mvc.perform(get("/api/sessions"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].conversationId").value(CopilotTraceFixture.CONVERSATION))
            .andExpect(jsonPath("$[0].agentName").value("GitHub Copilot Chat"))
            .andExpect(jsonPath("$[0].sourceKind").value("vscode"))
            .andExpect(jsonPath("$[0].sourceName").value("Visual Studio Code"))
            .andExpect(jsonPath("$[0].sourceService").value("copilot-chat"))
            .andExpect(jsonPath("$[0].sourceVersion").value("fixture-version"))
            .andExpect(jsonPath("$[0].inputTokens").value(1200))
            .andExpect(jsonPath("$[0].outputTokens").value(180))
            .andExpect(jsonPath("$[0].cacheReadTokens").value(800))
            .andExpect(jsonPath("$[0].toolCount").value(1));

        long sessionId = ((Number) store.sessions().get(0).get("ID")).longValue();
        mvc.perform(get("/api/sessions/{id}", sessionId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.spans", hasSize(3)))
            .andExpect(jsonPath("$.session.sourceKind").value("vscode"))
            .andExpect(jsonPath("$.messages", hasSize(4)))
            .andExpect(jsonPath("$.signals", hasSize(1)))
            .andExpect(jsonPath("$.signals[0].rawJson", containsString("gen_ai.operation.name")));

        mvc.perform(get("/api/sessions/{id}/analysis", sessionId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.detail.session.id").value(sessionId))
            .andExpect(jsonPath("$.view.interactions", hasSize(1)))
            .andExpect(jsonPath("$.view.modelTurns", hasSize(1)))
            .andExpect(jsonPath("$.view.modelTurns[0].tools", hasSize(1)))
            .andExpect(jsonPath("$.cutoffSignalId").isNumber());
    }

    @Test
    void readsSdkCacheWriteAndCountsRoundsAndToolsAcrossBatches() throws Exception {
        for (var batch : CopilotTraceFixture.sdkBatches()) {
            mvc.perform(post("/v1/traces").contentType("application/x-protobuf").content(batch.toByteArray()))
                .andExpect(status().isOk());
        }
        long sessionId = store.sessionIdByConversationId("sdk-fixture-conversation").orElseThrow();
        mvc.perform(get("/api/sessions"))
            .andExpect(jsonPath("$[0].turnCount").value(2))
            .andExpect(jsonPath("$[0].toolCount").value(1))
            .andExpect(jsonPath("$[0].sourceKind").value("copilot-sdk"))
            .andExpect(jsonPath("$[0].sourceName").value("GitHub Copilot SDK"))
            .andExpect(jsonPath("$[0].sourceService").value("github-copilot"))
            .andExpect(jsonPath("$[0].cacheCreationTokens").value(300));
        mvc.perform(get("/api/sessions/{id}", sessionId))
            .andExpect(jsonPath("$.spans", hasSize(4)))
            .andExpect(jsonPath("$.session.turnCount").value(2))
            .andExpect(jsonPath("$.session.toolCount").value(1))
            .andExpect(jsonPath("$.spans[1].cacheCreationTokens").value(100))
            .andExpect(jsonPath("$.spans[2].cacheCreationTokens").value(200));
    }

    @Test
    void acceptsGzipAndReturnsStandardEmptyProtobufResponse() throws Exception {
        byte[] compressed = gzip(CopilotTraceFixture.request().toByteArray());
        mvc.perform(post("/v1/traces")
                .contentType("application/x-protobuf")
                .header("Content-Encoding", "gzip")
                .content(compressed))
            .andExpect(status().isOk())
            .andExpect(content().bytes(new byte[0]));
    }

    @Test
    void acceptsOtlpJsonUsedByDefaultInCurrentVsCode() throws Exception {
        String json = JsonFormat.printer().preservingProtoFieldNames().print(CopilotTraceFixture.request());
        mvc.perform(post("/v1/traces")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(content().json("{}"));
        mvc.perform(get("/api/sessions"))
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].conversationId").value(CopilotTraceFixture.CONVERSATION));
    }

    @Test
    void pauseAcknowledgesButDoesNotPersistPayload() throws Exception {
        mvc.perform(post("/api/pause").contentType(MediaType.APPLICATION_JSON).content("{\"paused\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.paused").value(true));
        mvc.perform(post("/v1/traces").contentType("application/x-protobuf")
                .content(CopilotTraceFixture.request().toByteArray()))
            .andExpect(status().isOk());
        mvc.perform(get("/api/sessions")).andExpect(jsonPath("$", hasSize(0)));
        mvc.perform(post("/api/pause").contentType(MediaType.APPLICATION_JSON).content("{\"paused\":false}"));
    }

    @Test
    void rejectsMalformedProtobuf() throws Exception {
        mvc.perform(post("/v1/traces").contentType("application/x-protobuf").content(new byte[]{1, 2, 3}))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Invalid OTLP trace protobuf"));
    }

    @Test
    void acceptsMetricsAndLogsSignals() throws Exception {
        mvc.perform(post("/v1/metrics").contentType("application/x-protobuf")
                .content(CopilotTraceFixture.metricsRequest().toByteArray()))
            .andExpect(status().isOk()).andExpect(content().bytes(new byte[0]));
        mvc.perform(post("/v1/logs").contentType("application/x-protobuf")
                .content(CopilotTraceFixture.logsRequest().toByteArray()))
            .andExpect(status().isOk()).andExpect(content().bytes(new byte[0]));
        mvc.perform(get("/api/status"))
            .andExpect(jsonPath("$.metrics").value(1))
            .andExpect(jsonPath("$.logs").value(1));
    }

    @Test
    void exportsAndDeletesSessionWithItsRawSignal() throws Exception {
        mvc.perform(post("/v1/traces").contentType("application/x-protobuf")
            .content(CopilotTraceFixture.request().toByteArray())).andExpect(status().isOk());
        long sessionId = ((Number) store.sessions().get(0).get("ID")).longValue();
        byte[] exported = mvc.perform(get("/api/sessions/{id}/export", sessionId))
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Disposition", containsString("agent-scanner-session-")))
            .andExpect(jsonPath("$.format").value("agent-scanner-session"))
            .andExpect(jsonPath("$.signals", hasSize(1)))
            .andReturn().getResponse().getContentAsByteArray();
        mvc.perform(delete("/api/sessions/{id}", sessionId)).andExpect(status().isNoContent());
        mvc.perform(get("/api/sessions")).andExpect(jsonPath("$", hasSize(0)));
        mvc.perform(get("/api/status")).andExpect(jsonPath("$.traces").value(0));

        assertTrue(exported.length > 0);
    }

    @Test
    void rejectsLegacyJsonImportContentType() throws Exception {
        mvc.perform(post("/api/sessions/import").contentType(MediaType.APPLICATION_JSON)
                .content("{\"format\":\"something-else\",\"version\":1}"))
            .andExpect(status().isUnsupportedMediaType());
    }

    private byte[] gzip(byte[] source) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(output)) { gzip.write(source); }
        return output.toByteArray();
    }
}
