package dev.agentscanner.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.store.ScannerStore;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import static dev.agentscanner.ai.ToolClassification.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ToolClassificationTest {
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final CopilotProperties properties = new CopilotProperties("synthetic-secret", "test-model", null, null, 30);
    private final CopilotCompletion completion = mock(CopilotCompletion.class);
    private final ScannerStore store = mock(ScannerStore.class);
    private final ToolClassificationService service = new ToolClassificationService(mapper, completion, properties, store);
    private static final String ANSWER = """
        {"tools":[{"id":"tool-1","category":"DATA_ACCESS","specialization":"GENERAL_PURPOSE","reason":"Odczyt dowolnego pliku."}],
        "assessments":[{"contextId":"context-1","invocationId":"invocation-1","toolId":"tool-1","actions":["ACQUIRE_DATA"],"fit":"SUPPORTING","reason":"Żądanie pozyskania danych ze wskazanego pliku."}],
        "rounds":[{"roundId":"round-1","actions":["ACQUIRE_DATA"],"evidenceInvocationIds":["invocation-1"],"reason":"Model żąda danych z pliku, choć opisuje cel jako analizę."}]}
        """;
    private Request request(String goal) throws Exception {
        var invocation = new Invocation("invocation-1", "tool-1", "read_file", mapper.readTree("{\"path\":\"src/Main.java\"}"), false);
        return new Request(List.of(new Definition("tool-1", "read_file", mapper.readTree("""
            {"name":"read_file","description":"Read a file","parameters":{"type":"object"}}
            """))), List.of(new AgentInput("agent-1", null, List.of("context-1"))),
            List.of(new Context("context-1", "agent-1", goal,
                List.of(new RoundInput("round-1", 1, "Analizuję implementację.", true, List.of(invocation))))));
    }
    @Test void validatesEveryMappingAndReturnsModelAndRuleVersion() throws Exception {
        when(completion.complete(anyString())).thenReturn(ANSWER);
        Result result = service.classify(42, request("Znajdź implementację endpointu."));
        assertEquals(VERSION, result.version());
        assertEquals("test-model", result.model());
        assertEquals(Category.DATA_ACCESS, result.tools().get(0).category());
        assertEquals(Fit.SUPPORTING, result.assessments().get(0).fit());
        assertFalse(service.prompt(request("Cel" )).contains("synthetic-secret"));
        verify(store).saveToolClassification(eq(42L), matches("[0-9a-f]{64}"), eq(VERSION), eq("test-model"), any(), contains("\"assessments\""));
    }
    @Test void rejectsUnknownIdsMissingAssessmentsAndInventedCategories() throws Exception {
        var request = request("Cel");
        for (String bad : List.of(ANSWER.replace("tool-1", "invented"), ANSWER.replace("SUPPORTING", "PERFECT"),
                "{\"tools\":[],\"assessments\":[],\"rounds\":[],\"agents\":[]}", ANSWER + " {}", "```json\n" + ANSWER + "\n```",
                ANSWER.replace("\"reason\":\"Odczyt dowolnego pliku.\"", "\"reason\":\"A\",\"reason\":\"B\""))) {
            assertThrows(Exception.class, () -> service.validateAnswer(bad, request));
        }
    }
    @Test void missingGoalCannotReceiveAnAssertedFit() throws Exception {
        var request = request(null);
        assertThrows(IllegalStateException.class, () -> service.validateAnswer(ANSWER, request));
        String unknownFit = ANSWER.replace("SUPPORTING", "UNKNOWN").replace("\"fit\":\"DIRECT\"", "\"fit\":\"UNKNOWN\"");
        assertEquals(Fit.UNKNOWN, service.validateAnswer(unknownFit, request).assessments().get(0).fit());
    }
    @Test void textOnlyResponseAndMissingOutputRemainDistinct() throws Exception {
        for (boolean observed : List.of(true, false)) {
            var request = new Request(List.of(), List.of(new AgentInput("agent-1", null, List.of("context-1"))),
                List.of(new Context("context-1", "agent-1", "Wyjaśnij problem.",
                    List.of(new RoundInput("round-1", 1, observed ? "Oto wyjaśnienie." : null, observed, List.of())))));
            String answer = """
                {"tools":[],"assessments":[],
                 "rounds":[{"roundId":"round-1","actions":["RESPOND"],"evidenceInvocationIds":[],"reason":"Model przekazał wyjaśnienie."}]}
                """;
            assertDoesNotThrow(() -> service.prompt(request));
            if (observed) assertEquals(List.of(Action.RESPOND), service.validateAnswer(answer, request).rounds().get(0).actions());
            else {
                assertThrows(IllegalStateException.class, () -> service.validateAnswer(answer, request));
                assertEquals(List.of(Action.UNKNOWN), service.validateAnswer(answer.replace("RESPOND", "UNKNOWN"), request).rounds().get(0).actions());
            }
        }
    }
    @Test void requestedDelegationDoesNotRequireAConfirmedExecutionOrChild() throws Exception {
        var normal = request("Cel");
        String delegatedAnswer = ANSWER.replace("[\"ACQUIRE_DATA\"]", "[\"DELEGATE\"]");
        var invocation = new Invocation("invocation-1", null, "run_subagent", mapper.readTree("{\"task\":\"Find an endpoint\"}"), false);
        var requested = new Request(List.of(), normal.agents(), List.of(new Context("context-1", "agent-1", "Cel",
            List.of(new RoundInput("round-1", 1, null, true, List.of(invocation))))));
        var tree = mapper.readTree(delegatedAnswer);
        ((com.fasterxml.jackson.databind.node.ObjectNode) tree).putArray("tools");
        ((com.fasterxml.jackson.databind.node.ObjectNode) tree.path("assessments").get(0)).putNull("toolId");
        assertEquals(List.of(Action.DELEGATE), service.validateAnswer(tree.toString(), requested).rounds().get(0).actions());
        assertDoesNotThrow(() -> service.prompt(requested));
    }
    @Test void preservesSeveralActionsAndRejectsAnIntentOrAnInconsistentRoundUnion() throws Exception {
        var request = request("Analiza architektury");
        String mixed = ANSWER.replace("[\"ACQUIRE_DATA\"]", "[\"ACQUIRE_DATA\",\"VALIDATE\"]");
        assertEquals(2, service.validateAnswer(mixed, request).rounds().get(0).actions().size());
        assertThrows(Exception.class, () -> service.validateAnswer(ANSWER.replace("[\"ACQUIRE_DATA\"]", "[\"ANALYSIS\"]"), request));
        assertThrows(Exception.class, () -> service.validateAnswer(ANSWER.replace("[\"ACQUIRE_DATA\"]", "[\"ACQUIRE_DATA\",\"ACQUIRE_DATA\"]"), request));
        assertThrows(Exception.class, () -> service.validateAnswer(ANSWER.replace("\"roundId\":\"round-1\",\"actions\":[\"ACQUIRE_DATA\"]",
            "\"roundId\":\"round-1\",\"actions\":[\"VALIDATE\"]"), request));
        assertThrows(Exception.class, () -> service.validateAnswer(ANSWER.replace("[\"invocation-1\"]", "[]"), request));
        for (String action : List.of("WRITE_INTERMEDIATE", "WRITE_FINAL", "MODIFY", "MANAGE_CONTEXT"))
            assertEquals(action, service.validateAnswer(ANSWER.replace("[\"ACQUIRE_DATA\"]", "[\"" + action + "\"]"), request).rounds().get(0).actions().get(0).name());
        assertTrue(service.prompt(request).contains("goal służy wyłącznie do oceny fit"));
        assertFalse(service.prompt(request).contains("confirmedDelegation"));
        assertFalse(service.prompt(request).contains("confirmedError"));
    }
    @Test void rejectsDuplicateDefinitionsButDoesNotUseACharacterThresholdAsAContextProxy() throws Exception {
        var normal = request("Cel");
        assertThrows(IllegalArgumentException.class, () -> service.classify(42, new Request(List.of(normal.tools().get(0), normal.tools().get(0)), normal.agents(), normal.contexts())));
        var huge = mapper.createObjectNode().put("name", "large").put("description", "a".repeat(180_001));
        var largeRequest = new Request(List.of(new Definition("tool-1", "large", huge)), normal.agents(), normal.contexts());
        assertTrue(service.prompt(largeRequest).length() > 180_000);
        verifyNoInteractions(completion);
    }
    @Test void rejectsInvocationTextThatBypassesTheFrontendLimit() throws Exception {
        var normal = request("Cel");
        var tooLong = new Invocation("invocation-1", "tool-1", "read_file", mapper.getNodeFactory().textNode("x".repeat(101)), false);
        assertThrows(IllegalArgumentException.class, () -> service.classify(42, new Request(normal.tools(), normal.agents(),
            List.of(new Context("context-1", "agent-1", "Cel", List.of(new RoundInput("round-1", 1, null, true, List.of(tooLong))))))));
        verifyNoInteractions(completion);
    }
    @Test void restoresTheSameVersionModelAndRequestWithoutCallingCopilotAgain() throws Exception {
        AtomicReference<String> persisted = new AtomicReference<>();
        when(store.toolClassification(eq(42L), anyString())).thenAnswer(invocation -> Optional.ofNullable(persisted.get()));
        doAnswer(invocation -> { persisted.set(invocation.getArgument(5)); return null; }).when(store)
            .saveToolClassification(eq(42L), anyString(), anyString(), anyString(), any(), anyString());
        when(completion.complete(anyString())).thenReturn(ANSWER);
        Result first = service.classify(42, request("Cel"));
        Result restored = service.classify(42, request("Cel"));
        assertEquals(first, restored);
        verify(completion, times(1)).complete(anyString());
    }
    @Test void serializesEmptyAllowlistAndDisablesRuntimeDiscovery() throws Exception {
        // Verify the actual SDK wire request, rather than serializing its Optional-based config bean.
        var builder = Class.forName("com.github.copilot.SessionRequestBuilder").getDeclaredMethod("buildCreateRequest",
            com.github.copilot.rpc.SessionConfig.class, String.class, com.github.copilot.rpc.CopilotClientMode.class);
        builder.setAccessible(true);
        var config = mapper.valueToTree(builder.invoke(null, CopilotCompletion.sessionConfig("test-model", Path.of(".")),
            "test-session", com.github.copilot.rpc.CopilotClientMode.EMPTY));
        assertEquals(0, config.path("availableTools").size());
        assertTrue(config.has("availableTools"));
        assertFalse(config.path("enableSkills").asBoolean(true));
        assertFalse(config.path("enableConfigDiscovery").asBoolean(true));
        assertFalse(config.path("enableSessionStore").asBoolean(true));
        assertTrue(config.path("instructionDirectories").isArray());
        assertEquals(0, config.path("instructionDirectories").size());
        assertTrue(config.path("requestPermission").asBoolean());
        assertTrue(config.path("hooks").asBoolean());
        assertFalse(properties.toString().contains("synthetic-secret"));
    }
    @Test void exposesNoCredentialAndDoesNotStartSdkWhenUnconfigured() throws Exception {
        var empty = new CopilotProperties(null, null, null, null, 30);
        var coordinator = new AiExecutionCoordinator();
        var controller = new ToolClassificationController(empty, service, coordinator);
        try {
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();
            mvc.perform(get("/api/ai/tool-classification/status")).andExpect(status().isOk()).andExpect(jsonPath("$.configured").value(false)).andExpect(jsonPath("$.githubToken").doesNotExist());
            var pending = mvc.perform(post("/api/ai/tool-classification").param("sessionId", "42").contentType("application/json").content(mapper.writeValueAsBytes(request("Cel")))).andReturn();
            mvc.perform(asyncDispatch(pending)).andExpect(status().isServiceUnavailable());
            verifyNoInteractions(completion);
        } finally { coordinator.close(); }
    }
    @Test void returnsValidatedResultThroughAsyncHttpAndSanitizesSdkErrors() throws Exception {
        var coordinator = new AiExecutionCoordinator();
        var controller = new ToolClassificationController(properties, service, coordinator);
        try {
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();
            when(completion.complete(anyString())).thenReturn(ANSWER);
            var pending = mvc.perform(post("/api/ai/tool-classification").param("sessionId", "42").contentType("application/json").content(mapper.writeValueAsBytes(request("Cel")))).andReturn();
            mvc.perform(asyncDispatch(pending)).andExpect(status().isOk()).andExpect(jsonPath("$.tools[0].category").value("DATA_ACCESS"));
            when(completion.complete(anyString())).thenThrow(new IllegalStateException("synthetic-secret"));
            var failed = mvc.perform(post("/api/ai/tool-classification").param("sessionId", "42").contentType("application/json").content(mapper.writeValueAsBytes(request("Cel")))).andReturn();
            String body = mvc.perform(asyncDispatch(failed)).andExpect(status().isBadGateway()).andReturn().getResponse().getContentAsString();
            assertFalse(body.contains("synthetic-secret"));
        } finally { coordinator.close(); }
    }
    @Test void exposesSafeActionableAiExecutionFailure() throws Exception {
        var coordinator = new AiExecutionCoordinator();
        var controller = new ToolClassificationController(properties, service, coordinator);
        try {
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();
            when(completion.complete(anyString())).thenThrow(new AiExecutionException(AiExecutionException.Code.RUNTIME, "Model „test-model” nie jest dostępny."));
            var pending = mvc.perform(post("/api/ai/tool-classification").param("sessionId", "42").contentType("application/json")
                .content(mapper.writeValueAsBytes(request("Cel")))).andReturn();
            mvc.perform(asyncDispatch(pending)).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value("Model „test-model” nie jest dostępny."));
        } finally { coordinator.close(); }
    }
}
