import {Injectable} from '@angular/core';
import {ImportSessionResult, ScannerStatus, Session, SessionDetail} from '../models/scanner.models';

@Injectable({providedIn: 'root'})
export class ScannerApiService {
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
