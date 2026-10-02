import type {SessionDetail, SessionImportPreview, SessionView} from '../../models/scanner.models';
import type {WorkflowAnalysis} from '../../models/workflow.models';
import type {PreparedImport} from '../../../scanner-core/copilot-file';
import type {OperationErrorCode} from '../../../scanner-core/operation-error';

export const WORKER_PROTOCOL = 'scanner-worker-v1';
export interface WorkerOperations {
  preview: {input: {file: File; maxBytes: number; conversations: string[]; spanKeys: string[]}; result: {handle: string; preview: SessionImportPreview}};
  prepare: {input: {handle: string; selection: string[]; receivedAt: string}; result: PreparedImport};
  analysis: {input: {source: SessionDetail; related: SessionDetail[]}; result: SessionView};
  workflow: {input: {source: SessionDetail; related: SessionDetail[]}; result: WorkflowAnalysis};
  release: {input: {handle: string}; result: null};
}
export type WorkerCommand = keyof WorkerOperations;
export interface WorkerRequest {id: number; version: string; command: WorkerCommand; input: unknown;}
export interface WorkerResponse {
  id: number; version: string; result?: unknown; phase?: string;
  error?: {code: OperationErrorCode; message: string; line?: number};
}
