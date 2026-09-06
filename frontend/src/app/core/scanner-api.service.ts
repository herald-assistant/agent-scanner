import {Injectable} from '@angular/core';
import {ImportSessionResult, ScannerStatus, Session, SessionDetail} from '../models/scanner.models';
import {ToolClassificationRequest, ToolClassificationResult, ToolClassificationStatus} from '../models/tool-classification.models';

@Injectable({providedIn: 'root'})
export class ScannerApiService {
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
    if (!response.ok) throw new Error(`Błąd API ${response.status}`);
    return response.json() as Promise<T>;
  }

  private async request(url: string, init: RequestInit, fallback: string): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(fallback);
    return response;
  }
}
