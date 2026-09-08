import {NgTemplateOutlet} from '@angular/common';
import {ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, TemplateRef, viewChild} from '@angular/core';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {Metric, RoundObservation, WorkflowAnalysis, WorkflowStream} from '../../models/workflow.models';
import {known, ordered} from '../../core/workflow/telemetry';
import {estimateClassificationTokens, flowToolCatalog} from '../../core/flow-tool-catalog';
import {ToolClassificationService} from '../../core/tool-classification.service';
import {NotificationService} from '../../core/notification.service';
import {ROUND_CATEGORIES, SPECIALIZATIONS} from './tool-category-labels';
import {ACTIONS, ActionCategory, RoundCategory, ToolSpecialization} from '../../models/tool-classification.models';
import {actionCategory, actionsByRound, agentActionProfile, modelActionEvidence} from '../../core/model-action-evidence';
import {RoundDetailsPanelOpenMode, RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {estimateActionCredits} from '../../core/action-credit-attribution';
import {ContextCompactionMeasurement, SessionDetail} from '../../models/scanner.models';
import {ContextCompactionDetailsComponent} from '../context-compaction/context-compaction-details.component';
import {OptimizationAdvicePreview, OptimizationAdvicePreviewRequest, OptimizationGuidanceContext, OptimizationGuidanceEvidence, OptimizationGuidanceOpenRequest, OptimizationTopic} from '../../models/optimization-guidance.models';
import {GroupedWorkflowPhase, groupWorkflowPhases, WorkflowPhaseCompactionInput} from '../../core/workflow-phases';
import {buildGuidanceEvidencePreview} from '../../core/optimization/guidance-evidence';
import {buildRoundDiscussionEvidence} from '../../core/optimization/round-discussion-evidence';

const OPTIMIZATION_HINTS: Record<ActionCategory, string> = {
  ACQUIRE_DATA: 'Sprawdź rozmiar wyników narzędzi, możliwość zwracania krótszych wycinków oraz użycie indeksu, repo mapy lub narzędzia wyspecjalizowanego w tym zadaniu.',
  MODIFY: 'Sprawdź, czy zmiany można grupować w mniej żądań i czy narzędzie pozwala precyzyjnie wskazać zakres modyfikacji.',
  WRITE_INTERMEDIATE: 'Sprawdź, czy pełny rezultat pośredni musi wracać do rozmowy, czy wystarczy zapisać artefakt i przekazać krótką referencję.',
  WRITE_FINAL: 'Sprawdź, czy końcowy zapis odbywa się jednym precyzyjnym żądaniem i nie powiela wcześniej przesłanej treści.',
  VALIDATE: 'Sprawdź, czy walidacja może korzystać z testu lub narzędzia ograniczonego do zmienionego obszaru zamiast ponownego analizowania całego projektu.',
  DELEGATE: 'Sprawdź zakres zleceń subagentów, wielkość ich zwrotów oraz czy równoległe zadania nie powielają pozyskiwania tych samych danych.',
  MANAGE_CONTEXT: 'Sprawdź, które dane są zachowywane po kompaktowaniu i czy długie wyniki można zastąpić krótkim podsumowaniem lub referencją.',
  RESPOND: 'Sprawdź wymaganą długość i format odpowiedzi oraz czy agent nie tworzy kilku podobnych podsumowań.',
  OTHER: 'Otwórz przypisane rundy i doprecyzuj kategorię działania przed formułowaniem rekomendacji.',
  UNKNOWN: 'Brakuje wystarczających danych do rekomendacji. Najpierw sprawdź treść odpowiedzi modelu i definicję wywołanego narzędzia.'
};
const TOOL_SPECIALIZATION_TOOLTIPS: Record<ToolSpecialization, string> = {
  GENERAL_PURPOSE: 'Narzędzia uniwersalne, np. terminal, odczyt pliku, grep lub listowanie. Jeśli dominują w fazie o wysokim zużyciu credits, otwórz jej rundy i sprawdź, czy powtarzalne kroki można opisać skillem albo zastąpić narzędziem celowanym. Sam udział nie dowodzi nieefektywności.',
  DOMAIN_SPECIFIC: 'Narzędzia domenowe rozumieją konkretny rodzaj danych, np. symbole kodu lub API repozytorium. Otwórz rundy i sprawdź, czy zwracają tylko informacje potrzebne modelowi, bez szerokich wyników zwiększających kolejny input.',
  TASK_SPECIFIC: 'Narzędzia dedykowane konkretnej operacji mogą ograniczyć liczbę kroków i rozmiar wyników. Sam procent nie dowodzi oszczędności; porównaj credits fazy oraz dane przekazane w jej rundach.',
  UNKNOWN: 'Nie udało się jednoznacznie ustalić specjalizacji, zwykle z powodu brakującej lub niejednoznacznej definicji. Przed oceną optymalizacji sprawdź nazwę, definicję i argumenty narzędzia w odpowiedniej rundzie.'
};

type ChartTone = 'context-series' | 'credits-series' | 'fresh-series' | 'cache-series' | 'output-series' | 'write-series';
interface ChartPoint { round: RoundObservation; x: number; y: number; label: string; }
interface ChartSeries { id: string; label: string; tone: ChartTone; paths: string[]; points: ChartPoint[]; missingX: number[]; total?: number; coverage: string; }
interface LayerChart {
  title: string;
  scope: string;
  unit: string;
  ariaLabel: string;
  series: ChartSeries[];
  missingX: number[];
  showPointLabels: boolean;
}
interface PhaseToolShare { specialization: ToolSpecialization; label: string; percent: number; }
interface AggregatedPhase extends GroupedWorkflowPhase {
  toolShares: PhaseToolShare[];
  toolMixLabel: string;
  creditStrength: string;
}
interface CreditCategorySummary {
  id: string;
  action?: ActionCategory;
  label: string;
  icon: string;
  totalCredits: number | null;
  shareOfKnown: number | null;
  estimated: boolean;
  hint: string;
  coveredCalls: number;
  totalCalls: number;
}

@Component({
  selector: 'as-workflow-view',
  imports: [NgTemplateOutlet, MatDialogModule, MatIconModule, MatTooltipModule, ContextCompactionDetailsComponent],
  templateUrl: './workflow-view.component.html', styleUrl: './workflow-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorkflowViewComponent {
  readonly analysis = input.required<WorkflowAnalysis>();
  readonly refreshing = input(false);
  readonly contextCompactions = input<ContextCompactionMeasurement[]>([]);
  readonly relatedDetails = input<SessionDetail[]>([]);
  readonly creditTooltip = input('GitHub Copilot AI credits wyemitowane w telemetrii. To zużycie kredytów, nie kwota pieniężna.');
  readonly optimizationGuide = output<OptimizationGuidanceOpenRequest>();
  private readonly dialog = inject(MatDialog);
  private readonly detailsPanel = inject(RoundDetailsPanelService);
  private readonly selection = signal<{session: number; ref: string} | undefined>(undefined);
  private readonly interactionSelection = signal<{session: number; trace: string} | undefined>(undefined);
  readonly roundRangeMode = signal(false);
  private readonly rangeAnchor = signal<string | undefined>(undefined);
  private readonly rangeEnd = signal<string | undefined>(undefined);
  readonly buildingDiscussion = signal(false);
  readonly layer = signal<'context' | 'tokens' | 'credits'>('context');
  readonly detailedMap = signal(true);
  readonly mapDragging = signal(false);
  readonly aiVisible = signal(false);
  readonly restoringClassification = signal(false);
  readonly analysisMenuCompact = signal(false);
  readonly analysisMenuFrame = signal({left: 0, width: 0});
  readonly analysisMenuExpandedHeight = signal(0);
  private restoredScope = '';
  private viewChosen = false;
  private readonly mapScroll = viewChild<ElementRef<HTMLDivElement>>('mapScroll');
  private readonly analysisMenuSentinel = viewChild<ElementRef<HTMLElement>>('analysisMenuSentinel');
  private readonly analysisMenu = viewChild<ElementRef<HTMLElement>>('analysisMenu');
  private readonly compactionBody = viewChild.required<TemplateRef<unknown>>('compactionBody');
  private mapDrag?: {pointerId: number; startX: number; scrollLeft: number};
  constructor() {
    effect(onCleanup => {
      const sentinel = this.analysisMenuSentinel()?.nativeElement;
      const menu = this.analysisMenu()?.nativeElement;
      if (!sentinel || !menu || typeof IntersectionObserver === 'undefined') return;
      const updateMeasurements = () => {
        const rect = sentinel.getBoundingClientRect();
        this.analysisMenuFrame.set({left: rect.left, width: rect.width});
        if (!this.analysisMenuCompact()) {
          const height = menu.getBoundingClientRect().height;
          if (height > 0) this.analysisMenuExpandedHeight.set(height);
        }
      };
      const observer = new IntersectionObserver(([entry]) => {
        updateMeasurements();
        this.analysisMenuCompact.set(!entry.isIntersecting);
      }, {
        rootMargin: '-68px 0px 0px 0px', threshold: 0
      });
      observer.observe(sentinel);
      updateMeasurements();
      const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateMeasurements);
      resizeObserver?.observe(sentinel);
      resizeObserver?.observe(menu);
      onCleanup(() => {
        observer.disconnect();
        resizeObserver?.disconnect();
      });
    });
    effect(() => {
      const sessionId = this.analysis().source.session.id;
      const catalog = this.catalog();
      const scope = `${sessionId}:${catalog.key}`;
      if (scope === this.restoredScope) return;
      this.restoredScope = scope;
      this.viewChosen = false;
      this.aiVisible.set(false);
      this.detailedMap.set(true);
      this.restoringClassification.set(true);
      void this.classification.restore(sessionId, catalog).then(restored => {
        if (scope === this.restoredScope && restored && !this.viewChosen) this.aiVisible.set(true);
      }).catch(error => {
        if (scope === this.restoredScope) this.notifications.error(error instanceof Error ? error.message : 'Nie udało się odczytać zapisanej analizy.');
      }).finally(() => { if (scope === this.restoredScope) this.restoringClassification.set(false); });
    });
  }
  startMapDrag(event: PointerEvent): void {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest('button, a, input, summary, [role="button"]')) return;
    const element = this.mapScroll()?.nativeElement;
    if (!element) return;
    this.mapDrag = {pointerId: event.pointerId, startX: event.clientX, scrollLeft: element.scrollLeft};
    this.mapDragging.set(true);
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }
  moveMapDrag(event: PointerEvent): void {
    const drag = this.mapDrag, element = this.mapScroll()?.nativeElement;
    if (!drag || drag.pointerId !== event.pointerId || !element) return;
    element.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    event.preventDefault();
  }
  endMapDrag(event: PointerEvent): void {
    const drag = this.mapDrag, element = this.mapScroll()?.nativeElement;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (element?.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    this.mapDrag = undefined;
    this.mapDragging.set(false);
  }
  revealSelected(): void {
    const selected = this.selected(), element = this.mapScroll()?.nativeElement;
    if (selected && element) {
      element.scrollTo({left: Math.max(0, this.x(selected) - (element.clientWidth - 176) / 2), behavior: 'auto'});
    }
  }
  private readonly classification = inject(ToolClassificationService);
  private readonly notifications = inject(NotificationService);
  readonly roundCategories = ROUND_CATEGORIES;
  readonly catalog = computed(() => flowToolCatalog(this.analysis()));
  readonly compactionsBeforeInteraction = computed(() => {
    const interactionIndex = this.interaction()?.round.turn.interactionIndex;
    return interactionIndex == null ? [] : this.contextCompactions().filter(compaction => compaction.afterInteractionIndex === interactionIndex)
      .sort((left, right) => this.timestamp(left.startedAt) - this.timestamp(right.startedAt));
  });
  readonly trailingCompactions = computed(() => {
    const currentIndex = this.interaction()?.round.turn.interactionIndex;
    const lastIndex = this.interactions().at(-1)?.round.turn.interactionIndex;
    return currentIndex != null && currentIndex === lastIndex
      ? this.contextCompactions().filter(compaction => compaction.placementBeforeModelId == null)
        .sort((left, right) => this.timestamp(left.startedAt) - this.timestamp(right.startedAt))
      : [];
  });
  readonly visibleCompactions = computed(() => {
    const unique = new Map<string, ContextCompactionMeasurement>();
    [...this.compactionsBeforeInteraction(), ...this.trailingCompactions()].forEach(compaction => unique.set(compaction.id, compaction));
    return [...unique.values()];
  });
  readonly classificationEstimate = computed(() => estimateClassificationTokens(this.catalog().request));
  readonly classificationEstimateTooltip = computed(() => {
    const estimate = this.classificationEstimate();
    const cached = this.hasAiResult() ? ' Analiza jest już zapisana; przełącznik widoku pokaże kategorie bez kolejnego zapytania.' : '';
    return `Szacunek pierwszej analizy: do modelu ≈ ${this.compact(estimate.input)} tokenów, odpowiedź ≈ ${this.compact(estimate.output)} (dłuższy wariant ≈ ${this.compact(estimate.outputMax)}). Estymacja znaków/4; rzeczywiste naliczenie zależy od modelu.${cached}`;
  });
  readonly aiResult = computed(() => this.aiVisible() ? this.classification.result(this.analysis().source.session.id, this.catalog()) : undefined);
  readonly detailedMapVisible = computed(() => !this.aiResult() || this.detailedMap());
  readonly hasAiResult = computed(() => this.classification.hasResult(this.analysis().source.session.id, this.catalog()));
  readonly classifying = computed(() => !!this.classification.pending());
  readonly roundActions = computed(() => actionsByRound(this.catalog(), this.aiResult()));
  readonly actionEvidence = computed(() => modelActionEvidence(this.analysis(), this.catalog()));
  readonly aggregatedPhases = computed<AggregatedPhase[]>(() => {
    const catalog = this.catalog();
    const toolSpecializations = new Map(this.aiResult()?.tools.map(tool => [tool.id, tool.specialization]) ?? []);
    const usagesByRound = new Map<string, ToolSpecialization[]>();
    for (const usage of catalog.usages) {
      const values = usagesByRound.get(usage.roundRef) ?? [];
      values.push(usage.toolId ? toolSpecializations.get(usage.toolId) ?? 'UNKNOWN' : 'UNKNOWN');
      usagesByRound.set(usage.roundRef, values);
    }
    const subagentNumbers = new Map(this.lanes().slice(1).map((lane, index) => [lane.stream.id, index + 1]));
    const rounds = this.columns().map(round => {
      const actions = this.roundActions().get(round.ref) ?? [];
      const signature = actions.join('+') || 'UNMAPPED';
      const roundLabel = this.phaseRoundLabel(round, subagentNumbers);
      const hasSubagent = subagentNumbers.has(round.streamId);
      const actorLabel = hasSubagent ? `Subagent ${subagentNumbers.get(round.streamId)}` : 'Główny agent';
      const roundCredits = known(round.credits);
      return {round, signature, label: actions.length ? this.actionLabels(actions) : ROUND_CATEGORIES.UNMAPPED.label,
        icon: ROUND_CATEGORIES[actionCategory(actions)].icon, roundLabel, actorLabel, hasSubagent,
        credits: roundCredits ?? null, toolSpecializations: [...(usagesByRound.get(round.ref) ?? [])]};
    });
    const phases = groupWorkflowPhases(
      rounds,
      this.compactionsBeforeInteraction().map(compaction => this.compactionPhaseInput(compaction)),
      this.trailingCompactions().map(compaction => this.compactionPhaseInput(compaction))
    );
    const maxCredits = Math.max(0, ...phases.map(phase => phase.credits ?? 0));
    return phases.map(phase => {
      const toolShares = this.phaseToolShares(phase.toolSpecializations);
      return {...phase, toolShares,
        toolMixLabel: phase.compaction ? 'Fakt z telemetrii, poza zakresem analizy AI' : toolShares.length
          ? `Specjalizacja żądanych narzędzi: ${toolShares.map(share => `${share.label} ${share.percent}%`).join(', ')}`
          : 'Model nie zażądał narzędzia w tej fazie',
        creditStrength: phase.credits !== null && maxCredits > 0
          ? `${Math.round(14 + phase.credits / maxCredits * 46)}%`
          : '0%'};
    });
  });
  readonly classifiedRoundCount = computed(() => this.columns().filter(round => (this.roundActions().get(round.ref)?.length ?? 0) > 0).length);
  readonly creditAttribution = computed(() => {
    const result = this.aiResult();
    return result ? estimateActionCredits(this.analysis(), this.catalog(), result, this.columns()) : undefined;
  });
  readonly actionSummary = computed(() => {
    const actions = this.roundActions(), mainStreamId = this.root().id;
    const credits = new Map(this.creditAttribution()?.categories.map(item => [item.action, item]) ?? []);
    return ACTIONS.flatMap((action, order) => {
      const rounds = this.columns().filter(round => actions.get(round.ref)?.includes(action));
      return rounds.length ? [{action, order, rounds, count: rounds.length,
        mainCount: rounds.filter(round => round.streamId === mainStreamId).length,
        subagentCount: rounds.filter(round => round.streamId !== mainStreamId).length,
        credit: credits.get(action)}] : [];
    }).sort((left, right) => (right.credit?.totalCredits ?? -1) - (left.credit?.totalCredits ?? -1) || right.count - left.count || left.order - right.order);
  });
  readonly compactionCreditSummary = computed(() => {
    const values = this.visibleCompactions().map(compaction => compaction.credits).filter((value): value is number => value != null && Number.isFinite(value));
    return {knownCredits: values.length ? values.reduce((total, value) => total + value, 0) : null,
      coveredCalls: values.length, totalCalls: this.visibleCompactions().length};
  });
  readonly analyzedCreditScope = computed(() => {
    const actions = this.creditAttribution(), compactions = this.compactionCreditSummary();
    if (!actions) return undefined;
    const coveredCalls = actions.coveredCalls + compactions.coveredCalls;
    const compactionCredits = compactions.knownCredits ?? 0;
    return {knownCredits: coveredCalls ? (actions.knownCredits ?? 0) + compactionCredits : null,
      assignedCredits: coveredCalls ? (actions.assignedCredits ?? 0) + compactionCredits : null,
      unattributedCredits: coveredCalls ? actions.unattributedCredits ?? 0 : null,
      coveredCalls, totalCalls: actions.totalCalls + compactions.totalCalls};
  });
  readonly creditCategories = computed<CreditCategorySummary[]>(() => {
    const knownCredits = this.analyzedCreditScope()?.knownCredits;
    const attribution = this.creditAttribution();
    const rows: CreditCategorySummary[] = this.actionSummary().map(item => {
      const totalCredits = item.credit?.totalCredits ?? null;
      return {id: item.action, action: item.action, label: ROUND_CATEGORIES[item.action].label, icon: ROUND_CATEGORIES[item.action].icon,
        totalCredits, shareOfKnown: totalCredits != null && knownCredits != null && knownCredits > 0 ? totalCredits / knownCredits * 100 : null,
        estimated: true, hint: OPTIMIZATION_HINTS[item.action], coveredCalls: attribution?.coveredCalls ?? 0,
        totalCalls: attribution?.totalCalls ?? this.columns().length};
    });
    if (this.visibleCompactions().length) {
      const totalCredits = this.compactionCreditSummary().knownCredits;
      rows.push({id: 'CONTEXT_COMPACTION', label: 'Kompaktowanie kontekstu', icon: 'compress', totalCredits,
        shareOfKnown: totalCredits != null && knownCredits != null && knownCredits > 0 ? totalCredits / knownCredits * 100 : null,
        estimated: false, hint: 'Sprawdź koszt wejścia kompaktora, rozmiar utworzonego streszczenia oraz to, czy wynik został wykorzystany w kolejnej interakcji.',
        coveredCalls: this.compactionCreditSummary().coveredCalls, totalCalls: this.compactionCreditSummary().totalCalls});
    }
    return rows.sort((left, right) => (right.totalCredits ?? -1) - (left.totalCredits ?? -1));
  });
  readonly optimizationLead = computed(() => this.creditCategories().find(item => item.action !== 'UNKNOWN' && (item.totalCredits ?? 0) > 0)
    ?? this.creditCategories().find(item => (item.totalCredits ?? 0) > 0));
  readonly agentProfiles = computed(() => new Map(this.lanes().map(lane => [lane.stream.id, agentActionProfile(lane.rounds, this.roundActions())])));
  actionLabels(actions: readonly ActionCategory[]): string {
    return actions.length ? actions.map(action => ROUND_CATEGORIES[action].label).join(' + ') : 'Brak kategorii';
  }
  agentProfile(stream: WorkflowStream) { return this.agentProfiles().get(stream.id) ?? []; }
  openCategoryGuidance(item: CreditCategorySummary, origin?: EventTarget | null): void {
    const categoryRounds = item.action
      ? this.actionSummary().find(summary => summary.action === item.action)?.rounds ?? []
      : [];
    const context: OptimizationGuidanceContext = {
      kind: item.action ? 'CATEGORY' : 'COMPACTION',
      title: item.label,
      scopeLabel: `interakcja ${this.interaction()?.round.turn.interactionIndex ?? '—'}`,
      explanation: item.estimated
        ? 'Kategoria pochodzi z zapisanej analizy AI. Podział credits jest lokalną estymacją opartą na zmierzonych wywołaniach; otwarcie poradnika nie uruchamia kolejnej analizy.'
        : 'Kompaktowanie jest osobnym wywołaniem modelu rozpoznanym w telemetrii. Nie zostało sklasyfikowane przez AI.',
      topics: item.action ? [item.action] : ['CONTEXT_COMPACTION'],
      measurement: {credits: item.totalCredits, shareOfKnown: item.shareOfKnown, creditEstimated: item.estimated,
        coveredCalls: item.coveredCalls, totalCalls: item.totalCalls},
      evidenceLabels: [item.hint, item.estimated ? '≈ oznacza estymację udziału, nie cenę ani gwarantowaną oszczędność.' : 'Credits pochodzą bezpośrednio z telemetrii.'],
      evidence: item.action
        ? categoryRounds.map(round => this.roundGuidanceEvidence(round))
        : this.visibleCompactions().map(compaction => this.compactionGuidanceEvidence(compaction))
    };
    this.optimizationGuide.emit({context, origin: origin ?? null});
  }
  openPhaseGuidance(phase: AggregatedPhase, origin?: EventTarget | null): void {
    const knownCredits = this.analyzedCreditScope()?.knownCredits;
    const shareOfKnown = phase.credits != null && knownCredits != null && knownCredits > 0 ? phase.credits / knownCredits * 100 : null;
    const context: OptimizationGuidanceContext = {
      kind: phase.compaction ? 'COMPACTION' : 'PHASE',
      title: phase.label,
      scopeLabel: `interakcja ${this.interaction()?.round.turn.interactionIndex ?? '—'} · ${this.compactRoundLabels(phase.roundLabels)}`,
      explanation: phase.compaction
        ? 'To faktyczne wywołanie kompaktowania. Pokazane credits i tokeny pochodzą z telemetrii, a techniki są wybierane lokalnie.'
        : 'Faza grupuje sąsiednie rundy z takim samym zestawem kategorii zapisanej analizy AI. Credits są sumą pełnych wywołań w fazie, nie kosztem samej kategorii.',
      topics: this.phaseGuidanceTopics(phase),
      measurement: {credits: phase.credits, shareOfKnown, creditEstimated: false,
        coveredCalls: phase.creditCovered, totalCalls: phase.totalCalls,
        inputTokens: phase.compaction?.inputTokens, outputTokens: phase.compaction?.outputTokens},
      evidenceLabels: phase.compaction
        ? ['Kompaktowanie nie było wysyłane do klasyfikacji AI.', this.compactionReceiptLabel(phase.compaction)]
        : [`Kategorie: ${phase.label}.`, `Rundy: ${this.compactRoundLabels(phase.roundLabels)}.`],
      evidence: phase.compaction
        ? [this.compactionGuidanceEvidence(phase.compaction)]
        : phase.rounds.map(round => this.roundGuidanceEvidence(round))
    };
    this.optimizationGuide.emit({context, origin: origin ?? null});
  }
  openCompactionGuidance(origin?: EventTarget | null): void {
    const compactions = this.visibleCompactions();
    const inputTokens = this.completeSum(compactions.map(item => item.inputTokens));
    const outputTokens = this.completeSum(compactions.map(item => item.outputTokens));
    const credits = this.compactionCreditSummary();
    const context: OptimizationGuidanceContext = {
      kind: 'COMPACTION', title: compactions.length === 1 ? 'Kompaktowanie kontekstu' : `Kompaktowania kontekstu (${compactions.length})`,
      scopeLabel: `interakcja ${this.interaction()?.round.turn.interactionIndex ?? '—'}`,
      explanation: 'Scanner wykrył faktyczne wywołania kompaktowania. Dobór technik odbywa się lokalnie i nie wymaga klasyfikowania rund.',
      topics: ['CONTEXT_COMPACTION'],
      measurement: {credits: credits.knownCredits, creditEstimated: false, coveredCalls: credits.coveredCalls,
        totalCalls: credits.totalCalls, inputTokens, outputTokens},
      evidenceLabels: ['Kompaktowanie pozostaje poza kategoriami AI.', 'Brak późniejszego odbioru nie oznacza błędu, ale nie pozwala ocenić jakości kontynuacji.'],
      evidence: compactions.map(compaction => this.compactionGuidanceEvidence(compaction))
    };
    this.optimizationGuide.emit({context, origin: origin ?? null});
  }
  linkedRoundLabel(round: RoundObservation): string {
    const stream = this.analysis().streams.find(item => item.id === round.streamId);
    return `${stream ? this.streamDisplayLabel(stream) : 'Agent'} · interakcja ${round.turn.interactionIndex} · ${this.roundLabel(round)}`;
  }
  private roundGuidanceEvidence(round: RoundObservation): OptimizationGuidanceEvidence {
    return {kind: 'ROUND', id: round.ref, label: this.linkedRoundLabel(round),
      description: 'Otwórz faktyczny cykl M → A → M: odpowiedź modelu, wykonane działania i dane przekazane do następnego wywołania.'};
  }
  private compactionGuidanceEvidence(compaction: ContextCompactionMeasurement): OptimizationGuidanceEvidence {
    return {kind: 'COMPACTION', id: compaction.id, label: `K${this.compactionNumber(compaction)} · ${this.compactionPlacementLabel(compaction).toLowerCase()}`,
      description: 'Otwórz zmierzone wywołanie kompaktora, jego instrukcje, request, wynik oraz potwierdzone użycie w późniejszym requestcie.'};
  }
  openGuidanceEvidence(evidence: OptimizationGuidanceEvidence, origin?: EventTarget | null): void {
    if (evidence.kind === 'ROUND') {
      const round = this.analysis().streams.flatMap(stream => stream.rounds).find(candidate => candidate.ref === evidence.id);
      if (round) this.openRoundContent(round, origin, 'push');
      return;
    }
    const compaction = this.contextCompactions().find(candidate => candidate.id === evidence.id);
    if (compaction) this.openCompactionContent(this.compactionBody(), compaction, origin, 'push');
  }
  prepareOptimizationAdvicePreview(request: OptimizationAdvicePreviewRequest): Promise<OptimizationAdvicePreview> {
    return buildGuidanceEvidencePreview({...request, analysis: this.analysis(), catalog: this.catalog(),
      classification: this.aiResult(), compactions: this.contextCompactions(), relatedDetails: this.relatedDetails(),
      interactionTraceId: this.interaction()?.round.turn.model.traceId});
  }
  openRoundContent(round: RoundObservation, origin?: EventTarget | null, panelMode: RoundDetailsPanelOpenMode = 'reset'): void {
    const stream = this.analysis().streams.find(item => item.id === round.streamId);
    if (!stream) return;
    this.select(round);
    const next = this.nextRound(round);
    const index = this.columns().findIndex(item => item.ref === round.ref), rounds = this.columns();
    this.detailsPanel.openRound({turn: next?.turn ?? round.turn, sourceTurn: next ? round.turn : undefined, mode: next ? 'cycle' : 'final',
      messages: stream.source.messages, calibrationSpans: stream.source.spans,
      headingContext: next ? `${this.streamDisplayLabel(stream)} · cykl po rundzie ${round.turn.interactionTurnIndex}` : `${this.streamDisplayLabel(stream)} · odpowiedź końcowa`,
      subagent: !!stream.parentId}, this.linkedRoundLabel(round), origin, {
        previous: index > 0 ? () => this.openRoundContent(rounds[index - 1], null, panelMode === 'reset' ? 'reset' : 'replace') : undefined,
        next: index >= 0 && index + 1 < rounds.length ? () => this.openRoundContent(rounds[index + 1], null, panelMode === 'reset' ? 'reset' : 'replace') : undefined
      }, panelMode);
  }
  openInitialInteraction(origin?: EventTarget | null): void {
    const round = this.firstPrimaryRound();
    if (!round) return;
    this.select(round);
    const interactionIndex = round.turn.interactionIndex ?? 1;
    this.detailsPanel.openRound({turn: round.turn, mode: 'request', messages: this.root().source.messages,
      calibrationSpans: this.root().source.spans, headingContext: `Główny agent · interakcja ${interactionIndex} · start`},
    `Interakcja ${interactionIndex} · zlecenie użytkownika`, origin, {next: () => this.openRoundContent(round)});
  }
  nextRound(round: RoundObservation): RoundObservation | undefined {
    const stream = this.analysis().streams.find(item => item.id === round.streamId);
    const index = stream?.rounds.findIndex(item => item.ref === round.ref) ?? -1;
    const next = index >= 0 ? stream?.rounds[index + 1] : undefined;
    return next?.turn.model.traceId === round.turn.model.traceId ? next : undefined;
  }
  cycleFlowLabel(round: RoundObservation): string { return this.nextRound(round) ? 'M → A → M' : 'M → odpowiedź'; }
  async classifyTools(): Promise<void> {
    const catalog = this.catalog();
    const sessionId = this.analysis().source.session.id;
    if (this.classification.hasResult(sessionId, catalog)) return;
    try {
      await this.classification.classify(sessionId, catalog);
      if (catalog.key === this.catalog().key && this.classification.hasResult(sessionId, catalog)) this.aiVisible.set(true);
    } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'Nie udało się przeanalizować działań modelu.'); }
  }
  setAnalysisView(value: string): void {
    this.viewChosen = true;
    this.aiVisible.set(value === 'classification' && this.hasAiResult());
  }
  roundCategory(round: RoundObservation): RoundCategory | 'UNMAPPED' {
    return actionCategory(this.roundActions().get(round.ref) ?? []);
  }
  roundCaption(round: RoundObservation): string {
    return this.aiResult() ? ROUND_CATEGORIES[this.roundCategory(round)].label : round.tools.length ? this.plural(round.tools.length, 'użycie', 'użycia', 'użyć') : 'Model';
  }
  roundIcon(round: RoundObservation): string {
    return this.aiResult() ? ROUND_CATEGORIES[this.roundCategory(round)].icon : round.tools.length ? 'build' : 'chat_bubble_outline';
  }
  roundDescription(round: RoundObservation): string {
    return this.aiResult() ? this.actionLabels(this.roundActions().get(round.ref) ?? []) : this.plural(round.tools.length, 'zapisane użycie narzędzia', 'zapisane użycia narzędzi', 'zapisanych użyć narzędzi');
  }
  streamDisplayLabel(stream: WorkflowStream): string {
    const primary = this.streamPrimaryLabel(stream);
    const provider = this.streamProviderLabel(stream, primary);
    return provider ? `${primary} · ${provider}` : primary;
  }
  streamPrimaryLabel(stream: WorkflowStream): string {
    if (!stream.parentId) return 'Główny agent';
    const index = this.analysis().streams.slice(1).findIndex(item => item.id === stream.id);
    return index >= 0 ? `Subagent ${index + 1}` : 'Subagent';
  }
  streamProviderLabel(stream: WorkflowStream, primary = this.streamPrimaryLabel(stream)): string | undefined {
    const label = stream.label.trim();
    return label && label !== primary && label.toLocaleLowerCase('pl-PL') !== 'subagent' ? label : undefined;
  }
  private readonly numberFormat = new Intl.NumberFormat('pl-PL', {maximumFractionDigits: 2});
  private readonly compactFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact', maximumFractionDigits: 1});
  private readonly compactionCreditFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 3});
  private readonly timeFormat = new Intl.DateTimeFormat('pl-PL', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  readonly root = computed(() => this.analysis().streams[0]);
  readonly interactions = computed(() => [...new Set(this.root().rounds.map(round => round.turn.model.traceId))].map(trace => ({trace,
    round: this.root().rounds.find(round => round.turn.model.traceId === trace)!})));
  readonly interaction = computed(() => this.interactions().find(item => this.interactionSelection()?.session === this.analysis().source.session.id &&
    item.trace === this.interactionSelection()?.trace) ?? this.interactions()[0]);
  readonly lanes = computed(() => {
    const root = this.root(), selected = this.interaction();
    const lanes = [{stream: root, rounds: root.rounds.filter(round => round.turn.model.traceId === selected?.trace)}];
    const refs = new Set(lanes[0].rounds.map(round => round.ref));
    for (const stream of this.analysis().streams.slice(1)) {
      if (stream.launchRoundRef && refs.has(stream.launchRoundRef)) {
        lanes.push({stream, rounds: stream.rounds});
        stream.rounds.forEach(round => refs.add(round.ref));
      }
    }
    return lanes;
  });
  readonly columns = computed(() => this.lanes().flatMap(lane => lane.rounds).sort((a, b) => ordered(a.turn.model, b.turn.model)));
  readonly discussionRounds = computed<RoundObservation[]>(() => {
    const anchor = this.columns().find(round => round.ref === this.rangeAnchor());
    if (!anchor) return [];
    const stream = this.analysis().streams.find(candidate => candidate.id === anchor.streamId);
    if (!stream) return [];
    const eligible = stream.rounds.filter(round => round.turn.model.traceId === anchor.turn.model.traceId);
    const anchorIndex = eligible.findIndex(round => round.ref === anchor.ref);
    const end = eligible.find(round => round.ref === this.rangeEnd());
    if (!end) return [anchor];
    const endIndex = eligible.findIndex(round => round.ref === end.ref);
    const first = Math.min(anchorIndex, endIndex), last = Math.max(anchorIndex, endIndex);
    return eligible.slice(first, last + 1);
  });
  readonly discussionStream = computed(() => {
    const first = this.discussionRounds()[0];
    return first ? this.analysis().streams.find(stream => stream.id === first.streamId) : undefined;
  });
  readonly discussionRangeReady = computed(() => !!this.rangeEnd() && this.discussionRounds().length > 0);
  readonly discussionCreditSummary = computed(() => {
    const rounds = this.discussionRounds();
    const measured = rounds.map(round => known(round.credits)).filter((value): value is number => value !== undefined);
    return {credits: measured.length ? measured.reduce((sum, value) => sum + value, 0) : null,
      covered: measured.length, total: rounds.length};
  });
  readonly firstPrimaryRound = computed(() => this.lanes()[0]?.rounds[0]);
  readonly finalPrimaryRound = computed(() => this.lanes()[0]?.rounds.at(-1));
  readonly selected = computed<RoundObservation | undefined>(() => this.columns().find(round => this.selection()?.session === this.analysis().source.session.id &&
    round.ref === this.selection()?.ref) ?? this.lanes()[0].rounds[0]);
  readonly selectedStream = computed(() => this.analysis().streams.find(stream => stream.id === this.selected()?.streamId) ?? this.root());
  readonly returnText = computed(() => this.returnedPayload(this.selectedStream()));
  readonly leadingBoundaryCount = computed(() => this.compactionsBeforeInteraction().length + 1);
  readonly mapColumnCount = computed(() => this.leadingBoundaryCount() + this.columns().length + this.trailingCompactions().length);
  readonly interactionColumn = computed(() => this.compactionsBeforeInteraction().length + 1);
  readonly chartWidth = computed(() => Math.max(1, this.mapColumnCount()) * 88);
  readonly chartRowHeight = 112;
  readonly layerChartHeight = computed(() => this.layer() === 'tokens' ? this.layerChart().series.length * this.chartRowHeight : this.chartRowHeight);
  readonly delegationEdges = computed(() => this.lanes().slice(1).flatMap((lane, index) => {
    const parentRound = this.columns().find(round => round.ref === lane.stream.launchRoundRef);
    const first = lane.rounds[0], last = lane.rounds.at(-1);
    const parentIndex = this.lanes().findIndex(item => item.stream.id === lane.stream.parentId);
    if (!parentRound || !first || !last || parentIndex < 0) return [];
    const fromX = this.x(parentRound), toX = this.x(first), fromY = parentIndex * 202 + 72, toY = (index + 1) * 202 + 72;
    const paths = [{id: lane.stream.id + ':launch', path: `M ${fromX} ${fromY + 22} V ${toY - 42} H ${toX} V ${toY - 24}`, returned: false}];
    const evidence = [...this.actionEvidence().values()].find(item => item.children.some(child => child.id === lane.stream.id));
    const next = evidence?.consumers[0];
    if (next) paths.push({id: lane.stream.id + ':return',
      path: `M ${this.x(last) + 24} ${toY} H ${this.x(next)} V ${fromY + 25}`, returned: true});
    return paths;
  }));
  readonly layerChart = computed<LayerChart>(() => {
    if (this.layer() === 'context') {
      const rounds = this.lanes()[0].rounds;
      return {
        title: 'Okno kontekstowe', scope: 'Główny agent', unit: 'Input / całe okno',
        ariaLabel: 'Zajęcie okna kontekstowego w kolejnych rundach głównego agenta; przerwy oznaczają brak danych lub granicę sekwencji',
        series: [this.directSeries('context', 'Zajęcie okna', 'context-series', rounds, round => known(round.occupancy), 1, value => this.percentLabel(value), true)],
        missingX: rounds.filter(round => known(round.occupancy) === undefined).map(round => this.x(round)), showPointLabels: true
      };
    }
    if (this.layer() === 'credits') {
      const rounds = this.columns();
      const series = this.cumulativeSeries('credits', 'Credits', 'credits-series', rounds, round => known(round.credits), value => this.credits(value));
      return {
        title: 'Credits narastająco', scope: 'Cały przepływ', unit: 'Suma wyemitowanych credits',
        ariaLabel: 'Narastająca suma wyemitowanych credits w kolejnych wywołaniach modeli całego przepływu; przerwy oznaczają brak wartości',
        series: [series], missingX: rounds.filter(round => known(round.credits) === undefined).map(round => this.x(round)), showPointLabels: true
      };
    }
    const rounds = this.columns();
    const definitions: {id: string; label: string; tone: ChartTone; metric: (round: RoundObservation) => number | undefined}[] = [
      {id: 'fresh', label: 'Nowy input', tone: 'fresh-series', metric: round => known(round.fresh)},
      {id: 'cache', label: 'Input z cache', tone: 'cache-series', metric: round => known(round.cache)},
      {id: 'output', label: 'Output', tone: 'output-series', metric: round => known(round.output)},
      {id: 'write', label: 'Cache write', tone: 'write-series', metric: round => known(round.cacheWrite)}
    ];
    const series = definitions.map(item => this.cumulativeSeries(item.id, item.label, item.tone, rounds, item.metric, value => this.compact(value)));
    return {
      title: 'Tokeny narastająco', scope: 'Cały przepływ', unit: 'Suma według rodzaju',
      ariaLabel: 'Osobne wykresy narastających sum nowego inputu, cache read, outputu i wyemitowanego cache write w kolejnych wywołaniach modeli całego przepływu; każdy wykres ma własną skalę',
      series, missingX: [], showPointLabels: true
    };
  });
  plural(count: number, one: string, few: string, many: string): string {
    const last = count % 10, lastTwo = count % 100;
    return `${count} ${count === 1 ? one : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many}`;
  }
  value(metric: Metric, unit = ''): string {
    if (metric.value === undefined) return '—';
    return this.numberFormat.format(metric.value * (unit === '%' ? 100 : 1)) + (unit === '%' ? '%' : '');
  }
  compact(value?: number | null): string { return value == null ? '—' : this.compactFormat.format(value); }
  credits(value: number): string { return this.numberFormat.format(value); }
  shareOfKnown(value: number | null, knownCredits: number | null): string {
    return value == null || knownCredits == null || knownCredits <= 0 ? '—' : `≈ ${this.credits(value / knownCredits * 100)}%`;
  }
  compactRoundLabels(labels: readonly string[]): string {
    const ranges: {agent?: string; start: number; end: number; original: string}[] = [];
    for (const label of labels) {
      const match = /^(?:(S\d+):)?M(\d+)$/.exec(label);
      if (!match) {
        ranges.push({start: 0, end: 0, original: label});
        continue;
      }
      const agent = match[1], index = Number(match[2]), previous = ranges.at(-1);
      if (previous && previous.original === '' && previous.agent === agent && previous.end + 1 === index) previous.end = index;
      else ranges.push({agent, start: index, end: index, original: ''});
    }
    return ranges.map(range => {
      if (range.original) return range.original;
      const first = `${range.agent ? range.agent + ':' : ''}M${range.start}`;
      return range.start === range.end ? first : `${first}–M${range.end}`;
    }).join(' · ');
  }
  analyzedCreditsTooltip(): string {
    return 'Credits objęte zestawieniem pochodzą z telemetrii wywołań widocznego przepływu. AI przypisuje żądania modelu do kategorii, ale nie wylicza credits ani nie uzupełnia brakujących pomiarów. Kompaktowania nie są wysyłane do AI: ich udział jest dodawany lokalnie z wyemitowanych credits.';
  }
  phaseCategoryTooltip(phase: AggregatedPhase): string {
    if (phase.compaction) return 'Kompaktowanie jest faktycznym, osobnym wywołaniem modelu rozpoznanym w telemetrii. Nie jest kategorią nadaną przez AI i nie zostało wysłane do analizy.';
    return `„${phase.label}” to kategoria działania określona przez AI na podstawie akcji żądanych przez model. Faza łączy sąsiednie rundy z takim samym zestawem akcji. Porównaj jej credits z innymi fazami, aby wybrać obszar do sprawdzenia. Etykieta nie ocenia jakości ani poprawności wykonania.`;
  }
  phaseRoundsTooltip(): string {
    return 'M oznacza wywołanie modelu agenta głównego. S1:M2 oznacza drugie wywołanie modelu pierwszego subagenta. Użyj tych oznaczeń, aby odnaleźć i otworzyć konkretne rundy na szczegółowym diagramie.';
  }
  phaseSubagentTooltip(): string {
    return 'Co najmniej jedna runda tej fazy należy do subagenta. Jej credits i żądania narzędzi są wliczone do fazy. Otwórz rundy oznaczone S, aby sprawdzić koszt oraz zakres delegowanej pracy.';
  }
  phaseToolMixTooltip(): string {
    return 'Procent żądanych wywołań narzędzi w tej fazie według specjalizacji określonej przez AI. Liczymy każde wywołanie, a nie unikalne nazwy. Podział pomaga wskazać fazy, w których warto sprawdzić użycie skilla lub bardziej celowanego narzędzia.';
  }
  phaseToolSpecializationTooltip(specialization: ToolSpecialization): string { return TOOL_SPECIALIZATION_TOOLTIPS[specialization]; }
  phaseWithoutToolsTooltip(): string {
    return 'W tej fazie odpowiedź modelu nie zawierała żądania narzędzia. Porównaj jej credits, długość odpowiedzi oraz — jeśli istnieje — input następnej rundy.';
  }
  phaseCreditsTooltip(phase: AggregatedPhase): string {
    if (phase.compaction) {
      return phase.creditCovered
        ? 'Copilot AI credits wyemitowane dla osobnego wywołania modelu kompaktującego. To fakt z telemetrii, nie estymacja AI ani cena w walucie.'
        : 'Wywołanie kompaktowania nie wyemitowało pomiaru credits. Brak danych nie oznacza zera.';
    }
    const coverage = phase.creditCovered === phase.totalCalls ? 'Wartość jest dostępna dla wszystkich rund fazy.'
      : `Credits są dostępne dla ${phase.creditCovered} z ${phase.totalCalls} rund. Suma obejmuje tylko rundy z wyemitowaną wartością; brak nie oznacza zera.`;
    return `Suma Copilot AI credits wyemitowanych dla pełnych wywołań modelu należących do tej fazy. Nie musi odpowiadać procentowi kategorii powyżej: karta sumuje całe wywołania, a podział procentowy przypisuje ich części do działań. Nie jest to cena w walucie ani koszt samych narzędzi. ${coverage}`;
  }
  phaseMetricLabel(phase: AggregatedPhase): string {
    if (this.layer() === 'credits') return phase.compaction ? 'Credits kompaktowania' : 'Credits wywołań w fazie';
    if (this.layer() === 'tokens') return phase.compaction ? 'Input / output' : 'Input / output fazy';
    return phase.compaction ? 'Input przed → po' : 'Maks. okno w fazie';
  }
  phaseMetricValue(phase: AggregatedPhase): string {
    if (this.layer() === 'credits') return phase.credits === null ? '—' : this.credits(phase.credits);
    if (this.layer() === 'tokens') {
      const input = phase.compaction?.inputTokens ?? this.completeSum(phase.rounds.map(round => known(round.input)));
      const output = phase.compaction?.outputTokens ?? this.completeSum(phase.rounds.map(round => known(round.output)));
      return `${this.compact(input)} / ${this.compact(output)}`;
    }
    if (phase.compaction) {
      return phase.compaction.beforeInputTokens != null && phase.compaction.afterInputTokens != null
        ? `${this.compact(phase.compaction.beforeInputTokens)} → ${this.compact(phase.compaction.afterInputTokens)}`
        : '—';
    }
    const occupancy = phase.rounds.map(round => known(round.occupancy)).filter((value): value is number => value !== undefined);
    return occupancy.length ? this.percentLabel(Math.max(...occupancy)) : '—';
  }
  phaseMetricCoverage(phase: AggregatedPhase): string | undefined {
    if (this.layer() === 'credits') return phase.creditCovered < phase.totalCalls ? `${phase.creditCovered}/${phase.totalCalls} wywołań` : undefined;
    if (this.layer() === 'tokens') {
      if (phase.compaction) return undefined;
      const covered = phase.rounds.filter(round => known(round.input) !== undefined && known(round.output) !== undefined).length;
      return covered < phase.totalCalls ? `${covered}/${phase.totalCalls} wywołań` : undefined;
    }
    if (phase.compaction) return undefined;
    const covered = phase.rounds.filter(round => known(round.occupancy) !== undefined).length;
    return covered < phase.totalCalls ? `${covered}/${phase.totalCalls} wywołań` : undefined;
  }
  phaseMetricTooltip(phase: AggregatedPhase): string {
    if (this.layer() === 'credits') return this.phaseCreditsTooltip(phase);
    if (this.layer() === 'tokens') {
      return phase.compaction
        ? 'Input i output wyemitowane dla osobnego wywołania modelu kompaktującego.'
        : 'Suma inputu łącznie oraz outputu wywołań modelu w tej fazie. Wartość jest pokazywana tylko dla rodzaju tokenów kompletnego we wszystkich rundach; brak danych nie oznacza zera.';
    }
    return phase.compaction
      ? 'Zmierzony input przed kompaktowaniem i input późniejszego requestu, w którym potwierdzono użycie wyniku. Brak potwierdzonego odbioru pozostaje oznaczony jako brak danych.'
      : 'Największe zmierzone zajęcie pełnego okna kontekstowego w rundach tej fazy. Procent oznacza input podzielony przez limit promptu i maksymalny output.';
  }
  percent(metric: Metric): number { return Math.min(100, Math.max(0, (known(metric) ?? 0) * 100)); }
  known(metric: Metric): boolean { return known(metric) !== undefined; }
  roundLabel(round: RoundObservation): string { return `Runda ${round.turn.interactionTurnIndex}`; }
  private phaseRoundLabel(round: RoundObservation, subagentNumbers: ReadonlyMap<string, number>): string {
    const subagent = subagentNumbers.get(round.streamId);
    return subagent ? `S${subagent}:M${round.turn.interactionTurnIndex}` : `M${round.turn.interactionTurnIndex}`;
  }
  private compactionPhaseInput(compaction: ContextCompactionMeasurement): WorkflowPhaseCompactionInput {
    return {compaction, actorLabel: compaction.model || 'Model nieznany', roundLabel: `K${this.compactionNumber(compaction)}`};
  }
  private phaseGuidanceTopics(phase: AggregatedPhase): OptimizationTopic[] {
    if (phase.compaction) return ['CONTEXT_COMPACTION'];
    if (phase.signature === 'UNMAPPED') return ['UNMAPPED'];
    return phase.signature.split('+').filter((topic): topic is ActionCategory => ACTIONS.includes(topic as ActionCategory));
  }
  private completeSum(values: readonly (number | null | undefined)[]): number | null {
    return values.length && values.every((value): value is number => value != null && Number.isFinite(value))
      ? values.reduce((sum, value) => sum + value, 0)
      : null;
  }
  private compactionReceiptLabel(compaction: ContextCompactionMeasurement): string {
    return compaction.resultObservedInModelId != null
      ? 'Wynik kompaktowania został zaobserwowany w późniejszym requestcie.'
      : 'Nie potwierdzono odbioru wyniku w późniejszym requestcie.';
  }
  private phaseToolShares(values: readonly ToolSpecialization[]): PhaseToolShare[] {
    if (!values.length) return [];
    const order: ToolSpecialization[] = ['GENERAL_PURPOSE', 'DOMAIN_SPECIFIC', 'TASK_SPECIFIC', 'UNKNOWN'];
    const shares = order.map((specialization, index) => {
      const count = values.filter(value => value === specialization).length;
      const exact = count / values.length * 100;
      return {specialization, label: SPECIALIZATIONS[specialization], count, exact, percent: Math.floor(exact), index};
    });
    let remainder = 100 - shares.reduce((total, share) => total + share.percent, 0);
    for (const share of [...shares].filter(item => item.count).sort((a, b) => b.exact % 1 - a.exact % 1 || a.index - b.index)) {
      if (!remainder) break;
      share.percent++; remainder--;
    }
    return shares.filter(share => share.count).map(({specialization, label, percent}) => ({specialization, label, percent}));
  }
  leadingCompactionColumn(compaction: ContextCompactionMeasurement): number { return this.compactionsBeforeInteraction().findIndex(item => item.id === compaction.id) + 1; }
  trailingCompactionColumn(compaction: ContextCompactionMeasurement): number {
    return this.leadingBoundaryCount() + this.columns().length + this.trailingCompactions().findIndex(item => item.id === compaction.id) + 1;
  }
  column(round: RoundObservation): number { return this.leadingBoundaryCount() + this.columns().indexOf(round) + 1; }
  x(round: RoundObservation): number { return (this.column(round) - .5) * 88; }
  isFinalResponseRound(round: RoundObservation): boolean {
    return round.streamId === this.root().id && round.ref === this.finalPrimaryRound()?.ref;
  }
  y(value: number): number { return 92 - value * 70; }
  roundLayerTooltip(round: RoundObservation): string {
    const description = this.roundDescription(round);
    if (this.layer() === 'context') return `${description} · ${known(round.occupancy) !== undefined ? this.value(round.occupancy, '%') + ' okna kontekstowego' : 'brak pomiaru okna kontekstowego'}`;
    if (this.layer() === 'credits') return `${description} · ${known(round.credits) !== undefined ? this.value(round.credits) + ' credits tego wywołania' : 'brak pomiaru credits'}`;
    const measurements: [string, number | undefined][] = [
      ['nowy input', known(round.fresh)], ['cache read', known(round.cache)], ['output', known(round.output)], ['cache write', known(round.cacheWrite)]
    ];
    const parts = measurements.filter((item): item is [string, number] => typeof item[1] === 'number')
      .map(([label, value]) => `${label}: ${this.compact(value)}`);
    return `${description} · ${parts.length ? parts.join(' · ') : 'brak pomiarów tokenów'}`;
  }
  select(round: RoundObservation): void { this.selection.set({session: this.analysis().source.session.id, ref: round.ref}); this.revealSelected(); }
  selectInteraction(trace: string): void {
    this.clearRoundRange();
    this.interactionSelection.set({session: this.analysis().source.session.id, trace});
  }
  toggleRoundRange(): void {
    if (this.roundRangeMode()) this.clearRoundRange();
    else this.roundRangeMode.set(true);
  }
  clearRoundRange(): void {
    this.roundRangeMode.set(false);
    this.rangeAnchor.set(undefined);
    this.rangeEnd.set(undefined);
  }
  handleRoundClick(round: RoundObservation, origin?: EventTarget | null): void {
    if (!this.roundRangeMode()) {
      this.openRoundContent(round, origin);
      return;
    }
    const anchor = this.columns().find(candidate => candidate.ref === this.rangeAnchor());
    if (!anchor || this.rangeEnd()) {
      this.rangeAnchor.set(round.ref);
      this.rangeEnd.set(undefined);
      return;
    }
    if (anchor.streamId !== round.streamId || anchor.turn.model.traceId !== round.turn.model.traceId) {
      this.notifications.error('Koniec zakresu musi należeć do tego samego agenta i tej samej interakcji co początek.');
      return;
    }
    this.rangeEnd.set(round.ref);
  }
  roundInDiscussionRange(round: RoundObservation): boolean {
    return this.discussionRounds().some(candidate => candidate.ref === round.ref);
  }
  roundRangeEndpoint(round: RoundObservation): boolean {
    const selected = this.discussionRounds();
    return selected[0]?.ref === round.ref || selected.at(-1)?.ref === round.ref;
  }
  discussionRangeLabel(): string {
    const rounds = this.discussionRounds();
    const first = rounds[0]?.turn.interactionTurnIndex;
    const last = rounds.at(-1)?.turn.interactionTurnIndex;
    return first === last ? `M${first}` : `M${first}–M${last}`;
  }
  async openRoundDiscussion(): Promise<void> {
    const stream = this.discussionStream(), rounds = this.discussionRounds();
    if (!stream || !this.discussionRangeReady()) return;
    this.buildingDiscussion.set(true);
    try {
      const snapshot = await buildRoundDiscussionEvidence({analysis: this.analysis(), stream, rounds,
        actorLabel: this.streamDisplayLabel(stream)});
      const {RoundDiscussionDialogComponent} = await import('../round-discussion/round-discussion-dialog.component');
      this.dialog.open(RoundDiscussionDialogComponent, {data: {snapshot}, width: '95vw', maxWidth: '1180px',
        height: '92vh', maxHeight: '920px', panelClass: 'scanner-detail-dialog', autoFocus: 'dialog', restoreFocus: true});
    } catch (failure) {
      this.notifications.error(failure instanceof Error ? failure.message : 'Nie udało się przygotować materiału rozmowy.');
    } finally {
      this.buildingDiscussion.set(false);
    }
  }
  scrollMap(direction: -1 | 1): void {
    const element = this.mapScroll()?.nativeElement;
    if (!element) return;
    element.scrollBy({left: direction * Math.max(352, element.clientWidth - 176), behavior: 'smooth'});
  }
  openCompactionDetails(template: TemplateRef<unknown>, compaction: ContextCompactionMeasurement, event: Event): void {
    this.openCompactionContent(template, compaction, event.currentTarget);
  }
  private openCompactionContent(template: TemplateRef<unknown>, compaction: ContextCompactionMeasurement, origin?: EventTarget | null,
                                panelMode: RoundDetailsPanelOpenMode = 'reset'): void {
    this.detailsPanel.openTemplate(template, {$implicit: compaction}, `KOMPAKTOWANIE · ${this.compactionPlacementLabel(compaction)}`,
      'Kompaktowanie sesji', 'Szczegóły kompaktowania sesji', origin, undefined, panelMode);
  }
  compactionSource(compaction: ContextCompactionMeasurement): SessionDetail | undefined {
    return [this.analysis().source, ...this.relatedDetails()].find(detail => detail.session.id === compaction.sessionId);
  }
  compactionNumber(compaction: ContextCompactionMeasurement): number {
    return [...this.contextCompactions()].sort((left, right) => this.timestamp(left.startedAt) - this.timestamp(right.startedAt))
      .findIndex(item => item.id === compaction.id) + 1;
  }
  compactionPlacementLabel(compaction: ContextCompactionMeasurement): string {
    return compaction.afterInteractionIndex != null ? `PRZED INTERAKCJĄ ${compaction.afterInteractionIndex}` : 'PO OSTATNIEJ INTERAKCJI';
  }
  compactionNodeMetricLabel(compaction: ContextCompactionMeasurement): string {
    if (this.layer() === 'credits') return 'credits';
    if (this.layer() === 'tokens') return 'input / output';
    return compaction.beforeInputTokens != null && compaction.afterInputTokens != null ? 'input przed → po' : 'zmiana kontekstu';
  }
  compactionNodeMetric(compaction: ContextCompactionMeasurement): string {
    if (this.layer() === 'credits') return this.compactionCredits(compaction.credits);
    if (this.layer() === 'tokens') return `${this.compact(compaction.inputTokens)} / ${this.compact(compaction.outputTokens)}`;
    return compaction.beforeInputTokens != null && compaction.afterInputTokens != null
      ? `${this.compact(compaction.beforeInputTokens)} → ${this.compact(compaction.afterInputTokens)}` : '—';
  }
  compactionNodeTooltip(compaction: ContextCompactionMeasurement): string {
    return `Kompaktowanie ${this.compactionNumber(compaction)} · ${compaction.model || 'model nieznany'} · input ${this.compact(compaction.inputTokens)} · output ${this.compact(compaction.outputTokens)} · credits ${this.compactionCredits(compaction.credits)}`;
  }
  compactionStatusLabel(compaction: ContextCompactionMeasurement): string {
    if (compaction.resultObservedInModelId != null) return `wynik użyty w interakcji ${compaction.afterInteractionIndex}`;
    return compaction.placementBeforeModelId != null ? 'brak potwierdzonego użycia wyniku' : 'brak kolejnego requestu w telemetrii';
  }
  compactionCredits(value?: number): string { return value == null ? '—' : this.compactionCreditFormat.format(value); }
  compactionTime(value?: string): string { return value ? this.timeFormat.format(new Date(value)) : '—'; }
  open(template: TemplateRef<unknown>, label: string): void {
    this.dialog.open(template, {ariaLabel: label, panelClass: 'scanner-detail-dialog', width: '95vw', maxWidth: '95vw', height: '95vh', maxHeight: '95vh', autoFocus: 'dialog', restoreFocus: true});
  }
  definitionText(definition: unknown): string { return JSON.stringify(definition, null, 2); }
  returnedPayload(stream: WorkflowStream): string {
    const span = stream.launch?.span;
    if (!span) return '';
    try {
      const raw: unknown = (JSON.parse(span.attributesJson) as Record<string, unknown>)['gen_ai.tool.call.result'];
      return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2) ?? '';
    } catch { return ''; }
  }
  bar(round: RoundObservation, part: 'cache' | 'fresh' | 'output'): number {
    const input = known(round.input), output = known(round.output), value = known(round[part]);
    return input !== undefined && output !== undefined && value !== undefined && input + output > 0 ? value / (input + output) * 100 : 0;
  }
  creditBar(round: RoundObservation): number {
    const values = this.columns().map(item => known(item.credits)).filter((value): value is number => value !== undefined);
    const max = Math.max(0, ...values);
    return max > 0 ? (known(round.credits) ?? 0) / max * 100 : 0;
  }
  private directSeries(id: string, label: string, tone: ChartTone, rounds: RoundObservation[], metric: (round: RoundObservation) => number | undefined,
                       max: number, format: (value: number) => string, breakOnSequence = false): ChartSeries {
    const paths: string[] = [], points: ChartPoint[] = [];
    let path = '', previousSequence: string | undefined, total = 0, covered = 0;
    for (const round of rounds) {
      const value = metric(round), sequenceChanged = breakOnSequence && previousSequence !== undefined && previousSequence !== round.sequence;
      if (value === undefined || sequenceChanged) { if (path) paths.push(path); path = ''; }
      if (value !== undefined) {
        const point = {round, x: this.x(round), y: this.chartY(value, max), label: format(value)};
        points.push(point); total = value; covered++;
        path += `${path ? ' L' : 'M'} ${point.x} ${point.y}`;
      }
      previousSequence = round.sequence;
    }
    if (path) paths.push(path);
    return {id, label, tone, paths, points, missingX: rounds.filter(round => metric(round) === undefined).map(round => this.x(round)), total: covered ? total : undefined, coverage: `${covered}/${rounds.length}`};
  }
  private cumulativeSeries(id: string, label: string, tone: ChartTone, rounds: RoundObservation[], metric: (round: RoundObservation) => number | undefined,
                           format: (value: number) => string): ChartSeries {
    const values: {round: RoundObservation; value?: number; cumulative: number}[] = [];
    let cumulative = 0, covered = 0;
    for (const round of rounds) {
      const value = metric(round);
      if (value !== undefined) { cumulative += value; covered++; }
      values.push({round, value, cumulative});
    }
    const max = Math.max(0, ...values.map(item => item.cumulative));
    const paths: string[] = [], points: ChartPoint[] = [];
    let path = '';
    for (const item of values) {
      if (item.value === undefined) { if (path) paths.push(path); path = ''; continue; }
      const point = {round: item.round, x: this.x(item.round), y: this.chartY(item.cumulative, max), label: format(item.cumulative)};
      points.push(point);
      path += `${path ? ' L' : 'M'} ${point.x} ${point.y}`;
    }
    if (path) paths.push(path);
    return {id, label, tone, paths, points, missingX: values.filter(item => item.value === undefined).map(item => this.x(item.round)), total: covered ? cumulative : undefined, coverage: `${covered}/${rounds.length}`};
  }
  private chartY(value: number, max: number): number { return max > 0 ? 92 - Math.min(1, Math.max(0, value / max)) * 70 : 92; }
  private percentLabel(value: number): string { return this.numberFormat.format(value * 100) + '%'; }
  private timestamp(value?: string): number { return value ? new Date(value).getTime() : 0; }
}
