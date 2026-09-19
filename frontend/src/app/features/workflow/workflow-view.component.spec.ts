import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WorkflowViewComponent} from './workflow-view.component';
import {WorkflowAnalysisService} from '../../core/workflow-analysis.service';
import {chat, detail, span, workflowFixture} from '../../core/workflow/workflow.fixtures';
import {ScannerApiService} from '../../core/scanner-api.service';
import {NotificationService} from '../../core/notification.service';
import {ActionCategory, ToolClassificationRequest, ToolClassificationResult} from '../../models/tool-classification.models';
import {RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {RoundDetailsAsideComponent} from '../round-details/round-details-aside.component';
import {known} from '../../core/workflow/telemetry';

describe('WorkflowViewComponent', () => {
  let fixture: ComponentFixture<WorkflowViewComponent>;
  const classify = vi.fn<(sessionId: number, request: ToolClassificationRequest) => Promise<ToolClassificationResult>>();
  const cached = vi.fn<(sessionId: number, request: ToolClassificationRequest) => Promise<ToolClassificationResult | null>>();
  const notifyError = vi.fn();
  beforeEach(async () => {
    classify.mockReset(); cached.mockReset().mockResolvedValue(null); notifyError.mockReset();
    TestBed.configureTestingModule({providers: [{provide: ScannerApiService, useValue: {classifyTools: classify, cachedToolClassification: cached}}, {provide: NotificationService, useValue: {error: notifyError}}]});
    const [root, child] = workflowFixture();
    root.spans = root.spans.map(span => {
      const attrs = JSON.parse(span.attributesJson);
      if (span.id === 23) return {...span, attributesJson: JSON.stringify({...attrs, 'gen_ai.tool.name': 'delegate'})};
      if (span.operationName !== 'chat') return span;
      const calls = span.id === 1 ? [{type: 'tool_call', id: 'call-21', name: 'custom_operation', arguments: {path: 'src/Main.java'}}]
        : span.id === 2 ? [{type: 'tool_call', id: 'child', name: 'delegate', arguments: {task: 'Compare alternatives'}}]
        : span.id === 3 ? [{type: 'tool_call', id: 'call-24', name: 'custom_operation', arguments: {path: 'src/Other.java'}}] : [];
      return {...span, attributesJson: JSON.stringify({...attrs,
        'gen_ai.tool.definitions': [{name: 'custom_operation', description: 'Read any file'}, {name: 'delegate', description: 'Launch a subagent'}],
        'gen_ai.output.messages': [{role: 'assistant', parts: calls.length ? calls : [{type: 'text', text: 'Synthetic response'}]}],
        ...(span.id === 4 ? {'gen_ai.input.messages': [{role: 'tool', parts: [{type: 'tool_call_response', id: 'child', response: 'synthetic result'}]}]} : {})})};
    });
    const analysis = await new WorkflowAnalysisService().analyze(root, [child]);
    fixture = TestBed.createComponent(WorkflowViewComponent);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLDivElement>('.map-scroll')!.scrollTo = vi.fn();
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  it('leads with the actual user request and a selectable map without duplicated round measurements', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.interaction-node')?.textContent).toContain('Porównaj dwa warianty');
    expect(element.querySelectorAll('.agent-lane')).toHaveLength(2);
    expect(element.querySelectorAll('.model-round-node')).toHaveLength(9);
    expect(element.querySelectorAll('.boundary-node')).toHaveLength(1);
    expect(element.querySelectorAll('.final-response-node')).toHaveLength(1);
    expect(element.querySelector('.measurements')).toBeNull();
    expect(element.querySelector('.bottom-grid')).toBeNull();
    expect(element.querySelector('.rules-scroll')).toBeNull();
    expect(element.querySelectorAll('.delegation-edges > path')).toHaveLength(2);
    expect(element.querySelector('.analysis-scope')?.textContent).toContain('CAŁA SESJA AGENTÓW');
    expect(element.querySelector('.analysis-menu-copy')?.textContent).toContain('9 rund pracy · 2 agentów');
    expect(element.querySelector('.map-status')?.textContent).toContain('ZAKRES: INTERAKCJA 1');
    expect([...element.querySelectorAll('button')].some(button => button.textContent?.includes('Zapytaj o sesję'))).toBe(true);
    expect([...element.querySelectorAll('button')].some(button => button.textContent?.includes('Poprzednie rozmowy'))).toBe(true);
    expect([...element.querySelectorAll('.child-lane .round-number')].map(node => node.textContent?.trim())).toEqual(['M1', 'M2']);
    expect(element.querySelector('.child-lane .lane-label')?.textContent).toContain('Potwierdzona delegacja');
    expect(element.querySelector('.child-lane .lane-label strong')?.textContent).toContain('Subagent 1');
    expect(element.querySelector('.handoff-caption')).toBeNull();
    expect(element.querySelector('.axis-label')?.textContent).toContain('Okno kontekstowe');
    expect(element.textContent).not.toContain('Presja promptu');
    expect(classify).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain('Akumulacja kontekstu');
    expect(element.textContent).not.toContain('Wzorzec heurystyczny');
    expect(element.querySelector('.phase-strip')).toBeNull();
  });

  it('changes the chart together with the selected data layer', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.analysis-menu .layer-switch')).not.toBeNull();
    expect(element.querySelector('.map-toolbar .layer-switch')).toBeNull();
    const switches = element.querySelectorAll<HTMLButtonElement>('.layer-switch button');
    switches[1].click(); fixture.detectChanges();
    expect(element.querySelector('.axis-label')?.textContent).toContain('Tokeny narastająco');
    expect([...element.querySelectorAll('.token-axis-title')].map(label => label.textContent?.trim())).toEqual(['Nowy input', 'Input z cache', 'Output', 'Cache write']);
    expect(element.querySelectorAll('.token-chart-row')).toHaveLength(4);
    expect(element.querySelectorAll('.token-layer-chart')).toHaveLength(4);
    expect(element.querySelectorAll('.token-series')).toHaveLength(4);
    expect(element.querySelectorAll('.token-layer-chart .point-value').length).toBeGreaterThan(0);
    expect(fixture.componentInstance.layerChartHeight()).toBe(448);
    const tokenSeries = new Map(fixture.componentInstance.layerChart().series.map(series => [series.id, series]));
    const sum = (key: 'fresh' | 'cache' | 'output' | 'cacheWrite' | 'credits') => fixture.componentInstance.columns()
      .reduce((total, round) => total + (known(round[key]) ?? 0), 0);
    expect(tokenSeries.get('fresh')?.total).toBe(sum('fresh'));
    expect(tokenSeries.get('cache')?.total).toBe(sum('cache'));
    expect(tokenSeries.get('output')?.total).toBe(sum('output'));
    for (const id of ['fresh', 'cache', 'output']) {
      expect(tokenSeries.get(id)?.points.at(-1)?.y).toBe(22);
    }
    switches[2].click(); fixture.detectChanges();
    expect(element.querySelector('.axis-label')?.textContent).toContain('Credits narastająco');
    expect(element.querySelector('.axis-label')?.textContent).toContain('Suma wyemitowanych credits');
    expect(element.querySelectorAll('.credits-series .point-value').length).toBeGreaterThan(0);
    expect(fixture.componentInstance.layerChart().series[0].total!).toBeCloseTo(sum('credits'));
    expect(fixture.componentInstance.layerChartHeight()).toBe(112);
    switches[0].click(); fixture.detectChanges();
    expect(element.querySelector('.axis-label')?.textContent).toContain('Okno kontekstowe');
  });

  it('synchronizes round, evidence and subagent flow when a child round is selected', () => {
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('.child-lane .round-node')!.click(); fixture.detectChanges();
    expect(fixture.componentInstance.selectedStream().label).toContain('Subagent 1');
    expect(element.querySelector('.delegation-panel')?.textContent).toContain('Potwierdzona relacja delegacji');
    expect(element.querySelectorAll('.round-node[aria-pressed="true"]')).toHaveLength(1);
    expect(element.querySelector<HTMLDetailsElement>('.subagent-details')?.open).toBe(false);
    expect(element.querySelector('.rules-scroll')).toBeNull();
    const panel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(panel?.kind).toBe('round');
    if (panel?.kind === 'round') {
      expect(panel.data.subagent).toBe(true);
      expect(panel.data.mode).toBe('cycle');
      expect(panel.data.headingContext).toContain('Subagent 1');
    }
  });

  it('opens the clicked workflow round directly in the universal factual panel', () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.model-round-node')!;
    button.click();
    const panel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(panel?.kind).toBe('round');
    if (panel?.kind === 'round') {
      expect(panel.data.mode).toBe('cycle');
      expect(panel.data.sourceTurn?.model.id).toBe(1);
      expect(panel.data.turn.model.id).toBe(2);
      expect(panel.navigation?.previous).toBeUndefined();
      expect(panel.navigation?.next).toBeTypeOf('function');
    }
    TestBed.inject(RoundDetailsPanelService).next();
    const nextPanel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(nextPanel?.kind === 'round' ? nextPanel.data.sourceTurn?.model.id : undefined).toBe(2);
    expect(nextPanel?.kind === 'round' ? nextPanel.data.turn.model.id : undefined).toBe(3);
  });

  it('selects one continuous round range without opening the factual panel', () => {
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('.round-range-toggle')!.click();
    fixture.detectChanges();
    const rounds = element.querySelectorAll<HTMLButtonElement>('.primary-lane .model-round-node');
    rounds[0].click();
    fixture.detectChanges();
    expect(element.querySelector('.round-range-bar')?.textContent).toContain('Początek: M1');
    expect(TestBed.inject(RoundDetailsPanelService).panel()).toBeNull();

    rounds[2].click();
    fixture.detectChanges();
    const range = element.querySelector('.round-range-bar');
    expect(range?.textContent).toContain('M1–M3');
    expect(range?.textContent).toContain('3 rundy bez przerw');
    expect(range?.textContent).toContain('pokrycie 3/3');
    expect(element.querySelectorAll('.range-selected')).toHaveLength(3);
    expect(element.querySelectorAll('.range-endpoint')).toHaveLength(2);
  });

  it('rejects a range end from another agent stream', () => {
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('.round-range-toggle')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.primary-lane .model-round-node')!.click();
    element.querySelector<HTMLButtonElement>('.child-lane .model-round-node')!.click();
    fixture.detectChanges();
    expect(notifyError).toHaveBeenCalledWith('Koniec zakresu musi należeć do tego samego agenta i tej samej interakcji co początek.');
    expect(element.querySelector('.round-range-bar')?.textContent).toContain('Początek: M1');
  });

  it('opens the initial request and final response from their colored flow nodes', () => {
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('.interaction-node')!.click();
    const initial = TestBed.inject(RoundDetailsPanelService).panel();
    expect(initial?.kind === 'round' ? initial.data.mode : undefined).toBe('request');
    expect(initial?.kind === 'round' ? initial.data.headingContext : '').toContain('start');
    element.querySelector<HTMLButtonElement>('.final-response-node')!.click();
    const response = TestBed.inject(RoundDetailsPanelService).panel();
    expect(response?.kind === 'round' ? response.data.mode : undefined).toBe('final');
    expect(response?.kind === 'round' ? response.data.headingContext : '').toContain('odpowiedź końcowa');
  });

  it('keeps an unknown context window measurement as a gap instead of zero', async () => {
    fixture.componentRef.setInput('analysis', await new WorkflowAnalysisService().analyze(detail([span(1)]), []));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.node-data')?.textContent).toContain('brak danych');
    expect(element.querySelectorAll('.layer-chart .context-series circle')).toHaveLength(0);
    expect(fixture.componentInstance.selected()).toBeTruthy();
  });

  it('shows SDK window state on the map without changing request occupancy', async () => {
    const model = span(1, {'gen_ai.conversation.id': 'root', 'gen_ai.usage.input_tokens': 100_425}, {
      eventsJson: JSON.stringify([{name: 'github.copilot.session.usage_info', attributes: {
        'github.copilot.current_tokens': 73_401, 'github.copilot.token_limit': 200_000}}])
    });
    const analysis = await new WorkflowAnalysisService().analyze(detail([model]), []);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.detectChanges();

    const round = fixture.componentInstance.columns()[0];
    expect(known(round.occupancy)).toBeUndefined();
    expect(known(round.sdkContext!)).toBeCloseTo(73_401 / 200_000);
    expect(fixture.componentInstance.sdkContextMode()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.map-legend')?.textContent).toContain('Stan okna sesji z SDK');
    expect((fixture.nativeElement as HTMLElement).querySelector('.model-round-node .node-data')?.textContent).toContain('36,7%');
    expect(fixture.componentInstance.roundLayerTooltip(round)).toContain('stanu okna SDK');
  });

  it('keeps a one-round chart and node on the same fixed-width column without stretching svg geometry', async () => {
    fixture.componentRef.setInput('analysis', await new WorkflowAnalysisService().analyze(detail([chat(91)]), []));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const chart = element.querySelector<SVGElement>('.layer-chart')!;
    expect(chart.style.width).toBe('176px');
    expect(chart.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(element.querySelector<HTMLElement>('.lane-track')?.style.gridTemplateColumns).toBe('repeat(2, 88px)');
    expect(element.querySelector('.layer-chart circle')?.getAttribute('cx')).toBe('132');
    expect([...element.querySelectorAll('.primary-lane .round-number')].map(node => node.textContent?.trim())).toEqual(['START', 'M1']);
    expect(element.querySelector('.final-response-node .node-caption')?.textContent).toContain('Odpowiedź');
  });

  it('shows compaction at the interaction boundary and opens its existing factual details panel', () => {
    fixture.componentRef.setInput('contextCompactions', [{
      id: '192/865', sessionId: 192, spanId: 865, agentName: 'summarizeConversationHistory-full', model: 'gpt-5.6-terra',
      startedAt: '2026-01-01T10:58:30Z', inputTokens: 96_756, outputTokens: 6_081, credits: 29.672,
      resultCharacters: 15_000, placementBeforeModelId: 1, resultObservedInModelId: 1, afterInteractionIndex: 1,
      beforeInputTokens: 120_243, afterInputTokens: 28_831
    }]);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const marker = element.querySelector<HTMLButtonElement>('.compaction-node')!;
    expect(marker.closest('.primary-lane')).not.toBeNull();
    expect(marker.textContent).toContain('Kompaktowanie');
    expect(marker.textContent).toContain('120,2\u00a0tys. → 28,8\u00a0tys.');
    element.querySelectorAll<HTMLButtonElement>('.layer-switch button')[2].click(); fixture.detectChanges();
    expect(marker.textContent).toContain('29,672');
    expect(element.querySelector('.analysis-menu-copy')?.textContent).toContain('1 kompaktowanie pokazane na osi');
    const guidance = vi.fn();
    fixture.componentInstance.optimizationGuide.subscribe(guidance);
    element.querySelector<HTMLButtonElement>('.compaction-guide-button')!.click();
    expect(guidance).toHaveBeenCalledWith(expect.objectContaining({context: expect.objectContaining({
      kind: 'COMPACTION', topics: ['CONTEXT_COMPACTION'], measurement: expect.objectContaining({credits: 29.672, inputTokens: 96_756}),
      evidence: [expect.objectContaining({kind: 'COMPACTION', id: '192/865'})]
    })}));
    expect(classify).not.toHaveBeenCalled();
    const compactionEvidence = guidance.mock.calls[0][0].context.evidence[0];
    fixture.componentInstance.openGuidanceEvidence(compactionEvidence);
    expect(TestBed.inject(RoundDetailsPanelService).panel()?.kind).toBe('template');
    marker.click();
    const panel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(panel?.kind).toBe('template');
    expect(panel?.ariaLabel).toBe('Szczegóły kompaktowania sesji');
  });

  it('renders only the universal M to A to M content in the aside', () => {
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('.model-round-node')!.click();
    const aside = TestBed.createComponent(RoundDetailsAsideComponent);
    try {
      aside.detectChanges();
      const content: HTMLElement = aside.nativeElement;
      expect(content.textContent).toContain('Model → agent → model');
      expect(content.textContent).toContain('Co model zlecił agentowi');
      expect(content.textContent).toContain('Co wróciło do modelu');
      expect(content.textContent).not.toContain('AKCJE ŻĄDANE PRZEZ MODEL');
      expect(content.textContent).not.toContain('Pokaż cykl M → A → M');
      TestBed.inject(RoundDetailsPanelService).next();
      aside.detectChanges();
      const next = TestBed.inject(RoundDetailsPanelService).panel();
      expect(next?.kind === 'round' ? next.data.sourceTurn?.model.id : undefined).toBe(2);
      expect(next?.kind === 'round' ? next.data.turn.model.id : undefined).toBe(3);
    } finally { TestBed.inject(RoundDetailsPanelService).close(); aside.destroy(); }
  });

  it('scrolls the expanded map by grabbing its background', () => {
    const element: HTMLElement = fixture.nativeElement;
    const scroll = element.querySelector<HTMLDivElement>('.map-scroll')!;
    scroll.scrollLeft = 300;
    scroll.setPointerCapture = vi.fn();
    scroll.hasPointerCapture = vi.fn().mockReturnValue(true);
    scroll.releasePointerCapture = vi.fn();
    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, {bubbles: true, cancelable: true});
      Object.defineProperties(event, {button: {value: 0}, pointerId: {value: 7}, clientX: {value: clientX}});
      return event;
    };
    element.querySelector('.map-canvas')!.dispatchEvent(pointer('pointerdown', 200));
    scroll.dispatchEvent(pointer('pointermove', 150));
    fixture.detectChanges();
    expect(scroll.scrollLeft).toBe(350);
    expect(scroll.classList.contains('dragging')).toBe(true);
    expect(element.querySelector('.locate-selection')).toBeNull();
    scroll.dispatchEvent(pointer('pointerup', 150));
    fixture.detectChanges();
    expect(scroll.classList.contains('dragging')).toBe(false);
    expect(scroll.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('offers visible horizontal navigation for a long interaction', () => {
    const element: HTMLElement = fixture.nativeElement;
    const scroll = element.querySelector<HTMLDivElement>('.map-scroll')!;
    scroll.scrollBy = vi.fn();
    expect(element.querySelector('.map-navigation-hint')?.textContent).toContain('10 kroków');
    element.querySelector<HTMLButtonElement>('button[aria-label="Przewiń mapę w prawo"]')!.click();
    expect(scroll.scrollBy).toHaveBeenCalledWith(expect.objectContaining({left: expect.any(Number), behavior: 'smooth'}));
  });

  it('changes interaction scope and resets selection when the session changes', async () => {
    fixture.componentRef.setInput('analysis', await new WorkflowAnalysisService().analyze(detail([chat(1), chat(2, 1000, 800, 50, {}, {traceId: 'second'})]), []));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.analysis-menu .interaction-switch')).not.toBeNull();
    expect(element.querySelector('.map-panel .interaction-switch')).toBeNull();
    fixture.componentInstance.analysisMenuCompact.set(true); fixture.detectChanges();
    expect(element.querySelector('.analysis-menu')?.classList.contains('compact')).toBe(true);
    expect(element.querySelector('.analysis-mini-label')?.textContent).toContain('Analiza przepływu');
    element.querySelectorAll<HTMLButtonElement>('.interaction-switch button')[1].click(); fixture.detectChanges();
    expect(element.querySelectorAll('.model-round-node')).toHaveLength(1);
    expect(element.querySelectorAll('.round-node')).toHaveLength(2);
    expect(element.querySelector('.interaction-node .node-caption')?.textContent).toContain('Interakcja 2');
    fixture.componentRef.setInput('analysis', await new WorkflowAnalysisService().analyze(detail([], 42, 'empty'), []));
    fixture.detectChanges();
    expect(element.querySelector('.empty-map')?.textContent).toContain('Mapa czeka');
    expect(element.querySelector('.explanation')).toBeNull();
  });

  it('classifies requested actions and derives agent profiles and can return to facts without another AI request', async () => {
    const actions = (round: ToolClassificationRequest['contexts'][number]['rounds'][number]): ActionCategory[] =>
      round.invocations.length ? [...new Set(round.invocations.map(invocation => invocation.name === 'delegate' ? 'DELEGATE' as const : 'ACQUIRE_DATA' as const))]
        : [round.outputObserved ? 'RESPOND' : 'UNKNOWN'];
    classify.mockImplementation(async (_sessionId, request) => ({version: 'model-actions-v5', model: 'test-model', analyzedAt: '2026-01-01T00:00:00Z',
      tools: request.tools.map(tool => ({id: tool.id, category: 'DATA_ACCESS', specialization: 'GENERAL_PURPOSE', reason: 'Pozyskuje dane z pliku.'})),
      assessments: request.contexts.flatMap(context => context.rounds.flatMap(round => round.invocations.map(invocation => ({contextId: context.id, invocationId: invocation.id,
        toolId: invocation.toolId, actions: [invocation.name === 'delegate' ? 'DELEGATE' : 'ACQUIRE_DATA'], fit: context.goal ? 'SUPPORTING' : 'UNKNOWN', reason: 'Żądanie pozyskania danych lub delegacji.'})))),
      rounds: request.contexts.flatMap(context => context.rounds.map(round => ({roundId: round.id, actions: actions(round),
        evidenceInvocationIds: round.invocations.map(invocation => invocation.id), reason: 'Żądana akcja wynika z odpowiedzi modelu.'})))}));
    fixture.componentRef.setInput('contextCompactions', [
      {id: 'compaction-before', sessionId: 192, spanId: 865, agentName: 'summarizeConversationHistory-full', model: 'gpt-5.6-terra',
        startedAt: '2026-01-01T10:58:30Z', inputTokens: 96_756, outputTokens: 6_081, credits: .3,
        resultCharacters: 15_000, placementBeforeModelId: 1, resultObservedInModelId: 1, afterInteractionIndex: 1},
      {id: 'compaction-after', sessionId: 193, spanId: 866, agentName: 'summarizeConversationHistory-full', model: 'gpt-5.6-terra',
        startedAt: '2026-01-01T11:15:00Z', inputTokens: 12_793, outputTokens: 4_474, credits: .2,
        resultCharacters: 11_000}
    ]);
    fixture.detectChanges();
    await fixture.componentInstance.classifyTools(); fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(classify).toHaveBeenCalledTimes(1);
    expect(element.querySelector('.phase-strip')?.textContent).toContain('Pozyskanie danych');
    const firstRound = fixture.componentInstance.lanes()[0].rounds[0];
    expect(fixture.componentInstance.roundCategory(firstRound)).toBe('ACQUIRE_DATA');
    expect(fixture.componentInstance.agentProfile(fixture.componentInstance.lanes()[0].stream)).toContainEqual({action: 'ACQUIRE_DATA', count: 2});
    expect(element.querySelector('.action-summary')?.textContent).toContain('PODZIAŁ CREDITS');
    expect(element.querySelector('.action-summary')?.textContent).toContain('Pozyskanie danych');
    expect(element.querySelector('.action-summary')?.textContent).toContain('Żądanie delegacji');
    expect(element.querySelector('.action-summary')?.textContent).toContain('Ujęte w kategoriach');
    expect(element.querySelector('.action-summary')?.textContent).toContain('Poza kategoriami');
    expect(element.querySelector('.action-summary')?.textContent).toContain('Kompaktowanie kontekstu');
    expect(element.querySelector('.compaction-category .action-credit-share strong')?.textContent).not.toContain('≈');
    expect(element.querySelector('.optimization-hero')?.textContent).toContain('NAJWIĘKSZY OBSZAR DO SPRAWDZENIA');
    expect(element.querySelector('.optimization-hero')?.textContent).not.toContain('Co warto sprawdzić');
    expect(element.querySelectorAll('.action-ranking-row').length).toBeGreaterThan(1);
    expect(element.querySelectorAll('.category-guide-button')).toHaveLength(fixture.componentInstance.creditCategories().length);
    expect(element.querySelector('.action-summary details')).toBeNull();
    expect(element.querySelector('.action-credit-total')).toBeNull();
    expect(element.querySelector('.action-credit-share')?.textContent).toContain('%');
    expect(element.querySelector('.action-summary')?.textContent).toContain('credits objętych zestawieniem');
    expect(element.querySelector('.action-summary .info-tip')).not.toBeNull();
    expect(fixture.componentInstance.analyzedCreditsTooltip()).toContain('nie wylicza credits');
    expect(fixture.componentInstance.analyzedCreditsTooltip()).toContain('nie są wysyłane do AI');
    expect(element.querySelector('.classification-ready')?.textContent).toContain('Analiza gotowa');
    expect(element.querySelector('.map-scroll')).not.toBeNull();
    expect(element.querySelector('.phase-panel')?.textContent).toContain('ZAGREGOWANY PRZEBIEG · AGENT, SUBAGENCI I KOMPAKTOWANIA');
    expect(element.querySelector('.map-panel')?.textContent).toContain('SZCZEGÓŁOWY PRZEBIEG · RUNDY MODELU');
    expect([...element.querySelectorAll('.action-summary, .phase-panel, .map-panel')].map(node => node.className)).toEqual([
      'action-summary', 'phase-panel', 'map-panel'
    ]);
    const phases = fixture.componentInstance.aggregatedPhases();
    const roundPhases = phases.filter(phase => !phase.compaction);
    expect(phases.flatMap(phase => phase.rounds.map(round => round.ref))).toEqual(fixture.componentInstance.columns().map(round => round.ref));
    expect(phases[0]).toMatchObject({label: 'Kompaktowanie kontekstu', credits: .3, totalCalls: 1});
    expect(phases.at(-1)).toMatchObject({label: 'Kompaktowanie kontekstu', credits: .2, totalCalls: 1});
    expect(phases.flatMap(phase => phase.roundLabels)).toContain('S1:M1');
    expect(phases.flatMap(phase => phase.roundLabels)).toContain('S1:M2');
    expect(roundPhases.at(-1)?.roundLabels).toEqual(['M4', 'M5', 'M6', 'M7']);
    expect(roundPhases.at(-1)).toMatchObject({credits: .4, creditCovered: 4});
    expect([...element.querySelectorAll('.phase-card:not(.compaction-phase)')].at(-1)?.textContent).toContain('M4–M7');
    expect([...element.querySelectorAll('.phase-card:not(.compaction-phase)')].at(-1)?.textContent).toContain('Maks. okno w fazie');
    expect(element.querySelector('.compaction-phase .phase-metric')?.textContent).toContain('Input przed → po');
    element.querySelectorAll<HTMLButtonElement>('.layer-switch button')[1].click(); fixture.detectChanges();
    expect([...element.querySelectorAll('.phase-card:not(.compaction-phase)')].at(-1)?.textContent).toContain('Input / output fazy');
    element.querySelectorAll<HTMLButtonElement>('.layer-switch button')[2].click(); fixture.detectChanges();
    expect([...element.querySelectorAll('.phase-card:not(.compaction-phase)')].at(-1)?.textContent).toContain('Credits wywołań w fazie0,4');
    expect(element.querySelectorAll('.compaction-phase')).toHaveLength(2);
    expect(element.querySelector('.compaction-phase')?.textContent).toContain('Fakt z telemetrii · poza analizą AI');
    expect(element.querySelectorAll('.phase-category-icon')).toHaveLength(phases.length);
    expect(element.querySelectorAll('.phase-actor-icon')).toHaveLength(phases.length);
    expect(element.querySelector('.phase-card:not(.compaction-phase) .phase-round-copy')?.textContent).toContain('Główny agent');
    expect(phases.filter(phase => phase.toolShares.length).every(phase => phase.toolShares.reduce((total, share) => total + share.percent, 0) === 100)).toBe(true);
    expect(element.querySelector('.phase-tool-mix')?.textContent).toContain('Uniwersalne 100%');
    expect(element.querySelector('.phase-tool-mix.general-only')).not.toBeNull();
    expect(element.querySelectorAll('.phase-tool-bar').length).toBe(phases.filter(phase => phase.toolShares.length > 1).length);
    expect(element.querySelector('.phase-card:not(.compaction-phase) .phase-tool-empty')?.textContent).toContain('Bez żądań narzędzi');
    expect(element.querySelectorAll('.phase-title[tabindex="0"]')).toHaveLength(phases.length);
    expect(fixture.componentInstance.phaseCategoryTooltip(roundPhases[0])).toContain('kategoria działania');
    expect(fixture.componentInstance.phaseCategoryTooltip(phases[0])).toContain('Nie jest kategorią nadaną przez AI');
    expect(fixture.componentInstance.phaseRoundsTooltip()).toContain('S1:M2');
    expect(fixture.componentInstance.phaseToolMixTooltip()).toContain('nie unikalne nazwy');
    expect(fixture.componentInstance.phaseToolSpecializationTooltip('GENERAL_PURPOSE')).toContain('Sam udział nie dowodzi nieefektywności');
    expect(fixture.componentInstance.phaseCreditsTooltip({...roundPhases[0], creditCovered: 0})).toContain('brak nie oznacza zera');
    expect(fixture.componentInstance.phaseCreditsTooltip(roundPhases[0])).toContain('Nie musi odpowiadać procentowi kategorii');
    expect(fixture.componentInstance.phaseCreditsTooltip(phases[0])).toContain('fakt z telemetrii');
    expect(phases.every(phase => phase.creditStrength.endsWith('%'))).toBe(true);
    expect(element.querySelector('.optimization-guidance')).toBeNull();
    expect(element.querySelectorAll('.phase-guide-button')).toHaveLength(phases.length);
    expect([...element.querySelectorAll<HTMLButtonElement>('.phase-guide-button')].every(button =>
      button.getAttribute('aria-label')?.startsWith('Poznaj techniki dla fazy:') && !button.textContent?.includes('Poznaj techniki'))).toBe(true);
    const guidance = vi.fn();
    fixture.componentInstance.optimizationGuide.subscribe(guidance);
    const acquireRow = [...element.querySelectorAll<HTMLElement>('.action-ranking-row')]
      .find(row => row.textContent?.includes('Pozyskanie danych'))!;
    acquireRow.querySelector<HTMLButtonElement>('.category-guide-button')!.click();
    expect(guidance).toHaveBeenLastCalledWith(expect.objectContaining({context: expect.objectContaining({
      kind: 'CATEGORY', topics: expect.arrayContaining(['ACQUIRE_DATA']), measurement: expect.objectContaining({creditEstimated: true}),
      evidence: expect.arrayContaining([expect.objectContaining({kind: 'ROUND'})])
    })}));
    element.querySelector<HTMLButtonElement>('.phase-card:not(.compaction-phase) .phase-guide-button')!.click();
    expect(guidance).toHaveBeenLastCalledWith(expect.objectContaining({context: expect.objectContaining({
      kind: 'PHASE', measurement: expect.objectContaining({creditEstimated: false}),
      evidence: expect.arrayContaining([expect.objectContaining({kind: 'ROUND'})])
    })}));
    expect(element.querySelectorAll('.phase-step')).toHaveLength(phases.length);
    expect(element.querySelectorAll('.phase-arrow')).toHaveLength(phases.length);
    expect(element.querySelectorAll('.phase-arrow-placeholder')).toHaveLength(1);
    const expandedLabels = [...element.querySelectorAll('.model-round-node .node-caption')].map(node => node.textContent?.trim());
    expect(expandedLabels).toContain('Pozyskanie danych');
    expect(expandedLabels).toContain('Żądanie delegacji');
    expect(element.querySelector('.lane-functions')?.textContent).toContain('Pozyskanie danych');
    element.querySelector<HTMLButtonElement>('.map-detail-toggle')!.click(); fixture.detectChanges();
    expect(element.querySelector('.map-scroll')).toBeNull();
    expect(fixture.componentInstance.actionSummary().find(item => item.action === 'ACQUIRE_DATA')).toMatchObject({count: 2, mainCount: 2, subagentCount: 0});
    expect(fixture.componentInstance.actionSummary().find(item => item.action === 'UNKNOWN')).toMatchObject({count: 2, mainCount: 0, subagentCount: 2});
    const creditAttribution = fixture.componentInstance.creditAttribution()!;
    expect(creditAttribution.knownCredits).toBeCloseTo(.9);
    expect(creditAttribution.assignedCredits! + creditAttribution.unattributedCredits!).toBeCloseTo(.9);
    expect(fixture.componentInstance.analyzedCreditScope()?.knownCredits).toBeCloseTo(1.4);
    expect(fixture.componentInstance.analyzedCreditScope()?.totalCalls).toBe(11);
    expect(fixture.componentInstance.creditCategories().find(item => item.id === 'CONTEXT_COMPACTION')).toMatchObject({totalCredits: .5, estimated: false});
    expect(fixture.componentInstance.creditCategories().find(item => item.id === 'CONTEXT_COMPACTION')?.shareOfKnown).toBeCloseTo(35.714, 3);
    expect(fixture.componentInstance.compactRoundLabels(['S2:M1', 'S2:M2', 'S2:M3', 'M5', 'M7'])).toBe('S2:M1–M3 · M5 · M7');
    expect(element.querySelector('.category-credits')).toBeNull();
    fixture.componentInstance.setAnalysisView('facts'); fixture.detectChanges();
    expect(element.querySelector('.phase-strip')).toBeNull();
    fixture.componentInstance.setAnalysisView('classification'); fixture.detectChanges();
    expect(element.querySelector('.phase-strip')).not.toBeNull();
    await fixture.componentInstance.classifyTools();
    expect(classify).toHaveBeenCalledTimes(1);
  });
  it('shows a bounded token estimate for the optional classification request', () => {
    const estimate = fixture.componentInstance.classificationEstimate();
    expect(estimate.outputMax).toBeGreaterThan(estimate.output);
    expect(fixture.componentInstance.classificationEstimateTooltip()).toContain('do modelu ≈');
    expect(fixture.componentInstance.classificationEstimateTooltip()).toContain('odpowiedź ≈');
  });
  it('keeps facts available after an AI failure and reports a snackbar error', async () => {
    classify.mockRejectedValue(new Error('Ustaw token w konfiguracji.'));
    await fixture.componentInstance.classifyTools(); fixture.detectChanges();
    expect(notifyError).toHaveBeenCalledWith('Ustaw token w konfiguracji.');
    expect(fixture.nativeElement.querySelector('.phase-strip')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.model-round-node')).toHaveLength(9);
    expect(fixture.componentInstance.classifying()).toBe(false);
  });
});
