import {Injectable} from '@angular/core';
import {ImportSessionResult, ScannerStatus, Session, SessionAnalysisResponse, SessionDetail, SessionWorkflowSourcesResponse} from '../models/scanner.models';
import {ToolClassificationRequest, ToolClassificationResult, ToolClassificationStatus} from '../models/tool-classification.models';
import {OptimizationAdvicePreview, OptimizationAdviceResult, OptimizationAdviceRuntimeStatus, OptimizationTechniqueCatalog} from '../models/optimization-guidance.models';
import {SessionChatModelsResponse, SessionChatTurn, SessionChatView} from '../models/session-chat.models';

@Injectable({providedIn: 'root'})
export class ScannerApiService {
  private sessionChatModelsRequest?: Promise<SessionChatModelsResponse>;

  sessionChatModels(): Promise<SessionChatModelsResponse> {
    if (!this.sessionChatModelsRequest) {
      this.sessionChatModelsRequest = this.get<SessionChatModelsResponse>('/api/ai/session-chats/models')
        .catch(failure => {
          this.sessionChatModelsRequest = undefined;
          throw failure;
        });
    }
    return this.sessionChatModelsRequest;
  }
  sessionChats(sessionId: number): Promise<SessionChatView[]> { return this.get(`/api/ai/session-chats?sessionId=${sessionId}`); }
  sessionChat(sessionId: number, id: string): Promise<SessionChatView> {
    return this.get(`/api/ai/session-chats/${id}?sessionId=${sessionId}`);
  }
  async createSessionChat(sessionId: number, model: string, roundRefs: string[]): Promise<SessionChatView> {
    const response = await fetch(`/api/ai/session-chats?sessionId=${sessionId}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({model, focus: {roundRefs}})
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
