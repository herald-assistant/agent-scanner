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

  it('opens a main model round in the shared right panel', () => {
    const model = span({id: 21, spanId: 'round-21'});
    const nextModel = span({id: 22, spanId: 'round-22'});
    fixture.componentRef.setInput('turns', [
      {index: 1, interactionIndex: 1, interactionTurnIndex: 1, model, tools: []},
      {index: 2, interactionIndex: 1, interactionTurnIndex: 2, model: nextModel, tools: []}
    ]);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.initial-request-row .detail-trigger')!.click();
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
    const cycle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.cycle-row .detail-trigger')!;
    expect(cycle.textContent).toContain('Cykl 1 · M1 → A → M2');
    cycle.click();
    const directlyOpened = TestBed.inject(RoundDetailsPanelService).panel();
    expect(directlyOpened?.kind === 'round' ? directlyOpened.data.sourceTurn?.model.id : null).toBe(21);
    expect(directlyOpened?.kind === 'round' ? directlyOpened.data.turn.model.id : null).toBe(22);
    expect((fixture.nativeElement as HTMLElement).querySelector('.final-response-row')?.textContent).toContain('M2 → odpowiedź użytkownika');
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
    expect(cycle.textContent).toContain('Cykl 4 · M4 → A → M5');
    expect(cycle.querySelector('.round-token.output small')?.textContent).toContain('OUTPUT M4');
    expect(cycle.querySelector('.round-token.output strong')?.textContent?.trim()).toBe('1328');
    expect(cycle.querySelector('.cycle-receiver .round-token.input strong')?.textContent?.trim()).toBe(component.compact(84865));
    expect(cycle.querySelector('.round-token.credits small')?.textContent).toContain('CREDITS M4');
    expect(cycle.querySelector('.round-token.credits strong')?.textContent?.trim()).toBe('6,794');

    const finalResponse = fixture.nativeElement.querySelector('.final-response-row') as HTMLElement;
    expect(finalResponse.textContent).toContain('M5 → odpowiedź użytkownika');
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
