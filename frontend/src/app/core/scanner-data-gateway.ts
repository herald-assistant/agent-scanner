import {inject, Injectable, InjectionToken} from '@angular/core';
import {ScannerApiService} from './scanner-api.service';
import {ImportSessionResult, ScannerStatus, Session, SessionAnalysisResponse, SessionDetail, SessionImportPreview, SessionWorkflowSourcesResponse} from '../models/scanner.models';
import {OptimizationTechniqueCatalog} from '../models/optimization-guidance.models';
import {ScannerOperationError} from '../../scanner-core/operation-error';
import type {WorkflowAnalysis} from '../models/workflow.models';

export interface SessionImportResult extends ImportSessionResult {sessionIds: number[];}
export interface SessionDownload {name: string; blob: Blob;}
export interface PreparedWorkflowSources extends SessionWorkflowSourcesResponse {analysis?: WorkflowAnalysis;}
export interface ScannerDataGateway {
  readonly multipleSelection: boolean;
  readonly importPhase?: () => string;
  status(): Promise<ScannerStatus>;
  sessions(): Promise<Session[]>;
  session(id: number): Promise<SessionDetail>;
  sessionAnalysis(id: number, signal?: AbortSignal): Promise<SessionAnalysisResponse | undefined>;
  sessionWorkflowSources(id: number): Promise<PreparedWorkflowSources | undefined>;
  previewSessionImport(file: File): Promise<SessionImportPreview>;
  importSessions(file: File, conversationIds: string[]): Promise<SessionImportResult>;
  releaseImport(file: File): void;
  exportSession(id: number): Promise<SessionDownload>;
  deleteSession(id: number): Promise<void>;
  deleteAll(): Promise<void>;
  optimizationTechniques(): Promise<OptimizationTechniqueCatalog>;
}

@Injectable({providedIn: 'root'})
export class HttpScannerDataGateway implements ScannerDataGateway {
  private readonly api = inject(ScannerApiService);
  readonly multipleSelection = false;
  status(): Promise<ScannerStatus> {return this.api.status();}
  sessions(): Promise<Session[]> {return this.api.sessions();}
  session(id: number): Promise<SessionDetail> {return this.api.session(id);}
  sessionAnalysis(id: number, signal?: AbortSignal): Promise<SessionAnalysisResponse | undefined> {return this.api.sessionAnalysis(id, signal);}
  sessionWorkflowSources(id: number): Promise<SessionWorkflowSourcesResponse | undefined> {return this.api.sessionWorkflowSources(id);}
  previewSessionImport(file: File): Promise<SessionImportPreview> {return this.api.previewSessionImport(file);}
  async importSessions(file: File, ids: string[]): Promise<SessionImportResult> {
    if (ids.length !== 1) throw new ScannerOperationError('invalid-file', 'Wybierz jedną sesję do importu.');
    const result = await this.api.importSession(file, ids[0]);
    return {...result, sessionIds: [result.sessionId]};
  }
  releaseImport(_file: File): void { /* HTTP preview has no retained browser resources. */ }
  async exportSession(id: number): Promise<SessionDownload> {
    const response = await fetch(this.api.exportSessionUrl(id));
    if (!response.ok) throw new ScannerOperationError('storage', 'Nie udało się wyeksportować sesji.');
    return {name: `agent-scanner-session-${id}.json`, blob: await response.blob()};
  }
  deleteSession(id: number): Promise<void> {return this.api.deleteSession(id);}
  deleteAll(): Promise<void> {return this.api.deleteAll();}
  optimizationTechniques(): Promise<OptimizationTechniqueCatalog> {return this.api.optimizationTechniques();}
}

export const SCANNER_DATA = new InjectionToken<ScannerDataGateway>('SCANNER_DATA', {
  providedIn: 'root', factory: () => inject(HttpScannerDataGateway)
});
