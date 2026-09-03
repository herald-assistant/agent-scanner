import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {SessionDetail, SpanRecord} from '../../models/scanner.models';
import {InteractionTimelineComponent} from './interaction-timeline.component';

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

    const values = [...fixture.nativeElement.querySelectorAll('.round-row .round-token.write strong')]
      .map((element: Element) => element.textContent?.trim());
    expect(values).toEqual(['—', '640']);
  });

  it('does not reserve a cache write column when no round emitted the metric', () => {
    fixture.componentRef.setInput('turns', [{index: 1, model: span(), tools: []}]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.round-row .round-token.write')).toBeNull();
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
