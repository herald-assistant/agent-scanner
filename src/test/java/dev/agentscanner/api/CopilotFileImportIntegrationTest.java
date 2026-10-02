package dev.agentscanner.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.agentscanner.store.ScannerStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.*;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class CopilotFileImportIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ScannerStore store;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach void clearDatabase() { store.deleteAll(); }

    @Test void matchesSharedBrowserPreviewExpectations() throws Exception {
        var contracts = mapper.readTree(fixture("copilot-file-expectations-v1.json")).fields();
        while (contracts.hasNext()) {
            var contract = contracts.next();
            var response = mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson")
                .content(fixture(contract.getKey()))).andExpect(status().isOk()).andReturn().getResponse();
            var actual = mapper.readTree(response.getContentAsString());
            var expected = contract.getValue();
            for (String key : List.of("ignoredRecords", "duplicateRecords", "unassignedSpans")) {
                assertEquals(expected.get(key), actual.get(key), contract.getKey() + ": " + key);
            }
            assertEquals(expected.path("sessions").size(), actual.path("sessions").size());
            for (int index = 0; index < expected.path("sessions").size(); index++) {
                var fields = expected.path("sessions").get(index).fields();
            while (fields.hasNext()) {
                    var field = fields.next();
                    assertEquals(field.getValue(), actual.path("sessions").get(index).get(field.getKey()), field.getKey());
                }
            }
            store.deleteAll();
            for (var candidate : expected.path("sessions")) {
                mvc.perform(post("/api/sessions/import").param("conversationId", candidate.path("conversationId").asText())
                    .contentType("application/x-ndjson").content(fixture(contract.getKey()))).andExpect(status().isCreated());
            }
            var normalized = expected.path("normalized").fields();
            while (normalized.hasNext()) {
                var entry = normalized.next();
                long sessionId = store.sessionIdByConversationId(entry.getKey()).orElseThrow();
                var detailResponse = mvc.perform(get("/api/sessions/{id}", sessionId)).andExpect(status().isOk())
                    .andReturn().getResponse();
                var detail = mapper.readTree(detailResponse.getContentAsString());
                var fields = entry.getValue().fields();
                while (fields.hasNext()) {
                    var field = fields.next();
                    if (field.getKey().equals("spans")) assertEquals(field.getValue().asInt(), detail.path("spans").size());
                    else assertEquals(field.getValue(), detail.path("session").get(field.getKey()), field.getKey());
                }
            }
            store.deleteAll();
        }
    }

    @Test void previewsMultipleSessionsWithoutSavingAndImportsOnlySelectedTreeEvenWhenPaused() throws Exception {
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(fixture()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.sessions", hasSize(2)))
            .andExpect(jsonPath("$.ignoredRecords").value(3))
            .andExpect(jsonPath("$.sessions[0].conversationId").value("file-session-b"))
            .andExpect(jsonPath("$.sessions[1].conversationId").value("file-session-a"))
            .andExpect(jsonPath("$.sessions[1].relatedSessions").value(1))
            .andExpect(jsonPath("$.sessions[1].turns").value(1))
            .andExpect(jsonPath("$.sessions[1].relatedTurns").value(1))
            .andExpect(jsonPath("$.sessions[1].auxiliaryCalls").value(0))
            .andExpect(jsonPath("$.unassignedSpans").value(0))
            .andExpect(jsonPath("$.sessions[1].spans").value(5));
        assertTrue(store.sessions().isEmpty());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM telemetry_signal", Integer.class));
        mvc.perform(post("/api/pause").contentType("application/json").content("{\"paused\":true}"));
        try {
            importA().andExpect(status().isCreated()).andExpect(jsonPath("$.spans").value(5));
        } finally {
            mvc.perform(post("/api/pause").contentType("application/json").content("{\"paused\":false}"));
        }
        assertEquals(2, store.sessions().size());
        assertTrue(store.sessionIdByConversationId("file-session-b").isEmpty());
        long parent = store.sessionIdByConversationId("file-session-a").orElseThrow();
        long child = store.sessionIdByConversationId("file-child-a").orElseThrow();
        assertEquals(3, store.spans(parent).size());
        assertEquals(2, store.spans(child).size());
        mvc.perform(get("/api/sessions/{id}", parent)).andExpect(status().isOk())
            .andExpect(jsonPath("$.session.sourceKind").value("vscode"))
            .andExpect(jsonPath("$.session.inputTokens").value(100))
            .andExpect(jsonPath("$.messages", hasSize(2)))
            .andExpect(jsonPath("$.signals[0].rawJson", containsString("unknownFileField")))
            .andExpect(jsonPath("$.signals[0].rawJson", not(containsString("file-session-b"))));
        byte[] original = jdbc.queryForObject("SELECT raw_payload FROM telemetry_signal", byte[].class);
        assertTrue(new String(original, StandardCharsets.UTF_8).contains("unknownFileField"));
        assertFalse(new String(original, StandardCharsets.UTF_8).contains("synthetic log"));
        ObjectNode chat = (ObjectNode) mapper.readTree(store.spans(parent).stream()
            .filter(span -> "chat".equals(span.get("OPERATION_NAME"))).findFirst().orElseThrow().get("ATTRIBUTES_JSON").toString());
        assertEquals(1, chat.path("unknown.attribute").path("preserved").get(0).intValue());
        mvc.perform(get("/api/sessions/{id}/analysis", parent)).andExpect(status().isOk())
            .andExpect(jsonPath("$.view.costGroups", hasSize(2)));
        importA().andExpect(status().isConflict());
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM telemetry_signal", Integer.class));
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(fixture()))
            .andExpect(jsonPath("$.sessions[1].alreadyImported").value(true))
            .andExpect(jsonPath("$.sessions[0].alreadyImported").value(false));
    }

    @Test void rejectsMissingSelectionOldExportInvalidUtf8AndBrokenLinesWithoutWrites() throws Exception {
        mvc.perform(post("/api/sessions/import").contentType("application/x-ndjson").content(fixture()))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/sessions/import").param("conversationId", "missing")
            .contentType("application/x-ndjson").content(fixture())).andExpect(status().isBadRequest());
        for (String text : List.of("{\"format\":\"agent-scanner-session\",\"version\":1}",
                new String(fixture(), StandardCharsets.UTF_8) + "\n{broken}", "{}\n{\"key\":1,\"key\":2}")) {
            mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(text))
                .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(new byte[]{(byte) 0xFF}))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(" ".repeat(1_048_577)))
            .andExpect(status().isPayloadTooLarge());
        assertTrue(store.sessions().isEmpty());
    }

    @Test void deduplicatesIdenticalSpansAndRejectsConflictingSpanIds() throws Exception {
        String original = new String(fixture(), StandardCharsets.UTF_8);
        String first = original.lines().findFirst().orElseThrow();
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(original + "\n" + first))
            .andExpect(status().isOk()).andExpect(jsonPath("$.duplicateRecords").value(1))
            .andExpect(jsonPath("$.sessions[1].spans").value(5));
        ObjectNode changed = (ObjectNode) mapper.readTree(first);
        changed.put("name", "conflicting synthetic span");
        mvc.perform(post("/api/sessions/import").param("conversationId", "file-session-a")
            .contentType("application/x-ndjson").content(original + "\n" + changed))
            .andExpect(status().isBadRequest());
        assertTrue(store.sessions().isEmpty());
    }

    @Test void resolvesReorderedSpansAndMultipleSessionsInOneTraceWithoutLeakingOtherSession() throws Exception {
        List<String> lines = new ArrayList<>(new String(fixture(), StandardCharsets.UTF_8).lines().toList());
        lines.replaceAll(line -> line.replace("22222222222222222222222222222222", "11111111111111111111111111111111"));
        Collections.reverse(lines);
        String reordered = "\uFEFF" + String.join("\r\n", lines) + "\r\n\r\n";
        mvc.perform(post("/api/sessions/import").param("conversationId", "file-session-a")
            .contentType("application/x-ndjson").content(reordered)).andExpect(status().isCreated());
        assertTrue(store.sessionIdByConversationId("file-session-b").isEmpty());
        assertEquals(2, store.sessions().size());
    }

    @Test void doesNotJoinAChildWithAmbiguousCallIdAndDoesNotOverwriteExistingSpans() throws Exception {
        String original = new String(fixture(), StandardCharsets.UTF_8);
        ObjectNode secondLaunch = (ObjectNode) mapper.readTree(original.lines()
            .filter(line -> line.contains("\"name\":\"execute_tool A\"")).findFirst().orElseThrow());
        secondLaunch.put("traceId", "22222222222222222222222222222222");
        secondLaunch.put("spanId", "2222222222222203");
        ObjectNode parent = (ObjectNode) secondLaunch.get("parentSpanContext");
        parent.put("traceId", "22222222222222222222222222222222");
        parent.put("spanId", "2222222222222201");
        ((ObjectNode) secondLaunch.get("attributes")).put("gen_ai.conversation.id", "file-session-b");
        String ambiguous = original + "\n" + secondLaunch;
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(ambiguous))
            .andExpect(status().isOk()).andExpect(jsonPath("$.sessions", hasSize(3)));
        mvc.perform(post("/api/sessions/import").param("conversationId", "file-session-a")
            .contentType("application/x-ndjson").content(ambiguous))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.spans").value(3));
        assertEquals(1, store.sessions().size());
        assertTrue(store.sessionIdByConversationId("file-child-a").isEmpty());
        // A different conversation with already stored trace/span IDs cannot replace the original.
        String collision = original.replace("file-session-a", "different-session");
        mvc.perform(post("/api/sessions/import").param("conversationId", "different-session")
            .contentType("application/x-ndjson").content(collision)).andExpect(status().isConflict());
        assertTrue(store.sessionIdByConversationId("different-session").isEmpty());
        assertEquals(1, store.sessions().size());
    }

    @Test void fallsBackToTraceIdentityWhenConversationWasNotEmitted() throws Exception {
        String original = new String(fixture(), StandardCharsets.UTF_8);
        List<String> standalone = new ArrayList<>();
        for (String line : original.lines().filter(line -> line.contains("\"name\":\"invoke_agent B\"")
                || line.contains("\"name\":\"chat B\"")).toList()) {
            ObjectNode record = (ObjectNode) mapper.readTree(line);
            ((ObjectNode) record.get("attributes")).remove("gen_ai.conversation.id");
            standalone.add(record.toString());
        }
        String file = String.join("\n", standalone);
        String identity = "trace:22222222222222222222222222222222";
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(file))
            .andExpect(status().isOk()).andExpect(jsonPath("$.sessions[0].conversationId").value(identity));
        mvc.perform(post("/api/sessions/import").param("conversationId", identity)
            .contentType("application/x-ndjson").content(file)).andExpect(status().isCreated());
        assertEquals(1, store.sessions().size());
        assertTrue(store.sessionIdByConversationId(identity).isPresent());
    }

    @Test void offersOneConversationDespiteDetachedAuxiliaryCallsToolsAndUiSpans() throws Exception {
        byte[] file = fixture("copilot-file-detached-v1.jsonl");
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(file))
            .andExpect(status().isOk()).andExpect(jsonPath("$.sessions", hasSize(1)))
            .andExpect(jsonPath("$.sessions[0].conversationId").value("fixture-main"))
            .andExpect(jsonPath("$.sessions[0].agentName").value("Fixture main"))
            .andExpect(jsonPath("$.sessions[0].model").value("fixture-main-model"))
            .andExpect(jsonPath("$.sessions[0].turns").value(2))
            .andExpect(jsonPath("$.sessions[0].relatedSessions").value(1))
            .andExpect(jsonPath("$.sessions[0].relatedTurns").value(2))
            .andExpect(jsonPath("$.sessions[0].auxiliaryCalls").value(1))
            .andExpect(jsonPath("$.sessions[0].spans").value(10))
            .andExpect(jsonPath("$.ignoredRecords").value(3))
            .andExpect(jsonPath("$.unassignedSpans").value(6));
        assertTrue(store.sessions().isEmpty());
        mvc.perform(post("/api/sessions/import").param("conversationId", "trace:" + "3".repeat(32))
            .contentType("application/x-ndjson").content(file)).andExpect(status().isBadRequest());
        assertTrue(store.sessions().isEmpty());
        mvc.perform(post("/api/sessions/import").param("conversationId", "fixture-main")
            .contentType("application/x-ndjson").content(file))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.spans").value(10));
        assertEquals(3, store.sessions().size());
        assertEquals(5, store.spans(store.sessionIdByConversationId("fixture-main").orElseThrow()).size());
        assertEquals(4, store.spans(store.sessionIdByConversationId("fixture-child").orElseThrow()).size());
        var title = store.spans(store.sessionIdByConversationId("trace:" + "2".repeat(32)).orElseThrow());
        assertEquals(1, title.size());
        assertTrue(mapper.readTree(title.get(0).get("ATTRIBUTES_JSON").toString())
            .path("unknown.attribute").path("preserved").booleanValue());
        String raw = new String(jdbc.queryForObject("SELECT raw_payload FROM telemetry_signal", byte[].class), StandardCharsets.UTF_8);
        assertTrue(raw.contains("chat title"));
        assertFalse(raw.contains("chat progress"));
        assertFalse(raw.contains("execute_tool detached"));
        assertFalse(raw.contains("synthetic log"));
    }

    @Test void doesNotAttachTechnicalGroupsBySharedRuntimeOrAmbiguousParentReferences() throws Exception {
        var records = new ArrayList<String>();
        String detached = new String(fixture("copilot-file-detached-v1.jsonl"), StandardCharsets.UTF_8);
        for (String line : detached.lines().filter(line -> line.contains("\"name\":\"chat title\"")).toList()) {
            ObjectNode title = (ObjectNode) mapper.readTree(line);
            title.put("traceId", "abababababababababababababababab");
            ((ObjectNode) title.get("attributes")).put("copilot_chat.parent_chat_session_id", "file-session-a");
            records.add(title.toString());
            title.put("spanId", "0000000000000020");
            ((ObjectNode) title.get("attributes")).put("copilot_chat.parent_chat_session_id", "file-session-b");
            records.add(title.toString());
        }
        String file = new String(fixture(), StandardCharsets.UTF_8) + "\n" + String.join("\n", records);
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(file))
            .andExpect(status().isOk()).andExpect(jsonPath("$.sessions", hasSize(2)))
            .andExpect(jsonPath("$.unassignedSpans").value(2))
            .andExpect(jsonPath("$.sessions[1].auxiliaryCalls").value(0));
        mvc.perform(post("/api/sessions/import/preview").contentType("application/x-ndjson").content(String.join("\n", records)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.sessions", hasSize(0)))
            .andExpect(jsonPath("$.unassignedSpans").value(2));
    }

    private org.springframework.test.web.servlet.ResultActions importA() throws Exception {
        return mvc.perform(post("/api/sessions/import").param("conversationId", "file-session-a")
            .contentType("application/x-ndjson").content(fixture()));
    }
    private byte[] fixture() throws Exception {
        return fixture("copilot-file-v1.jsonl");
    }
    private byte[] fixture(String name) throws Exception {
        try (var stream = Objects.requireNonNull(getClass().getResourceAsStream("/fixtures/" + name))) {
            return stream.readAllBytes();
        }
    }
}
