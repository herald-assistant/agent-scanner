import {ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {NotificationService} from '../../core/notification.service';
import {OptimizationGuidanceService} from '../../core/optimization-guidance.service';
import {matchOptimizationTechniques} from '../../core/optimization-technique-matcher';
import {AdvicePreviewComponent} from './advice-preview.component';
import {AdviceResultComponent} from './advice-result.component';
import {
  OptimizationAdvicePreview,
  OptimizationAdvicePreviewRequest,
  OptimizationAdviceResult,
  OptimizationGuidanceContext,
  OptimizationGuidanceEvidence,
  OptimizationGuidanceEvidenceOpenRequest,
  OptimizationTechnique,
  OptimizationTechniqueCatalog,
  OptimizationTopic,
  TechniqueApplicationPoint,
  TechniqueSetupLevel
} from '../../models/optimization-guidance.models';

type GuideTopicId = 'ALL' | 'GOAL' | 'DATA' | 'HANDOFF' | 'QUALITY' | 'CONTEXT';

interface GuideTopic {
  id: GuideTopicId;
  label: string;
  icon: string;
  topics: OptimizationTopic[];
}

const GUIDE_TOPICS: GuideTopic[] = [
  {id: 'ALL', label: 'Wszystkie', icon: 'apps', topics: []},
  {id: 'GOAL', label: 'Cel i polecenie', icon: 'target', topics: ['GENERAL', 'RESPOND', 'OTHER', 'UNKNOWN']},
  {id: 'DATA', label: 'Pozyskiwanie danych', icon: 'search', topics: ['ACQUIRE_DATA']},
  {id: 'HANDOFF', label: 'Przekazywanie wyników', icon: 'move_down', topics: ['WRITE_INTERMEDIATE', 'WRITE_FINAL', 'DELEGATE']},
  {id: 'QUALITY', label: 'Weryfikacja', icon: 'verified', topics: ['VALIDATE', 'MODIFY']},
  {id: 'CONTEXT', label: 'Kontekst', icon: 'compress', topics: ['MANAGE_CONTEXT', 'CONTEXT_COMPACTION']}
];

const TECHNIQUE_CATALOG_ORDER = Array.from(
  {length: 16},
  (_, index) => `T${String(index + 1).padStart(2, '0')}`
);
const TECHNIQUE_CATALOG_POSITION = new Map(
  TECHNIQUE_CATALOG_ORDER.map((id, index) => [id, index])
);

@Component({
  selector: 'as-optimization-guidance',
  imports: [MatIconModule, MatTooltipModule, AdvicePreviewComponent, AdviceResultComponent],
  templateUrl: './optimization-guidance.component.html',
  styleUrl: './optimization-guidance.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OptimizationGuidanceComponent {
  private readonly guidance = inject(OptimizationGuidanceService);
  private readonly notifications = inject(NotificationService);
  readonly catalogState = signal<OptimizationTechniqueCatalog | undefined>(undefined);
  readonly context = input<OptimizationGuidanceContext | undefined>(undefined);
  readonly advicePreview = input<OptimizationAdvicePreview | undefined>(undefined);
  readonly advicePreviewLoading = input(false);
  readonly adviceResult = input<OptimizationAdviceResult | undefined>(undefined);
  readonly adviceLoading = input(false);
  readonly evidenceSelected = output<OptimizationGuidanceEvidenceOpenRequest>();
  readonly advicePreviewRequested = output<OptimizationAdvicePreviewRequest>();
  readonly adviceRequested = output<OptimizationAdvicePreview>();
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly selectedTopic = signal<GuideTopicId>('ALL');
  readonly selectedTechniqueId = signal<string | undefined>(undefined);
  readonly contextualMode = signal(false);
  readonly topics = GUIDE_TOPICS;
  readonly contextualTechniques = computed(() => {
    const context = this.context();
    return context ? matchOptimizationTechniques(context.topics, this.catalogState()?.techniques ?? []) : [];
  });
  readonly advicePreviewEligible = computed(() => {
    const context = this.context();
    if (context?.kind === 'PHASE') return context.evidence.some(item => item.kind === 'ROUND');
    return context?.kind === 'COMPACTION' && context.evidence.filter(item => item.kind === 'COMPACTION').length === 1;
  });
  readonly filteredTechniques = computed(() => {
    const techniques = [...(this.catalogState()?.techniques ?? [])]
      .sort((left, right) => {
        const leftOrder = TECHNIQUE_CATALOG_POSITION.get(left.id) ?? TECHNIQUE_CATALOG_ORDER.length;
        const rightOrder = TECHNIQUE_CATALOG_POSITION.get(right.id) ?? TECHNIQUE_CATALOG_ORDER.length;
        return leftOrder - rightOrder
          || left.id.localeCompare(right.id);
      });
    if (this.contextualMode() && this.context()) return this.contextualTechniques();
    const topic = GUIDE_TOPICS.find(candidate => candidate.id === this.selectedTopic());
    if (!topic || topic.id === 'ALL') return techniques;
    return techniques.filter(technique => technique.topics.some(value => topic.topics.includes(value)));
  });
  readonly selectedTechnique = computed(() => {
    const catalog = this.catalogState();
    if (!catalog) return undefined;
    return catalog.techniques.find(technique => technique.id === this.selectedTechniqueId())
      ?? this.filteredTechniques()[0];
  });

  private appliedContextKey = '';
  private readonly numberFormat = new Intl.NumberFormat('pl-PL', {maximumFractionDigits: 3});
  private readonly compactNumberFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact', maximumFractionDigits: 1});

  constructor() {
    effect(() => {
      const catalog = this.catalogState();
      const context = this.context();
      if (!catalog) return;
      const key = context
        ? `${context.kind}:${context.title}:${context.scopeLabel}:${context.topics.join(',')}`
        : 'GENERAL';
      if (key === this.appliedContextKey) return;
      this.appliedContextKey = key;
      this.contextualMode.set(!!context);
      this.selectedTopic.set('ALL');
      this.selectedTechniqueId.set(context
        ? matchOptimizationTechniques(context.topics, catalog.techniques)[0]?.id
        : catalog.techniques.find(technique => technique.id === 'T03')?.id ?? catalog.techniques[0]?.id);
    });
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const catalog = await this.guidance.load();
      this.catalogState.set(catalog);
      if (!this.context() && !this.selectedTechniqueId() && catalog.techniques.length) {
        this.selectedTechniqueId.set(catalog.techniques.find(technique => technique.id === 'T03')?.id ?? catalog.techniques[0].id);
      }
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  selectTopic(topic: GuideTopicId): void {
    this.contextualMode.set(false);
    this.selectedTopic.set(topic);
    const current = this.selectedTechnique();
    const first = this.filteredTechniques()[0];
    if (!current || !this.filteredTechniques().some(technique => technique.id === current.id)) {
      this.selectedTechniqueId.set(first?.id);
    }
  }

  selectContextualRecommendations(): void {
    this.contextualMode.set(true);
    this.selectedTechniqueId.set(this.contextualTechniques()[0]?.id);
  }

  selectTechnique(technique: OptimizationTechnique): void {
    this.selectedTechniqueId.set(technique.id);
  }

  openEvidence(evidence: OptimizationGuidanceEvidence, origin: EventTarget | null): void {
    this.evidenceSelected.emit({evidence, origin});
  }

  prepareAdvicePreview(): void {
    const context = this.context();
    const catalog = this.catalogState();
    if (!context || !catalog || !this.advicePreviewEligible() || this.advicePreviewLoading()) return;
    this.advicePreviewRequested.emit({
      context,
      catalogVersion: catalog.version,
      candidateTechniqueIds: this.contextualTechniques().slice(0, 3).map(technique => technique.id)
    });
  }

  topicCount(topic: GuideTopic): number {
    const techniques = this.catalogState()?.techniques ?? [];
    return topic.id === 'ALL'
      ? techniques.length
      : techniques.filter(technique => technique.topics.some(value => topic.topics.includes(value))).length;
  }

  relatedTechnique(id: string): OptimizationTechnique | undefined {
    return this.catalogState()?.techniques.find(technique => technique.id === id);
  }

  applicationPointLabel(point: TechniqueApplicationPoint): string {
    const labels: Record<TechniqueApplicationPoint, string> = {
      PROMPT: 'polecenie',
      PROJECT_INSTRUCTIONS: 'instrukcje projektu',
      SKILL: 'skill',
      AGENT_ROLE: 'rola agenta',
      TOOL_CODE: 'kod narzędzia',
      PROJECT_MAP: 'mapa projektu',
      ARTIFACT_PIPELINE: 'przepływ artefaktów',
      SESSION_STRATEGY: 'podział sesji',
      MODEL_OR_RUNTIME_CONFIG: 'konfiguracja modelu lub runtime'
    };
    return labels[point];
  }

  setupLabel(level: TechniqueSetupLevel): string {
    const labels: Record<TechniqueSetupLevel, string> = {
      NONE: 'bez wdrożenia technicznego',
      SMALL: 'małe wdrożenie',
      MEDIUM: 'średnie wdrożenie',
      LARGE: 'duże wdrożenie'
    };
    return labels[level];
  }

  credits(value: number): string { return this.numberFormat.format(value); }
  percent(value: number): string { return this.numberFormat.format(value); }
  tokens(value: number): string { return this.compactNumberFormat.format(value); }

  async copyTrialPlan(technique: OptimizationTechnique): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.trialPlan(technique));
      this.notifications.success('Plan próby skopiowany do schowka.');
    } catch {
      this.notifications.error('Nie udało się skopiować planu próby.');
    }
  }

  trialPlan(technique: OptimizationTechnique): string {
    const numbered = (items: string[]): string => items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    const bullets = (items: string[]): string => items.map(item => `- ${item}`).join('\n');
    return [
      `Próba optymalizacyjna: ${technique.title} (${technique.id})`,
      '',
      'Problem do rozwiązania',
      technique.explanation,
      '',
      'Oczekiwany rezultat',
      technique.mechanism,
      '',
      'Cel i kryterium próby',
      technique.firstExperimentGoal,
      '',
      'Prostszy wariant',
      technique.simplerAlternative,
      '',
      'Kroki',
      numbered(technique.firstExperiment),
      '',
      'Przykład — obecnie',
      technique.example.before,
      '',
      'Przykład — wariant do przetestowania',
      technique.example.after,
      '',
      'Jak sprawdzić rezultat — porównaj przed i po',
      bullets(technique.compare),
      '',
      'Rezultat jest akceptowalny, jeśli',
      bullets(technique.qualityChecks),
      '',
      `Nakład: ${this.setupLabel(technique.setup.level)}`,
      bullets(technique.setup.tasks),
      '',
      'Utrzymanie',
      bullets(technique.maintenance.tasks),
      '',
      'Wróć do decyzji, gdy',
      bullets(technique.maintenance.triggers)
    ].join('\n');
  }
}
