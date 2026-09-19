export type Tab = 'overview' | 'loop' | 'workflow' | 'ai-hub' | 'technical';
export type TechnicalMode = 'spans' | 'signals';

export interface ScannerStatus {
  paused: boolean;
  connected: boolean;
  lastSignalAt: string | null;
  traces: number;
  metrics: number;
  logs: number;
  contentCaptured: boolean;
  retentionDays: number;
}

export interface Session {
  id: number;
  conversationId: string;
  agentName?: string;
  agentType?: string;
  requestedModel?: string;
  responseModel?: string;
  repository?: string;
  branchName?: string;
  sourceKind?: 'vscode' | 'copilot-sdk' | 'unknown';
  sourceName?: string;
  sourceService?: string;
  sourceVersion?: string;
  startedAt?: string;
  endedAt?: string;
  lastSeenAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  turnCount: number;
  toolCount: number;
  errorCount: number;
  contentCaptured: boolean;
}

export interface SpanRecord {
  id: number;
  signalId: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  spanName: string;
  operationName?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  statusCode?: string;
  statusMessage?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  ttftMs?: number;
  attributesJson: string;
  eventsJson: string;
  depth?: number;
}

export interface MessageRecord {
  id: number;
  spanId: number;
  direction: string;
  sequenceNo: number;
  roleName?: string;
  content: string;
  sourceKind: string;
}

export interface SignalRecord {
  id: number;
  signalType: string;
  receivedAt: string;
  rawJson?: string;
  resourceAttributes: string;
  itemCount: number;
}

export interface SessionDetail {
  session: Session;
  spans: SpanRecord[];
  messages: MessageRecord[];
  signals: SignalRecord[];
}

export interface ModelTurn {
  index: number;
  interactionIndex?: number;
  interactionTurnIndex?: number;
  interactionPrompt?: string;
  interactionStartedAt?: string;
  model: SpanRecord;
  tools: SpanRecord[];
  diagnostics?: SpanRecord[];
}

export interface UserInteraction {
  index: number;
  traceId: string;
  prompt: string;
  startedAt?: string;
  turns: ModelTurn[];
}

export interface ImportSessionResult {
  sessionId: number;
  signals: number;
  spans: number;
}

export interface RelatedModelCall {
  span: SpanRecord;
  label: string;
}

export interface SessionCostGroup {
  id: string;
  kind: 'main' | 'subagent';
  agentName?: string;
  startedAt?: string;
  spans: SpanRecord[];
}

export interface ContextCompactionMeasurement {
  id: string;
  sessionId: number;
  spanId: number;
  agentName: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  freshInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  credits?: number;
  resultCharacters: number;
  placementBeforeModelId?: number;
  resultObservedInModelId?: number;
  beforeInteractionIndex?: number;
  afterInteractionIndex?: number;
  observedAt?: string;
  beforeInputTokens?: number;
  afterInputTokens?: number;
  beforeOccupancy?: number;
  afterOccupancy?: number;
}

export interface SessionView {
  source: SessionDetail;
  relatedSource: SessionDetail[];
  tools: SpanRecord[];
  primaryModelSpans: SpanRecord[];
  billingModelSpans: SpanRecord[];
  costGroups: SessionCostGroup[];
  modelTurns: ModelTurn[];
  interactions: UserInteraction[];
  contextCompactions: ContextCompactionMeasurement[];
  relatedModelCalls: RelatedModelCall[];
  assistantAnswer: string;
  toolDefinitionNames: string[];
  contextualMessageCount: number;
  madeFileChanges: boolean;
}

export interface SessionAnalysisResponse {
  schemaVersion: 'session-reconstruction-v1';
  reconstructionVersion: 'copilot-episode-v1';
  cutoffSignalId: number;
  detail: SessionDetail;
  relatedDetails: SessionDetail[];
  view: Omit<SessionView, 'source' | 'relatedSource' | 'contextCompactions'>;
}

export interface SessionWorkflowSourcesResponse {
  schemaVersion: 'session-reconstruction-v1';
  reconstructionVersion: 'copilot-episode-v1';
  cutoffSignalId: number;
  sources: SessionDetail[];
}
