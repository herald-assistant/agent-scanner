import {Injectable} from '@angular/core';
import {ImportSessionResult, ScannerStatus, Session, SessionAnalysisResponse, SessionDetail, SessionWorkflowSourcesResponse} from '../models/scanner.models';
import {ToolClassificationRequest, ToolClassificationResult, ToolClassificationStatus} from '../models/tool-classification.models';
import {OptimizationAdvicePreview, OptimizationAdviceResult, OptimizationAdviceRuntimeStatus, OptimizationTechniqueCatalog} from '../models/optimization-guidance.models';
import {SessionChatModelsResponse, SessionChatSummary, SessionChatTurn, SessionChatView} from '../models/session-chat.models';
import {SavedStandardAnalysis, StandardCatalog, StandardPrepareRequest, StandardPreview, StandardRepositorySummary, StandardResult} from '../models/standardization.models';

@Injectable({providedIn: 'root'})
export class ScannerApiService {
  private sessionChatModelsRequest?: Promise<SessionChatModelsResponse>;

  sessionChatModels(refresh = false): Promise<SessionChatModelsResponse> {
    if (refresh) this.sessionChatModelsRequest = undefined;
    if (!this.sessionChatModelsRequest) {
      this.sessionChatModelsRequest = this.get<SessionChatModelsResponse>('/api/ai/session-chats/models')
        .catch(failure => {
          this.sessionChatModelsRequest = undefined;
          throw failure;
        });
    }
    return this.sessionChatModelsRequest;
  }
  standardizationCatalog(): Promise<StandardCatalog> { return this.get('/api/standardization/catalog'); }
  prepareStandardization(request: StandardPrepareRequest): Promise<StandardPreview> {
    return this.standardizationPost<StandardPreview>('prepare', request);
  }
  analyzeStandardization(previewId: string): Promise<StandardResult> {
    return this.standardizationPost<StandardResult>('analyze', {previewId});
  }
  standardizationRepositories(): Promise<StandardRepositorySummary[]> {
    return this.get('/api/standardization/repositories');
  }
  savedStandardization(repositoryId: string, analysisId: string): Promise<SavedStandardAnalysis> {
    return this.get(`/api/standardization/repositories/${encodeURIComponent(repositoryId)}/analyses/${encodeURIComponent(analysisId)}`);
  }
  standardizationExportUrl(repositoryId: string, analysisId: string): string {
    return `/api/standardization/repositories/${encodeURIComponent(repositoryId)}/analyses/${encodeURIComponent(analysisId)}/export`;
  }
  async deleteStandardization(repositoryId: string, analysisId: string): Promise<void> {
    await this.request(`/api/standardization/repositories/${encodeURIComponent(repositoryId)}/analyses/${encodeURIComponent(analysisId)}`,
      {method: 'DELETE'}, 'Nie udało się usunąć analizy repozytorium');
  }
  analyzeAndSaveStandardization(previewId: string, repositoryId: string | null, repositoryName: string): Promise<SavedStandardAnalysis> {
    return this.standardizationPost<SavedStandardAnalysis>('analyze-and-save', {previewId, repositoryId, repositoryName});
  }
  async cancelStandardization(previewId: string): Promise<void> {
    await this.standardizationPost('cancel', {previewId});
  }
  async discardStandardization(previewId: string): Promise<void> {
    await fetch('/api/standardization/previews/' + encodeURIComponent(previewId), {method: 'DELETE'});
  }
  private async standardizationPost<T>(operation: string, body: unknown): Promise<T> {
    const response = await fetch('/api/standardization/' + operation, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null) as (T & {error?: string}) | null;
    if (!response.ok) throw new Error(result?.error || 'Nie udało się zakończyć operacji Standaryzacji.');
    return result as T;
  }
  sessionChats(sessionId: number): Promise<SessionChatSummary[]> { return this.get(`/api/ai/session-chats?sessionId=${sessionId}`); }
  sessionChat(sessionId: number, id: string): Promise<SessionChatView> {
    return this.get(`/api/ai/session-chats/${id}?sessionId=${sessionId}`);
  }
  async createSessionChat(sessionId: number, model: string): Promise<SessionChatView> {
    const response = await fetch(`/api/ai/session-chats?sessionId=${sessionId}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model})
    });
    const result = await response.json().catch(() => null) as (SessionChatView & {error?: string}) | null;
    if (!response.ok || !result) throw new Error(result?.error || 'Nie udało się utworzyć rozmowy o sesji.');
    return result;
  }
  async askSessionChat(sessionId: number, id: string, question: string, clientRequestId: string): Promise<SessionChatTurn> {
    const response = await fetch(`/api/ai/session-chats/${id}/turns?sessionId=${sessionId}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({question, clientRequestId})
    });
    const result = await response.json().catch(() => null) as (SessionChatTurn & {error?: string}) | null;
    if (!response.ok || !result) throw new Error(result?.error || 'Nie udało się uzyskać odpowiedzi w tej rozmowie.');
    return result;
  }
  async deleteSessionChat(sessionId: number, id: string): Promise<void> {
    const response = await fetch(`/api/ai/session-chats/${id}?sessionId=${sessionId}`, {method: 'DELETE'});
    if (!response.ok) {
      const result = await response.json().catch(() => null) as {error?: string} | null;
      throw new Error(result?.error || 'Nie udało się usunąć rozmowy.');
    }
  }
  toolClassificationStatus(): Promise<ToolClassificationStatus> { return this.get('/api/ai/tool-classification/status'); }
  async cachedToolClassification(sessionId: number, request: ToolClassificationRequest): Promise<ToolClassificationResult | null> {
    const response = await fetch(`/api/ai/tool-classification/cached?sessionId=${sessionId}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)});
    if (response.status === 204) return null;
    const result = await response.json().catch(() => null) as (ToolClassificationResult & {error?: string}) | null;
    if (!response.ok || !result) throw new Error(result?.error || 'Nie udało się odczytać zapisanej analizy.');
    return result;
  }
  async classifyTools(sessionId: number, request: ToolClassificationRequest): Promise<ToolClassificationResult> {
    const response = await fetch(`/api/ai/tool-classification?sessionId=${sessionId}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)});
    const result = await response.json().catch(() => null) as (ToolClassificationResult & {error?: string}) | null;
    if (!response.ok || !result) throw new Error(result?.error || (response.status === 404 ? 'Uruchom ponownie backend, aby włączyć analizę AI.' : 'Nie udało się przeanalizować działań modelu.'));
    return result;
  }
  async deleteToolClassification(sessionId: number, request: ToolClassificationRequest): Promise<void> {
    const response = await fetch(`/api/ai/tool-classification?sessionId=${sessionId}`, {
      method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as {error?: string} | null;
      throw new Error(result?.error || 'Nie udało się usunąć zapisanej analizy.');
    }
  }
  status(): Promise<ScannerStatus> { return this.get('/api/status'); }
  sessions(): Promise<Session[]> { return this.get('/api/sessions'); }
  session(id: number): Promise<SessionDetail> { return this.get(`/api/sessions/${id}`); }
  async sessionAnalysis(id: number, signal?: AbortSignal): Promise<SessionAnalysisResponse | undefined> {
    const response = await fetch(`/api/sessions/${id}/analysis`, {signal});
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Błąd API ${response.status}`);
    const result = await response.json().catch(() => undefined) as SessionAnalysisResponse | undefined;
    return result?.schemaVersion === 'session-reconstruction-v1' && result.detail && result.view ? result : undefined;
  }
  async sessionWorkflowSources(id: number): Promise<SessionWorkflowSourcesResponse | undefined> {
    const response = await fetch(`/api/sessions/${id}/workflow-sources`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Błąd API ${response.status}`);
    const result = await response.json().catch(() => undefined) as SessionWorkflowSourcesResponse | undefined;
    return result?.schemaVersion === 'session-reconstruction-v1' && Array.isArray(result.sources) ? result : undefined;
  }
  optimizationTechniques(): Promise<OptimizationTechniqueCatalog> { return this.get('/api/optimization/techniques'); }
  async prepareOptimizationAdvice(sessionId: number, request: OptimizationAdvicePreview['request']): Promise<OptimizationAdvicePreview> {
    const response = await fetch(`/api/ai/optimization-advice/prepare?sessionId=${sessionId}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)
    });
    const result = await response.json().catch(() => null) as (OptimizationAdvicePreview & {error?: string}) | null;
    if (!response.ok || !result) throw new Error(result?.error || 'Nie udało się zweryfikować i zamrozić pakietu.');
    return result;
  }
  optimizationAdviceStatus(): Promise<OptimizationAdviceRuntimeStatus> { return this.get('/api/ai/optimization-advice/status'); }
  async cachedOptimizationAdvice(sessionId: number, previewId: string): Promise<OptimizationAdviceResult | null> {
    const response = await fetch(`/api/ai/optimization-advice/cached?sessionId=${sessionId}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({previewId})
    });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => null) as (OptimizationAdviceResult & {error?: string}) | null;
    if (!response.ok || !result) throw new Error(result?.error || 'Nie udało się odczytać zapisanej rekomendacji.');
    return result;
  }
  async requestOptimizationAdvice(sessionId: number, previewId: string): Promise<OptimizationAdviceResult> {
    const response = await fetch(`/api/ai/optimization-advice?sessionId=${sessionId}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({previewId})
    });
    const result = await response.json().catch(() => null) as (OptimizationAdviceResult & {error?: string}) | null;
    if (!response.ok || !result) throw new Error(result?.error || 'Nie udało się przygotować rekomendacji AI.');
    return result;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.request('/api/pause', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({paused})
    }, 'Nie udało się zmienić nasłuchiwania');
  }

  async deleteSession(id: number): Promise<void> {
    await this.request(`/api/sessions/${id}`, {method: 'DELETE'}, 'Nie udało się usunąć sesji');
  }

  async deleteAll(): Promise<void> {
    await this.request('/api/data', {method: 'DELETE'}, 'Nie udało się wyczyścić danych');
  }

  async importSession(file: File): Promise<ImportSessionResult> {
    const response = await fetch('/api/sessions/import', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: file
    });
    const result = await response.json().catch(() => ({})) as ImportSessionResult & {error?: string};
    if (!response.ok) throw new Error(result.error || 'Nie udało się zaimportować sesji');
    return result;
  }

  exportSessionUrl(id: number): string { return `/api/sessions/${id}/export`; }

  private async get<T>(url: string): Promise<T> {
    const response = await fetch(url);
    const result = await response.json().catch(() => null) as (T & {error?: string}) | null;
    if (!response.ok || result == null) throw new Error(result?.error || `Błąd API ${response.status}`);
    return result;
  }

  private async request(url: string, init: RequestInit, fallback: string): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(fallback);
    return response;
  }
}
