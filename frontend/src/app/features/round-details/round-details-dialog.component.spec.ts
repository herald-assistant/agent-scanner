import {ComponentFixture, TestBed} from '@angular/core/testing';
import {describe, expect, it} from 'vitest';
import {RoundDetailsDialogComponent} from './round-details-dialog.component';

describe('RoundDetailsDialogComponent', () => {
  it('shows the initial interaction as the input of the first model call', () => {
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
      {id: 2, spanId: model.id, direction: 'output', roleName: 'assistant', sequenceNo: 1, content: JSON.stringify({content: 'Gotowe'})},
      {id: 3, spanId: model.id, direction: 'output', roleName: 'assistant', sequenceNo: 2, content: JSON.stringify({role: 'assistant', parts: [
        {type: 'tool_call', id: 'call-right', name: 'run_in_terminal', arguments: {command: 'mvn test', explanation: 'Uruchom testy', goal: 'Zweryfikuj zmianę'}}
      ]})}
    ]);
    fixture.componentRef.setInput('calibrationSpans', [model]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · RUNDA 1');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Co uruchomiło pierwszy model');
    expect(fixture.nativeElement.textContent).not.toContain('Co zwrócił model');
    expect(fixture.nativeElement.textContent).not.toContain('Gotowe');
    expect(fixture.componentInstance.estimatedTokens('przeanalizuj projekt')).toBe(100);
    expect(fixture.componentInstance.requestCapturedDescription()).toContain('znaków treści przechwyconej w OTLP');
    expect(fixture.componentInstance.contextWindowTooltip()).toContain('requestu wywołania M1');
    expect(fixture.nativeElement.querySelector('.detail-section > header p')).toBeNull();
    expect(fixture.nativeElement.querySelector('.context-source')).toBeNull();
    expect(fixture.nativeElement.querySelector('.request-inspector-header p')).toBeNull();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLDetailsElement>('.messages-part')?.open).toBe(true);
    const userMessage = root.querySelector<HTMLElement>('.user-text-message');
    expect(userMessage?.tagName).toBe('ARTICLE');
    expect(userMessage?.querySelector('pre')?.textContent).toContain('przeanalizuj projekt');
    expect(fixture.nativeElement.querySelector('.response-tool-request')).toBeNull();
  });

  it('shows system instructions immediately in a bounded content block', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const model = span({attributesJson: JSON.stringify({
      'gen_ai.system_instructions': JSON.stringify([{type: 'text', content: 'Pracuj wyłącznie na przechwyconych danych.'}])
    })});
    fixture.componentRef.setInput('turn', {index: 1, model, tools: []});
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('calibrationSpans', [model]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · RUNDA 1');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLDetailsElement>('.system-part')?.open).toBe(true);
    expect(root.querySelector('.system-block pre')?.textContent).toContain('Pracuj wyłącznie');
  });

  it('extracts a structured user text message and preserves its whitespace', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const model = span();
    const content = JSON.stringify({role: 'user', parts: [{type: 'text', content: 'Pierwszy akapit.\n\n  Drugi akapit z wcięciem.'}]});
    fixture.componentRef.setInput('turn', {index: 1, model, tools: []});
    fixture.componentRef.setInput('messages', [{id: 7, spanId: model.id, direction: 'input', sequenceNo: 0, roleName: 'user', content}]);
    fixture.componentRef.setInput('calibrationSpans', [model]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · RUNDA 1');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).querySelector('.user-text-message pre')?.textContent;
    expect(text).toBe('Pierwszy akapit.\n\n  Drugi akapit z wcięciem.');
    expect(text).not.toContain('"content"');
  });

  it('links a tool response to the earlier request and shows its tool and parameters', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const previous = span({id: 10, spanId: 'previous'});
    const current = span({id: 11, spanId: 'current'});
    const request = {
      role: 'assistant',
      parts: [{type: 'tool_call', id: 'call-42', name: 'read_file', arguments: {path: 'docs/architecture.md', line_end: 80, encoding: 'UTF-8'}}]
    };
    const response = {
      role: 'tool',
      parts: [{type: 'tool_call_response', id: 'call-42', response: 'treść pliku'}]
    };
    const responseMessage = {id: 2, spanId: current.id, direction: 'input', roleName: 'tool', sequenceNo: 0,
      content: JSON.stringify(response), sourceKind: 'explicit'};
    fixture.componentRef.setInput('turn', {index: 2, model: current, tools: []});
    fixture.componentRef.setInput('sourceTurn', {index: 1, model: previous, tools: []});
    fixture.componentRef.setInput('mode', 'cycle');
    fixture.componentRef.setInput('messages', [
      {id: 1, spanId: previous.id, direction: 'output', roleName: 'assistant', sequenceNo: 0, content: JSON.stringify(request), sourceKind: 'explicit'},
      responseMessage
    ]);
    fixture.componentRef.setInput('calibrationSpans', [previous, current]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · RUNDA 2');
    fixture.componentInstance.expandedSections.add('messages');
    fixture.detectChanges();

    const context = fixture.componentInstance.toolResponseContexts(responseMessage)[0];
    expect(fixture.nativeElement.textContent).toContain('Model → agent → model');
    expect(fixture.nativeElement.textContent).toContain('Co model zlecił agentowi');
    expect(fixture.nativeElement.textContent).toContain('Co wróciło do modelu');
    const requestedTool = fixture.nativeElement.querySelector('.response-tool-request') as HTMLElement;
    expect(requestedTool.textContent).toContain('read_file');
    expect(requestedTool.textContent).not.toContain('call-42');
    expect(requestedTool.querySelectorAll('.tool-parameter-list > div')).toHaveLength(3);
    expect(context).toMatchObject({id: 'call-42', name: 'read_file', matched: true});
    expect(context.arguments).toContain('docs/architecture.md');
    const card = fixture.nativeElement.querySelector('.tool-message') as HTMLElement;
    expect(card.tagName).toBe('DETAILS');
    expect(card.querySelector(':scope > summary strong')?.textContent).toBe('read_file');
    expect(card.querySelector(':scope > summary small')?.textContent).toContain('· input[0]');
    expect(card.querySelector('.tool-correlation > header')).toBeNull();
    expect(card.textContent).not.toContain('Odczytaj plik');
    expect(card.querySelector('.tool-parameter-list')?.textContent).toContain('docs/architecture.md');
    expect(card.querySelectorAll('.tool-parameter-list > div')).toHaveLength(3);
    expect(card.querySelector('.tool-response-value')?.textContent).toContain('treść pliku');
    expect(card.querySelector<HTMLDetailsElement>('.raw-tool-message')?.open).toBe(false);
  });

  it('keeps an unmatched tool response explicit instead of guessing a request', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const current = span({id: 12});
    const message = {id: 3, spanId: current.id, direction: 'input', roleName: 'tool', sequenceNo: 0,
      content: JSON.stringify({type: 'function_call_output', call_id: 'missing-call', output: 'result'}), sourceKind: 'explicit'};
    fixture.componentRef.setInput('turn', {index: 1, model: current, tools: []});
    fixture.componentRef.setInput('messages', [message]);
    fixture.componentRef.setInput('calibrationSpans', [current]);
    fixture.componentRef.setInput('headingContext', 'RUNDA 1');

    expect(fixture.componentInstance.toolResponseContexts(message)[0]).toMatchObject({id: 'missing-call', matched: false});
  });

  it('shows captured reasoning content for the source model response of a cycle', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const source = span({id: 20, reasoningTokens: 45, attributesJson: JSON.stringify({
      'copilot_chat.reasoning_content': 'Sprawdzę zależności przed wybraniem kolejnych narzędzi.',
      'gen_ai.usage.reasoning.output_tokens': 45
    })});
    const receiver = span({id: 21, reasoningTokens: 12, attributesJson: JSON.stringify({
      'copilot_chat.reasoning_content': 'Treść następnego wywołania.'
    })});
    fixture.componentRef.setInput('turn', {index: 2, model: receiver, tools: []});
    fixture.componentRef.setInput('sourceTurn', {index: 1, model: source, tools: []});
    fixture.componentRef.setInput('mode', 'cycle');
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('calibrationSpans', [source, receiver]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · CYKL 1');
    fixture.detectChanges();

    expect(fixture.componentInstance.responseReasoningTooltip()).toContain('Sprawdzę zależności');
    expect(fixture.componentInstance.responseReasoningTooltip()).toContain('45 tokenów');
    expect(fixture.componentInstance.responseReasoningTooltip()).not.toContain('Treść następnego wywołania');
  });

  it('explains when the provider emits only an encrypted reasoning marker', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const model = span({reasoningTokens: 999, attributesJson: JSON.stringify({
      'copilot_chat.reasoning_content': '[encrypted]', 'gen_ai.usage.reasoning.output_tokens': 999})});
    fixture.componentRef.setInput('turn', {index: 1, model, tools: []});
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('calibrationSpans', [model]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · CYKL 1');

    expect(fixture.componentInstance.responseReasoningTooltip()).toContain('999 tokenów');
    expect(fixture.componentInstance.responseReasoningTooltip()).toContain('ukryta przez providera');
  });

  it('shows exact SDK reasoning content while keeping a missing token count missing', () => {
    const fixture: ComponentFixture<RoundDetailsDialogComponent> = TestBed.createComponent(RoundDetailsDialogComponent);
    const model = span({id: 199, reasoningTokens: 0, attributesJson: JSON.stringify({
      'github.copilot.service_request_id': 'sdk-request-199', 'github.copilot.server_duration': 2450
    })});
    fixture.componentRef.setInput('turn', {index: 1, model, tools: []});
    fixture.componentRef.setInput('mode', 'final');
    fixture.componentRef.setInput('messages', [{id: 1, spanId: 199, direction: 'output', roleName: 'assistant', sequenceNo: 0,
      content: JSON.stringify({role: 'assistant', parts: [{type: 'reasoning', content: 'Wyemitowana treść SDK.'}]}), sourceKind: 'telemetry'}]);
    fixture.componentRef.setInput('calibrationSpans', [model]);
    fixture.componentRef.setInput('headingContext', 'INTERAKCJA 1 · RUNDA 1');
    fixture.detectChanges();

    expect(fixture.componentInstance.responseReasoningLabel()).toBe('—');
    expect(fixture.componentInstance.responseReasoningTooltip()).toContain('Wyemitowana treść SDK.');
    expect(fixture.componentInstance.responseReasoningTooltip()).toContain('Licznik tokenów reasoning niewyemitowany');
    expect(fixture.componentInstance.requestParameters()).toContainEqual({label: 'Server request ID', value: 'sdk-request-199'});
    expect(fixture.componentInstance.requestParameters()).toContainEqual({label: 'Czas serwera SDK (surowy)', value: '2450'});
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
