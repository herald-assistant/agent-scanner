import {NgTemplateOutlet} from '@angular/common';
import {ChangeDetectionStrategy, Component, computed, inject, input, TemplateRef} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ContextCompactionMeasurement, MessageRecord, ModelTurn, RelatedModelCall, SessionDetail, SpanRecord, UserInteraction} from '../../models/scanner.models';
import {episodeLaunches, sessionEpisodes} from '../../core/session-episodes';
import {RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {ContextCompactionDetailsComponent} from '../context-compaction/context-compaction-details.component';

interface ConfirmedProblem {
  title: string;
  evidence: string[];
}

interface RoundPanelItem {
  turn: ModelTurn;
  sourceTurn?: ModelTurn;
  mode: 'request' | 'cycle' | 'final';
  headingContext: string;
}

@Component({
  selector: 'as-interaction-timeline',
  imports: [NgTemplateOutlet, MatIconModule, MatTooltipModule, ContextCompactionDetailsComponent],
  templateUrl: './interaction-timeline.component.html',
  styleUrl: './interaction-timeline.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InteractionTimelineComponent {
  readonly turns = input.required<ModelTurn[]>();
  readonly interactions = input.required<UserInteraction[]>();
  readonly contextCompactions = input<ContextCompactionMeasurement[]>([]);
  readonly messages = input.required<MessageRecord[]>();
  readonly calibrationSpans = input.required<SpanRecord[]>();
  readonly relatedModelCalls = input<RelatedModelCall[]>([]);
  readonly detail = input.required<SessionDetail>();
  readonly relatedDetails = input<SessionDetail[]>([]);
  readonly creditTooltip = input.required<string>();
  readonly contextMetricTooltip = 'Wartość wyliczona dla requestu: gen_ai.usage.input_tokens podzielone przez limit kontekstu, czyli max prompt + max output wyemitowane w telemetrii.';
  readonly freshInputMetricTooltip = 'Wartość wyliczona dla requestu: max(0, gen_ai.usage.input_tokens − gen_ai.usage.cache_read.input_tokens). Telemetria nie przypisuje jej do pojedynczych części requestu.';
  readonly outputMetricTooltip = 'Wartość gen_ai.usage.output_tokens wyemitowana w telemetrii dla odpowiedzi modelu.';
  readonly subagentFreshInputMetricTooltip = 'Suma inputu po odjęciu sumy cache read dla dokładnie powiązanych wywołań modelu subagenta.';
  readonly subagentOutputMetricTooltip = 'Suma gen_ai.usage.output_tokens z dokładnie powiązanych wywołań modelu subagenta.';
  readonly subagentCreditsMetricTooltip = 'Suma GitHub Copilot AI credits z dokładnie powiązanych wywołań modelu subagenta. Każda wartość pochodzi z nano AIU wyemitowanego w telemetrii i jest dzielona przez 1 000 000 000.';
  private readonly episodes = computed(() => sessionEpisodes(this.detail(), this.relatedDetails()));
  private readonly launches = computed(() => episodeLaunches(this.episodes()));

  private readonly detailsPanel = inject(RoundDetailsPanelService);
  private readonly attributeCache = new WeakMap<SpanRecord, Record<string, unknown>>();
  private readonly jsonAttributeCache = new WeakMap<SpanRecord, Map<string, unknown>>();
  private readonly standardNumberFormat = new Intl.NumberFormat('pl-PL');
  private readonly compactNumberFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact'});
  private readonly callCreditFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 3});
  private readonly percentFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  private readonly timeFormat = new Intl.DateTimeFormat('pl-PL', {hour: '2-digit', minute: '2-digit', second: '2-digit'});

  openInitialRequest(turn: ModelTurn, event: Event): void {
    const items = this.mainPanelItems();
    const current = items.find(item => item.turn.model.id === turn.model.id && item.mode === 'request');
    if (current) this.showRoundDetails(items, current, this.calibrationSpans(), false, event.currentTarget);
  }

  openMainRoundDetails(turn: ModelTurn, event: Event): void {
    const items = this.mainPanelItems();
    const current = items.find(item => item.sourceTurn?.model.id === turn.model.id && item.mode === 'cycle');
    if (current) this.showRoundDetails(items, current, this.calibrationSpans(), false, event.currentTarget);
  }

  openFinalResponse(turn: ModelTurn, event: Event): void {
    const items = this.mainPanelItems();
    const current = items.find(item => item.turn.model.id === turn.model.id && item.mode === 'final');
    if (current) this.showRoundDetails(items, current, this.calibrationSpans(), false, event.currentTarget);
  }

  openAuxiliaryRoundDetails(call: RelatedModelCall, event: Event): void {
    const items: RoundPanelItem[] = this.auxiliaryModelCalls().map((item, index) => ({
      turn: {index: index + 1, model: item.span, tools: []}, mode: 'request', headingContext: item.label
    }));
    const selected = items.find(item => item.turn.model.id === call.span.id);
    if (selected) this.showRoundDetails(items, selected, this.auxiliarySpans(), false, event.currentTarget);
  }

  openSubagentInitialRequest(tool: SpanRecord, turn: ModelTurn, event: Event): void {
    const calls = this.subagentModelCalls(tool);
    const items = this.sequencePanelItems(this.subagentTurns(tool), item => `SUBAGENT · ${item}`);
    const current = items.find(item => item.turn.model.id === turn.model.id && item.mode === 'request');
    if (current) this.showRoundDetails(items, current, calls, true, event.currentTarget);
  }

  openSubagentRoundDetails(tool: SpanRecord, turn: ModelTurn, event: Event): void {
    const calls = this.subagentModelCalls(tool);
    const items = this.sequencePanelItems(this.subagentTurns(tool), item => `SUBAGENT · ${item}`);
    const current = items.find(item => item.sourceTurn?.model.id === turn.model.id && item.mode === 'cycle');
    if (current) this.showRoundDetails(items, current, calls, true, event.currentTarget);
  }

  openSubagentFinalResponse(tool: SpanRecord, turn: ModelTurn, event: Event): void {
    const calls = this.subagentModelCalls(tool);
    const items = this.sequencePanelItems(this.subagentTurns(tool), item => `SUBAGENT · ${item}`);
    const current = items.find(item => item.turn.model.id === turn.model.id && item.mode === 'final');
    if (current) this.showRoundDetails(items, current, calls, true, event.currentTarget);
  }

  openSubagentDetails(template: TemplateRef<unknown>, tool: SpanRecord, turn: ModelTurn, event: Event): void {
    const eyebrow = `INTERAKCJA ${turn.interactionIndex} · CYKL ${this.turnNumber(turn)} · DELEGACJA PO M${this.turnNumber(turn)}`;
    this.detailsPanel.openTemplate(template, {$implicit: tool}, eyebrow, this.friendlyToolTitle(tool), 'Szczegóły pracy subagenta', event.currentTarget);
  }

  openCompactionDetails(template: TemplateRef<unknown>, compaction: ContextCompactionMeasurement, event: Event): void {
    const target = compaction.afterInteractionIndex ? `PRZED INTERAKCJĄ ${compaction.afterInteractionIndex}` : 'PO OSTATNIEJ INTERAKCJI';
    this.detailsPanel.openTemplate(template, {$implicit: compaction}, `KOMPAKTOWANIE · ${target}`,
      'Kompaktowanie sesji', 'Szczegóły kompaktowania sesji', event.currentTarget);
  }

  private showRoundDetails(items: RoundPanelItem[], selected: RoundPanelItem, calibrationSpans: SpanRecord[], subagent: boolean,
                           origin?: EventTarget | null): void {
    const index = items.indexOf(selected);
    const current = items[index];
    if (!current) return;
    this.detailsPanel.openRound({turn: current.turn, sourceTurn: current.sourceTurn, mode: current.mode, messages: this.messages(), calibrationSpans,
      headingContext: current.headingContext, subagent}, current.headingContext, origin, {
      previous: index > 0 ? () => this.showRoundDetails(items, items[index - 1], calibrationSpans, subagent) : undefined,
      next: index < items.length - 1 ? () => this.showRoundDetails(items, items[index + 1], calibrationSpans, subagent) : undefined
    });
  }

  private mainPanelItems(): RoundPanelItem[] {
    return this.sequencePanelItems(this.turns(), (label, turn) => `INTERAKCJA ${turn.interactionIndex ?? 1} · ${label}`);
  }

  private sequencePanelItems(turns: ModelTurn[], heading: (label: string, turn: ModelTurn) => string): RoundPanelItem[] {
    const items: RoundPanelItem[] = [];
    for (const [index, turn] of turns.entries()) {
      const previous = index > 0 && turns[index - 1].model.traceId === turn.model.traceId ? turns[index - 1] : undefined;
      items.push(previous
        ? {turn, sourceTurn: previous, mode: 'cycle', headingContext: heading(`CYKL ${this.turnNumber(previous)}`, turn)}
        : {turn, mode: 'request', headingContext: heading('START', turn)});
      const next = turns[index + 1];
      if (!next || next.model.traceId !== turn.model.traceId)
        items.push({turn, mode: 'final', headingContext: heading('ODPOWIEDŹ KOŃCOWA', turn)});
    }
    return items;
  }

  turnNumber(turn: ModelTurn): number { return turn.interactionTurnIndex ?? turn.index; }

  interactionForTurn(turn: ModelTurn): UserInteraction | undefined {
    return this.interactions().find(interaction => interaction.index === turn.interactionIndex);
  }

  compactionsForTurn(turn: ModelTurn): ContextCompactionMeasurement[] {
    return this.contextCompactions().filter(compaction => compaction.placementBeforeModelId === turn.model.id);
  }

  trailingCompactions(): ContextCompactionMeasurement[] {
    return this.contextCompactions().filter(compaction => compaction.placementBeforeModelId == null);
  }

  compactionStatusLabel(compaction: ContextCompactionMeasurement): string {
    if (compaction.resultObservedInModelId != null) return `wynik użyty w interakcji ${compaction.afterInteractionIndex}`;
    return compaction.placementBeforeModelId != null ? 'brak potwierdzonego użycia wyniku' : 'brak kolejnego requestu w telemetrii';
  }

  compactionSource(compaction: ContextCompactionMeasurement): SessionDetail | undefined {
    return [this.detail(), ...this.relatedDetails()].find(detail => detail.session.id === compaction.sessionId);
  }

  exactTokenLabel(value?: number): string { return value == null ? '—' : this.standardNumberFormat.format(value); }

  compactionCreditsLabel(value?: number): string {
    return value == null ? '—' : this.callCreditFormat.format(value);
  }

  interactionFreshInputTokens(interaction: UserInteraction): number {
    return interaction.turns.reduce((sum, turn) => sum + this.freshInputTokens(turn.model), 0);
  }

  interactionCacheReadTokens(interaction: UserInteraction): number {
    return interaction.turns.reduce((sum, turn) => sum + turn.model.cacheReadTokens, 0);
  }

  interactionOutputTokens(interaction: UserInteraction): number {
    return interaction.turns.reduce((sum, turn) => sum + turn.model.outputTokens, 0);
  }

  interactionCredits(interaction: UserInteraction): number | null {
    return this.sumCredits(interaction.turns.map(turn => turn.model));
  }

  auxiliaryModelCalls(): RelatedModelCall[] {
    const subagentCalls = new Set(this.turns()
      .flatMap(turn => this.subagentLaunchesForTurn(turn))
      .flatMap(tool => this.subagentModelCalls(tool)));
    return this.relatedModelCalls().filter(call => !subagentCalls.has(call.span));
  }

  auxiliarySpans(): SpanRecord[] { return this.auxiliaryModelCalls().map(call => call.span); }

  auxiliaryFreshInputTokens(): number {
    return this.auxiliaryModelCalls().reduce((sum, call) => sum + this.freshInputTokens(call.span), 0);
  }

  auxiliaryCacheReadTokens(): number {
    return this.auxiliaryModelCalls().reduce((sum, call) => sum + call.span.cacheReadTokens, 0);
  }

  auxiliaryOutputTokens(): number {
    return this.auxiliaryModelCalls().reduce((sum, call) => sum + call.span.outputTokens, 0);
  }

  auxiliaryCredits(): number | null {
    return this.sumCredits(this.auxiliaryModelCalls().map(call => call.span));
  }

  freshInputTokens(span: SpanRecord): number { return Math.max(0, span.inputTokens - span.cacheReadTokens); }

  roundTokenLabel(span: SpanRecord, kind: 'input' | 'cache' | 'fresh' | 'output'): string {
    const key = kind === 'cache' ? 'gen_ai.usage.cache_read.input_tokens'
      : kind === 'output' ? 'gen_ai.usage.output_tokens' : 'gen_ai.usage.input_tokens';
    let value = this.numericAttribute(span, key);
    if (kind === 'fresh') {
      const cache = this.numericAttribute(span, 'gen_ai.usage.cache_read.input_tokens');
      value = value != null && cache != null ? Math.max(0, value - cache) : null;
    }
    return value == null ? '—' : this.compact(value);
  }

  hasCacheWriteForTurns(turns: ModelTurn[]): boolean {
    return turns.some(turn => this.hasCacheWriteTelemetry(turn.model));
  }

  cacheWriteLabel(span: SpanRecord): string {
    return this.hasCacheWriteTelemetry(span) ? this.compact(span.cacheCreationTokens) : '—';
  }

  spanCredits(span: SpanRecord): number | null {
    const raw = this.attributes(span)['copilot_chat.copilot_usage_nano_aiu'];
    if (raw == null || raw === '') return null;
    const nanoAiu = Number(raw);
    return Number.isFinite(nanoAiu) ? nanoAiu / 1_000_000_000 : null;
  }

  spanCreditsLabel(span: SpanRecord): string { return this.creditsLabel(this.spanCredits(span)); }

  creditsLabel(value: number | null): string {
    return value == null ? 'brak danych' : this.callCreditFormat.format(value);
  }

  isInitialTurn(turn: ModelTurn): boolean { return !this.previousTurnFor(turn); }
  isFinalTurn(turn: ModelTurn): boolean {
    const turns = this.interactionForTurn(turn)?.turns ?? this.turns();
    const position = turns.findIndex(candidate => candidate.model.id === turn.model.id);
    return position >= 0 && position === turns.length - 1;
  }
  previousTurnFor(turn: ModelTurn): ModelTurn | undefined {
    const turns = this.interactionForTurn(turn)?.turns ?? this.turns();
    const position = turns.findIndex(candidate => candidate.model.id === turn.model.id);
    return position > 0 ? turns[position - 1] : undefined;
  }

  nextTurnFor(turn: ModelTurn): ModelTurn | undefined {
    const turns = this.interactionForTurn(turn)?.turns ?? this.turns();
    return this.nextTurnIn(turns, turn);
  }

  nextSubagentTurn(tool: SpanRecord, turn: ModelTurn): ModelTurn | undefined {
    return this.nextTurnIn(this.subagentTurns(tool), turn);
  }

  modelCallLabel(turn: ModelTurn): string { return `M${this.turnNumber(turn)}`; }

  subagentCallLabel(turn: ModelTurn): string { return `S${turn.index}`; }

  cycleReceiptLabel(source: ModelTurn, receiver: ModelTurn): string {
    return `${this.toolResultsLabel(source.tools.length)} po ${this.modelCallLabel(source)} → input ${this.modelCallLabel(receiver)}`;
  }

  roundContextPercentLabel(turn: ModelTurn): string {
    const limit = this.contextWindowTokens(turn);
    const input = this.numericAttribute(turn.model, 'gen_ai.usage.input_tokens');
    return limit && input != null ? `${this.percentFormat.format(input / limit * 100)}%` : '—';
  }

  roundContextLabel(turn: ModelTurn): string {
    const limit = this.contextWindowTokens(turn);
    const input = this.roundTokenLabel(turn.model, 'input');
    return limit == null
      ? `${input} · limit niewyemitowany`
      : `${input} / ${this.compact(limit)}`;
  }

  roundContextTooltip(turn: ModelTurn): string {
    return `${this.contextMetricTooltip} Dane dla tego requestu: ${this.roundContextLabel(turn)} tokenów.`;
  }

  subagentLaunchesForTurn(turn: ModelTurn): SpanRecord[] {
    return turn.tools.filter(tool => this.subagentEpisode(tool) || ['execution_subagent', 'runSubagent'].includes(this.attribute(tool, 'gen_ai.tool.name')));
  }

  subagentTrigger(tool: SpanRecord): string {
    const args = this.jsonAttribute(tool, 'gen_ai.tool.call.arguments');
    if (args && typeof args === 'object') {
      const record = args as Record<string, unknown>;
      const trigger = record['prompt'] ?? record['task'] ?? record['description'] ?? record['query'];
      if (trigger != null) return this.excerpt(String(trigger), 700);
    }
    return this.excerpt(this.telemetryValue(tool, 'gen_ai.tool.call.arguments', 'Brak zlecenia w telemetrii.'), 700);
  }

  subagentReturn(tool: SpanRecord): string {
    return this.telemetryValue(tool, 'gen_ai.tool.call.result', 'Brak wyniku w telemetrii.');
  }

  subagentInputTokens(tool: SpanRecord): number {
    return this.subagentModelCalls(tool).reduce((sum, span) => sum + span.inputTokens, 0);
  }

  subagentFreshInputTokens(tool: SpanRecord): number {
    return Math.max(0, this.subagentInputTokens(tool) - this.subagentCacheReadTokens(tool));
  }

  subagentOutputTokens(tool: SpanRecord): number {
    return this.subagentModelCalls(tool).reduce((sum, span) => sum + span.outputTokens, 0);
  }

  subagentCacheReadTokens(tool: SpanRecord): number {
    return this.subagentModelCalls(tool).reduce((sum, span) => sum + span.cacheReadTokens, 0);
  }

  subagentCredits(tool: SpanRecord): number | null { return this.sumCredits(this.subagentModelCalls(tool)); }

  subagentModelCalls(tool: SpanRecord): SpanRecord[] {
    return this.subagentEpisode(tool)?.spans.filter(span => span.operationName === 'chat') ?? [];
  }

  private subagentEpisode(tool: SpanRecord): SessionDetail | undefined {
    return this.launches().get(tool)?.source;
  }

  subagentTools(tool: SpanRecord): SpanRecord[] {
    return this.subagentEpisode(tool)?.spans.filter(span => span.operationName === 'execute_tool') ?? [];
  }

  subagentTurns(tool: SpanRecord): ModelTurn[] {
    const calls = this.subagentModelCalls(tool);
    const tools = this.subagentTools(tool);
    const diagnostics = this.subagentEpisode(tool)?.spans.filter(span => span.operationName === 'execute_tool' || span.operationName === 'execute_hook') ?? [];
    return calls.map((model, index) => {
      const from = this.timestamp(model.endedAt || model.startedAt);
      const to = index + 1 < calls.length ? this.timestamp(calls[index + 1].startedAt) : Number.MAX_SAFE_INTEGER;
      return {
        index: index + 1,
        model,
        tools: tools.filter(item => item.traceId === model.traceId && this.isBetween(item, from, to)),
        diagnostics: diagnostics.filter(item => item.traceId === model.traceId && this.isBetween(item, from, to))
      };
    });
  }

  friendlyToolTitle(span: SpanRecord): string {
    if (this.launches().has(span)) return 'Subagent';
    const name = this.attribute(span, 'gen_ai.tool.name');
    const labels: Record<string, string> = {
      execution_subagent: 'Subagent',
      runSubagent: 'Subagent'
    };
    return labels[name] || `Użył narzędzia: ${name === '—' ? span.spanName : name}`;
  }

  roundHasConfirmedProblem(turn: ModelTurn): boolean { return this.roundConfirmedProblems(turn).length > 0; }

  roundProblemTooltip(turn: ModelTurn): string {
    const problems = this.roundConfirmedProblems(turn);
    const heading = problems.length === 1
      ? 'Potwierdzony problem w tej rundzie:'
      : `Potwierdzone problemy w tej rundzie (${problems.length}):`;
    return [heading, ...problems.map(problem => `• ${problem.title}: ${problem.evidence.join('; ')}`)].join('\n');
  }

  toolResultsLabel(count: number): string {
    return `${count} ${this.polishPlural(count, 'wynik narzędzia', 'wyniki narzędzi', 'wyników narzędzi')}`;
  }

  toolActionsLabel(count: number): string {
    return `${count} ${this.polishPlural(count, 'działanie narzędzia', 'działania narzędzi', 'działań narzędzi')}`;
  }

  modelCallsLabel(count: number): string {
    return `${count} ${this.polishPlural(count, 'wywołanie modelu', 'wywołania modelu', 'wywołań modelu')}`;
  }

  duration(value?: number): string {
    if (value == null) return '—';
    return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${Math.round(value)} ms`;
  }

  compact(value?: number): string {
    return (value && value >= 10000 ? this.compactNumberFormat : this.standardNumberFormat).format(value ?? 0);
  }

  time(value?: string): string { return value ? this.timeFormat.format(new Date(value)) : '—'; }

  short(value?: string, size = 9): string {
    return value ? (value.length > size ? value.slice(0, size) + '…' : value) : '—';
  }

  attribute(span: SpanRecord, key: string): string { return String(this.attributes(span)[key] ?? '—'); }

  private contextWindowTokens(turn: ModelTurn): number | null {
    const prompt = this.numericAttribute(turn.model, 'copilot_chat.request.max_prompt_tokens');
    const response = this.numericAttribute(turn.model, 'gen_ai.request.max_tokens');
    return prompt != null && response != null ? prompt + response : null;
  }

  private hasCacheWriteTelemetry(span: SpanRecord): boolean {
    return Object.prototype.hasOwnProperty.call(
      this.attributes(span), 'gen_ai.usage.cache_creation.input_tokens');
  }

  private numericAttribute(span: SpanRecord, key: string): number | null {
    const value = this.attributes(span)[key];
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private sumCredits(spans: SpanRecord[]): number | null {
    const values = spans.map(span => this.spanCredits(span)).filter((value): value is number => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  private isBetween(span: SpanRecord, from: number, to: number): boolean {
    const at = this.timestamp(span.startedAt);
    return at >= from && at < to;
  }

  private nextTurnIn(turns: ModelTurn[], turn: ModelTurn): ModelTurn | undefined {
    const position = turns.findIndex(candidate => candidate.model.id === turn.model.id);
    const next = position >= 0 ? turns[position + 1] : undefined;
    return next?.model.traceId === turn.model.traceId ? next : undefined;
  }

  private roundConfirmedProblems(turn: ModelTurn): ConfirmedProblem[] {
    return [turn.model, ...(turn.diagnostics ?? turn.tools)]
      .map(span => this.confirmedProblemForSpan(span))
      .filter((problem): problem is ConfirmedProblem => problem != null);
  }

  private confirmedProblemForSpan(span: SpanRecord): ConfirmedProblem | null {
    const evidence = new Set<string>();
    if (span.statusCode === 'STATUS_CODE_ERROR') {
      evidence.add(span.statusMessage ? `status ERROR — ${this.excerpt(span.statusMessage, 180)}` : 'status spanu: ERROR');
    }
    const errorType = this.attributes(span)['error.type'];
    if (errorType != null && String(errorType).trim()) evidence.add(`error.type: ${String(errorType).trim()}`);
    for (const event of this.spanEvents(span)) {
      const name = String(event['name'] ?? '').trim();
      const normalizedName = name.toLowerCase();
      const attributes = event['attributes'] && typeof event['attributes'] === 'object'
        ? event['attributes'] as Record<string, unknown> : {};
      const failedCompaction = normalizedName === 'github.copilot.session.compaction_complete' &&
        (attributes['success'] === false || String(attributes['success']).toLowerCase() === 'false');
      const isErrorEvent = normalizedName === 'exception' || normalizedName === 'error' ||
        normalizedName.endsWith('.error') || normalizedName === 'github.copilot.session.abort';
      if (!isErrorEvent && !failedCompaction) continue;
      const message = attributes['exception.message'] ?? attributes['error.message'] ?? attributes['message'] ??
        attributes['github.copilot.error_type'];
      evidence.add(message == null ? `zdarzenie ${name || 'błędu'}` : `zdarzenie ${name || 'błędu'} — ${this.excerpt(String(message), 180)}`);
    }
    if (span.operationName === 'execute_tool') {
      const resultEvidence = this.structuredToolFailure(span);
      if (resultEvidence) evidence.add(resultEvidence);
    }
    return evidence.size ? {title: this.problemSourceTitle(span), evidence: [...evidence]} : null;
  }

  private spanEvents(span: SpanRecord): Array<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(span.eventsJson) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((event): event is Record<string, unknown> => event != null && typeof event === 'object')
        : [];
    } catch { return []; }
  }

  private structuredToolFailure(span: SpanRecord): string | null {
    const raw = this.attributes(span)['gen_ai.tool.call.result'];
    if (raw == null) return null;
    let result: unknown = raw;
    if (typeof raw === 'string') { try { result = JSON.parse(raw); } catch { /* Text result. */ } }
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const record = result as Record<string, unknown>;
      if (record['isError'] === true) return 'wynik narzędzia zawiera isError=true';
      if (record['success'] === false) return 'wynik narzędzia zawiera success=false';
      if (record['ok'] === false) return 'wynik narzędzia zawiera ok=false';
      const status = String(record['status'] ?? '').toLowerCase();
      if (['error', 'failed', 'failure'].includes(status)) return `wynik narzędzia ma status ${status}`;
      const exitCode = record['exitCode'] ?? record['exit_code'];
      if (exitCode != null && Number.isFinite(Number(exitCode)) && Number(exitCode) !== 0) return `narzędzie zakończyło się kodem ${exitCode}`;
    }
    if (typeof raw !== 'string') return null;
    const toolName = String(this.attributes(span)['gen_ai.tool.name'] ?? '');
    if (toolName === 'apply_patch') {
      const patchFailure = raw.match(/Applying patch failed with error:\s*([^\r\n]+)/i);
      if (patchFailure) return `apply_patch odrzucił zmianę — ${this.excerpt(patchFailure[1], 180)}`;
    }
    const exitCode = raw.match(/^(?:Process\s+)?Exit Code:\s*(-?\d+)\s*$/im);
    return exitCode && Number(exitCode[1]) !== 0 ? `polecenie zakończyło się kodem ${exitCode[1]}` : null;
  }

  private problemSourceTitle(span: SpanRecord): string {
    if (span.operationName === 'chat') return `Model ${span.model || ''}`.trim();
    if (span.operationName === 'execute_hook') return `Hook ${span.spanName}`;
    if (span.operationName === 'execute_tool') return `Narzędzie ${String(this.attributes(span)['gen_ai.tool.name'] ?? span.spanName)}`;
    return span.spanName || 'Operacja';
  }

  private telemetryValue(span: SpanRecord, key: string, fallback: string): string {
    const value = this.attributes(span)[key];
    if (value == null || value === '') return fallback;
    if (typeof value !== 'string') return JSON.stringify(value, null, 2);
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }

  private excerpt(value: string, size = 430): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > size ? normalized.slice(0, size).trimEnd() + '…' : normalized;
  }

  private jsonAttribute(span: SpanRecord, key: string): unknown {
    let cache = this.jsonAttributeCache.get(span);
    if (!cache) { cache = new Map<string, unknown>(); this.jsonAttributeCache.set(span, cache); }
    if (cache.has(key)) return cache.get(key);
    const raw = this.attributes(span)[key];
    let value: unknown = raw;
    if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { /* Text value. */ } }
    cache.set(key, value);
    return value;
  }

  private attributes(span: SpanRecord): Record<string, unknown> {
    const cached = this.attributeCache.get(span);
    if (cached) return cached;
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(span.attributesJson) as Record<string, unknown>; } catch { /* Invalid telemetry. */ }
    this.attributeCache.set(span, parsed);
    return parsed;
  }

  private timestamp(value?: string): number { return value ? new Date(value).getTime() : 0; }

  private polishPlural(count: number, one: string, few: string, many: string): string {
    if (count === 1) return one;
    const lastTwo = count % 100;
    const last = count % 10;
    return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
  }
}
