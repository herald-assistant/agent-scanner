export type StandardCategory = 'INSTRUCTIONS' | 'SKILLS' | 'AGENTS' | 'MCP' | 'PROMPTS' | 'CONTEXT';
export type StandardProfile = 'AUTO' | 'VSCODE_LOCAL' | 'VSCODE_AGENT_HOST' | 'COPILOT_CLI' | 'GITHUB_CLOUD' | 'GITHUB_REVIEW' | 'JETBRAINS';
export type StandardVerdict = 'SUPPORTED' | 'CONCERN' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE' | 'UNRESOLVED';
export interface StandardSource { id: string; title: string; url: string; }
export interface StandardRule { id: string; category: StandardCategory; basis: string; criterion: string; evidence: string; sourceIds: string[]; }
export interface StandardDocument { category: StandardCategory; document: string; content: string; }
export interface StandardCatalog {
  version: string; checkedAt: string; rules: StandardRule[]; sources: StandardSource[];
  standards: StandardDocument[]; profiles: StandardProfile[];
  limits: {maxFiles: number; maxFileBytes: number; maxTotalBytes: number};
}
export interface StandardOmission { path: string; reason: 'EXCLUDED' | 'UNREADABLE' | 'TOO_LARGE' | 'LIMIT' | 'UNSUPPORTED_ENCODING'; }
export interface StandardPrepareRequest {
  profile: StandardProfile; clientVersion: string; model: string;
  files: {path: string; content: string}[]; omissions: StandardOmission[]; inventoryComplete: boolean;
}
export interface StandardFile {
  id: string; path: string; category: StandardCategory; content: string; hash: string; lines: number; redacted: boolean;
}
export interface StandardLocalCheck { fileId: string; state: 'PASS' | 'WARNING' | 'ERROR' | 'INFO'; message: string; }
export interface StandardTarget { id: string; fileId: string; ruleId: string; }
export interface StandardPacket {
  version: string; rulesetVersion: string; promptVersion: string; profile: StandardProfile;
  clientVersion: string; model: string; inventoryComplete: boolean; files: StandardFile[];
  omissions: StandardOmission[]; localChecks: StandardLocalCheck[]; rules: StandardRule[];
  sources: StandardSource[]; standards: StandardDocument[]; targets: StandardTarget[];
}
export interface StandardPreview {
  id: string; expiresAt: string; hash: string; packet: StandardPacket; systemMessage: string; prompt: string;
}
export interface StandardEvidence {
  fileId: string; kind: 'QUOTE' | 'ABSENCE'; startLine: number; endLine: number; quote: string;
}
export interface StandardAssessment {
  assessmentId: string; verdict: StandardVerdict; rationale: string; evidence: StandardEvidence[];
  sourceIds: string[]; limitations: string[]; recommendation: string;
}
export interface StandardResult {
  contract: string; previewId: string; hash: string; model: string; analyzedAt: string;
  assessments: StandardAssessment[]; unreviewedTargetIds: string[]; rejectedRecords: number;
}
export interface StandardAnalysisSummary { id: string; analyzedAt: string; model: string; fileCount: number; }
export interface StandardRepositorySummary {
  id: string; name: string; createdAt: string; analyses: StandardAnalysisSummary[];
}
export interface SavedStandardAnalysis {
  repositoryId: string; analysisId: string; preview: StandardPreview; result: StandardResult;
}
export interface StandardAnalysisExport {
  format: 'agent-scanner-standardization-analysis'; version: 1; analysis: SavedStandardAnalysis;
}
