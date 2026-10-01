package dev.agentscanner.standardization;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
        int deleted = jdbc.update("DELETE FROM standardization_analysis WHERE repository_id = ? AND id = ?",
                repositoryId, analysisId);
        if (deleted == 0) return false;
        jdbc.update("""
                DELETE FROM standardization_repository WHERE id = ?
                AND NOT EXISTS (SELECT 1 FROM standardization_analysis WHERE repository_id = ?)
                """, repositoryId, repositoryId);
        return true;
    }

    public void checkpoint() {
        jdbc.execute("CHECKPOINT");
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
        try {
            jdbc.update("""
                    INSERT INTO standardization_analysis(id, repository_id, analyzed_at, model, file_count, preview_json, result_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, preview.id(), target, java.sql.Timestamp.from(Instant.parse(result.analyzedAt())),
                    result.model(), preview.packet().files().size(), mapper.writeValueAsString(preview), mapper.writeValueAsString(result));
            return new SavedAnalysis(target, preview.id(), preview, result);
        } catch (com.fasterxml.jackson.core.JsonProcessingException failure) {
            throw new IllegalStateException("Nie udało się zapisać wyniku analizy.", failure);
        }
    }

    private SavedAnalysis deserialize(ResultSet rs) {
        try {
            return new SavedAnalysis(rs.getString("repository_id"), rs.getString("id"),
                    mapper.readValue(rs.getString("preview_json"), Preview.class),
                    mapper.readValue(rs.getString("result_json"), Result.class));
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
