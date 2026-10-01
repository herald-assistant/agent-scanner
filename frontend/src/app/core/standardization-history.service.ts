import {inject, Injectable, signal} from '@angular/core';
import {ScannerApiService} from './scanner-api.service';
import {StandardRepositorySummary} from '../models/standardization.models';

@Injectable({providedIn: 'root'})
export class StandardizationHistoryService {
  private readonly api = inject(ScannerApiService);
  readonly repositories = signal<StandardRepositorySummary[]>([]);
  readonly error = signal('');

  async deleteAnalysis(repositoryId: string, analysisId: string): Promise<void> {
    await this.api.deleteStandardization(repositoryId, analysisId);
    this.repositories.update(repositories => repositories.map(repository => repository.id === repositoryId
      ? {...repository, analyses: repository.analyses.filter(analysis => analysis.id !== analysisId)} : repository)
      .filter(repository => repository.id !== repositoryId || repository.analyses.length > 0));
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.repositories.set(await this.api.standardizationRepositories());
      this.error.set('');
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Nie udało się odczytać repozytoriów.');
    }
  }
}
