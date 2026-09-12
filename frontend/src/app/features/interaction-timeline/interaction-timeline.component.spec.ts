import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {SessionDetail, SpanRecord} from '../../models/scanner.models';
import {InteractionTimelineComponent} from './interaction-timeline.component';
import {mixedEpisodeFixture} from '../../core/workflow/mixed-episode.fixture';
import {RoundDetailsPanelService} from '../../core/round-details-panel.service';

describe('InteractionTimelineComponent', () => {
  let fixture: ComponentFixture<InteractionTimelineComponent>;
  let component: InteractionTimelineComponent;

  beforeEach(() => {
    fixture = TestBed.createComponent(InteractionTimelineComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('turns', []);
    fixture.componentRef.setInput('interactions', []);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('calibrationSpans', []);
    fixture.componentRef.setInput('detail', detail());
    fixture.componentRef.setInput('creditTooltip', 'AI credits');
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('shows every child round and its tools when the episode was split across stored sessions', () => {
    const [root, child] = mixedEpisodeFixture();
    fixture.componentRef.setInput('detail', root);
    fixture.componentRef.setInput('relatedDetails', [child]);
    const launch = root.spans.find(span => span.id === 2000)!;
    expect(component.subagentModelCalls(launch)).toHaveLength(16);
    expect(component.subagentTools(launch)).toHaveLength(15);
    expect(component.subagentTurns(launch)[4].tools[0].statusCode).toBe('STATUS_CODE_ERROR');
    expect(component.subagentCredits(launch)).toBeCloseTo(1.6);
    expect(component.friendlyToolTitle(launch)).toBe('Subagent');
  });

  it('marks a round when telemetry explicitly reports an error', () => {
    const model = span({operationName: 'chat'});
    const failedTool = span({
      operationName: 'execute_tool',
      statusCode: 'STATUS_CODE_ERROR',
      statusMessage: 'Permission denied',
      attributesJson: JSON.stringify({'gen_ai.tool.name': 'create_file'})
    });
    const turn = {index: 2, model, tools: [failedTool]};

    expect(component.roundHasConfirmedProblem(turn)).toBe(true);
    expect(component.roundProblemTooltip(turn)).toContain('Narzędzie create_file');
    expect(component.roundProblemTooltip(turn)).toContain('Permission denied');
  });

  it('renders absent round metrics as missing while preserving explicitly emitted zero', () => {
    const limits = {'copilot_chat.request.max_prompt_tokens': 272000, 'gen_ai.request.max_tokens': 128000};
    const missing = span({id: 1, attributesJson: JSON.stringify(limits)});
    const zero = span({id: 2, attributesJson: JSON.stringify({...limits,
      'gen_ai.usage.input_tokens': 0, 'gen_ai.usage.cache_read.input_tokens': 0, 'gen_ai.usage.output_tokens': 0})});
    fixture.componentRef.setInput('turns', [missing, zero].map((model, index) => ({index: index + 1, model, tools: []})));
    fixture.detectChanges();
    const initial = fixture.nativeElement.querySelector('.initial-request-row') as HTMLElement;
    const cycle = fixture.nativeElement.querySelector('.cycle-row') as HTMLElement;
    const tokens = (row: HTMLElement) => [...row.querySelectorAll('.round-token:not(.credits) strong')].map(item => item.textContent?.trim());
    expect(tokens(initial)).toEqual(['—', '—', '—']);
    expect(tokens(cycle)).toEqual(['—', '0', '0', '0']);
    expect(initial.querySelector('.round-context-summary strong')?.textContent).toBe('—');
    expect(cycle.querySelector('.round-context-summary strong')?.textContent).toBe('0,0%');
  });

  it('names the primary execution section as the main agent work and result', () => {
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.rounds-section > .rounds-heading h2')?.textContent?.trim())
      .toBe('Praca i rezultat głównego Agenta');
  });

  it('does not calculate fresh input or window usage from missing or invalid operands', () => {
    const model = span({inputTokens: 500, attributesJson: JSON.stringify({'gen_ai.usage.input_tokens': 500,
      'gen_ai.usage.cache_read.input_tokens': false, 'gen_ai.usage.output_tokens': -1})});
    expect(component.roundTokenLabel(model, 'input')).toBe('500');
    expect(component.roundTokenLabel(model, 'fresh')).toBe('—');
    expect(component.roundTokenLabel(model, 'cache')).toBe('—');
    expect(component.roundTokenLabel(model, 'output')).toBe('—');
    expect(component.roundContextPercentLabel({index: 1, model, tools: []})).toBe('—');
  });

  it('recognizes structured tool failures and the apply_patch failure contract', () => {
    const model = span({operationName: 'chat'});
    const structuredFailure = span({
      operationName: 'execute_tool',
      attributesJson: JSON.stringify({
        'gen_ai.tool.name': 'custom_tool',
        'gen_ai.tool.call.result': JSON.stringify({isError: true})
      })
    });
    const patchFailure = span({
      operationName: 'execute_tool',
      attributesJson: JSON.stringify({
        'gen_ai.tool.name': 'apply_patch',
        'gen_ai.tool.call.result': 'Applying patch failed with error: Invalid Add File Line'
      })
    });

    expect(component.roundHasConfirmedProblem({index: 1, model, tools: [structuredFailure]})).toBe(true);
    expect(component.roundProblemTooltip({index: 1, model, tools: [patchFailure]})).toContain('Invalid Add File Line');
  });

  it('does not treat error-looking arbitrary tool content as a confirmed failure', () => {
    const model = span({operationName: 'chat'});
    const informationalResult = span({
      operationName: 'execute_tool',
      attributesJson: JSON.stringify({
        'gen_ai.tool.name': 'read_file',
        'gen_ai.tool.call.result': 'Documentation example: error: invalid input'
      })
    });

    expect(component.roundHasConfirmedProblem({index: 1, model, tools: [informationalResult]})).toBe(false);
  });

  it('shows auxiliary model requests below the interaction timeline', () => {
    const auxiliary = span({
      id: 17,
      model: 'gpt-helper',
      inputTokens: 120,
      cacheReadTokens: 80,
      outputTokens: 12,
      startedAt: '2026-01-01T10:00:00Z'
    });
    fixture.componentRef.setInput('relatedModelCalls', [{span: auxiliary, label: 'Generowanie tytułu'}]);
    fixture.detectChanges();

    const section = fixture.nativeElement.querySelector('.auxiliary-calls') as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.textContent).toContain('Pozostałe wywołania modeli pomocniczych');
    expect(section.textContent).toContain('Generowanie tytułu');
  });

  it('shows compaction as a cost bar and opens user-facing request and result details', () => {
    const model = span({id: 18, traceId: 'trace-2', spanId: 'after-summary', startedAt: '2026-01-01T11:00:00Z'});
    const turn = {index: 2, interactionIndex: 2, interactionTurnIndex: 1, model, tools: []};
    const compactionSpan = span({id: 865, traceId: 'compact-trace', spanId: 'compact', model: 'gpt-5.6-terra', startedAt: '2026-01-01T10:58:30Z', durationMs: 52435,
      attributesJson: JSON.stringify({
        'gen_ai.agent.name': 'summarizeConversationHistory-full',
        'copilot_chat.user_request': 'Summarize the conversation history.',
        'gen_ai.system_instructions': 'Compaction rules\n## Additional instructions from the user:\nnie pomijaj szczegółów',
        'copilot_chat.request.options': JSON.stringify({tool_choice: 'none'})
      })});
    const compactionSource = detail();
    compactionSource.session = {...compactionSource.session, id: 192, agentName: 'summarizeConversationHistory-full'};
    compactionSource.spans = [compactionSpan];
    compactionSource.messages = [
      {id: 1, spanId: 865, direction: 'input', sequenceNo: 0, roleName: 'user', content: JSON.stringify({role: 'user', content: 'Historia rozmowy'}), sourceKind: 'telemetry'},
      {id: 2, spanId: 865, direction: 'definition', sequenceNo: 0, content: JSON.stringify({name: 'read_file'}), sourceKind: 'telemetry'},
      {id: 3, spanId: 865, direction: 'output', sequenceNo: 0, roleName: 'assistant', content: JSON.stringify({role: 'assistant', content: '<summary>Skrócony stan pracy</summary>'}), sourceKind: 'telemetry'}
    ];
    fixture.componentRef.setInput('turns', [turn]);
    fixture.componentRef.setInput('interactions', [{index: 2, traceId: 'trace-2', prompt: 'kontynuuj', turns: [turn]}]);
    fixture.componentRef.setInput('relatedDetails', [compactionSource]);
    fixture.componentRef.setInput('contextCompactions', [{
      id: '192/865', sessionId: 192, spanId: 865, agentName: 'summarizeConversationHistory-full',
      model: 'gpt-5.6-terra',
      startedAt: '2026-01-01T10:58:30Z', durationMs: 52435, placementBeforeModelId: model.id,
      resultObservedInModelId: model.id, beforeInteractionIndex: 1, afterInteractionIndex: 2,
      beforeInputTokens: 120243, afterInputTokens: 28831, beforeOccupancy: .3006075, afterOccupancy: .0720775,
      inputTokens: 96756, freshInputTokens: 88884, cacheReadTokens: 7872, outputTokens: 6081,
      reasoningTokens: 54, credits: 29.67189, resultCharacters: 19
    }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.timeline-compaction') as HTMLElement;
    expect(marker.textContent).toContain('Kompaktowanie sesji');
    expect(marker.textContent).toContain('PRACA W OSOBNEJ SESJI');
    expect(marker.textContent).not.toContain('PRZED INTERAKCJĄ 2');
    expect(marker.textContent).toContain('96 756');
    expect(marker.textContent).toContain('6081');
    expect(marker.textContent).toContain('29,672');
    expect(marker.textContent).toContain('gpt-5.6-terra');
    expect(marker.textContent).not.toContain('76,0% mniej');
    expect(marker.querySelector('.compaction-output strong')?.textContent?.trim()).toBe('6081');
    expect([...marker.querySelectorAll('.compaction-input-equation strong')].map(item => item.textContent?.trim())).toEqual(['88 884', '7872', '96 756']);
    expect(marker.querySelector('.compaction-credits strong')?.textContent?.trim()).toBe('29,672');

    marker.querySelector<HTMLElement>('.detail-trigger')!.click();
    const panel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(panel?.kind).toBe('template');
    if (panel?.kind === 'template') {
      expect(panel.title).toBe('Kompaktowanie sesji');
      expect(panel.context).toEqual({$implicit: component.contextCompactions()[0]});
      const view = panel.template.createEmbeddedView(panel.context ?? {});
      view.detectChanges();
      const host = document.createElement('div');
      for (const node of view.rootNodes) host.append(node);
      expect(host.textContent).toContain('Osobny model przygotował krótszy zapis rozmowy');
      expect(host.textContent).toContain('MODEL UŻYTY DO KOMPAKTOWANIA');
      expect(host.textContent).toContain('gpt-5.6-terra');
      expect(host.textContent).toContain('ZASADY I FORMAT REZULTATU');
      expect(host.textContent).toContain('System instructions');
      expect(host.textContent).toContain('Compaction rules');
      expect(host.textContent).toContain('ZADANIE W TYM WYWOŁANIU');
      expect(host.textContent).toContain('nie pomijaj szczegółów');
      expect(host.textContent).toContain('Summarize the conversation history.');
      expect(host.textContent).toContain('Messages / input items');
      expect(host.textContent).toContain('read_file');
      expect(host.textContent).toContain('Skrócony stan pracy');
      expect(host.textContent).toContain('102 837 tokenów');
      expect(host.textContent).toContain('76,0% mniej');
      expect(host.textContent).toContain('30,1% → 7,2%');
      expect(host.textContent).not.toContain('Jak Scanner powiązał');
      expect(host.textContent).not.toContain('conversation-summary');
      expect(host.textContent?.match(/Compaction rules/g)).toHaveLength(1);
      view.destroy();
    }
  });

  it('shows a later compaction even when telemetry has no following model request', () => {
    const model = span({id: 19, traceId: 'trace-3', spanId: 'after-summary'});
    const turn = {index: 1, interactionIndex: 2, interactionTurnIndex: 1, model, tools: []};
    fixture.componentRef.setInput('turns', [turn]);
    fixture.componentRef.setInput('interactions', [{index: 2, traceId: 'trace-3', prompt: 'dalej', turns: [turn]}]);
    fixture.componentRef.setInput('contextCompactions', [{
      id: '196/872', sessionId: 196, spanId: 872, agentName: 'summarizeConversationHistory-full',
      startedAt: '2026-01-02T14:00:21Z', durationMs: 68000, inputTokens: 12793, freshInputTokens: 12793,
      cacheReadTokens: 0, outputTokens: 4474, reasoningTokens: 76, credits: 8.5633, resultCharacters: 12000
    }]);
    fixture.detectChanges();

    const marker = fixture.nativeElement.querySelector('.timeline-compaction') as HTMLElement;
    expect(marker.textContent).toContain('Kompaktowanie sesji');
    expect(marker.textContent).not.toContain('PO OSTATNIEJ INTERAKCJI');
    expect(marker.textContent).toContain('PRACA W OSOBNEJ SESJI');
    expect(marker.textContent).toContain('brak kolejnego requestu w telemetrii');
    expect(marker.textContent).toContain('12 793');
    expect(marker.textContent).toContain('8,563');
  });

  it('opens a main model round in the shared right panel', () => {
    const model = span({id: 21, spanId: 'round-21'});
    const nextModel = span({id: 22, spanId: 'round-22'});
    fixture.componentRef.setInput('turns', [
      {index: 1, interactionIndex: 1, interactionTurnIndex: 1, model, tools: []},
      {index: 2, interactionIndex: 1, interactionTurnIndex: 2, model: nextModel, tools: []}
    ]);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.initial-request-row .detail-trigger')!.click();
    const initial = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.initial-request-row')!;
    expect(initial.textContent).toContain('A → M1');
    expect(initial.textContent).not.toContain('Start ·');
    const panel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(panel?.kind).toBe('round');
    if (panel?.kind === 'round') {
      expect(panel.data.turn.model.id).toBe(21);
      expect(panel.data.headingContext).toContain('START');
      expect(panel.data.mode).toBe('request');
    }
    TestBed.inject(RoundDetailsPanelService).next();
    const nextPanel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(nextPanel?.kind === 'round' ? nextPanel.data.turn.model.id : null).toBe(22);
    expect(nextPanel?.kind === 'round' ? nextPanel.data.sourceTurn?.model.id : null).toBe(21);
    expect(nextPanel?.kind === 'round' ? nextPanel.data.mode : null).toBe('cycle');
    expect(nextPanel?.kind === 'round' ? nextPanel.data.headingContext : null).toBe('INTERAKCJA 1 · M1 → A → M2');
    const cycle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.cycle-row .detail-trigger')!;
    expect(cycle.textContent).toContain('M1 → A → M2');
    expect(cycle.textContent).not.toContain('Cykl 1 ·');
    cycle.click();
    const directlyOpened = TestBed.inject(RoundDetailsPanelService).panel();
    expect(directlyOpened?.kind === 'round' ? directlyOpened.data.sourceTurn?.model.id : null).toBe(21);
    expect(directlyOpened?.kind === 'round' ? directlyOpened.data.turn.model.id : null).toBe(22);
    expect((fixture.nativeElement as HTMLElement).querySelector('.final-response-row')?.textContent).toContain('M2 → odpowiedź');
  });

  it('uses the stable subagent and model round identities on the bar and in the round panel', () => {
    const [root, child] = mixedEpisodeFixture();
    fixture.componentRef.setInput('detail', root);
    fixture.componentRef.setInput('relatedDetails', [child]);
    fixture.detectChanges();
    const launch = root.spans.find(item => item.id === 2000)!;
    const turns = component.subagentTurns(launch);

    expect(component.subagentCallLabel(launch, turns[0])).toBe('S2:M1');
    expect(component.subagentCallLabel(launch, turns[1])).toBe('S2:M2');
    expect(component.subagentDelegationLabel(launch, {index: 5, interactionIndex: 2, interactionTurnIndex: 5,
      model: span(), tools: []})).toBe('INTERAKCJA 2 · M5:S2');
    expect(component.subagentWorkTitle(launch)).toBe('Praca i rezultat Subagenta 2');
    expect(component.subagentTimelineTitle(launch)).toBe('Subagent 2');

    component.openSubagentRoundDetails(launch, turns[0], new Event('click'));
    const panel = TestBed.inject(RoundDetailsPanelService).panel();
    expect(panel?.kind === 'round' ? panel.data.headingContext : null)
      .toBe('SUBAGENT · S2:M1 → A → S2:M2');
  });

  it('shows cache write on every round row when at least one round emitted the metric', () => {
    const withoutMetric = span({id: 1, spanId: 'round-1', cacheCreationTokens: 0});
    const withMetric = span({
      id: 2,
      spanId: 'round-2',
      cacheCreationTokens: 640,
      attributesJson: JSON.stringify({'gen_ai.usage.cache_creation.input_tokens': 640})
    });
    fixture.componentRef.setInput('turns', [
      {index: 1, model: withoutMetric, tools: []},
      {index: 2, model: withMetric, tools: []}
    ]);
    fixture.detectChanges();

    const values = [...fixture.nativeElement.querySelectorAll('.cycle-row .round-token.write strong, .final-response-row .round-token.write strong')]
      .map((element: Element) => element.textContent?.trim());
    expect(values).toEqual(['—', '640']);
  });

  it('uses SDK credits, cache write and the separate context event for an SDK round', () => {
    const model = span({id: 199, spanId: 'sdk-chat', attributesJson: JSON.stringify({
      'gen_ai.usage.input_tokens': 100_425, 'github.copilot.nano_aiu': 5_427_230_000,
      'gen_ai.usage.cache_write.input_tokens': 13_419
    }), eventsJson: JSON.stringify([{name: 'github.copilot.session.usage_info', attributes: {
      'github.copilot.current_tokens': 73_401, 'github.copilot.token_limit': 200_000}}])});
    const turn = {index: 1, model, tools: []};
    expect(component.spanCredits(model)).toBe(5.42723);
    expect(component.cacheWriteLabel(model)).toBe(component.compact(13_419));
    expect(component.roundContextPercentLabel(turn)).toBe('36,7%');
    expect(component.roundContextTooltip(turn)).toContain('Stan okna SDK');
    expect(component.roundContextTooltip(turn)).toContain('Nie jest to udział tokenów bieżącego requestu');
    expect(component.aggregateTokenLabel(component.interactionFreshInputTokens({index: 1, traceId: 'trace', prompt: 'x', turns: [turn]}))).toBe('—');
    expect(component.aggregateTokenLabel(component.interactionCacheReadTokens({index: 1, traceId: 'trace', prompt: 'x', turns: [turn]}))).toBe('—');
  });

  it('shows the verified SDK root aggregate in the interaction summary only', () => {
    const root = span({id: 10, spanId: 'root', operationName: 'invoke_agent', attributesJson: JSON.stringify({
      'gen_ai.conversation.id': 'sdk', 'gen_ai.usage.input_tokens': 300,
      'gen_ai.usage.cache_read.input_tokens': 100, 'gen_ai.usage.output_tokens': 30,
      'github.copilot.turn_count': 2})});
    const first = span({id: 11, spanId: 'first', inputTokens: 100, outputTokens: 10,
      startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:02Z', attributesJson: JSON.stringify({
        'gen_ai.conversation.id': 'sdk', 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 10})});
    const second = span({id: 12, spanId: 'second', inputTokens: 200, cacheReadTokens: 100, outputTokens: 20,
      startedAt: '2026-01-01T10:00:03Z', endedAt: '2026-01-01T10:00:04Z', attributesJson: JSON.stringify({
        'gen_ai.conversation.id': 'sdk', 'gen_ai.usage.input_tokens': 200,
        'gen_ai.usage.cache_read.input_tokens': 100, 'gen_ai.usage.output_tokens': 20})});
    const turns = [first, second].map((model, index) => ({index: index + 1, interactionIndex: 1,
      interactionTurnIndex: index + 1, model, tools: []}));
    const interaction = {index: 1, traceId: 'trace', prompt: 'test', turns};
    fixture.componentRef.setInput('detail', {...detail(), spans: [root, first, second]});
    fixture.componentRef.setInput('turns', turns);
    fixture.componentRef.setInput('interactions', [interaction]);
    fixture.detectChanges();

    expect(component.interactionFreshInputTokens(interaction)).toBe(200);
    expect(component.interactionCacheReadTokens(interaction)).toBe(100);
    expect(component.interactionInputCache(interaction).aggregateFallbacks).toBe(1);
    expect(component.roundTokenLabel(first, 'cache')).toBe('—');
    const marker = fixture.nativeElement.querySelector('.interaction-marker') as HTMLElement;
    expect(marker.querySelector('.fresh')?.textContent).toContain('200');
    expect(marker.querySelector('.cache')?.textContent).toContain('100');
    expect(marker.querySelector('[aria-label="Źródło sumy tokenów interakcji"]')).not.toBeNull();
  });

  it('does not reserve a cache write column when no round emitted the metric', () => {
    fixture.componentRef.setInput('turns', [{index: 1, model: span(), tools: []}]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.round-token.write')).toBeNull();
  });

  it('keeps the source model response, agent work and receiving model input in one cycle', () => {
    const limits = {'copilot_chat.request.max_prompt_tokens': 272000, 'gen_ai.request.max_tokens': 128000};
    const source = span({
      id: 41, spanId: 'm4', inputTokens: 83000, cacheReadTokens: 68000, outputTokens: 1328,
      attributesJson: JSON.stringify({...limits,
        'gen_ai.usage.input_tokens': 83000,
        'gen_ai.usage.cache_read.input_tokens': 68000,
        'gen_ai.usage.output_tokens': 1328,
        'copilot_chat.copilot_usage_nano_aiu': 6794000000})
    });
    const receiver = span({
      id: 42, spanId: 'm5', inputTokens: 84865, cacheReadTokens: 83481, outputTokens: 556,
      attributesJson: JSON.stringify({...limits,
        'gen_ai.usage.input_tokens': 84865,
        'gen_ai.usage.cache_read.input_tokens': 83481,
        'gen_ai.usage.output_tokens': 556,
        'copilot_chat.copilot_usage_nano_aiu': 2683000000})
    });
    fixture.componentRef.setInput('turns', [
      {index: 4, interactionIndex: 1, interactionTurnIndex: 4, model: source, tools: []},
      {index: 5, interactionIndex: 1, interactionTurnIndex: 5, model: receiver, tools: []}
    ]);
    fixture.detectChanges();

    const cycle = fixture.nativeElement.querySelector('.cycle-row') as HTMLElement;
    expect(cycle.textContent).toContain('M4 → A → M5');
    expect(cycle.textContent).not.toContain('Cykl 4 ·');
    expect(cycle.querySelector(':scope > .detail-trigger > .cycle-agent-step')).toBeNull();
    expect(cycle.textContent).not.toContain('AGENT PO M4');
    expect(cycle.querySelector('.round-token.output small')?.textContent).toContain('OUTPUT');
    expect(cycle.querySelector('.round-token.output small')?.textContent).not.toContain('M4');
    expect(cycle.querySelector('.round-token.output strong')?.textContent?.trim()).toBe('1328');
    expect(cycle.querySelector('.cycle-receiver .round-token.input strong')?.textContent?.trim()).toBe(component.compact(84865));
    expect(cycle.querySelector('.round-token.credits small')?.textContent).toContain('CREDITS');
    expect(cycle.querySelector('.round-token.credits small')?.textContent).not.toContain('M4');
    expect(cycle.querySelector('.round-token.credits strong')?.textContent?.trim()).toBe('6,794');
    expect(cycle.querySelector('.round-context-summary small')?.textContent).toContain('KONTEKST');
    expect(cycle.querySelector('.round-context-summary em')).toBeNull();
    expect(component.contextMetricTooltip).toContain('gen_ai.usage.input_tokens');
    expect(component.roundContextTooltip({index: 5, model: receiver, tools: []})).toContain(component.roundContextLabel({index: 5, model: receiver, tools: []}));
    expect(component.freshInputMetricTooltip).toContain('cache_read.input_tokens');
    expect(component.outputMetricTooltip).toContain('gen_ai.usage.output_tokens');

    const finalResponse = fixture.nativeElement.querySelector('.final-response-row') as HTMLElement;
    expect(finalResponse.textContent).toContain('KONIEC INTERAKCJI 1');
    expect(finalResponse.textContent).toContain('M5 → odpowiedź');
    expect(finalResponse.textContent).not.toContain('odpowiedź użytkownika');
    expect(finalResponse.textContent).not.toContain('Końcowa przechwycona odpowiedź modelu');
    expect(finalResponse.querySelector('.round-token.output strong')?.textContent?.trim()).toBe('556');
    expect(finalResponse.querySelector('.round-token.credits strong')?.textContent?.trim()).toBe('2,683');
  });

  it('keeps the complete subagent result instead of truncating it', () => {
    const result = 'pełny wynik '.repeat(120);
    const tool = span({
      operationName: 'execute_tool',
      attributesJson: JSON.stringify({'gen_ai.tool.call.result': result})
    });

    expect(component.subagentReturn(tool)).toBe(result);
    expect(component.subagentReturn(tool).endsWith('…')).toBe(false);
  });
});

function detail(): SessionDetail {
  return {
    session: {
      id: 1, conversationId: 'conversation', lastSeenAt: '2026-01-01T10:00:00Z',
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
      reasoningTokens: 0, turnCount: 0, toolCount: 0, errorCount: 0, contentCaptured: true
    },
    spans: [], messages: [], signals: []
  };
}

function span(overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {
    id: 1, signalId: 1, traceId: 'trace', spanId: 'span', spanName: 'chat', operationName: 'chat',
    statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, attributesJson: '{}', eventsJson: '[]', ...overrides
  };
}
