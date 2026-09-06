import {ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatButtonModule} from '@angular/material/button';
import {MAT_ICON_DEFAULT_OPTIONS, MatIconModule} from '@angular/material/icon';
import {MatSidenavModule} from '@angular/material/sidenav';
import {MatSnackBarModule} from '@angular/material/snack-bar';
import {MatTooltipModule} from '@angular/material/tooltip';
import {timer} from 'rxjs';
import {MessageRecord, ModelTurn, RelatedModelCall, ScannerStatus, Session, SessionDetail, SpanRecord, Tab, UserInteraction} from './models/scanner.models';
import {ScannerApiService} from './core/scanner-api.service';
import {NotificationService} from './core/notification.service';
import {TopbarComponent} from './layout/topbar/topbar.component';
import {SessionSidebarComponent} from './features/sessions/session-sidebar.component';
import {CostDashboardComponent, CostDashboardView, DashboardRecord} from './features/session-overview/cost-dashboard.component';
import {SessionAnalysisService} from './core/session-analysis.service';
import {TechnicalViewComponent} from './features/technical/technical-view.component';
import {InteractionTimelineComponent} from './features/interaction-timeline/interaction-timeline.component';
import {WorkflowViewComponent} from './features/workflow/workflow-view.component';
import {WorkflowAnalysis} from './models/workflow.models';
import {RoundDetailsAsideComponent} from './features/round-details/round-details-aside.component';
import {RoundDetailsPanelService} from './core/round-details-panel.service';

@Component({
  selector: 'as-root',
  imports: [MatButtonModule, MatIconModule, MatSidenavModule, MatSnackBarModule, MatTooltipModule, TopbarComponent, SessionSidebarComponent, CostDashboardComponent, TechnicalViewComponent, InteractionTimelineComponent, WorkflowViewComponent, RoundDetailsAsideComponent],
  providers: [{provide: MAT_ICON_DEFAULT_OPTIONS, useValue: {fontSet: 'material-symbols-outlined'}}],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ScannerApiService);
  private readonly notifications = inject(NotificationService);
  private readonly analysis = inject(SessionAnalysisService);
  private readonly detailsPanel = inject(RoundDetailsPanelService);
  private readonly statusState = signal<ScannerStatus>({paused: false, connected: false, lastSignalAt: null, traces: 0, metrics: 0, logs: 0, contentCaptured: false, retentionDays: 30});
  private readonly sessionsState = signal<Session[]>([]);
  private readonly detailState = signal<SessionDetail | undefined>(undefined);
  private readonly relatedDetailsState = signal<SessionDetail[]>([]);
  private readonly activeTabState = signal<Tab>('loop');
  readonly workflowState = signal<WorkflowAnalysis | undefined>(undefined);
  readonly workflowLoading = signal(false);
  readonly workflowFailed = signal(false);
  private workflowRequest = 0;
  private readonly showConfigState = signal(false);
  private readonly configPlatformState = signal<'vscode' | 'intellij'>('vscode');
  private readonly sidebarOpenState = signal(true);
  private readonly loadingState = signal(true);
  private readonly copiedState = signal(false);
  private readonly importingState = signal(false);
  private polling = false;
  private readonly attributeCache = new WeakMap<SpanRecord, Record<string, unknown>>();
  private readonly standardNumberFormat = new Intl.NumberFormat('pl-PL');
  private readonly compactNumberFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact'});
  private readonly sessionCreditFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  private readonly callCreditFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 3});
  private readonly timeFormat = new Intl.DateTimeFormat('pl-PL', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  readonly creditTooltip = 'Uproszczony zapis: liczba oznacza GitHub Copilot AI credits. Scanner dzieli wartość nano AIU z telemetrii przez 1 000 000 000. To zużycie kredytów, nie kwota pieniężna.';

  readonly visibleSessions = computed(() => this.sessions.filter(session => !this.isAuxiliarySession(session)));
  readonly sessionStatus = computed(() => this.detail ? this.analysis.sessionStatus(this.detail, this.relatedDetails) : '');
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
    const hasCacheWrite = this.hasCacheWriteTelemetry();
    return {
      modelCalls: this.modelCallsLabel(this.primaryModelSpans().length),
      toolActions: this.toolActionsLabel(this.tools().length),
      totals: {
        freshInput: this.compact(this.totalSessionInputOutsideCache()),
        cacheRead: this.compact(this.totalSessionCacheTokens()),
        cacheWrite: hasCacheWrite ? this.compact(this.totalSessionCacheWriteTokens()) : 'brak danych',
        hasCacheWrite,
        output: this.compact(this.totalSessionOutputTokens()),
        duration: this.sessionDurationLabel(),
        credits: this.sessionCreditsLabel(),
        creditCoverage: this.sessionCreditCoverage()
      },
      records: {
        freshInput: record(fresh, fresh ? `${this.compact(this.freshInputTokens(fresh.model))} tokenów` : ''),
        cacheRead: record(cache, cache ? `${this.compact(cache.model.cacheReadTokens)} tokenów` : ''),
        cacheWrite: record(cacheWrite, cacheWrite ? `${this.compact(cacheWrite.model.cacheCreationTokens)} tokenów` : ''),
        output: record(output, output ? `${this.compact(output.model.outputTokens)} tokenów` : ''),
        longest: record(longest, longest ? this.duration(longest.model.durationMs) : ''),
        mostExpensive: record(expensive, expensive ? this.spanCreditsLabel(expensive.model) : '')
      }
    };
  });

  get status(): ScannerStatus { return this.statusState(); }
  get sessions(): Session[] { return this.sessionsState(); }
  get detail(): SessionDetail | undefined { return this.detailState(); }
  get relatedDetails(): SessionDetail[] { return this.relatedDetailsState(); }
  get activeTab(): Tab { return this.activeTabState(); }
  get showConfig(): boolean { return this.showConfigState(); }
  get configPlatform(): 'vscode' | 'intellij' { return this.configPlatformState(); }
  get sidebarOpen(): boolean { return this.sidebarOpenState(); }
  get loading(): boolean { return this.loadingState(); }
  get copied(): boolean { return this.copiedState(); }
  get importing(): boolean { return this.importingState(); }

  constructor() {
    void this.refresh();
    timer(2000, 2000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.pollStatus());
  }

  toggleSidebar(): void {
    this.sidebarOpenState.update(open => !open);
  }

  readonly configText = `{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.protocol": "http/protobuf",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:8080",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}`;

  async refresh(): Promise<void> {
    try {
      const [status, sessions] = await Promise.all([this.api.status(), this.api.sessions()]);
      this.statusState.set(status);
      this.sessionsState.set(sessions);
      if (this.detail && !this.isAuxiliarySession(this.detail.session)) {
        const current = sessions.find(item => item.id === this.detail?.session.id);
        if (current) await this.selectSession(current);
        else this.detailState.set(undefined);
      } else {
        const preferred = this.visibleSessions()[0] ?? sessions[0];
        if (preferred) await this.selectSession(preferred);
      }
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się pobrać danych', () => this.refresh());
    } finally {
      this.loadingState.set(false);
    }
  }

  async selectSession(session: Session): Promise<void> {
    if (this.detail?.session.id !== session.id) this.detailsPanel.close();
    const loadedDetail = await this.api.session(session.id);
    const detail = {...loadedDetail, spans: this.analysis.withDepth(loadedDetail.spans)};
    this.detailState.set(detail);
    this.relatedDetailsState.set(this.isAuxiliarySession(session) ? [] : await this.loadRelatedDetails(detail));
    if (this.activeTab === 'workflow') void this.loadWorkflow();
  }

  async togglePause(): Promise<void> {
    try {
      await this.api.setPaused(!this.status.paused);
      this.statusState.update(status => ({...status, paused: !status.paused}));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się zmienić nasłuchiwania');
    }
  }

  async deleteSession(): Promise<void> {
    if (!this.detail || !confirm('Usunąć tę sesję wraz z surową telemetrią i pełną treścią?')) return;
    await this.api.deleteSession(this.detail.session.id);
    this.detailState.set(undefined);
    await this.refresh();
  }

  async deleteAll(): Promise<void> {
    if (!confirm('Usunąć bezpowrotnie wszystkie sesje, prompty, wyniki narzędzi i surowe payloady?')) return;
    await this.api.deleteAll();
    this.detailState.set(undefined);
    await this.refresh();
  }

  async copyConfig(): Promise<void> {
    await navigator.clipboard.writeText(this.configText);
    this.copiedState.set(true);
    setTimeout(() => {
      this.copiedState.set(false);
    }, 1800);
  }

  exportSession(): void {
    if (this.detail) window.location.href = this.api.exportSessionUrl(this.detail.session.id);
  }

  async importSessionFile(file: File): Promise<void> {
    this.importingState.set(true);
    try {
      const result = await this.api.importSession(file);
      await this.refresh();
      const imported = this.sessions.find(session => session.id === result.sessionId);
      if (imported) await this.selectSession(imported);
      this.notifications.success('Sesja została zaimportowana.');
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się zaimportować sesji');
    } finally {
      this.importingState.set(false);
    }
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

  setConfigVisible(visible: boolean): void {
    this.showConfigState.set(visible);
  }

  setConfigPlatform(platform: 'vscode' | 'intellij'): void {
    this.configPlatformState.set(platform);
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

  freshInputTokens(span: SpanRecord): number { return Math.max(0, span.inputTokens - span.cacheReadTokens); }

  totalSessionOutputTokens(): number { return this.billingModelSpans().reduce((sum, span) => sum + span.outputTokens, 0); }
  totalSessionCacheTokens(): number { return this.billingModelSpans().reduce((sum, span) => sum + span.cacheReadTokens, 0); }
  totalSessionCacheWriteTokens(): number { return this.billingModelSpans().reduce((sum, span) => sum + span.cacheCreationTokens, 0); }
  totalSessionInputOutsideCache(): number { return this.billingModelSpans().reduce((sum, span) => sum + this.freshInputTokens(span), 0); }

  spanCredits(span: SpanRecord): number | null {
    const raw = this.parsedAttributes(span)['copilot_chat.copilot_usage_nano_aiu'];
    if (raw == null || raw === '') return null;
    const nanoAiu = Number(raw);
    return Number.isFinite(nanoAiu) ? nanoAiu / 1_000_000_000 : null;
  }

  sessionCredits(): number | null {
    const values = this.billingModelSpans().map(span => this.spanCredits(span)).filter((value): value is number => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  sessionCreditsLabel(): string {
    const value = this.sessionCredits();
    return value == null ? 'brak danych' : this.sessionCreditFormat.format(value);
  }

  spanCreditsLabel(span: SpanRecord): string {
    const value = this.spanCredits(span);
    return value == null ? '—' : this.callCreditFormat.format(value);
  }

  sessionCreditCoverage(): string {
    const spans = this.billingModelSpans();
    const captured = spans.filter(span => this.spanCredits(span) != null).length;
    return `${captured}/${spans.length} rund z credits`;
  }

  highestFreshInputTurn(): ModelTurn | undefined {
    return this.modelTurns().reduce<ModelTurn | undefined>((highest, turn) =>
      !highest || this.freshInputTokens(turn.model) > this.freshInputTokens(highest.model) ? turn : highest, undefined);
  }

  highestCacheReadTurn(): ModelTurn | undefined {
    return this.highestTurnBy(turn => turn.model.cacheReadTokens);
  }

  highestCacheWriteTurn(): ModelTurn | undefined {
    return this.highestTurnBy(
      turn => turn.model.cacheCreationTokens,
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
    return spans.some(item => Object.prototype.hasOwnProperty.call(
      this.parsedAttributes(item), 'gen_ai.usage.cache_creation.input_tokens'));
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
      if (!this.isAuxiliarySession(session)) return false;
      const at = this.newDate(session.startedAt || session.lastSeenAt);
      return at >= start && at <= end;
    });
    const details = await Promise.all(candidates.map(session => this.api.session(session.id)));
    return details.map(detail => ({...detail, spans: this.analysis.withDepth(detail.spans)}));
  }

  private async pollStatus(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const status = await this.api.status();
      const tracesChanged = status.traces !== this.status.traces;
      const statusChanged = JSON.stringify(status) !== JSON.stringify(this.status);
      if (tracesChanged) await this.refresh();
      else if (statusChanged) this.statusState.set(status);
    } catch {
      // Zachowaj ostatnie poprawne dane. Kolejna próba nastąpi automatycznie.
    } finally {
      this.polling = false;
    }
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
