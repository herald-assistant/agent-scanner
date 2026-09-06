import {inject, Injectable, signal} from '@angular/core';
import {ScannerApiService} from './scanner-api.service';
import {FlowToolCatalog, TOOL_CLASSIFICATION_VERSION, ToolClassificationResult} from '../models/tool-classification.models';

@Injectable({providedIn: 'root'})
export class ToolClassificationService {
  private readonly api = inject(ScannerApiService);
  private readonly results = signal(new Map<string, ToolClassificationResult>());
  private readonly checked = new Set<string>();
  readonly pending = signal<string | undefined>(undefined);
  result(sessionId: number, catalog: FlowToolCatalog): ToolClassificationResult | undefined {
    return this.results().get(this.key(sessionId, catalog));
  }
  hasResult(sessionId: number, catalog: FlowToolCatalog): boolean { return !!this.result(sessionId, catalog); }
  async restore(sessionId: number, catalog: FlowToolCatalog): Promise<boolean> {
    const key = this.key(sessionId, catalog);
    if (this.results().has(key)) return true;
    if (this.checked.has(key)) return false;
    this.checked.add(key);
    try {
      const result = await this.api.cachedToolClassification(sessionId, catalog.request);
      if (result?.version === TOOL_CLASSIFICATION_VERSION) this.store(key, result);
      return result?.version === TOOL_CLASSIFICATION_VERSION;
    } catch (error) {
      this.checked.delete(key);
      throw error;
    }
  }
  async classify(sessionId: number, catalog: FlowToolCatalog): Promise<void> {
    if (this.pending()) return;
    const key = this.key(sessionId, catalog);
    if (this.results().has(key)) return;
    this.pending.set(key);
    try {
      const result = await this.api.classifyTools(sessionId, catalog.request);
      if (result.version !== TOOL_CLASSIFICATION_VERSION)
        throw new Error('Backend zwrócił starszą wersję analizy. Uruchom aplikację ponownie i wykonaj analizę v5.');
      this.checked.add(key);
      this.store(key, result);
    } finally { this.pending.set(undefined); }
  }
  private store(key: string, result: ToolClassificationResult): void {
    this.results.update(previous => {
      const next = new Map(previous);
      if (next.size >= 5) {
        const oldest = next.keys().next().value!;
        next.delete(oldest);
        this.checked.delete(oldest);
      }
      next.set(key, result);
      return next;
    });
  }
  private key(sessionId: number, catalog: FlowToolCatalog): string { return `${sessionId}:${catalog.key}`; }
}
