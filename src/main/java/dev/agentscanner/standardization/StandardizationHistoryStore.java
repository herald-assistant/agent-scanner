package dev.agentscanner.standardization;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import static dev.agentscanner.standardization.Standardization.*;

@Repository
public class StandardizationHistoryStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public StandardizationHistoryStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<RepositorySummary> repositories() {
        var grouped = new LinkedHashMap<String, RepositorySummary>();
        jdbc.query("""
                SELECT r.id repository_id, r.name repository_name, r.created_at repository_created,
                       a.id analysis_id, a.analyzed_at, a.model, a.file_count
                FROM standardization_repository r
                LEFT JOIN standardization_analysis a ON a.repository_id = r.id
                ORDER BY r.created_at DESC, a.analyzed_at DESC
                """, rs -> {
            String id = rs.getString("repository_id");
            var repository = grouped.computeIfAbsent(id, key -> new RepositorySummary(key,
                    rsString(rs, "repository_name"), time(rs, "repository_created"), new ArrayList<>()));
            if (rs.getString("analysis_id") != null) repository.analyses().add(new AnalysisSummary(
                    rs.getString("analysis_id"), time(rs, "analyzed_at"), rs.getString("model"), rs.getInt("file_count")));
        });
        jdbc.query("""
                SELECT s.repository_id, s.id, s.saved_at, s.file_count FROM standardization_input_snapshot s
                WHERE NOT EXISTS (SELECT 1 FROM standardization_analysis_input i
                    JOIN standardization_analysis a ON a.id = i.analysis_id WHERE i.snapshot_id = s.id)
                ORDER BY s.saved_at DESC
                """, rs -> {
            var repository = grouped.get(rs.getString("repository_id"));
            if (repository != null) repository.snapshots().add(new SnapshotSummary(rs.getString("id"),
                    time(rs, "saved_at"), rs.getInt("file_count")));
        });
        return List.copyOf(grouped.values());
    }

    public SavedAnalysis get(String repositoryId, String analysisId) {
        List<SavedAnalysis> rows = jdbc.query("""
                SELECT repository_id, id, preview_json, result_json FROM standardization_analysis
                WHERE repository_id = ? AND id = ?
                """, (rs, row) -> deserialize(rs), repositoryId, analysisId);
        if (rows.isEmpty()) throw new IllegalArgumentException("Nie znaleziono zapisanej analizy tego repozytorium.");
        return rows.get(0);
    }

    public boolean hasRepository(String id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM standardization_repository WHERE id = ?", Integer.class, id) > 0;
    }

    @Transactional
    public boolean deleteAnalysis(String repositoryId, String analysisId) {
        List<String> inputs = jdbc.query("SELECT snapshot_id FROM standardization_analysis_input WHERE analysis_id = ?",
                (rs, row) -> rs.getString(1), analysisId);
        int deleted = jdbc.update("DELETE FROM standardization_analysis WHERE repository_id = ? AND id = ?",
                repositoryId, analysisId);
        if (deleted == 0) return false;
        jdbc.update("DELETE FROM standardization_analysis_input WHERE analysis_id = ?", analysisId);
        for (String input : inputs) jdbc.update("""
                DELETE FROM standardization_input_snapshot WHERE id = ?
                AND NOT EXISTS (SELECT 1 FROM standardization_analysis_input WHERE snapshot_id = ?)
                """, input, input);
        removeEmptyRepository(repositoryId);
        return true;
    }

    public void checkpoint() {
        jdbc.execute("CHECKPOINT");
    }

    public void validateInputRepository(String previewId, String repositoryId) {
        var repositories = jdbc.query("""
                SELECT s.repository_id FROM standardization_analysis_input i
                JOIN standardization_input_snapshot s ON s.id = i.snapshot_id WHERE i.analysis_id = ?
                """, (rs, row) -> rs.getString(1), previewId);
        if (!repositories.isEmpty() && !repositories.get(0).equals(repositoryId)) {
            throw new IllegalArgumentException("Analiza musi zostać zapisana przy repozytorium swojego pakietu wejściowego.");
        }
    }

    public String inputSnapshotId(String previewId) {
        var inputs = jdbc.query("SELECT snapshot_id FROM standardization_analysis_input WHERE analysis_id = ?",
                (rs, row) -> rs.getString(1), previewId);
        return inputs.isEmpty() ? null : inputs.get(0);
    }

    @Transactional
    public SavedAnalysis saveWithInput(Preview preview, Result result, String repositoryId, String repositoryName, String snapshotId) {
        var owner = jdbc.query("SELECT repository_id FROM standardization_input_snapshot WHERE id = ? FOR UPDATE",
                (rs, row) -> rs.getString(1), snapshotId);
        if (owner.isEmpty() || !snapshotId.equals(inputSnapshotId(preview.id()))) {
            throw new IllegalArgumentException("Wejście tej analizy zostało usunięte. Wynik nie został przypisany do innego repozytorium.");
        }
        return save(preview, result, repositoryId, repositoryName);
    }

    @Transactional
    public SavedAnalysis save(Preview preview, Result result, String repositoryId, String repositoryName) {
        List<String> existing = jdbc.query("SELECT repository_id FROM standardization_analysis WHERE id = ?",
                (rs, row) -> rs.getString(1), preview.id());
        if (!existing.isEmpty()) return get(existing.get(0), preview.id());
        String target = repositoryId;
        if (target == null || target.isBlank()) {
            if (repositoryName == null || repositoryName.isBlank() || repositoryName.length() > 200
                    || repositoryName.chars().anyMatch(c -> Character.isISOControl(c))) {
                throw new IllegalArgumentException("Podaj poprawną nazwę repozytorium.");
            }
            target = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO standardization_repository(id, name, created_at) VALUES (?, ?, ?)",
                    target, repositoryName.trim(), java.sql.Timestamp.from(Instant.now()));
        } else if (!hasRepository(target)) {
            throw new IllegalArgumentException("Wybrane repozytorium nie istnieje.");
        }
        validateInputRepository(preview.id(), target);
        try {
            jdbc.update("""
                    INSERT INTO standardization_analysis(id, repository_id, analyzed_at, model, file_count, preview_json, result_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, preview.id(), target, java.sql.Timestamp.from(Instant.parse(result.analyzedAt())),
                    result.model(), preview.packet().files().size(), mapper.writeValueAsString(preview), mapper.writeValueAsString(result));
            return new SavedAnalysis(target, preview.id(), preview, result, inputSnapshotId(preview.id()));
        } catch (com.fasterxml.jackson.core.JsonProcessingException failure) {
            throw new IllegalStateException("Nie udało się zapisać wyniku analizy.", failure);
        }
    }

    public RepositorySnapshot snapshot(String repositoryId, String snapshotId) {
        var rows = jdbc.query("SELECT snapshot_json FROM standardization_input_snapshot WHERE repository_id = ? AND id = ?",
                (rs, row) -> readSnapshot(rs.getString(1)), repositoryId, snapshotId);
        if (rows.isEmpty()) throw new IllegalArgumentException("Nie znaleziono zapisanych plików repozytorium.");
        return rows.get(0);
    }

    @Transactional
    public RepositorySnapshot saveSnapshot(SnapshotRequest request) {
        if (request == null || request.repositoryName() == null || request.repositoryName().isBlank()
                || request.repositoryName().length() > 200 || request.repositoryName().chars().anyMatch(Character::isISOControl)
                || request.files() == null || request.files().size() > 300) {
            throw new IllegalArgumentException("Niepoprawna nazwa repozytorium lub zakres plików.");
        }
        var paths = new HashSet<String>();
        var files = new ArrayList<SnapshotFile>();
        int total = 0;
        for (SnapshotInputFile file : request.files()) {
            if (file == null || !StandardizationText.analysisPath(file.path()) || !paths.add(file.path())
                    || file.content() == null || file.content().contains("\u0000")
                    || (file.omissionReason() != null && !Set.of("UNREADABLE", "TOO_LARGE", "LIMIT", "UNSUPPORTED_ENCODING", "EXCLUDED").contains(file.omissionReason()))) {
                throw new IllegalArgumentException("Niepoprawny plik konfiguracji lub powtórzona ścieżka.");
            }
            int bytes = file.content().getBytes(StandardCharsets.UTF_8).length;
            total += bytes;
            if (bytes > MAX_FILE_BYTES || total > MAX_BODY_BYTES) throw new IllegalArgumentException("Migawka przekracza limit zapisu plików. Zmniejsz zakres repozytorium.");
            String text = file.content().replace("\r\n", "\n").replace("\r", "\n").replaceFirst("^\uFEFF", "");
            String content = StandardizationText.redact(text);
            if (file.omissionReason() != null && !file.omissionReason().equals("EXCLUDED")
                    && (file.selected() || !content.isEmpty())) throw new IllegalArgumentException("Nieodczytany plik nie może zawierać treści ani być zaznaczony.");
            files.add(new SnapshotFile(file.path(), StandardizationText.category(file.path()), content,
                    content.getBytes(StandardCharsets.UTF_8).length, !content.equals(text) || content.contains("[UKRYTO]"),
                    file.selected(), file.omissionReason()));
        }
        var reportFiles = new ArrayList<ReportFile>();
        if (request.reportFiles() != null && request.reportFiles().size() > 300) throw new IllegalArgumentException("Za dużo plików raportu.");
        for (ReportInputFile file : request.reportFiles() == null ? List.<ReportInputFile>of() : request.reportFiles()) {
            if (file == null || !StandardizationText.reportPath(file.path()) || !paths.add(file.path()) || file.content() == null
                    || file.content().contains("\u0000") || (file.omissionReason() != null
                    && !Set.of("UNREADABLE", "TOO_LARGE", "LIMIT", "UNSUPPORTED_ENCODING").contains(file.omissionReason()))) {
                throw new IllegalArgumentException("Niepoprawny plik raportu repozytorium.");
            }
            int bytes = file.content().getBytes(StandardCharsets.UTF_8).length;
            total += bytes;
            if (bytes > MAX_FILE_BYTES || total > MAX_BODY_BYTES || file.omissionReason() != null && !file.content().isEmpty()) {
                throw new IllegalArgumentException("Niepoprawna treść lub przekroczony limit plików raportu.");
            }
            String raw = StandardizationText.reportContent(file.path(), file.content().replace("\r\n", "\n").replace("\r", "\n").replaceFirst("^\uFEFF", ""));
            if (file.path().toLowerCase(Locale.ROOT).startsWith(".idea/") && raw.isBlank()) throw new IllegalArgumentException("Brak rozpoznanego komponentu AI w pliku IDE.");
            String content = StandardizationText.redact(raw);
            reportFiles.add(new ReportFile(file.path(), content, content.getBytes(StandardCharsets.UTF_8).length,
                    !content.equals(raw) || content.contains("[UKRYTO]"), file.omissionReason()));
        }
        GitMetadata git = request.git();
        if (git != null) {
            if (git.availability() == null || !Set.of("AVAILABLE", "PARTIAL", "UNAVAILABLE").contains(git.availability())
                    || git.branch() != null && (git.branch().length() > 500 || git.branch().chars().anyMatch(Character::isISOControl))
                    || git.commit() != null && !git.commit().matches("(?i)(?:[a-f\\d]{40}|[a-f\\d]{64})")) {
                throw new IllegalArgumentException("Niepoprawne metadane Git.");
            }
            git = new GitMetadata(StandardizationText.safeRemote(git.origin()),
                    git.branch() == null ? null : StandardizationText.redact(git.branch()), git.commit(), git.availability());
        }
        String repositoryId = request.repositoryId();
        if (repositoryId == null || repositoryId.isBlank()) {
            repositoryId = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO standardization_repository(id, name, created_at) VALUES (?, ?, ?)",
                    repositoryId, request.repositoryName().trim(), java.sql.Timestamp.from(Instant.now()));
        } else {
            var names = jdbc.query("SELECT name FROM standardization_repository WHERE id = ?", (rs, row) -> rs.getString(1), repositoryId);
            if (names.isEmpty() || !names.get(0).equals(request.repositoryName().trim())) throw new IllegalArgumentException("Wybrane repozytorium nie istnieje lub ma inną nazwę.");
        }
        String snapshotId = request.snapshotId();
        if (snapshotId != null) {
            var existing = jdbc.query("SELECT repository_id FROM standardization_input_snapshot WHERE id = ? FOR UPDATE",
                    (rs, row) -> rs.getString(1), snapshotId);
            if (existing.isEmpty() || !existing.get(0).equals(repositoryId)) throw new IllegalArgumentException("Nie znaleziono wejścia tego repozytorium.");
            if (jdbc.queryForObject("SELECT COUNT(*) FROM standardization_analysis_input WHERE snapshot_id = ?", Integer.class, snapshotId) > 0) snapshotId = null;
        }
        var snapshot = new RepositorySnapshot(snapshotId == null ? UUID.randomUUID().toString() : snapshotId,
                repositoryId, request.repositoryName().trim(), Instant.now().toString(), request.inventoryComplete(), request.gitDetected(), List.copyOf(files), git, List.copyOf(reportFiles));
        try {
            jdbc.update("""
                    MERGE INTO standardization_input_snapshot(id, repository_id, saved_at, file_count, snapshot_json) KEY(id)
                    VALUES (?, ?, ?, ?, ?)
                    """, snapshot.id(), snapshot.repositoryId(), java.sql.Timestamp.from(Instant.parse(snapshot.savedAt())),
                    files.size(), mapper.writeValueAsString(snapshot));
        } catch (com.fasterxml.jackson.core.JsonProcessingException failure) {
            throw new IllegalStateException("Nie udało się zapisać plików repozytorium.", failure);
        }
        return snapshot;
    }

    @Transactional
    public void attachInput(RepositorySnapshot snapshot, String previewId) {
        var current = jdbc.query("SELECT snapshot_json FROM standardization_input_snapshot WHERE id = ? FOR UPDATE",
                (rs, row) -> readSnapshot(rs.getString(1)), snapshot.id());
        if (current.isEmpty() || !current.get(0).equals(snapshot)) throw new IllegalArgumentException("Wejście zmieniło się podczas przygotowania. Otwórz zapisane pliki ponownie.");
        jdbc.update("INSERT INTO standardization_analysis_input(analysis_id, snapshot_id) VALUES (?, ?)", previewId, snapshot.id());
    }

    @Transactional
    public boolean deleteSnapshot(String repositoryId, String snapshotId) {
        var owner = jdbc.query("SELECT repository_id FROM standardization_input_snapshot WHERE id = ? AND repository_id = ? FOR UPDATE",
                (rs, row) -> rs.getString(1), snapshotId, repositoryId);
        if (owner.isEmpty()) return false;
        if (jdbc.queryForObject("""
                SELECT COUNT(*) FROM standardization_analysis_input i JOIN standardization_analysis a ON a.id = i.analysis_id
                WHERE i.snapshot_id = ?
                """, Integer.class, snapshotId) > 0) throw new IllegalArgumentException("Te pliki są powiązane z wynikiem AI. Usuń właściwą analizę.");
        int deleted = jdbc.update("DELETE FROM standardization_input_snapshot WHERE repository_id = ? AND id = ?", repositoryId, snapshotId);
        if (deleted > 0) removeEmptyRepository(repositoryId);
        return deleted > 0;
    }

    private void removeEmptyRepository(String repositoryId) {
        jdbc.update("""
                DELETE FROM standardization_repository WHERE id = ?
                AND NOT EXISTS (SELECT 1 FROM standardization_analysis WHERE repository_id = ?)
                AND NOT EXISTS (SELECT 1 FROM standardization_input_snapshot WHERE repository_id = ?)
                """, repositoryId, repositoryId, repositoryId);
    }

    private RepositorySnapshot readSnapshot(String json) {
        try { return mapper.readValue(json, RepositorySnapshot.class); }
        catch (Exception failure) { throw new IllegalStateException("Nie udało się odczytać zapisanych plików repozytorium.", failure); }
    }

    private SavedAnalysis deserialize(ResultSet rs) {
        try {
            return new SavedAnalysis(rs.getString("repository_id"), rs.getString("id"),
                    mapper.readValue(rs.getString("preview_json"), Preview.class),
                    mapper.readValue(rs.getString("result_json"), Result.class), inputSnapshotId(rs.getString("id")));
        } catch (Exception failure) {
            throw new IllegalStateException("Nie udało się odczytać zapisanej analizy.", failure);
        }
    }

    private static String time(ResultSet rs, String column) {
        try { return rs.getTimestamp(column).toInstant().toString(); }
        catch (java.sql.SQLException failure) { throw new IllegalStateException(failure); }
    }
    private static String rsString(ResultSet rs, String column) {
        try { return rs.getString(column); }
        catch (java.sql.SQLException failure) { throw new IllegalStateException(failure); }
    }
}
