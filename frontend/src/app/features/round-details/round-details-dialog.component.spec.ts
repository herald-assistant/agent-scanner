import {ComponentFixture, TestBed} from '@angular/core/testing';
import {describe, expect, it} from 'vitest';
import {RoundDetailsDialogComponent} from './round-details-dialog.component';

describe('RoundDetailsDialogComponent', () => {
  it('shows the request and model response for the same round', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const model = span({
      inputTokens: 100,
      outputTokens: 12,
      attributesJson: JSON.stringify({
        'copilot_chat.request.shape': JSON.stringify({hasPreviousResponseId: false}),
        'copilot_chat.request.max_prompt_tokens': 272000,
        'gen_ai.request.max_tokens': 128000
      })
    });
    fixture.componentRef.setInput('turn', {index: 1, model, tools: []});
    fixture.componentRef.setInput('messages', [
      {id: 1, spanId: model.id, direction: 'input', roleName: 'user', sequenceNo: 0, content: 'przeanalizuj projekt'},
      {id: 2, spanId: model.id, direction: 'output', roleName: 'assistant', sequenceNo: 1, content: JSON.stringify({content: 'Gotowe'})}
    ]);
    fixture.componentRef.setInput('calibrationSpans', [model]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · RUNDA 1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Co weszło do modelu');
    expect(fixture.nativeElement.textContent).toContain('Co zwrócił model');
    expect(fixture.nativeElement.textContent).toContain('Gotowe');
    expect(fixture.componentInstance.estimatedTokens('przeanalizuj projekt')).toBe(100);
  });
});

function span(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, signalId: 1, traceId: 'trace', spanId: 'span', spanName: 'chat', operationName: 'chat',
    statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, attributesJson: '{}', eventsJson: '[]',
    ...overrides
  } as any;
}
