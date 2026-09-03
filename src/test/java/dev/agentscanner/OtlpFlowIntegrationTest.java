package dev.agentscanner;

import dev.agentscanner.fixture.CopilotTraceFixture;
import dev.agentscanner.store.ScannerStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.io.ByteArrayOutputStream;
import java.util.zip.GZIPOutputStream;
import com.google.protobuf.util.JsonFormat;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class OtlpFlowIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ScannerStore store;

    @BeforeEach
    void clearDatabase() { store.deleteAll(); }

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
            .andExpect(jsonPath("$[0].inputTokens").value(1200))
            .andExpect(jsonPath("$[0].outputTokens").value(180))
            .andExpect(jsonPath("$[0].cacheReadTokens").value(800))
            .andExpect(jsonPath("$[0].toolCount").value(1));

        long sessionId = ((Number) store.sessions().get(0).get("ID")).longValue();
        mvc.perform(get("/api/sessions/{id}", sessionId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.spans", hasSize(3)))
            .andExpect(jsonPath("$.messages", hasSize(4)))
            .andExpect(jsonPath("$.signals", hasSize(1)))
            .andExpect(jsonPath("$.signals[0].rawJson", containsString("gen_ai.operation.name")));
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
    void exportsDeletesAndImportsSessionWithItsRawSignal() throws Exception {
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

        mvc.perform(post("/api/sessions/import").contentType(MediaType.APPLICATION_JSON).content(exported))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.signals").value(1))
            .andExpect(jsonPath("$.spans").value(3));
        mvc.perform(get("/api/sessions"))
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].conversationId").value(CopilotTraceFixture.CONVERSATION));
        long importedId = ((Number) store.sessions().get(0).get("ID")).longValue();
        mvc.perform(get("/api/sessions/{id}", importedId))
            .andExpect(jsonPath("$.spans", hasSize(3)))
            .andExpect(jsonPath("$.messages", hasSize(4)))
            .andExpect(jsonPath("$.signals", hasSize(1)));
        mvc.perform(post("/api/sessions/import").contentType(MediaType.APPLICATION_JSON).content(exported))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error", containsString("już zapisana")));
    }

    @Test
    void rejectsJsonThatIsNotAnAgentScannerExport() throws Exception {
        mvc.perform(post("/api/sessions/import").contentType(MediaType.APPLICATION_JSON)
                .content("{\"format\":\"something-else\",\"version\":1}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error", containsString("Nieobsługiwany format")));
    }

    private byte[] gzip(byte[] source) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(output)) { gzip.write(source); }
        return output.toByteArray();
    }
}
