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
    void persistsInputBeforeAiAndKeepsTheLinkedInputImmutableAndOwnedByItsRepository() {
        var database = new EmbeddedDatabaseBuilder().setType(EmbeddedDatabaseType.H2).addScript("schema.sql").build();
        try {
            var jdbc = new JdbcTemplate(database);
            var store = new StandardizationHistoryStore(jdbc, new ObjectMapper());
            var snapshot = store.saveSnapshot(new SnapshotRequest(null, null, "synthetic-project", true, false,
                    List.of(new SnapshotInputFile("AGENTS.md", "token=synthetic-secret-value", true, null),
                            new SnapshotInputFile(".github/copilot-instructions.md", "Excluded instructions", false, null))));
            assertEquals("token=[UKRYTO]", snapshot.files().get(0).content());
            assertTrue(snapshot.files().get(0).redacted());
            assertFalse(snapshot.files().get(1).selected());
            assertEquals(snapshot, new StandardizationHistoryStore(jdbc, new ObjectMapper()).snapshot(snapshot.repositoryId(), snapshot.id()));
            assertTrue(store.repositories().get(0).analyses().isEmpty());
            assertEquals(snapshot.id(), store.repositories().get(0).snapshots().get(0).id());

            String analysisId = "11111111-1111-4111-8111-111111111111";
            store.attachInput(snapshot, analysisId);
            var edited = store.saveSnapshot(new SnapshotRequest(snapshot.id(), snapshot.repositoryId(), "synthetic-project",
                    true, false, List.of(new SnapshotInputFile("AGENTS.md", "Changed input", true, null))));
            assertNotEquals(snapshot.id(), edited.id());
            assertEquals(snapshot, store.snapshot(snapshot.repositoryId(), snapshot.id()));
            assertThrows(IllegalArgumentException.class, () -> store.validateInputRepository(analysisId, "other-repository"));
            store.validateInputRepository(analysisId, snapshot.repositoryId());
            var saved = store.saveWithInput(preview(analysisId), result(analysisId), snapshot.repositoryId(), null, snapshot.id());
            assertEquals(snapshot.repositoryId(), saved.repositoryId());
            assertEquals(snapshot.id(), saved.snapshotId());
            assertEquals(snapshot.id(), store.get(saved.repositoryId(), saved.analysisId()).snapshotId());
            assertEquals(List.of(edited.id()), store.repositories().get(0).snapshots().stream().map(SnapshotSummary::id).toList());
            assertThrows(IllegalArgumentException.class, () -> store.deleteSnapshot(snapshot.repositoryId(), snapshot.id()));
            assertTrue(store.deleteAnalysis(snapshot.repositoryId(), analysisId));
            assertEquals(edited, store.snapshot(snapshot.repositoryId(), edited.id()));
            assertTrue(store.deleteSnapshot(snapshot.repositoryId(), edited.id()));
            assertFalse(store.hasRepository(snapshot.repositoryId()));
            assertThrows(IllegalArgumentException.class, () -> store.saveWithInput(preview(analysisId), result(analysisId),
                    snapshot.repositoryId(), null, snapshot.id()));
        } finally { database.shutdown(); }
    }

    @Test
    void rejectsInvalidInputAndDetectsChangesBeforeFreezingTheSnapshot() {
        var database = new EmbeddedDatabaseBuilder().setType(EmbeddedDatabaseType.H2).addScript("schema.sql").build();
        try {
            var store = new StandardizationHistoryStore(new JdbcTemplate(database), new ObjectMapper());
            assertThrows(IllegalArgumentException.class, () -> store.saveSnapshot(new SnapshotRequest(null, null,
                    "synthetic-project", true, true, List.of(new SnapshotInputFile("package.json", "{}", true, null)))));
            assertTrue(store.repositories().isEmpty());
            var snapshot = store.saveSnapshot(new SnapshotRequest(null, null, "synthetic-project", false, true,
                    List.of(new SnapshotInputFile("AGENTS.md", "Original input", true, null))));
            var updated = store.saveSnapshot(new SnapshotRequest(snapshot.id(), snapshot.repositoryId(), "synthetic-project", false, true,
                    List.of(new SnapshotInputFile("AGENTS.md", "New input", false, null))));
            assertThrows(IllegalArgumentException.class, () -> store.attachInput(snapshot, "11111111-1111-4111-8111-111111111111"));
            assertEquals(updated, store.snapshot(snapshot.repositoryId(), snapshot.id()));
        } finally { database.shutdown(); }
    }

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
