package dev.agentscanner.standardization;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseBuilder;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType;

import java.util.List;

import static dev.agentscanner.standardization.Standardization.*;
import static org.junit.jupiter.api.Assertions.*;

class StandardizationHistoryStoreTest {
    @Test
    void savesMultipleAnalysesForOneRepositoryAndReopensTheirEvidenceWithoutInference() {
        var database = new EmbeddedDatabaseBuilder().setType(EmbeddedDatabaseType.H2).addScript("schema.sql").build();
        try {
            var store = new StandardizationHistoryStore(new JdbcTemplate(database), new ObjectMapper());
            var first = store.save(preview("11111111-1111-4111-8111-111111111111"),
                    result("11111111-1111-4111-8111-111111111111"), null, "synthetic-project");
            var second = store.save(preview("22222222-2222-4222-8222-222222222222"),
                    result("22222222-2222-4222-8222-222222222222"), first.repositoryId(), null);

            assertEquals(first.repositoryId(), second.repositoryId());
            assertEquals(1, store.repositories().size());
            assertEquals(2, store.repositories().get(0).analyses().size());
            assertEquals("[UKRYTO]", store.get(first.repositoryId(), first.analysisId()).preview()
                    .packet().files().get(0).content());
            assertEquals(first, store.save(preview(first.analysisId()), result(first.analysisId()), null, "ignored"));
            assertEquals(2, store.repositories().get(0).analyses().size());
            assertThrows(IllegalArgumentException.class, () -> store.get(second.repositoryId(), "unknown"));
            assertThrows(IllegalArgumentException.class, () -> store.save(
                    preview("33333333-3333-4333-8333-333333333333"),
                    result("33333333-3333-4333-8333-333333333333"), "missing-repository", null));
        } finally { database.shutdown(); }
    }

    @Test
    void deletesOnlyTheSelectedSnapshotAndRemovesTheRepositoryAfterItsLastAnalysis() {
        var database = new EmbeddedDatabaseBuilder().setType(EmbeddedDatabaseType.H2).addScript("schema.sql").build();
        try {
            var store = new StandardizationHistoryStore(new JdbcTemplate(database), new ObjectMapper());
            var first = store.save(preview("11111111-1111-4111-8111-111111111111"),
                    result("11111111-1111-4111-8111-111111111111"), null, "synthetic-project");
            var second = store.save(preview("22222222-2222-4222-8222-222222222222"),
                    result("22222222-2222-4222-8222-222222222222"), first.repositoryId(), null);
            var other = store.save(preview("33333333-3333-4333-8333-333333333333"),
                    result("33333333-3333-4333-8333-333333333333"), null, "other-project");

            assertFalse(store.deleteAnalysis(other.repositoryId(), first.analysisId()));
            assertEquals(first, store.get(first.repositoryId(), first.analysisId()));
            assertTrue(store.deleteAnalysis(first.repositoryId(), first.analysisId()));
            assertThrows(IllegalArgumentException.class, () -> store.get(first.repositoryId(), first.analysisId()));
            assertEquals(second, store.get(second.repositoryId(), second.analysisId()));
            assertTrue(store.hasRepository(first.repositoryId()));
            assertFalse(store.deleteAnalysis(first.repositoryId(), first.analysisId()));

            assertTrue(store.deleteAnalysis(second.repositoryId(), second.analysisId()));
            store.checkpoint();
            assertFalse(store.hasRepository(first.repositoryId()));
            assertEquals(other, store.get(other.repositoryId(), other.analysisId()));
            assertEquals(List.of(other.repositoryId()), store.repositories().stream().map(RepositorySummary::id).toList());
        } finally { database.shutdown(); }
    }

    private static Preview preview(String id) {
        var file = new FileEvidence("f1", "AGENTS.md", Category.INSTRUCTIONS, "[UKRYTO]", "hash", 1, true);
        var packet = new Packet(VERSION, "rules-v1", PROMPT_VERSION, Profile.AUTO, "nieznana", "model-a",
                true, List.of(file), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        return new Preview(id, "2026-09-22T12:00:00Z", "packet-hash", packet, "system", "prompt");
    }

    private static Result result(String previewId) {
        return new Result(ANSWER_VERSION, previewId, "packet-hash", "model-a", "2026-09-22T11:00:00Z",
                List.of(), List.of(), 0);
    }
}
