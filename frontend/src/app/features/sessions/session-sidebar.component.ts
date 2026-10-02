import {ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {Session} from '../../models/scanner.models';
import {FeatureAvailability} from '../../core/feature-availability.service';
import {StandardRepositorySummary} from '../../models/standardization.models';
import {sessionEmitterLabel, sessionRepositoryName, sessionSourceIcon, sessionSourceLabel} from '../../core/session-presentation';

@Component({
  selector: 'as-session-sidebar',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './session-sidebar.component.html',
  styleUrl: './session-sidebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionSidebarComponent {
  readonly features = inject(FeatureAvailability);
  readonly sessions = input.required<Session[]>();
  readonly selectedSessionId = input<number>();
  readonly selectedTurnCount = input(0);
  readonly retentionDays = input.required<number>();
  readonly importing = input(false);
  readonly canClear = input(false);
  readonly repositories = input<StandardRepositorySummary[]>([]);
  readonly repositoryError = input('');
  readonly selectedRepositoryId = input<string | null>(null);
  readonly selectedAnalysisId = input<string | null>(null);

  readonly sessionSelected = output<Session>();
  readonly fileSelected = output<File>();
  readonly clearAll = output<void>();
  readonly newRepositoryAnalysis = output<void>();
  readonly analysisSelected = output<{repositoryId: string; analysisId: string}>();
  readonly refreshRepositories = output<void>();

  readonly repositoriesExpanded = signal(true);
  readonly analysisLimit = signal(5);
  readonly analyses = computed(() => this.repositories()
    .flatMap(repository => [
      ...repository.analyses.map(analysis => ({repositoryId: repository.id, repositoryName: repository.name,
        analysis: {...analysis, date: analysis.analyzedAt, input: false}})),
      ...(repository.snapshots ?? []).map(snapshot => ({repositoryId: repository.id, repositoryName: repository.name,
        analysis: {...snapshot, date: snapshot.savedAt, model: '', input: true}}))
    ])
    .sort((left, right) => right.analysis.date.localeCompare(left.analysis.date)
      || left.repositoryName.localeCompare(right.repositoryName) || left.analysis.id.localeCompare(right.analysis.id)));
  readonly visibleAnalyses = computed(() => this.analyses().slice(0, this.analysisLimit()));

  constructor() {
    effect(() => {
      const selected = this.selectedAnalysisId();
      const repository = this.selectedRepositoryId();
      const index = this.analyses().findIndex(item => selected ? item.analysis.id === selected
        : item.repositoryId === repository);
      if (index >= this.analysisLimit()) this.analysisLimit.set(Math.ceil((index + 1) / 5) * 5);
    });
  }

  isAnalysisActive(entry: {repositoryId: string; analysis: {id: string}}): boolean {
    const selected = this.selectedAnalysisId();
    return selected === entry.analysis.id || (!selected && this.selectedRepositoryId() === entry.repositoryId
      && (this.repositories().find(repository => repository.id === entry.repositoryId)?.analyses[0]?.id
        ?? this.repositories().find(repository => repository.id === entry.repositoryId)?.snapshots?.[0]?.id) === entry.analysis.id);
  }

  private readonly compactNumber = new Intl.NumberFormat('pl-PL', {notation: 'compact'});
  private readonly pluralRules = new Intl.PluralRules('pl-PL');
  private readonly timeFormat = new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.fileSelected.emit(file);
    input.value = '';
  }

  turnCount(session: Session): number {
    return session.id === this.selectedSessionId() ? this.selectedTurnCount() : session.turnCount;
  }

  title(session: Session): string {
    return sessionRepositoryName(session) || (session.sourceKind === 'vscode' ? 'Sesja bez danych repozytorium' : session.agentName || 'Sesja agenta');
  }
  sourceLabel(session: Session): string { return sessionSourceLabel(session); }
  sourceDetails(session: Session): string | undefined { return sessionEmitterLabel(session); }
  sourceIcon(session: Session): string { return sessionSourceIcon(session); }
  model(session: Session): string { return session.responseModel || session.requestedModel || 'model —'; }
  tokens(session: Session): string { return this.compactNumber.format(session.inputTokens + session.outputTokens); }
  files(count: number): string {
    const form = this.pluralRules.select(count);
    return `${count} ${form === 'one' ? 'plik' : form === 'few' ? 'pliki' : 'plików'}`;
  }
  time(value?: string): string { return value ? this.timeFormat.format(new Date(value)) : '—'; }
}
