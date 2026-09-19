export interface SessionChatFocus { roundRefs: string[]; }

export interface SessionChatModel {
  id: string;
  name: string;
  maxPromptTokens: number | null;
  maxContextWindowTokens: number | null;
  reasoningEfforts: string[];
}

export interface SessionChatModelsResponse {
  configured: boolean;
  defaultModel: string;
  running: boolean;
  models: SessionChatModel[];
}

export type SessionChatAnswerStatus = 'ANSWER' | 'CLARIFICATION_NEEDED' | 'INSUFFICIENT_EVIDENCE' | 'OUT_OF_SCOPE';

export interface SessionChatEvidence { ref: string; label: string; }
export interface SessionChatAnswer {
  contract: 'session-analysis-answer';
  status: SessionChatAnswerStatus;
  answerMarkdown: string;
  evidence: SessionChatEvidence[];
  hypotheses: string[];
  limitations: string[];
  suggestedFollowUps: string[];
}

export interface SessionChatToolCall {
  id: string;
  toolName: string;
  activityLabel: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  arguments: unknown;
  result: unknown | null;
  resultCharacters: number | null;
  truncated: boolean;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SessionChatTurn {
  id: string;
  clientRequestId: string;
  question: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  answer: SessionChatAnswer | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  toolCalls: SessionChatToolCall[];
}

export interface SessionChatView {
  id: string;
  sessionId: number;
  model: string;
  cutoffSignalId: number;
  contextHash: string;
  focus: SessionChatFocus;
  bootstrap: Record<string, unknown>;
  revision: number;
  createdAt: string;
  updatedAt: string;
  newerTelemetryAvailable: boolean;
  turns: SessionChatTurn[];
}
