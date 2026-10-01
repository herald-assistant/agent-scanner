import {ChangeDetectionStrategy, Component, DestroyRef, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ActivatedRoute, Router} from '@angular/router';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ScannerApiService} from '../../core/scanner-api.service';
import {NotificationService} from '../../core/notification.service';
import {StandardizationHistoryService} from '../../core/standardization-history.service';
import {StandardizationStateService} from '../../core/standardization-state.service';
import {StandardizationComponent} from './standardization.component';
import {SavedStandardAnalysis} from '../../models/standardization.models';

@Component({
  selector: 'as-standardization-page',
  imports: [StandardizationComponent, MatIconModule, MatTooltipModule],
  templateUrl: './standardization-page.component.html',
  styleUrl: './standardization-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StandardizationPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ScannerApiService);
  private readonly history = inject(StandardizationHistoryService);
  private readonly notifications = inject(NotificationService);
  readonly state = inject(StandardizationStateService);
  private request = 0;
  readonly loading = signal(true);
  readonly error = signal('');
  readonly title = signal('Nowa analiza repozytorium');
  readonly repositoryId = signal<string | null>(null);
  readonly newAnalysis = signal(true);
  readonly savedAnalysis = signal<SavedStandardAnalysis | null>(null);
  readonly deleting = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => this.request++);
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const current = ++this.request;
      this.loading.set(true);
      this.error.set('');
      this.savedAnalysis.set(null);
      const repositoryId = params.get('repositoryId');
      const analysisId = params.get('analysisId');
      this.repositoryId.set(repositoryId);
      this.newAnalysis.set(!repositoryId || this.route.snapshot.routeConfig?.path?.endsWith('/new') === true);
      void this.open(current, repositoryId, analysisId);
    });
  }

  exportAnalysis(): void {
    const saved = this.savedAnalysis();
    if (saved) window.location.href = this.api.standardizationExportUrl(saved.repositoryId, saved.analysisId);
  }

  async deleteAnalysis(): Promise<void> {
    const saved = this.savedAnalysis();
    if (!saved || this.deleting() || !confirm('Usunąć tę analizę repozytorium wraz z wynikiem AI i zapisaną migawką plików?')) return;
    const request = this.request;
    this.deleting.set(true);
    try {
      await this.history.deleteAnalysis(saved.repositoryId, saved.analysisId);
      if (request === this.request) await this.closeAnalysis();
      this.notifications.success('Usunięto analizę repozytorium.');
    } catch (failure) {
      this.notifications.error(failure instanceof Error ? failure.message : 'Nie udało się usunąć analizy repozytorium.');
    } finally { this.deleting.set(false); }
  }

  async closeAnalysis(): Promise<void> {
    this.request++;
    this.state.beginNew();
    this.savedAnalysis.set(null);
    await this.router.navigate(['/']);
  }

  private async open(request: number, repositoryId: string | null, analysisId: string | null): Promise<void> {
    try {
      if (!repositoryId) {
        this.state.beginNew();
        this.title.set('Nowa analiza repozytorium');
      } else {
        await this.history.refresh();
        if (request !== this.request) return;
        const repository = this.history.repositories().find(item => item.id === repositoryId);
        if (!repository) throw new Error('Nie znaleziono repozytorium.');
        if (this.newAnalysis()) {
          this.state.beginNew(repositoryId, repository.name);
          this.title.set(`Nowa analiza · ${repository.name}`);
        } else {
          const selected = analysisId ?? repository.analyses[0]?.id;
          if (!selected) throw new Error('Repozytorium nie ma zapisanych analiz.');
          const saved = await this.api.savedStandardization(repositoryId, selected);
          if (request !== this.request) return;
          this.state.loadSaved(saved, repository.name);
          this.savedAnalysis.set(saved);
          this.title.set(repository.name);
        }
      }
    } catch (failure) {
      if (request === this.request) this.error.set(failure instanceof Error ? failure.message : 'Nie udało się otworzyć analizy.');
    } finally { if (request === this.request) this.loading.set(false); }
  }
}
