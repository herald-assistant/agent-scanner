export type OptimizationTopic =
  | 'GENERAL'
  | 'ACQUIRE_DATA'
  | 'MODIFY'
  | 'WRITE_INTERMEDIATE'
  | 'WRITE_FINAL'
  | 'VALIDATE'
  | 'DELEGATE'
  | 'MANAGE_CONTEXT'
  | 'RESPOND'
  | 'OTHER'
  | 'UNKNOWN'
  | 'CONTEXT_COMPACTION'
  | 'UNMAPPED'
  | 'UNATTRIBUTED';

export type TechniqueApplicationPoint =
  | 'PROMPT'
  | 'PROJECT_INSTRUCTIONS'
  | 'SKILL'
  | 'AGENT_ROLE'
  | 'TOOL_CODE'
  | 'PROJECT_MAP'
  | 'ARTIFACT_PIPELINE'
  | 'SESSION_STRATEGY'
  | 'MODEL_OR_RUNTIME_CONFIG';

export type TechniqueSetupLevel = 'NONE' | 'SMALL' | 'MEDIUM' | 'LARGE';

export interface OptimizationTechniqueCatalog {
  version: string;
  techniques: OptimizationTechnique[];
}

export interface OptimizationTechnique {
  id: string;
  revision: number;
  title: string;
  explanation: string;
  mechanism: string;
  firstExperimentGoal: string;
  simplerAlternative: string;
  topics: OptimizationTopic[];
  whenUseful: string[];
  whenNotUseful: string[];
  prerequisites: string[];
  applyAt: TechniqueApplicationPoint[];
  firstExperiment: string[];
  example: TechniqueExample;
  setup: TechniqueSetup;
  maintenance: TechniqueMaintenance;
  qualityChecks: string[];
  compare: string[];
  relatedTechniqueIds: string[];
}

export interface TechniqueExample {
  before: string;
  after: string;
}

export interface TechniqueSetup {
  level: TechniqueSetupLevel;
  tasks: string[];
}

export interface TechniqueMaintenance {
  tasks: string[];
  triggers: string[];
}

export type OptimizationGuidanceSourceKind = 'CATEGORY' | 'PHASE' | 'COMPACTION';

export interface OptimizationGuidanceMeasurement {
  credits: number | null;
  shareOfKnown?: number | null;
  creditEstimated: boolean;
  coveredCalls: number;
  totalCalls: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface OptimizationGuidanceEvidence {
  kind: 'ROUND' | 'COMPACTION';
  id: string;
  label: string;
  description: string;
}

export interface OptimizationGuidanceEvidenceOpenRequest {
  evidence: OptimizationGuidanceEvidence;
  origin: EventTarget | null;
}

export interface OptimizationAdvicePreviewRequest {
  context: OptimizationGuidanceContext;
  catalogVersion: string;
  candidateTechniqueIds: string[];
}

export type OptimizationAdviceScope =
  | {kind: 'phase'; rootSessionId: number; interactionTraceId: string; roundRefs: string[]; actions: OptimizationTopic[]}
  | {kind: 'compaction'; rootSessionId: number; compactionRef: string};

export interface GuidanceSourceRef {
  sessionId: number;
  spanId: number;
  signalId: number;
  traceId: string;
  rawSpanId: string;
  sourcePointer: string;
  sourceContentHash: string;
  roundRef: string | null;
  callId: string | null;
  messageId: number | null;
  attribute: string | null;
}

export interface GuidanceObservation {
  id: string;
  kind: string;
  provenance: 'EMITTED' | 'DERIVED' | 'ESTIMATED' | 'AI_CLASSIFICATION' | 'MISSING';
  sources: GuidanceSourceRef[];
  ruleVersion: string | null;
  metric: {
    value: number | null;
    unit: string;
    population: string;
    covered: number;
    total: number;
    formulaId: string | null;
  } | null;
  excerpt: {text: string; originalCharacters: number; truncated: boolean; redacted: boolean} | null;
  limitationCodes: string[];
}

export interface GuidanceManifest {
  capturedAt: string;
  dataFingerprint: string;
  selectedRefs: string[];
  supportingRefs: string[];
  omitted: {ref: string; reason: string}[];
  classificationFingerprint: string | null;
  evidenceVersion: 'guidance-evidence-v2';
  redactionVersion: 'guidance-redaction-v1';
  upstreamCompleteness: 'UNVERIFIED' | 'TRUNCATED';
}

export interface OptimizationAdvicePreview {
  preparation?: {
    previewId: string;
    preparedAt: string;
    expiresAt: string;
    requestHash: string;
    sourceValidation: 'RAW_AND_NORMALIZED';
  };
  request: {
    version: 'optimization-advice-v1';
    catalogVersion: string;
    scope: OptimizationAdviceScope;
    manifest: GuidanceManifest;
    observations: GuidanceObservation[];
    candidateTechniqueIds: string[];
    userContext: {
      goal: string | null;
      frequency: 'UNKNOWN';
      effort: 'UNKNOWN';
      constraints: string[];
    };
  };
  summary: {
    selectedRounds: number;
    supportingRounds: number;
    observations: number;
    contentFragments: number;
    payloadCharacters: number;
    estimatedInputTokens: number;
    sendBlocked: boolean;
  };
  warnings: string[];
}

export type OptimizationAdviceStatus = 'SUGGESTIONS' | 'INSUFFICIENT_EVIDENCE' | 'NO_SUITABLE_TECHNIQUE';

export interface OptimizationAdviceProposal {
  techniqueId: string;
  observationIds: string[];
  rationale: string;
  conditionsToCheck: string[];
  experimentSteps: string[];
  setupWork: string[];
  maintenanceWork: string[];
  qualityChecks: string[];
  comparisonPlan: string[];
  limitations: string[];
  alternativeTechniqueId: string | null;
}

export interface OptimizationAdviceResult {
  version: 'optimization-advice-v1';
  catalogVersion: string;
  promptVersion: 'optimization-advice-prompt-v1';
  model: string;
  analyzedAt: string;
  previewId: string;
  requestHash: string;
  dataFingerprint: string;
  sourceValidation: 'RAW_AND_NORMALIZED';
  status: OptimizationAdviceStatus;
  proposals: OptimizationAdviceProposal[];
  missingInformation: string[];
  aiCallMetricsAvailable: boolean;
}

export interface OptimizationAdviceRuntimeStatus {
  configured: boolean;
  model: string;
  running: boolean;
}

export interface OptimizationGuidanceContext {
  kind: OptimizationGuidanceSourceKind;
  title: string;
  scopeLabel: string;
  explanation: string;
  topics: OptimizationTopic[];
  measurement: OptimizationGuidanceMeasurement;
  evidenceLabels: string[];
  evidence: OptimizationGuidanceEvidence[];
}

export interface OptimizationGuidanceOpenRequest {
  context: OptimizationGuidanceContext;
  origin: EventTarget | null;
}
