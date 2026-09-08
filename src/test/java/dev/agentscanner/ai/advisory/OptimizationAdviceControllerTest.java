package dev.agentscanner.ai.advisory;

import dev.agentscanner.ai.AiExecutionCoordinator;
import dev.agentscanner.ai.CopilotProperties;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class OptimizationAdviceControllerTest {
    @Test
    void statusAndInvalidRequestsNeverInvokeAi() throws Exception {
        var preparation = mock(OptimizationAdvicePreparationService.class);
        var advice = mock(OptimizationAdviceService.class);
        var coordinator = new AiExecutionCoordinator();
        try {
            var controller = new OptimizationAdviceController(preparation, advice,
                    new CopilotProperties("", "", null, null, 30), coordinator);
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();

            mvc.perform(get("/api/ai/optimization-advice/status"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.configured").value(false))
                    .andExpect(jsonPath("$.running").value(false));
            mvc.perform(post("/api/ai/optimization-advice").param("sessionId", "1")
                            .contentType("application/json")
                            .content("{\"previewId\":\"12345678-1234-1234-1234-123456789abc\",\"extra\":true}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("Żądanie doradztwa ma niepoprawną strukturę."));
            verifyNoInteractions(advice);
        } finally {
            coordinator.close();
        }
    }

    @Test
    void explicitExecutionDoesNotReachServiceWhenAiIsNotConfigured() throws Exception {
        var preparation = mock(OptimizationAdvicePreparationService.class);
        var advice = mock(OptimizationAdviceService.class);
        var coordinator = new AiExecutionCoordinator();
        try {
            var controller = new OptimizationAdviceController(preparation, advice,
                    new CopilotProperties("", "", null, null, 30), coordinator);
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();
            var pending = mvc.perform(post("/api/ai/optimization-advice").param("sessionId", "1")
                            .contentType("application/json")
                            .content("{\"previewId\":\"12345678-1234-1234-1234-123456789abc\"}"))
                    .andReturn();
            mvc.perform(asyncDispatch(pending))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("agent-scanner.ai.github-token")));
            verifyNoInteractions(advice);
        } finally {
            coordinator.close();
        }
    }
}
