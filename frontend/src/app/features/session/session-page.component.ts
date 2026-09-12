import {ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal, TemplateRef, untracked, viewChild} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ActivatedRoute, Router} from '@angular/router';
import {ContextCompactionMeasurement, MessageRecord, ModelTurn, RelatedModelCall, Session, SessionDetail, SpanRecord, Tab, UserInteraction} from '../../models/scanner.models';
import {ScannerApiService} from '../../core/scanner-api.service';
import {NotificationService} from '../../core/notification.service';
import {CostBreakdownRow, CostDashboardComponent, CostDashboardView, DashboardRecord} from '../session-overview/cost-dashboard.component';
import {ToolOptimizationOverviewComponent} from '../session-overview/tool-optimization-overview.component';
import {SessionAnalysisService} from '../../core/session-analysis.service';
import {cacheWriteValue, creditsValue, inputCacheTotals, InputCacheTotals} from '../../core/copilot-telemetry';
import {TelemetryReader} from '../../core/workflow/telemetry';
import {analyzeToolUsage} from '../../core/tool-usage-analysis';
import {TechnicalViewComponent} from '../technical/technical-view.component';
import {InteractionTimelineComponent} from '../interaction-timeline/interaction-timeline.component';
import {WorkflowViewComponent} from '../workflow/workflow-view.component';
import {WorkflowAnalysis} from '../../models/workflow.models';
import {RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {ScannerShellStateService} from '../../core/scanner-shell-state.service';
import {OptimizationGuidanceComponent} from '../optimization/optimization-guidance.component';
import {
  OptimizationAdvicePreview,
  OptimizationAdvicePreviewRequest,
  OptimizationAdviceResult,
  OptimizationGuidanceContext,
  OptimizationGuidanceEvidenceOpenRequest
} from '../../models/optimization-guidance.models';

@Component({
  selector: 'as-session-page',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, CostDashboardComponent, ToolOptimizationOverviewComponent, TechnicalViewComponent,
    InteractionTimelineComponent, WorkflowViewComponent, OptimizationGuidanceComponent],
  templateUrl: './session-page.component.html',
  styleUrl: './session-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionPageComponent {
  private readonly telemetry = new TelemetryReader();
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ScannerApiService);
  private readonly notifications = inject(NotificationService);
  private readonly analysis = inject(SessionAnalysisService);
  private readonly detailsPanel = inject(RoundDetailsPanelService);
  private readonly shell = inject(ScannerShellStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly detailState = signal<SessionDetail | undefined>(undefined);
  private readonly relatedDetailsState = signal<SessionDetail[]>([]);
  private readonly activeTabState = signal<Tab>('loop');
  readonly workflowState = signal<WorkflowAnalysis | undefined>(undefined);
  readonly workflowLoading = signal(false);
  readonly workflowFailed = signal(false);
  readonly optimizationGuideContext = signal<OptimizationGuidanceContext | undefined>(undefined);
  readonly optimizationAdvicePreview = signal<OptimizationAdvicePreview | undefined>(undefined);
  readonly optimizationAdvicePreviewLoading = signal(false);
  readonly optimizationAdviceResult = signal<OptimizationAdviceResult | undefined>(undefined);
  readonly optimizationAdviceLoading = signal(false);
  private readonly workflowView = viewChild(WorkflowViewComponent);
  private sessionRequest = 0;
  private readonly routeSessionId = signal<number | undefined>(undefined);
  private workflowRequest = 0;
  private optimizationAdvicePreviewRequest = 0;
  private optimizationAdviceExecutionRequest = 0;
  private readonly attributeCache = new WeakMap<SpanRecord, Record<string, unknown>>();
  private readonly standardNumberFormat = new Intl.NumberFormat('pl-PL');
  private readonly compactNumberFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact'});
  private readonly callCreditFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 3});
  private readonly timeFormat = new Intl.DateTimeFormat('pl-PL', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  readonly creditTooltip = 'Uproszczony zapis: liczba oznacza GitHub Copilot AI credits. Scanner dzieli wartość nano AIU z telemetrii przez 1 000 000 000. To zużycie kredytów, nie kwota pieniężna.';

  readonly sessionStatus = computed(() => this.detail ? this.analysis.sessionStatus(this.detail, this.relatedDetails) : '');
  readonly toolUsageOverview = computed(() => {
    const view = this.sessionView();
    return view ? analyzeToolUsage(view) : {
      rows: [], modelCalls: 0, callsWithDefinitions: 0, callsWithOutput: 0, unusedTools: 0, unlinkedResultOccurrences: 0
    };
  });
  readonly sdkTelemetry = computed(() => this.modelTurns().some(turn =>
    Object.hasOwn(this.parsedAttributes(turn.model), 'github.copilot.nano_aiu')));
  readonly costDashboard = computed<CostDashboardView>(() => {
    const record = (turn: ModelTurn | undefined, value: string): DashboardRecord | undefined => turn
      ? {reference: this.turnReference(turn), value}
      : undefined;
    const fresh = this.highestFreshInputTurn();
    const cache = this.highestCacheReadTurn();
    const cacheWrite = this.highestCacheWriteTurn();
    const output = this.highestOutputTurn();
    const longest = this.longestTurn();
    const expensive = this.mostExpensiveTurn();
    const view = this.sessionView();
    const costGroups = view?.costGroups ?? [];
    const billingSpans = view?.billingModelSpans ?? [];
    const compactions = this.contextCompactions();
    const completeTotal = (values: (number | undefined)[]): number | undefined =>
      values.length && values.every((value): value is number => value != null) ? values.reduce((sum, value) => sum + value!, 0) : undefined;
    const combinedMetric = (base: number | undefined, extras: (number | undefined)[]): string => {
      if (base === undefined) return 'brak danych';
      if (!extras.length) return this.compact(base);
      const extra = completeTotal(extras);
      return extra == null ? 'brak danych' : this.compact(base + extra);
    };
    const coverage = (values: (number | null | undefined)[], noun: string): {value: number | undefined; label: string} => {
      const knownValues = values.filter((value): value is number => value != null);
      return {
        value: knownValues.length ? knownValues.reduce((sum, value) => sum + value, 0) : undefined,
        label: `${knownValues.length}/${values.length} ${noun}`
      };
    };
    const modelsLabel = (spans: SpanRecord[]): string => {
      const models = [...new Set(spans.map(span => span.model).filter((model): model is string => Boolean(model)))];
      return models.length ? models.join(', ') : 'model nieznany';
    };
    const rowForSpans = (id: string, kind: 'main' | 'subagent', label: string, spans: SpanRecord[]): CostBreakdownRow => {
      const durations = coverage(spans.map(span => span.durationMs), 'wywołań z czasem');
      const credits = coverage(spans.map(span => this.spanCredits(span)), 'wywołań z credits');
      const inputCache = this.inputCacheForSpans(spans);
      const freshInput = inputCache.freshInputTokens;
      const cacheRead = inputCache.cacheReadTokens;
      const cacheWrite = this.sumCacheWrite(spans);
      return {
        id, kind, label,
        detail: `${this.modelCallsLabel(spans.length)} · ${modelsLabel(spans)}`,
        freshInput: freshInput == null ? '—' : this.compact(freshInput),
        cacheRead: cacheRead == null ? '—' : this.compact(cacheRead),
        tokenAggregateSource: inputCache.aggregateFallbacks && cacheRead !== undefined && freshInput !== undefined
          ? 'z agregatu invoke_agent' : undefined,
        cacheWrite: cacheWrite == null ? '—' : this.compact(cacheWrite),
        output: this.compact(spans.reduce((sum, span) => sum + span.outputTokens, 0)),
        duration: durations.value == null ? '—' : this.modelDurationLabel(durations.value),
        durationCoverage: durations.label,
        credits: credits.value == null ? '—' : this.callCreditFormat.format(credits.value),
        creditCoverage: credits.label
      };
    };
    const mainGroups = costGroups.filter(group => group.kind === 'main');
    const subagentGroups = costGroups.filter(group => group.kind === 'subagent');
    const breakdown: CostBreakdownRow[] = [
      ...mainGroups.map(group => rowForSpans(group.id, 'main', 'Agent główny', group.spans)),
      ...subagentGroups.map((group, index) => rowForSpans(group.id, 'subagent', `Subagent ${index + 1}`, group.spans)),
      ...[...compactions].sort((left, right) => this.newDate(left.startedAt) - this.newDate(right.startedAt)).map((call, index): CostBreakdownRow => ({
        id: call.id,
        kind: 'compaction',
        label: `Kompaktowanie ${index + 1}`,
        detail: `1 wywołanie modelu · ${call.model || 'model nieznany'} · ${this.time(call.startedAt)}`,
        freshInput: call.freshInputTokens == null ? '—' : this.compact(call.freshInputTokens),
        cacheRead: call.cacheReadTokens == null ? '—' : this.compact(call.cacheReadTokens),
        cacheWrite: call.cacheWriteTokens == null ? '—' : this.compact(call.cacheWriteTokens),
        output: call.outputTokens == null ? '—' : this.compact(call.outputTokens),
        duration: call.durationMs == null ? '—' : this.modelDurationLabel(call.durationMs),
        durationCoverage: `${call.durationMs == null ? 0 : 1}/1 wywołań z czasem`,
        credits: call.credits == null ? '—' : this.callCreditFormat.format(call.credits),
        creditCoverage: `${call.credits == null ? 0 : 1}/1 wywołań z credits`
      }))
    ];
    const allDurations = coverage([...billingSpans.map(span => span.durationMs), ...compactions.map(call => call.durationMs)], 'wywołań z czasem');
    const allCredits = coverage([...billingSpans.map(span => this.spanCredits(span)), ...compactions.map(call => call.credits)], 'wywołań z credits');
    const sessionInputCache = this.inputCacheForSpans(billingSpans);
    const hasCacheWrite = this.hasCacheWriteTelemetryFor(billingSpans) || compactions.some(call => call.cacheWriteTokens != null);
    const primaryCalls = this.primaryModelSpans().length;
    const subagentCalls = subagentGroups.reduce((sum, group) => sum + group.spans.length, 0);
    const compactionLabel = `${compactions.length} ${this.polishPlural(compactions.length, 'kompaktowanie', 'kompaktowania', 'kompaktowań')}`;
    const totalScopes = ['agent główny', ...(subagentGroups.length ? ['subagenci'] : []), ...(compactions.length ? ['kompaktowanie'] : [])];
    const totalsScope = totalScopes.length === 1
      ? totalScopes[0]
      : `${totalScopes.slice(0, -1).join(', ')} i ${totalScopes.at(-1)}`;
    return {
      headingSummary: `${primaryCalls} ${this.polishPlural(primaryCalls, 'wywołanie agenta głównego', 'wywołania agenta głównego', 'wywołań agenta głównego')} · ${subagentCalls} ${this.polishPlural(subagentCalls, 'wywołanie subagenta', 'wywołania subagentów', 'wywołań subagentów')} · ${compactionLabel}`,
      wallDuration: this.sessionDurationLabel(),
      totalsScope,
      breakdownSummary: `Agent główny · Subagenci: ${subagentGroups.length} · Kompaktowania: ${compactions.length}`,
      breakdown,
      totals: {
        freshInput: combinedMetric(billingSpans.length ? sessionInputCache.freshInputTokens : 0,
          compactions.map(call => call.freshInputTokens)),
        cacheRead: combinedMetric(billingSpans.length ? sessionInputCache.cacheReadTokens : 0,
          compactions.map(call => call.cacheReadTokens)),
        tokenAggregateSource: sessionInputCache.aggregateFallbacks && sessionInputCache.cacheReadTokens !== undefined
          && sessionInputCache.freshInputTokens !== undefined
          && compactions.every(call => call.cacheReadTokens !== undefined && call.freshInputTokens !== undefined)
          ? 'z agregatu invoke_agent' : undefined,
        cacheWrite: hasCacheWrite
          ? combinedMetric(billingSpans.length ? this.totalSessionCacheWriteTokens() : 0,
            compactions.map(call => call.cacheWriteTokens))
          : 'brak danych',
        hasCacheWrite,
        output: combinedMetric(this.totalSessionOutputTokens(), compactions.map(call => call.outputTokens)),
        duration: allDurations.value == null ? 'brak danych' : this.modelDurationLabel(allDurations.value),
        durationCoverage: allDurations.label,
        credits: allCredits.value == null ? 'brak danych' : this.callCreditFormat.format(allCredits.value),
        creditCoverage: allCredits.label
      },
      records: {
        freshInput: record(fresh, fresh ? `${this.compact(this.freshInputTokens(fresh.model))} tokenów` : ''),
        cacheRead: record(cache, cache ? `${this.compact(cache.model.cacheReadTokens)} tokenów` : ''),
        cacheWrite: record(cacheWrite, cacheWrite ? `${this.compact(this.cacheWriteTokens(cacheWrite.model))} tokenów` : ''),
        output: record(output, output ? `${this.compact(output.model.outputTokens)} tokenów` : ''),
        longest: record(longest, longest ? this.duration(longest.model.durationMs) : ''),
        mostExpensive: record(expensive, expensive ? this.spanCreditsLabel(expensive.model) : '')
      }
    };
  });

  get status() { return this.shell.status(); }
  get sessions(): Session[] { return this.shell.sessions(); }
  get detail(): SessionDetail | undefined { return this.detailState(); }
  get relatedDetails(): SessionDetail[] { return this.relatedDetailsState(); }
  get activeTab(): Tab { return this.activeTabState(); }
  get loading(): boolean { return this.shell.loading(); }

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const rawSessionId = params.get('sessionId');
        const sessionId = rawSessionId == null ? undefined : Number(rawSessionId);
        if (rawSessionId != null && (!Number.isSafeInteger(sessionId) || sessionId! <= 0)) {
          this.routeSessionId.set(undefined);
          void this.router.navigate(['/'], {replaceUrl: true});
          return;
        }
        this.routeSessionId.set(sessionId);
      });
    effect(() => {
      this.shell.refreshRevision();
      const sessionId = this.routeSessionId();
      if (this.shell.loading() || sessionId == null) return;
      if (this.sessions.some(session => session.id === sessionId)) untracked(() => void this.loadSession(sessionId));
      else {
        this.clearSessionData();
        void this.router.navigate(['/'], {replaceUrl: true});
        this.notifications.error('Nie znaleziono wskazanej sesji. Wybierz inną sesję z listy.');
      }
    });
    this.destroyRef.onDestroy(() => this.shell.setSelectedTurnCount(0));
  }

  async refresh(): Promise<void> {
    await this.shell.refresh();
  }

  private async loadSession(sessionId: number): Promise<void> {
    const request = ++this.sessionRequest;
    if (this.detail?.session.id !== sessionId) this.detailsPanel.close();
    const loadedDetail = await this.api.session(sessionId);
    if (request !== this.sessionRequest || this.routeSessionId() !== sessionId) return;
    const detail = {...loadedDetail, spans: this.analysis.withDepth(loadedDetail.spans)};
    this.detailState.set(detail);
    const relatedDetails = this.isAuxiliarySession(detail.session) ? [] : await this.loadRelatedDetails(detail);
    if (request !== this.sessionRequest || this.routeSessionId() !== sessionId) return;
    this.relatedDetailsState.set(relatedDetails);
    this.shell.setSelectedTurnCount(this.modelTurns().length);
    if (this.activeTab === 'workflow') void this.loadWorkflow();
  }

  async closeSession(): Promise<void> {
    this.detailsPanel.close();
    this.clearSessionData();
    await this.router.navigate(['/']);
  }

  private clearSessionData(): void {
    this.sessionRequest++;
    this.workflowRequest++;
    this.detailState.set(undefined);
    this.relatedDetailsState.set([]);
    this.workflowState.set(undefined);
    this.workflowLoading.set(false);
    this.workflowFailed.set(false);
    this.shell.setSelectedTurnCount(0);
  }

  async deleteSession(): Promise<void> {
    if (!this.detail || !confirm('Usunąć tę sesję wraz z surową telemetrią i pełną treścią?')) return;
    await this.api.deleteSession(this.detail.session.id);
    this.clearSessionData();
    await this.router.navigate(['/']);
    await this.shell.refresh();
  }

  exportSession(): void {
    if (this.detail) window.location.href = this.api.exportSessionUrl(this.detail.session.id);
  }

  selectTab(tab: Tab): void {
    if (this.activeTab === tab) return;
    this.detailsPanel.close();
    this.activeTabState.set(tab);
    if (tab === 'workflow') void this.loadWorkflow();
  }

  async loadWorkflow(): Promise<void> {
    const source = this.detail;
    if (!source) return;
    const request = ++this.workflowRequest;
    this.workflowLoading.set(true);
    this.workflowFailed.set(false);
    try {
      // The session key is only an index hint; exact linking needs raw per-span IDs.
      const pending = this.sessions.filter(session => session.id !== source.session.id);
      const details: SessionDetail[] = [];
      let cursor = 0;
      await Promise.all(Array.from({length: Math.min(4, pending.length)}, async () => {
        while (cursor < pending.length) {
          const candidate = pending[cursor++];
          details.push(await this.api.session(candidate.id));
        }
      }));
      const result = await this.analysis.buildWorkflow(source, details);
      if (request === this.workflowRequest && this.detail === source) this.workflowState.set(result);
    } catch {
      if (request === this.workflowRequest && this.detail === source) {
        this.workflowFailed.set(true);
        this.notifications.error('Nie udało się przygotować mapy pracy. Spróbuj ponownie.', () => this.loadWorkflow());
      }
    } finally {
      if (request === this.workflowRequest) this.workflowLoading.set(false);
    }
  }

  openOptimizationGuide(template: TemplateRef<unknown>, origin: EventTarget | null, context?: OptimizationGuidanceContext): void {
    this.optimizationAdvicePreviewRequest++;
    this.optimizationAdviceExecutionRequest++;
    this.optimizationGuideContext.set(context);
    this.optimizationAdvicePreview.set(undefined);
    this.optimizationAdvicePreviewLoading.set(false);
    this.optimizationAdviceResult.set(undefined);
    this.optimizationAdviceLoading.set(false);
    this.detailsPanel.openTemplate(
      template,
      {},
      'OPTYMALIZACJA',
      'Techniki i doradztwo',
      'Techniki optymalizacji i doradztwo na żądanie',
      origin
    );
  }

  openOptimizationEvidence(request: OptimizationGuidanceEvidenceOpenRequest): void {
    this.workflowView()?.openGuidanceEvidence(request.evidence, request.origin);
  }

  async prepareOptimizationAdvicePreview(request: OptimizationAdvicePreviewRequest): Promise<void> {
    const workflow = this.workflowView();
    if (!workflow) {
      this.notifications.error('Podgląd wymaga aktualnej mapy pracy. Otwórz ponownie wskazaną fazę.');
      return;
    }
    const sequence = ++this.optimizationAdvicePreviewRequest;
    this.optimizationAdviceExecutionRequest++;
    this.optimizationAdvicePreview.set(undefined);
    this.optimizationAdviceResult.set(undefined);
    this.optimizationAdviceLoading.set(false);
    this.optimizationAdvicePreviewLoading.set(true);
    try {
      const localPreview = await workflow.prepareOptimizationAdvicePreview(request);
      if (sequence === this.optimizationAdvicePreviewRequest) this.optimizationAdvicePreview.set(localPreview);
      const preview = await this.api.prepareOptimizationAdvice(localPreview.request.scope.rootSessionId, localPreview.request);
      if (sequence === this.optimizationAdvicePreviewRequest) this.optimizationAdvicePreview.set(preview);
      if (sequence === this.optimizationAdvicePreviewRequest && preview.preparation) {
        const cached = await this.api.cachedOptimizationAdvice(preview.request.scope.rootSessionId, preview.preparation.previewId);
        if (sequence === this.optimizationAdvicePreviewRequest && cached) this.optimizationAdviceResult.set(cached);
      }
    } catch (error) {
      if (sequence === this.optimizationAdvicePreviewRequest) {
        this.notifications.error(error instanceof Error ? error.message : 'Nie udało się przygotować podglądu pakietu.');
      }
    } finally {
      if (sequence === this.optimizationAdvicePreviewRequest) this.optimizationAdvicePreviewLoading.set(false);
    }
  }

  async requestOptimizationAdvice(preview: OptimizationAdvicePreview): Promise<void> {
    if (!preview.preparation) {
      this.notifications.error('Najpierw przygotuj i zweryfikuj migawkę.');
      return;
    }
    const sequence = ++this.optimizationAdviceExecutionRequest;
    const previewId = preview.preparation.previewId;
    this.optimizationAdviceLoading.set(true);
    try {
      const result = await this.api.requestOptimizationAdvice(preview.request.scope.rootSessionId, previewId);
      if (sequence === this.optimizationAdviceExecutionRequest
          && this.optimizationAdvicePreview()?.preparation?.previewId === previewId) {
        this.optimizationAdviceResult.set(result);
      }
    } catch (error) {
      if (sequence === this.optimizationAdviceExecutionRequest) {
        this.notifications.error(error instanceof Error ? error.message : 'Nie udało się przygotować rekomendacji AI.');
      }
    } finally {
      if (sequence === this.optimizationAdviceExecutionRequest) this.optimizationAdviceLoading.set(false);
    }
  }

  allMessages(): MessageRecord[] {
    return [this.detail, ...this.relatedDetails]
      .filter((detail): detail is SessionDetail => detail != null)
      .flatMap(detail => detail.messages);
  }

  tools(): SpanRecord[] {
    return this.sessionView()?.tools ?? [];
  }

  isAuxiliarySession(session: Session): boolean {
    return this.analysis.isAuxiliarySession(session);
  }

  sessionTitle(session: Session): string {
    return this.analysis.sessionTitle(session);
  }

  primaryModelSpans(): SpanRecord[] {
    return this.sessionView()?.primaryModelSpans ?? [];
  }

  modelTurns(): ModelTurn[] {
    return this.sessionView()?.modelTurns ?? [];
  }

  displayedTurnCount(session: Session): number {
    return this.detail?.session.id === session.id ? this.modelTurns().length : session.turnCount;
  }

  interactions(): UserInteraction[] {
    return this.sessionView()?.interactions ?? [];
  }

  contextCompactions(): ContextCompactionMeasurement[] {
    return this.sessionView()?.contextCompactions ?? [];
  }

  relatedModelCalls(): RelatedModelCall[] {
    return this.sessionView()?.relatedModelCalls ?? [];
  }

  modelCallsLabel(count: number): string {
    return `${count} ${this.polishPlural(count, 'wywołanie modelu', 'wywołania modelu', 'wywołań modelu')}`;
  }

  toolActionsLabel(count: number): string {
    return `${count} ${this.polishPlural(count, 'działanie narzędzia', 'działania narzędzi', 'działań narzędzi')}`;
  }

  turnNumber(turn: ModelTurn): number {
    return turn.interactionTurnIndex ?? turn.index;
  }

  freshInputTokens(span: SpanRecord): number | undefined {
    const input = this.telemetry.metric(span, 'gen_ai.usage.input_tokens');
    const cache = this.telemetry.metric(span, 'gen_ai.usage.cache_read.input_tokens');
    return input.availability === 'emitted' && cache.availability === 'emitted' && cache.value! <= input.value!
      ? input.value! - cache.value! : undefined;
  }

  private inputCacheForSpans(spans: SpanRecord[]): InputCacheTotals {
    const ids = new Set(spans.map(span => span.id));
    const sources = [this.detail, ...this.relatedDetails].filter((source): source is SessionDetail =>
      source !== undefined && source.spans.some(span => ids.has(span.id)));
    return inputCacheTotals(this.telemetry, spans, sources.flatMap(source => source.spans));
  }

  private sumCacheWrite(spans: SpanRecord[]): number | undefined {
    if (!spans.length) return undefined;
    const values = spans.map(span => this.cacheWriteTokens(span));
    return values.every((value): value is number => value !== undefined)
      ? values.reduce((sum, value) => sum + value!, 0) : undefined;
  }

  totalSessionOutputTokens(): number { return this.billingModelSpans().reduce((sum, span) => sum + span.outputTokens, 0); }
  totalSessionCacheWriteTokens(): number | undefined { return this.sumCacheWrite(this.billingModelSpans()); }

  spanCredits(span: SpanRecord): number | null {
    return creditsValue(this.telemetry, span) ?? null;
  }

  private cacheWriteTokens(span: SpanRecord): number | undefined { return cacheWriteValue(this.telemetry, span); }

  spanCreditsLabel(span: SpanRecord): string {
    const value = this.spanCredits(span);
    return value == null ? '—' : this.callCreditFormat.format(value);
  }

  highestFreshInputTurn(): ModelTurn | undefined {
    return this.modelTurns().filter(turn => this.freshInputTokens(turn.model) !== undefined)
      .reduce<ModelTurn | undefined>((highest, turn) =>
        !highest || this.freshInputTokens(turn.model)! > this.freshInputTokens(highest.model)! ? turn : highest, undefined);
  }

  highestCacheReadTurn(): ModelTurn | undefined {
    return this.highestTurnBy(turn => turn.model.cacheReadTokens,
      turn => this.telemetry.metric(turn.model, 'gen_ai.usage.cache_read.input_tokens').availability === 'emitted');
  }

  highestCacheWriteTurn(): ModelTurn | undefined {
    return this.highestTurnBy(
      turn => this.cacheWriteTokens(turn.model) ?? 0,
      turn => this.hasCacheWriteTelemetry(turn.model)
    );
  }

  highestOutputTurn(): ModelTurn | undefined {
    return this.highestTurnBy(turn => turn.model.outputTokens);
  }

  longestTurn(): ModelTurn | undefined {
    return this.highestTurnBy(turn => turn.model.durationMs ?? 0);
  }

  mostExpensiveTurn(): ModelTurn | undefined {
    return this.highestTurnBy(
      turn => this.spanCredits(turn.model) ?? 0,
      turn => this.spanCredits(turn.model) != null
    );
  }

  turnReference(turn: ModelTurn): string {
    return `Interakcja ${turn.interactionIndex ?? 1} · runda ${this.turnNumber(turn)}`;
  }

  sessionDurationMs(): number {
    const session = this.detail?.session;
    if (!session) return 0;
    return Math.max(0, this.newDate(session.endedAt || session.lastSeenAt) - this.newDate(session.startedAt));
  }

  sessionDurationLabel(): string {
    const milliseconds = this.sessionDurationMs();
    if (milliseconds < 60_000) return this.duration(milliseconds);
    const totalMinutes = Math.floor(milliseconds / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
  }

  private highestTurnBy(value: (turn: ModelTurn) => number, eligible: (turn: ModelTurn) => boolean = () => true): ModelTurn | undefined {
    return this.modelTurns().filter(eligible).reduce<ModelTurn | undefined>((highest, turn) =>
      !highest || value(turn) > value(highest) ? turn : highest, undefined);
  }

  hasCacheWriteTelemetry(span?: SpanRecord): boolean {
    const spans = span ? [span] : this.billingModelSpans();
    return this.hasCacheWriteTelemetryFor(spans);
  }

  private hasCacheWriteTelemetryFor(spans: SpanRecord[]): boolean {
    return spans.some(span => this.cacheWriteTokens(span) !== undefined);
  }

  private billingModelSpans(): SpanRecord[] {
    return this.sessionView()?.billingModelSpans ?? [];
  }

  repositoryName(): string {
    const repository = this.detail?.session.repository;
    return repository ? repository.replace(/\/$/, '').split('/').pop() || repository : 'brak danych o repozytorium';
  }

  duration(value?: number): string {
    if (value == null) return '—';
    return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${Math.round(value)} ms`;
  }

  private modelDurationLabel(milliseconds: number): string {
    if (milliseconds < 60_000) return this.duration(milliseconds);
    const totalSeconds = Math.round(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours} h ${minutes} min` : `${totalMinutes} min ${seconds} s`;
  }

  compact(value?: number): string {
    return (value && value >= 10000 ? this.compactNumberFormat : this.standardNumberFormat).format(value ?? 0);
  }

  time(value?: string): string {
    return value ? this.timeFormat.format(new Date(value)) : '—';
  }

  private async loadRelatedDetails(primary: SessionDetail): Promise<SessionDetail[]> {
    const linkedConversationIds = new Set(primary.spans
      .filter(span => span.operationName === 'execute_tool')
      .map(span => String(this.parsedAttributes(span)['gen_ai.tool.call.id'] ?? '—'))
      .filter(value => value && value !== '—'));
    const start = this.newDate(primary.session.startedAt) - 2000;
    const end = this.newDate(primary.session.endedAt || primary.session.lastSeenAt) + 2500;
    const candidates = this.sessions.filter(session => {
      if (session.id === primary.session.id) return false;
      if (linkedConversationIds.has(session.conversationId)) return true;
      if (this.analysis.isContextCompactionSession(session)) return true;
      if (!this.isAuxiliarySession(session)) return false;
      const at = this.newDate(session.startedAt || session.lastSeenAt);
      return at >= start && at <= end;
    });
    const details = await Promise.all(candidates.map(session => this.api.session(session.id)));
    return details.map(detail => ({...detail, spans: this.analysis.withDepth(detail.spans)}));
  }

  private parsedAttributes(span: SpanRecord): Record<string, unknown> {
    const cached = this.attributeCache.get(span);
    if (cached) return cached;
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(span.attributesJson) as Record<string, unknown>; } catch { /* malformed telemetry */ }
    this.attributeCache.set(span, parsed);
    return parsed;
  }

  private newDate(value?: string): number { return value ? new Date(value).getTime() : 0; }

  private polishPlural(count: number, one: string, few: string, many: string): string {
    if (count === 1) return one;
    const lastTwo = count % 100;
    const last = count % 10;
    return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
  }

  private sessionView() {
    return this.analysis.build(this.detail, this.relatedDetails);
  }
}
