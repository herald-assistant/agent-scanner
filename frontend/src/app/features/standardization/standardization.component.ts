import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {DatePipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatDialog} from '@angular/material/dialog';
import {Router} from '@angular/router';
import {firstValueFrom} from 'rxjs';
import {FeatureAvailability} from '../../core/feature-availability.service';
import {StandardizationAnalysisDialogComponent} from './standardization-analysis-dialog.component';
import {StandardizationStateService} from '../../core/standardization-state.service';
import {StandardizationHistoryService} from '../../core/standardization-history.service';
import {pickRepository, RepositoryFile, RepositorySelection, selectionFromFiles} from '../../core/standardization-files';
import {StandardCategory} from '../../models/standardization.models';
import {StandardizationFileDialogComponent, StandardizationFileDialogData} from './standardization-file-dialog.component';
import {RepositoryReportComponent} from './repository-report.component';
import {buildRepositoryReport, ReportEntry} from '../../core/repository-report';

export const CATEGORY_LABELS: Record<StandardCategory, string> = {
  INSTRUCTIONS: 'Instrukcje', SKILLS: 'Skills', AGENTS: 'Agenci', MCP: 'MCP', PROMPTS: 'Prompty', CONTEXT: 'Materiały konfiguracji'
};
@Component({
  selector: 'as-standardization',
  imports: [DatePipe, MatIconModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule, RepositoryReportComponent],
  templateUrl: './standardization.component.html',
  styleUrl: './standardization.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StandardizationComponent {
  readonly state = inject(StandardizationStateService);
  readonly features = inject(FeatureAvailability);
  readonly choosingModel = signal(false);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly history = inject(StandardizationHistoryService);
  readonly categories = CATEGORY_LABELS;
  readonly search = signal('');
  readonly category = signal<StandardCategory | 'ALL'>('ALL');
  readonly filtered = computed(() => this.state.files().filter(file =>
    (this.category() === 'ALL' || file.category === this.category())
    && file.path.toLowerCase().includes(this.search().toLowerCase())));
  readonly categoryOptions = computed(() => Object.entries(CATEGORY_LABELS)
    .map(([id, label]) => ({id: id as StandardCategory, label, count: this.state.files().filter(file => file.category === id).length}))
    .filter(item => item.count > 0));
  readonly readableCount = computed(() => this.state.files().filter(file => !file.error).length);
  readonly report = computed(() => buildRepositoryReport({name: this.state.folder()?.name ?? '',
    savedAt: this.state.snapshot()?.savedAt ?? this.state.result()?.analyzedAt,
    complete: this.state.inventoryComplete() && (!this.state.saved() || !!this.state.snapshot()), gitDetected: this.state.folder()?.gitDetected ?? false,
    git: this.state.git(), files: this.state.files(), reportFiles: this.state.reportFiles(),
    ideComplete: this.state.snapshot()?.reportFiles != null}));
  readonly summaries = computed(() => {
    const preview = this.state.preview();
    const result = this.state.result();
    const counts = new Map<string, {supported: number; concern: number; gaps: number; missing: number; skipped: number}>();
    if (!preview || !result) return counts;
    for (const file of preview.packet.files) {
      const targetIds = new Set(preview.packet.targets.filter(target => target.fileId === file.id).map(target => target.id));
      const values = result.assessments.filter(value => targetIds.has(value.assessmentId));
      counts.set(file.path, {
        supported: values.filter(value => value.verdict === 'SUPPORTED').length,
        concern: values.filter(value => value.verdict === 'CONCERN').length,
        gaps: values.filter(value => value.verdict === 'INSUFFICIENT_EVIDENCE' || value.verdict === 'UNRESOLVED').length,
        skipped: values.filter(value => value.verdict === 'NOT_APPLICABLE').length,
        missing: result.unreviewedTargetIds.filter(id => targetIds.has(id)).length
      });
    }
    return counts;
  });
  readonly totals = computed(() => {
    const assessments = this.state.result()?.assessments ?? [];
    return {
      supported: assessments.filter(value => value.verdict === 'SUPPORTED').length,
      concern: assessments.filter(value => value.verdict === 'CONCERN').length,
      gaps: assessments.filter(value => value.verdict === 'INSUFFICIENT_EVIDENCE' || value.verdict === 'UNRESOLVED').length,
      skipped: assessments.filter(value => value.verdict === 'NOT_APPLICABLE').length
    };
  });
  readonly crossFile = computed(() => (this.state.result()?.assessments ?? []).filter(value =>
    value.verdict === 'CONCERN' && new Set(value.evidence.map(item => item.fileId)).size > 1));
  async retrySave(): Promise<void> {
    await this.state.persistFiles().catch(() => undefined);
    if (this.state.filesSaved()) await this.openSavedInput();
  }
  async runAnalysis(): Promise<void> {
    if (!this.state.canRun() || this.choosingModel() || !this.features.require('standardization')) return;
    this.choosingModel.set(true);
    const dialog = this.dialog.open<StandardizationAnalysisDialogComponent, undefined, boolean>(StandardizationAnalysisDialogComponent,
      {width: '560px', maxWidth: '94vw', maxHeight: '90vh', restoreFocus: true});
    const confirmed = await firstValueFrom(dialog.afterClosed());
    this.choosingModel.set(false);
    if (!confirmed) return;
    await this.state.prepare();
    if (!this.state.preview()) return;
    const saved = await this.state.send();
    if (!saved) return;
    await this.history.refresh();
    await this.router.navigate(['/repositories', saved.repositoryId, 'analyses', saved.analysisId]);
  }

  async chooseFolder(input: HTMLInputElement): Promise<void> {
    if (this.state.busy()) return;
    this.state.choosingFolder.set(true);
    try {
      const selection = await pickRepository();
      this.state.choosingFolder.set(false);
      if (selection) await this.loadFolder(selection);
      else { input.value = ''; input.click(); }
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      // Sandboxed/embedded browsers can deny the newer picker while allowing directory input.
      if (failure instanceof DOMException && failure.name === 'SecurityError') { input.value = ''; input.click(); return; }
      this.state.error.set('Nie udało się otworzyć folderu. Spróbuj ponownie lub użyj wyboru folderu przez przeglądarkę.');
    } finally { this.state.choosingFolder.set(false); }
  }
  async filesChosen(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
    try { await this.loadFolder(selectionFromFiles(Array.from(input.files))); }
    catch (failure) { this.state.error.set(failure instanceof Error ? failure.message : 'Nie udało się otworzyć folderu.'); }
    input.value = '';
  }
  private async loadFolder(selection: RepositorySelection): Promise<void> {
    await this.state.loadFolder(selection);
    await this.openSavedInput();
  }
  private async openSavedInput(): Promise<void> {
    const snapshot = this.state.snapshot();
    if (snapshot && this.state.filesSaved() && this.router.url !== `/repositories/${snapshot.repositoryId}/inputs/${snapshot.id}`) {
      await this.router.navigate(['/repositories', snapshot.repositoryId, 'inputs', snapshot.id]);
    }
  }
  async toggleFile(path: string, selected: boolean): Promise<void> {
    await this.state.toggle(path, selected);
    await this.openSavedInput();
  }
  async selectFiles(selected: boolean): Promise<void> {
    await this.state.selectAll(selected);
    await this.openSavedInput();
  }
  openFile(file: RepositoryFile): void {
    const preview = this.state.preview();
    const packetFile = preview?.packet.files.find(item => item.path === file.path);
    this.dialog.open<StandardizationFileDialogComponent, StandardizationFileDialogData>(StandardizationFileDialogComponent, {
      width: '1000px', maxWidth: '94vw', maxHeight: '90vh',
      data: {file, packetFile, preview, result: this.state.result()}
    });
  }
  openReportFile(entry: ReportEntry): void {
    const file = this.state.files().find(file => file.path === entry.path);
    if (file) { this.openFile(file); return; }
    this.openFile({path: entry.path, category: 'CONTEXT', content: entry.content, bytes: entry.bytes,
      redacted: entry.redacted, selected: false, error: entry.readable ? undefined : 'Treść nieodczytana',
      read: async () => new File([entry.content], entry.path)});
  }
  openAssessment(id: string): void {
    const packet = this.state.preview()?.packet;
    const target = packet?.targets.find(item => item.id === id);
    const path = packet?.files.find(item => item.id === target?.fileId)?.path;
    const file = this.state.files().find(item => item.path === path);
    if (file) this.openFile(file);
  }
  size(bytes: number): string { return new Intl.NumberFormat('pl-PL', {maximumFractionDigits: 1}).format(bytes / 1024) + ' KiB'; }
}
