import {ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ActivatedRoute, Router} from '@angular/router';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {ScannerApiService} from '../../core/scanner-api.service';
import {NotificationService} from '../../core/notification.service';
import {StandardizationHistoryService} from '../../core/standardization-history.service';
import {StandardizationStateService} from '../../core/standardization-state.service';
import {StandardizationComponent} from './standardization.component';
import {SavedStandardAnalysis} from '../../models/standardization.models';
import {StandardizationRepositoryService} from '../../core/standardization-repository.service';
import {FeatureAvailability} from '../../core/feature-availability.service';
import {createRepositoryReportPdf} from '../../core/repository-report-pdf';

@Component({
  selector: 'as-standardization-page',
  imports: [StandardizationComponent, MatIconModule, MatTooltipModule, MatProgressSpinnerModule],
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
  private readonly repositories = inject(StandardizationRepositoryService);
  private readonly features = inject(FeatureAvailability);
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
  readonly exportingPdf = signal(false);
  readonly canExportPdf = computed(() => !this.loading() && !this.error() && !this.deleting() && !this.exportingPdf()
    && !this.state.busy() && this.state.filesSaved() && !!this.state.folder());

  constructor() {
    this.destroyRef.onDestroy(() => this.request++);
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const current = ++this.request;
      this.loading.set(true);
      this.error.set('');
      this.savedAnalysis.set(null);
      const repositoryId = params.get('repositoryId');
      const analysisId = params.get('analysisId');
      const snapshotId = params.get('snapshotId');
      this.repositoryId.set(repositoryId);
      this.newAnalysis.set(!repositoryId || this.route.snapshot.routeConfig?.path?.endsWith('/new') === true);
      void this.open(current, repositoryId, analysisId, snapshotId);
    });
  }

  exportAnalysis(): void {
    const saved = this.savedAnalysis();
    if (saved) window.location.href = this.api.standardizationExportUrl(saved.repositoryId, saved.analysisId);
    else if (this.state.snapshot()) {
      const snapshot = this.state.snapshot()!;
      const url = URL.createObjectURL(new Blob([JSON.stringify({format: 'agent-scanner-repository-input', version: 1, snapshot}, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url; link.download = `agent-scanner-input-${snapshot.id}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  async downloadPdf(): Promise<void> {
    if (!this.canExportPdf()) return;
    // Freeze the report at the user's click, even if navigation changes during generation.
    const report = this.state.report();
    this.exportingPdf.set(true);
    try {
      const blob = await createRepositoryReportPdf(report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agent-scanner-raport-${report.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.notifications.error('Nie udało się wygenerować PDF. Spróbuj ponownie; zapisane pliki pozostają dostępne.');
    } finally { this.exportingPdf.set(false); }
  }

  async deleteAnalysis(): Promise<void> {
    const saved = this.savedAnalysis();
    const snapshot = this.state.snapshot();
    if ((!saved && !snapshot) || this.deleting() || !confirm(saved
      ? 'Usunąć tę analizę repozytorium wraz z wynikiem AI i zapisanymi plikami?'
      : 'Usunąć zapisane pliki tego repozytorium?')) return;
    const request = this.request;
    this.deleting.set(true);
    try {
      if (saved) await this.history.deleteAnalysis(saved.repositoryId, saved.analysisId);
      else if (snapshot) { await this.repositories.delete(snapshot.repositoryId, snapshot.id); await this.history.refresh(); }
      if (request === this.request) await this.closeAnalysis();
      this.notifications.success(saved ? 'Usunięto analizę repozytorium.' : 'Usunięto zapisane pliki repozytorium.');
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

  private async open(request: number, repositoryId: string | null, analysisId: string | null, snapshotId: string | null): Promise<void> {
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
        } else if (snapshotId || (!analysisId && !repository.analyses.length && repository.snapshots?.length)) {
          const snapshot = await this.repositories.get(repositoryId, snapshotId ?? repository.snapshots![0].id);
          if (request !== this.request) return;
          this.state.loadSnapshot(snapshot);
          this.title.set(repository.name);
        } else {
          if (this.features.demo) throw new Error('Nie znaleziono zapisanych plików tego repozytorium.');
          const selected = analysisId ?? repository.analyses[0]?.id;
          if (!selected) throw new Error('Repozytorium nie ma zapisanych analiz.');
          const saved = await this.api.savedStandardization(repositoryId, selected);
          const snapshot = saved.snapshotId ? await this.repositories.get(repositoryId, saved.snapshotId) : undefined;
          if (request !== this.request) return;
          this.state.loadSaved(saved, repository.name, snapshot);
          this.savedAnalysis.set(saved);
          this.title.set(repository.name);
        }
      }
    } catch (failure) {
      if (request === this.request) this.error.set(failure instanceof Error ? failure.message : 'Nie udało się otworzyć analizy.');
    } finally { if (request === this.request) this.loading.set(false); }
  }
}
