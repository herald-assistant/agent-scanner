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
    @Test void savesAndReopensMaskedInputWithoutCopilotCredentialsOrInference() throws Exception {
        var database = new org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseBuilder()
                .setType(org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType.H2).addScript("schema.sql").build();
        var service = mock(StandardizationService.class);
        var mapper = new ObjectMapper();
        var history = new StandardizationHistoryStore(new org.springframework.jdbc.core.JdbcTemplate(database), mapper);
        try (var coordinator = new AiExecutionCoordinator()) {
            var mvc = MockMvcBuilders.standaloneSetup(new StandardizationController(new StandardizationCatalog(),
                    service, history, new CopilotProperties("", "", null, null, 30), coordinator, mapper)).build();
            String body = mapper.writeValueAsString(new SnapshotRequest(null, null, "synthetic-project", true, false,
                    List.of(new SnapshotInputFile("AGENTS.md", "token=synthetic-secret-value", true, null))));
            var response = mvc.perform(post("/api/standardization/snapshots").contentType("application/json").content(body))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.files[0].content").value("token=[UKRYTO]"))
                    .andReturn();
            var snapshot = mapper.readValue(response.getResponse().getContentAsByteArray(), RepositorySnapshot.class);
            mvc.perform(get("/api/standardization/repositories/{id}/inputs/{snapshotId}", snapshot.repositoryId(), snapshot.id()))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.files[0].selected").value(true));
            mvc.perform(get("/api/standardization/repositories"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$[0].analyses.length()").value(0))
                    .andExpect(jsonPath("$[0].snapshots[0].id").value(snapshot.id()));
            verifyNoInteractions(service);
        } finally { database.shutdown(); }
    }

    @Test void preparesAiOnlyFromStoredSelectedInputWithoutInvokingTheModel() throws Exception {
        var service = mock(StandardizationService.class);
        var history = mock(StandardizationHistoryStore.class);
        var snapshot = new RepositorySnapshot("input-a", "repo-a", "synthetic-project", "2026-10-02T10:00:00Z", false, true,
                List.of(new SnapshotFile("AGENTS.md", Category.INSTRUCTIONS, "Persisted configuration", 23, false, true, null),
                        new SnapshotFile(".github/copilot-instructions.md", Category.INSTRUCTIONS, "Excluded", 8, false, false, null)),
                new GitMetadata("https://example.invalid/repo.git", "main", "a".repeat(40), "AVAILABLE"),
                List.of(new ReportFile(".vscode/settings.json", "{\"chat.example\":true}", 21, false, null)));
        when(history.snapshot("repo-a", "input-a")).thenReturn(snapshot);
        var preview = new Preview("12345678-1234-1234-1234-123456789abc", "2026-10-02T11:00:00Z", "hash", null, "system", "prompt");
        when(service.prepare(any())).thenReturn(preview);
        try (var coordinator = new AiExecutionCoordinator()) {
            var mvc = MockMvcBuilders.standaloneSetup(new StandardizationController(new StandardizationCatalog(),
                    service, history, new CopilotProperties("", "", null, null, 30), coordinator, new ObjectMapper())).build();
            mvc.perform(get("/api/standardization/repositories/repo-a/inputs/input-a"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.files[0].content").value("Persisted configuration"));
            mvc.perform(post("/api/standardization/repositories/repo-a/inputs/input-a/prepare")
                    .contentType("application/json").content("{\"model\":\"model-a\"}"))
                    .andExpect(status().isOk());
            verify(service).prepare(new PrepareRequest(Profile.AUTO, "", "model-a",
                    List.of(new InputFile("AGENTS.md", "Persisted configuration")),
                    List.of(new Omission(".github/copilot-instructions.md", "EXCLUDED")), false));
            verify(history).attachInput(snapshot, preview.id());
            verify(service, never()).analyze(any());
            verifyNoMoreInteractions(service);
            mvc.perform(post("/api/standardization/snapshots").contentType("application/json")
                    .content("{\"unexpected\":true}"))
                    .andExpect(status().isBadRequest());
            verify(history, never()).saveSnapshot(any());
        }
    }

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
