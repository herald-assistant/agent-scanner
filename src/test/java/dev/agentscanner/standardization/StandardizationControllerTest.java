package dev.agentscanner.standardization;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.ai.AiExecutionCoordinator;
import dev.agentscanner.ai.CopilotProperties;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static dev.agentscanner.standardization.Standardization.*;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class StandardizationControllerTest {
    @Test void deletesOnlyTheRequestedAnalysisAndCheckpointsAfterSuccessfulDeletionWithoutAi() throws Exception {
        var service = mock(StandardizationService.class);
        var history = mock(StandardizationHistoryStore.class);
        when(history.deleteAnalysis("repo-a", "analysis-a")).thenReturn(true);
        try (var coordinator = new AiExecutionCoordinator()) {
            var mvc = MockMvcBuilders.standaloneSetup(new StandardizationController(new StandardizationCatalog(),
                    service, history, new CopilotProperties("", "", null, null, 30), coordinator, new ObjectMapper())).build();
            mvc.perform(delete("/api/standardization/repositories/repo-a/analyses/analysis-a"))
                    .andExpect(status().isNoContent());
            var order = inOrder(history);
            order.verify(history).deleteAnalysis("repo-a", "analysis-a");
            order.verify(history).checkpoint();
            mvc.perform(delete("/api/standardization/repositories/repo-b/analyses/analysis-a"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.error").value("Nie znaleziono zapisanej analizy tego repozytorium."));
            verify(history, times(1)).checkpoint();
            verifyNoInteractions(service);
        }
    }

    @Test void exportsTheStoredResultAndRedactedSnapshotWithoutAi() throws Exception {
        var service = mock(StandardizationService.class);
        var history = mock(StandardizationHistoryStore.class);
        var file = new FileEvidence("f1", "AGENTS.md", Category.INSTRUCTIONS, "[UKRYTO]", "hash", 1, true);
        var packet = new Packet(VERSION, "rules-v1", PROMPT_VERSION, Profile.AUTO, "nieznana", "model-a",
                true, List.of(file), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        var preview = new Preview("analysis-a", "2026-09-22T11:00:00Z", "hash", packet, "system", "prompt");
        var result = new Result(ANSWER_VERSION, "analysis-a", "hash", "model-a", "2026-09-22T10:00:00Z", List.of(), List.of(), 0);
        when(history.get("repo-a", "analysis-a")).thenReturn(new SavedAnalysis("repo-a", "analysis-a", preview, result));
        try (var coordinator = new AiExecutionCoordinator()) {
            var mvc = MockMvcBuilders.standaloneSetup(new StandardizationController(new StandardizationCatalog(),
                    service, history, new CopilotProperties("", "", null, null, 30), coordinator, new ObjectMapper())).build();
            mvc.perform(get("/api/standardization/repositories/repo-a/analyses/analysis-a/export"))
                    .andExpect(status().isOk())
                    .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=agent-scanner-analysis-analysis-a.json"))
                    .andExpect(content().contentType("application/json"))
                    .andExpect(jsonPath("$.format").value("agent-scanner-standardization-analysis"))
                    .andExpect(jsonPath("$.version").value(1))
                    .andExpect(jsonPath("$.analysis.repositoryId").value("repo-a"))
                    .andExpect(jsonPath("$.analysis.preview.packet.files[0].content").value("[UKRYTO]"))
                    .andExpect(jsonPath("$.analysis.result.model").value("model-a"));
            verifyNoInteractions(service);
        }
    }

    @Test void malformedInputAndUnconfiguredExecutionDoNotReachTheModel() throws Exception {
        var service = mock(StandardizationService.class);
        try (var coordinator = new AiExecutionCoordinator()) {
            var mvc = MockMvcBuilders.standaloneSetup(new StandardizationController(new StandardizationCatalog(),
                    service, mock(StandardizationHistoryStore.class), new CopilotProperties("", "", null, null, 30), coordinator, new ObjectMapper())).build();
            mvc.perform(get("/api/standardization/catalog")).andExpect(status().isOk()).andExpect(jsonPath("$.rules.length()").value(30));
            mvc.perform(post("/api/standardization/prepare").contentType("application/json").content("{\"files\":[],\"unexpected\":true}"))
                    .andExpect(status().isBadRequest());
            var pending = mvc.perform(post("/api/standardization/analyze").contentType("application/json")
                    .content("{\"previewId\":\"12345678-1234-1234-1234-123456789abc\"}")).andReturn();
            mvc.perform(asyncDispatch(pending)).andExpect(status().isServiceUnavailable());
            verifyNoInteractions(service);
        }
    }


    @Test void analysisIsSavedUnderSelectedRepositoryAndCanBeReopened() throws Exception {
        var service = mock(StandardizationService.class);
        var history = mock(StandardizationHistoryStore.class);
        String previewId = "12345678-1234-1234-1234-123456789abc";
        String repositoryId = "87654321-4321-4321-4321-cba987654321";
        var preview = new Preview(previewId, "2026-09-22T11:00:00Z", "hash", null, "system", "prompt");
        var result = new Result(ANSWER_VERSION, previewId, "hash", "model-a", "2026-09-22T10:00:00Z", List.of(), List.of(), 0);
        var saved = new SavedAnalysis(repositoryId, previewId, preview, result);
        when(history.hasRepository(repositoryId)).thenReturn(true);
        when(service.preview(previewId)).thenReturn(preview);
        when(service.analyze(previewId)).thenReturn(result);
        when(history.save(preview, result, repositoryId, "Projekt")).thenReturn(saved);
        when(history.get(repositoryId, previewId)).thenReturn(saved);
        try (var coordinator = new AiExecutionCoordinator()) {
            var mvc = MockMvcBuilders.standaloneSetup(new StandardizationController(new StandardizationCatalog(),
                    service, history, new CopilotProperties("configured", "", null, null, 30), coordinator, new ObjectMapper())).build();
            var pending = mvc.perform(post("/api/standardization/analyze-and-save").contentType("application/json")
                    .content("{\"previewId\":\"" + previewId + "\",\"repositoryId\":\"" + repositoryId + "\",\"repositoryName\":\"Projekt\"}"))
                    .andReturn();
            mvc.perform(asyncDispatch(pending)).andExpect(status().isOk())
                    .andExpect(jsonPath("$.repositoryId").value(repositoryId));
            mvc.perform(get("/api/standardization/repositories/{repositoryId}/analyses/{analysisId}", repositoryId, previewId))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.result.model").value("model-a"));
            var order = inOrder(service, history);
            order.verify(service).preview(previewId);
            order.verify(service).analyze(previewId);
            order.verify(history).save(preview, result, repositoryId, "Projekt");
        }
    }
}
