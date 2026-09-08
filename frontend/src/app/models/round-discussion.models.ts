import {GuidanceSourceRef} from './optimization-guidance.models';

export interface RoundDiscussionSelection {
  rootSessionId: number;
  streamId: string;
  actorLabel: string;
  interactionTraceId: string;
  startRoundRef: string;
  endRoundRef: string;
  roundRefs: string[];
  initialPrompt: string | null;
}

export interface RoundDiscussionRoundEvidence {
  roundRef: string;
  sequenceIndex: number;
  interactionTurnIndex: number;
  nextRoundRef: string | null;
  model: string | null;
  metrics: Record<string, unknown>;
  source: GuidanceSourceRef;
}

export interface RoundDiscussionBoundary {
  id: string;
  roundRef: string;
  kind: 'MODEL_REQUEST' | 'MODEL_RESPONSE' | 'TOOL_DEFINITIONS' | 'TOOL_EXECUTION' | 'NEXT_MODEL_REQUEST';
  source: GuidanceSourceRef;
  value: unknown;
  limitationCodes: string[];
}

export interface RoundDiscussionEvidenceSnapshot {
  version: 'round-discussion-evidence-v1';
  capturedAt: string;
  contentHash: string;
  selection: RoundDiscussionSelection;
  rounds: RoundDiscussionRoundEvidence[];
  boundaries: RoundDiscussionBoundary[];
  redactionVersion: 'guidance-redaction-v1';
  upstreamCompleteness: 'UNVERIFIED' | 'TRUNCATED';
}

export interface RoundDiscussionCreateRequest {
  version: 'round-discussion-v1';
  model: string;
  snapshot: RoundDiscussionEvidenceSnapshot;
}

export interface RoundDiscussionModel {
  id: string;
  name: string;
  maxPromptTokens: number | null;
  maxContextWindowTokens: number | null;
  reasoningEfforts: string[];
}

export interface RoundDiscussionModelsResponse {
  configured: boolean;
  defaultModel: string;
  running: boolean;
  models: RoundDiscussionModel[];
}

export type RoundDiscussionAnswerStatus = 'ANSWER' | 'CLARIFICATION_NEEDED' | 'INSUFFICIENT_EVIDENCE' | 'OUT_OF_SCOPE';
export type RoundDiscussionBlockKind = 'EXPLANATION' | 'HYPOTHESIS' | 'GENERAL_GUIDANCE';

export interface RoundDiscussionAnswerBlock {
  kind: RoundDiscussionBlockKind;
  text: string;
  boundaryIds: string[];
  roundRefs: string[];
}

export interface RoundDiscussionAnswer {
  status: RoundDiscussionAnswerStatus;
  blocks: RoundDiscussionAnswerBlock[];
  questionsToUser: string[];
  limitations: string[];
}

export interface RoundDiscussionTurn {
  id: string;
  clientRequestId: string;
  question: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  answer: RoundDiscussionAnswer | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RoundDiscussionView {
  id: string;
  sessionId: number;
  version: 'round-discussion-v1';
  model: string;
  evidenceHash: string;
  snapshot: RoundDiscussionEvidenceSnapshot;
  revision: number;
  createdAt: string;
  updatedAt: string;
  turns: RoundDiscussionTurn[];
}
