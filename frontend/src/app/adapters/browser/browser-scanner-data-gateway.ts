import {DestroyRef,inject,Injectable} from '@angular/core';
import type {ScannerDataGateway,SessionDownload,SessionImportResult,PreparedWorkflowSources} from '../../core/scanner-data-gateway';
import {APP_RUNTIME} from '../../core/app-runtime';
import type {ScannerStatus,Session,SessionDetail,SessionAnalysisResponse,SessionImportPreview} from '../../models/scanner.models';
import type {OptimizationTechniqueCatalog} from '../../models/optimization-guidance.models';
import {BrowserWorkerClient} from './browser-worker-client';
import {IndexedDbSessionRepository} from './indexeddb-session-repository';
import {ScannerOperationError} from '../../../scanner-core/operation-error';

@Injectable({providedIn: 'root'})
export class BrowserScannerDataGateway implements ScannerDataGateway {
  readonly multipleSelection=true;
  readonly repository=new IndexedDbSessionRepository();
  private readonly worker=inject(BrowserWorkerClient);
  private readonly runtime=inject(APP_RUNTIME);
  private readonly previews=new WeakMap<File,string>();
  private currentFile?: File;
  readonly importPhase=this.worker.phase.asReadonly();
  constructor() {inject(DestroyRef).onDestroy(()=>void this.repository.close());}
  async status(): Promise<ScannerStatus> {
    const stats=await this.repository.statistics();
    return {paused: false,connected: false,lastSignalAt: stats.lastSignalAt,traces: stats.signals,metrics: 0,logs: 0,retentionDays: 0,contentCaptured: stats.contentCaptured};
  }
  sessions(): Promise<Session[]> {return this.repository.sessions();}
  session(id: number): Promise<SessionDetail> {return this.repository.detail(id);}
  async sessionAnalysis(id: number,signal?: AbortSignal): Promise<SessionAnalysisResponse> {
    const [detail,...relatedDetails]=await this.repository.scope(id);
    if (signal?.aborted) throw new DOMException('Aborted','AbortError');
    const view=await this.worker.execute('analysis',{source: detail,related: relatedDetails});
    if (signal?.aborted) throw new DOMException('Aborted','AbortError');
    return {schemaVersion: 'session-reconstruction-v1',reconstructionVersion: 'copilot-episode-v1',cutoffSignalId: Math.max(...[detail,...relatedDetails].flatMap(item=>item.signals.map(signal=>signal.id))),detail,relatedDetails,view};
  }
  async sessionWorkflowSources(id: number): Promise<PreparedWorkflowSources> {
    const [source,...sources]=await this.repository.scope(id);
    const analysis=await this.worker.execute('workflow',{source,related: sources});
    return {schemaVersion: 'session-reconstruction-v1',reconstructionVersion: 'copilot-episode-v1',cutoffSignalId: Math.max(...[source,...sources].flatMap(item=>item.signals.map(signal=>signal.id))),sources,analysis};
  }
  async previewSessionImport(file: File): Promise<SessionImportPreview> {
    if (file.size>this.runtime.maxImportBytes) throw new ScannerOperationError('limit',`Plik przekracza limit ${this.runtime.maxImportBytes/1024/1024} MB.`);
    this.currentFile=file;
    const identities=await this.repository.identities();
    if (this.currentFile!==file) throw new ScannerOperationError('cancelled','Operacja została anulowana.');
    const result=await this.worker.execute('preview',{file,maxBytes: this.runtime.maxImportBytes,...identities});
    if (this.currentFile!==file) throw new ScannerOperationError('cancelled','Operacja została anulowana.');
    this.previews.set(file,result.handle); return result.preview;
  }
  async importSessions(file: File,conversationIds: string[]): Promise<SessionImportResult> {
    const handle=this.previews.get(file);
    if (!handle) throw new ScannerOperationError('cancelled','Wczytaj plik ponownie przed importem.');
    const prepared=await this.worker.execute('prepare',{handle,selection: conversationIds,receivedAt: new Date().toISOString()});
    return this.repository.save(prepared);
  }
  releaseImport(file: File): void {
    const handle=this.previews.get(file); this.previews.delete(file);
    if (handle) void this.worker.execute('release',{handle}).catch(()=>{});
    else if (this.currentFile===file) this.worker.cancel();
    if (this.currentFile===file) this.currentFile=undefined;
  }
  async exportSession(id: number): Promise<SessionDownload> {
    const [detail,...relatedDetails]=await this.repository.scope(id);
    return {name: `agent-scanner-session-${id}.json`,blob: new Blob([JSON.stringify({format: 'agent-scanner-session',version: 1,...detail,relatedDetails},null,2)],{type: 'application/json'})};
  }
  deleteSession(id: number): Promise<void> {return this.repository.deleteSession(id);}
  deleteAll(): Promise<void> {return this.repository.deleteAll();}
  async optimizationTechniques(): Promise<OptimizationTechniqueCatalog> {
    const response=await fetch(new URL('assets/optimization/techniques-v1.json',document.baseURI));
    if (!response.ok) throw new ScannerOperationError('storage','Nie udało się odczytać katalogu technik.');
    return response.json() as Promise<OptimizationTechniqueCatalog>;
  }
}
