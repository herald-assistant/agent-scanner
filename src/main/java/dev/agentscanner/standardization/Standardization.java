package dev.agentscanner.standardization;

import java.util.List;

public final class Standardization {
    private Standardization() {}
    public static final String VERSION = "standardization-evidence-v1";
    public static final String ANSWER_VERSION = "standardization-answer-v1";
    public static final String PROMPT_VERSION = "standardization-prompt-v3";
    public static final int MAX_FILES = 80;
    public static final int MAX_FILE_BYTES = 131_072;
    public static final int MAX_TOTAL_BYTES = 1_048_576;
    public static final int MAX_BODY_BYTES = 8_388_608;

    public enum Category { INSTRUCTIONS, SKILLS, AGENTS, MCP, PROMPTS, CONTEXT }
    public enum Profile { AUTO, VSCODE_LOCAL, VSCODE_AGENT_HOST, COPILOT_CLI, GITHUB_CLOUD, GITHUB_REVIEW, JETBRAINS }
    public enum Verdict { SUPPORTED, CONCERN, INSUFFICIENT_EVIDENCE, NOT_APPLICABLE, UNRESOLVED }
    public enum EvidenceKind { QUOTE, ABSENCE }
    public record Source(String id, String title, String url) {}
    public record Rule(String id, Category category, String basis, String criterion, String evidence,
                       List<String> sourceIds) {}
    public record Standard(Category category, String document, String content) {}
    public record Limits(int maxFiles, int maxFileBytes, int maxTotalBytes) {}
    public record Catalog(String version, String checkedAt, List<Rule> rules, List<Source> sources,
                          List<Standard> standards, List<Profile> profiles, Limits limits) {}
    public record InputFile(String path, String content) {}
    public record Omission(String path, String reason) {}
    public record PrepareRequest(Profile profile, String clientVersion, String model,
                                 List<InputFile> files, List<Omission> omissions, boolean inventoryComplete) {}
    public record FileEvidence(String id, String path, Category category, String content, String hash,
                               int lines, boolean redacted) {}
    public record LocalCheck(String fileId, String state, String message) {}
    public record Target(String id, String fileId, String ruleId) {}
    public record Packet(String version, String rulesetVersion, String promptVersion, Profile profile,
                         String clientVersion, String model, boolean inventoryComplete,
                         List<FileEvidence> files, List<Omission> omissions, List<LocalCheck> localChecks,
                         List<Rule> rules, List<Source> sources, List<Standard> standards, List<Target> targets) {}
    public record Preview(String id, String expiresAt, String hash, Packet packet, String systemMessage, String prompt) {}
    public record ExecuteRequest(String previewId) {}
    public record SaveRequest(String previewId, String repositoryId, String repositoryName) {}
    public record AnalysisSummary(String id, String analyzedAt, String model, int fileCount) {}
    public record RepositorySummary(String id, String name, String createdAt, List<AnalysisSummary> analyses,
                                    List<SnapshotSummary> snapshots) {
        public RepositorySummary(String id, String name, String createdAt, List<AnalysisSummary> analyses) {
            this(id, name, createdAt, analyses, new java.util.ArrayList<>());
        }
    }
    public record SnapshotInputFile(String path, String content, boolean selected, String omissionReason) {}
    public record SnapshotRequest(String snapshotId, String repositoryId, String repositoryName,
                                  boolean inventoryComplete, boolean gitDetected, List<SnapshotInputFile> files) {}
    public record SnapshotFile(String path, Category category, String content, int bytes, boolean redacted,
                               boolean selected, String omissionReason) {}
    public record SnapshotSummary(String id, String savedAt, int fileCount) {}
    public record RepositorySnapshot(String id, String repositoryId, String repositoryName, String savedAt,
                                     boolean inventoryComplete, boolean gitDetected, List<SnapshotFile> files) {}
    public record SnapshotModelRequest(String model) {}
    public record SavedAnalysis(String repositoryId, String analysisId, Preview preview, Result result, String snapshotId) {
        public SavedAnalysis(String repositoryId, String analysisId, Preview preview, Result result) {
            this(repositoryId, analysisId, preview, result, null);
        }
    }
    public record AnalysisExport(String format, int version, SavedAnalysis analysis) {}
    public record Evidence(String fileId, EvidenceKind kind, int startLine, int endLine, String quote) {}
    public record Assessment(String assessmentId, Verdict verdict, String rationale, List<Evidence> evidence,
                             List<String> sourceIds, List<String> limitations, String recommendation) {}
    public record Answer(String contract, List<Assessment> assessments) {}
    public record Result(String contract, String previewId, String hash, String model, String analyzedAt,
                         List<Assessment> assessments, List<String> unreviewedTargetIds, int rejectedRecords) {}
}
