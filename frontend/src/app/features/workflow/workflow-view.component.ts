import {NgTemplateOutlet} from '@angular/common';
import {ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal, TemplateRef, viewChild} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {Metric, RoundObservation, WorkflowAnalysis, WorkflowStream} from '../../models/workflow.models';
import {known, ordered} from '../../core/workflow/telemetry';
import {flowToolCatalog} from '../../core/flow-tool-catalog';
import {modelActionEvidence} from '../../core/model-action-evidence';
import {RoundDetailsPanelOpenMode, RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {ContextCompactionMeasurement, SessionDetail} from '../../models/scanner.models';
import {ContextCompactionDetailsComponent} from '../context-compaction/context-compaction-details.component';

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
@Component({
  selector: 'as-workflow-view',
  imports: [NgTemplateOutlet, MatIconModule, MatTooltipModule, ContextCompactionDetailsComponent],
  templateUrl: './workflow-view.component.html', styleUrl: './workflow-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorkflowViewComponent {
  readonly analysis = input.required<WorkflowAnalysis>();
  readonly refreshing = input(false);
  readonly contextCompactions = input<ContextCompactionMeasurement[]>([]);
  readonly relatedDetails = input<SessionDetail[]>([]);
  readonly creditTooltip = input('GitHub Copilot AI credits wyemitowane w telemetrii. To zużycie kredytów, nie kwota pieniężna.');
  private readonly detailsPanel = inject(RoundDetailsPanelService);
  private readonly selection = signal<{session: number; ref: string} | undefined>(undefined);
  private readonly interactionSelection = signal<{session: number; trace: string} | undefined>(undefined);
  readonly layer = signal<'context' | 'tokens' | 'credits'>('context');
  readonly mapDragging = signal(false);
  private readonly mapScroll = viewChild<ElementRef<HTMLDivElement>>('mapScroll');
  private mapDrag?: {pointerId: number; startX: number; scrollLeft: number};
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
  readonly catalog = computed(() => flowToolCatalog(this.analysis()));
  readonly actionEvidence = computed(() => modelActionEvidence(this.analysis(), this.catalog()));
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
  roundCaption(round: RoundObservation): string { return round.tools.length ? this.plural(round.tools.length, 'użycie', 'użycia', 'użyć') : 'Model'; }
  roundIcon(round: RoundObservation): string { return round.tools.length ? 'build' : 'chat_bubble_outline'; }
  roundDescription(round: RoundObservation): string {
    return this.plural(round.tools.length, 'zapisane użycie narzędzia', 'zapisane użycia narzędzi', 'zapisanych użyć narzędzi');
  }
  linkedRoundLabel(round: RoundObservation): string {
    const stream = this.analysis().streams.find(item => item.id === round.streamId);
    return `${stream ? this.streamDisplayLabel(stream) : 'Agent'} · interakcja ${round.turn.interactionIndex} · ${this.roundLabel(round)}`;
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
  readonly sdkContextMode = computed(() => {
    const rounds = this.lanes()[0]?.rounds ?? [];
    return rounds.length > 0 && rounds.every(round => known(round.occupancy) === undefined)
      && rounds.some(round => round.sdkContext && known(round.sdkContext) !== undefined);
  });
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
      const sdk = this.sdkContextMode();
      return {
        title: 'Okno kontekstowe', scope: 'Główny agent', unit: sdk ? 'Stan okna SDK' : 'Input / całe okno',
        ariaLabel: sdk
          ? 'Stan okna sesji wyemitowany przez SDK w kolejnych rundach; przerwy oznaczają brak danych lub granicę sekwencji'
          : 'Zajęcie okna kontekstowego w kolejnych rundach głównego agenta; przerwy oznaczają brak danych lub granicę sekwencji',
        series: [this.directSeries('context', sdk ? 'Stan okna SDK' : 'Zajęcie okna', 'context-series', rounds,
          round => known(this.contextMetric(round)), 1, value => this.percentLabel(value), true)],
        missingX: rounds.filter(round => known(this.contextMetric(round)) === undefined).map(round => this.x(round)), showPointLabels: true
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
  contextMetric(round: RoundObservation): Metric {
    return this.sdkContextMode() ? round.sdkContext ?? {
      availability: 'missing', sourceAttributes: ['github.copilot.current_tokens', 'github.copilot.token_limit'],
      evidenceRefs: [round.ref]
    } : round.occupancy;
  }
  compact(value?: number | null): string { return value == null ? '—' : this.compactFormat.format(value); }
  credits(value: number): string { return this.numberFormat.format(value); }
  percent(metric: Metric): number { return Math.min(100, Math.max(0, (known(metric) ?? 0) * 100)); }
  known(metric: Metric): boolean { return known(metric) !== undefined; }
  roundLabel(round: RoundObservation): string { return `Runda ${round.turn.interactionTurnIndex}`; }
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
    if (this.layer() === 'context') return `${description} · ${known(this.contextMetric(round)) !== undefined
      ? this.value(this.contextMetric(round), '%') + (this.sdkContextMode() ? ' stanu okna SDK' : ' okna kontekstowego')
      : 'brak pomiaru okna kontekstowego'}`;
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
    this.interactionSelection.set({session: this.analysis().source.session.id, trace});
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
