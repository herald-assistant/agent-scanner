export type ToolCategory = 'DATA_ACCESS' | 'ANALYSIS' | 'MODIFICATION' | 'VALIDATION' | 'EXECUTION' | 'EXTERNAL' | 'COORDINATION' | 'DELEGATION' | 'OTHER';
export const TOOL_CLASSIFICATION_VERSION = 'model-actions-v5';
export type ToolSpecialization = 'GENERAL_PURPOSE' | 'DOMAIN_SPECIFIC' | 'TASK_SPECIFIC' | 'UNKNOWN';
export type ToolFit = 'DIRECT' | 'SUPPORTING' | 'WEAK' | 'UNKNOWN';
export const ACTIONS = ['ACQUIRE_DATA', 'MODIFY', 'WRITE_INTERMEDIATE', 'WRITE_FINAL', 'VALIDATE', 'DELEGATE', 'MANAGE_CONTEXT', 'RESPOND', 'OTHER', 'UNKNOWN'] as const;
export type ActionCategory = typeof ACTIONS[number];
export type RoundCategory = ActionCategory | 'MIXED';
export interface ClassifiedTool { id: string; category: ToolCategory; specialization: ToolSpecialization; reason: string; }
export interface ToolAssessment { contextId: string; invocationId: string; toolId: string | null; actions: ActionCategory[]; fit: ToolFit; reason: string; }
export interface RoundClassification { roundId: string; actions: ActionCategory[]; evidenceInvocationIds: string[]; reason: string; }
export interface ToolInvocationInput {
  id: string;
  toolId: string | null;
  name: string;
  arguments: unknown;
  argumentsTruncated: boolean;
}
export interface RoundClassificationInput {
  id: string;
  order: number;
  modelOutput: string | null;
  outputObserved: boolean;
  invocations: ToolInvocationInput[];
}
export interface ToolClassificationRequest {
  tools: {id: string; name: string; definition: Record<string, unknown>}[];
  agents: {id: string; parentId: string | null; contextIds: string[]}[];
  contexts: {id: string; agentId: string; goal: string | null; rounds: RoundClassificationInput[]}[];
}
export interface ToolClassificationResult {
  version: string; model: string; analyzedAt: string; tools: ClassifiedTool[]; assessments: ToolAssessment[];
  rounds: RoundClassification[];
}
export interface ToolClassificationStatus { configured: boolean; model: string; running: boolean; }
export interface CatalogUsage { ref: string; roundRef: string; roundId: string; streamId: string; agentId: string; contextId: string; invocationId: string; name: string; toolId?: string; callId?: string; }
export interface FlowToolCatalog {
  request: ToolClassificationRequest;
  key: string;
  usages: CatalogUsage[];
  rounds: {ref: string; id: string; streamId: string}[];
  agents: {streamId: string; id: string}[];
  definitionsSeen: number;
  missing: number;
}
