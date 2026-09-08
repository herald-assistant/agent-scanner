package dev.agentscanner.ai.discussion;

import dev.agentscanner.ai.AiExecutionCoordinator;
import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.ai.CopilotProperties;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class RoundDiscussionControllerTest {
    @Test
    void modelLookupAndTurnsStayDisabledWithoutCredentials() throws Exception {
        var service = mock(RoundDiscussionService.class);
        var evidence = mock(RoundDiscussionEvidenceService.class);
        var completion = mock(CopilotCompletion.class);
        var coordinator = new AiExecutionCoordinator();
        when(evidence.readTurn(any())).thenReturn(new RoundDiscussion.TurnRequest(
                "Co tu się wydarzyło?", "12345678-1234-1234-1234-123456789abc"));
        try {
            var controller = new RoundDiscussionController(service, evidence, completion,
                    new CopilotProperties("", "", null, null, 30), coordinator);
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();

            var models = mvc.perform(get("/api/ai/round-discussions/models")).andReturn();
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch(models))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("github-token")));

            var turn = mvc.perform(post("/api/ai/round-discussions/d1/turns").param("sessionId", "1")
                    .contentType("application/json")
                    .content("{\"question\":\"Co tu się wydarzyło?\",\"clientRequestId\":\"12345678-1234-1234-1234-123456789abc\"}"))
                    .andReturn();
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch(turn))
                    .andExpect(status().isServiceUnavailable());
            verifyNoInteractions(service, completion);
        } finally {
            coordinator.close();
        }
    }

    @Test
    void creatingADiscussionOnlyValidatesAndPersistsTheSnapshot() throws Exception {
        var service = mock(RoundDiscussionService.class);
        var evidence = mock(RoundDiscussionEvidenceService.class);
        var completion = mock(CopilotCompletion.class);
        var coordinator = new AiExecutionCoordinator();
        var request = mock(RoundDiscussion.CreateRequest.class);
        var view = new RoundDiscussion.DiscussionView("d1", 1, RoundDiscussion.VERSION, "gpt-test", "a".repeat(64),
                null, 0, "2026-09-08T10:00:00Z", "2026-09-08T10:00:00Z", List.of());
        when(evidence.readAndValidate(any())).thenReturn(request);
        when(service.create(eq(1L), eq(request))).thenReturn(view);
        try {
            var controller = new RoundDiscussionController(service, evidence, completion,
                    new CopilotProperties("token", "", null, null, 30), coordinator);
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();

            mvc.perform(post("/api/ai/round-discussions").param("sessionId", "1")
                            .contentType("application/json").content("{}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value("d1"));
            verifyNoInteractions(completion);
        } finally {
            coordinator.close();
        }
    }
}
