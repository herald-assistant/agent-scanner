import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {DatePipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MatDialog} from '@angular/material/dialog';
import {Router} from '@angular/router';
import {StandardizationStateService} from '../../core/standardization-state.service';
import {StandardizationHistoryService} from '../../core/standardization-history.service';
import {pickRepository, RepositoryFile, selectionFromFiles} from '../../core/standardization-files';
import {StandardCategory} from '../../models/standardization.models';
import {StandardizationFileDialogComponent, StandardizationFileDialogData} from './standardization-file-dialog.component';

export const CATEGORY_LABELS: Record<StandardCategory, string> = {
  INSTRUCTIONS: 'Instrukcje', SKILLS: 'Skills', AGENTS: 'Agenci', MCP: 'MCP', PROMPTS: 'Prompty', CONTEXT: 'Materiały konfiguracji'
};
@Component({
  selector: 'as-standardization',
  imports: [DatePipe, MatIconModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './standardization.component.html',
  styleUrl: './standardization.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StandardizationComponent {
  readonly state = inject(StandardizationStateService);
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
  constructor() { void this.state.initialize(); }

  async runAnalysis(): Promise<void> {
    if (!this.state.canPrepare()) return;
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
      if (selection) await this.state.loadFolder(selection);
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
    try { await this.state.loadFolder(selectionFromFiles(Array.from(input.files))); }
    catch (failure) { this.state.error.set(failure instanceof Error ? failure.message : 'Nie udało się otworzyć folderu.'); }
    input.value = '';
  }
  openFile(file: RepositoryFile): void {
    const preview = this.state.preview();
    const packetFile = preview?.packet.files.find(item => item.path === file.path);
    this.dialog.open<StandardizationFileDialogComponent, StandardizationFileDialogData>(StandardizationFileDialogComponent, {
      width: '1000px', maxWidth: '94vw', maxHeight: '90vh',
      data: {file, packetFile, preview, result: this.state.result()}
    });
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
