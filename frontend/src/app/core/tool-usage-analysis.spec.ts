import {describe, expect, it} from 'vitest';
import {MessageRecord, SessionDetail, SessionView, SpanRecord} from '../models/scanner.models';
import {analyzeToolUsage} from './tool-usage-analysis';

describe('analyzeToolUsage', () => {
  it('lists used and unused tools with invocation, result and definition estimates', () => {
    const first = span(1, 'model-1', 200, 80, [definition('read_file', 'Czyta plik.'), definition('unused_tool', 'Bardzo długa definicja '.repeat(20))]);
    const second = span(2, 'model-2', 300, 20, [definition('read_file', 'Czyta plik.'), definition('unused_tool', 'Bardzo długa definicja '.repeat(20))]);
    const messages: MessageRecord[] = [
      message(1, first.id, 'input', {role: 'user', parts: [{type: 'text', text: 'Sprawdź plik.'}]}),
      message(2, first.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: {path: 'README.md'}}
      ]}),
      message(3, second.id, 'input', {role: 'user', parts: [
        {type: 'function_call_output', call_id: 'call-1', output: 'Treść pliku '.repeat(12)}
      ]}),
      message(4, second.id, 'output', {role: 'assistant', parts: [{type: 'text', text: 'Gotowe.'}]})
    ];

    const result = analyzeToolUsage(view([first, second], messages));
    const read = result.rows.find(row => row.name === 'read_file')!;
    const unused = result.rows.find(row => row.name === 'unused_tool')!;

    expect(result.callsWithDefinitions).toBe(2);
    expect(result.callsWithOutput).toBe(2);
    expect(result.unusedTools).toBe(1);
    expect(read).toMatchObject({
      state: 'used', availableCalls: 2, responseCoveredCalls: 2, invocations: 1, resultOccurrences: 1,
      retainedResultOccurrences: 0, cachedResultTokens: 0, cacheEstimateCoverage: 0
    });
    expect(read.invocationTokens).toBeGreaterThan(0);
    expect(read.resultTokens).toBeGreaterThan(0);
    expect(unused).toMatchObject({state: 'unused', availableCalls: 2, responseCoveredCalls: 2, invocations: 0});
    expect(unused.definitionTokens).toBeGreaterThan(read.definitionTokens);
    expect(result.rows[0].name).toBe('unused_tool');
  });

  it('ranks tools by input tokens plus ten times output tokens', () => {
    const first = span(1, 'model-1', 100, 100, [definition('large_output', 'Narzędzie.'), definition('large_input_', 'Narzędzie.')]);
    const second = span(2, 'model-2', 500, 10, [definition('large_output', 'Narzędzie.'), definition('large_input_', 'Narzędzie.')]);
    const messages: MessageRecord[] = [
      message(1, first.id, 'input', {role: 'user', content: 'Wykonaj oba narzędzia.'}),
      message(2, first.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-output', name: 'large_output', arguments: {query: 'x'.repeat(250)}},
        {type: 'function_call', call_id: 'call-input', name: 'large_input_', arguments: {query: 'x'}}
      ]}),
      message(3, second.id, 'input', {role: 'user', parts: [
        {type: 'function_call_output', call_id: 'call-output', output: 'ok'},
        {type: 'function_call_output', call_id: 'call-input', output: 'x'.repeat(2_000)}
      ]}),
      message(4, second.id, 'output', {role: 'assistant', content: 'Gotowe.'})
    ];

    const used = analyzeToolUsage(view([first, second], messages)).rows.filter(row => row.state === 'used');

    expect(used.map(row => row.name)).toEqual(['large_output', 'large_input_']);
    expect(used[0].invocationTokens).toBeGreaterThan(used[1].invocationTokens);
    expect(used[0].resultTokens).toBeLessThan(used[1].resultTokens);
    expect(used[0].invocationTokens + used[0].resultTokens)
      .toBeLessThan(used[1].invocationTokens + used[1].resultTokens);
  });

  it('counts a result once and estimates later cache reuse only until the next compaction', () => {
    const first = span(1, 'model-1', 100, 20, [definition('read_file', 'Czyta plik.')]);
    const second = span(2, 'model-2', 100, 10, [], 0);
    const third = span(3, 'model-3', 100, 10, [], 80);
    const afterCompaction = span(4, 'model-4', 100, 10, [], 100);
    const result = {type: 'function_call_output', call_id: 'call-1', output: 'Treść pliku '.repeat(20)};
    const messages: MessageRecord[] = [
      message(1, first.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: {path: 'README.md'}}
      ]}),
      message(2, second.id, 'input', {role: 'user', parts: [result]}),
      message(3, second.id, 'output', {role: 'assistant', content: 'Pierwszy odbiór.'}),
      message(4, third.id, 'input', {role: 'user', parts: [result]}),
      message(5, third.id, 'output', {role: 'assistant', content: 'Kolejna runda.'}),
      message(6, afterCompaction.id, 'input', {role: 'user', parts: [result]}),
      message(7, afterCompaction.id, 'output', {role: 'assistant', content: 'Po kompaktowaniu.'})
    ];
    const compactions: SessionView['contextCompactions'] = [{
      id: 'compaction-1', sessionId: 2, spanId: 20, agentName: 'summarizeConversationHistory-full',
      startedAt: '2026-01-01T10:00:03.750Z', resultCharacters: 100
    }];

    const read = analyzeToolUsage(view([first, second, third, afterCompaction], messages, compactions)).rows[0];

    expect(read).toMatchObject({
      name: 'read_file', resultOccurrences: 1, retainedResultOccurrences: 1, cacheEstimateCoverage: 1
    });
    expect(read.resultTokens).toBeGreaterThan(0);
    expect(read.cachedResultTokens).toBeGreaterThan(0);
  });

  it('keeps the later cache estimate missing when the receiving request has no cache metrics', () => {
    const first = span(1, 'model-1', 100, 20, [definition('read_file', 'Czyta plik.')]);
    const second = span(2, 'model-2', 100, 10, [], 0);
    const third = span(3, 'model-3', 100, 10, [], null);
    const result = {type: 'function_call_output', call_id: 'call-1', output: 'Treść pliku.'};
    const messages: MessageRecord[] = [
      message(1, first.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: {path: 'README.md'}}
      ]}),
      message(2, second.id, 'input', {role: 'user', parts: [result]}),
      message(3, second.id, 'output', {role: 'assistant', content: 'Pierwszy odbiór.'}),
      message(4, third.id, 'input', {role: 'user', parts: [result]}),
      message(5, third.id, 'output', {role: 'assistant', content: 'Kolejna runda.'})
    ];

    const read = analyzeToolUsage(view([first, second, third], messages)).rows[0];

    expect(read).toMatchObject({
      resultOccurrences: 1, retainedResultOccurrences: 1, cachedResultTokens: undefined, cacheEstimateCoverage: 0
    });
  });

  it('does not call a tool unused when its model output was not captured', () => {
    const model = span(1, 'model-1', 200, 0, [definition('optional_tool', 'Narzędzie opcjonalne.')]);

    const result = analyzeToolUsage(view([model], [message(1, model.id, 'input', {role: 'user', content: 'Cel'})]));

    expect(result.rows[0]).toMatchObject({name: 'optional_tool', state: 'unverified', availableCalls: 1, responseCoveredCalls: 0});
    expect(result.unusedTools).toBe(0);
  });

  it('keeps distinct definition versions under one tool name', () => {
    const first = span(1, 'model-1', 100, 10, [definition('search', 'Wersja A')]);
    const second = span(2, 'model-2', 100, 10, [definition('search', 'Wersja B')]);
    const messages = [
      message(1, first.id, 'output', {role: 'assistant', content: 'Bez narzędzia.'}),
      message(2, second.id, 'output', {role: 'assistant', content: 'Bez narzędzia.'})
    ];

    const result = analyzeToolUsage(view([first, second], messages));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({name: 'search', definitionVersions: 2, availableCalls: 2, state: 'unused'});
  });

  it('detects identical requests globally across agents and compaction and compares exact results', () => {
    const main1 = span(1, 'main-1', 100, 20, [definition('read_file', 'Czyta plik.')]);
    const main2 = span(2, 'main-2', 100, 20, []);
    const main3 = span(3, 'main-3', 100, 10, []);
    const sub1 = span(4, 'sub-1', 100, 20, []);
    const sub2 = span(5, 'sub-2', 100, 20, []);
    const messages: MessageRecord[] = [
      message(1, main1.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: {path: 'README.md', line: 1}}
      ]}),
      message(2, main2.id, 'input', {type: 'tool_call_response', id: 'call-1', response: 'ta sama treść'}),
      message(3, main2.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-2', name: 'read_file', arguments: {line: 1, path: 'README.md'}}
      ]}),
      message(4, main3.id, 'input', {type: 'tool_call_response', id: 'call-2', response: [
        {type: 'text', text: 'ta sama treść'}
      ]}),
      message(5, main3.id, 'output', {role: 'assistant', content: 'Gotowe.'}),
      message(6, sub1.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-3', name: 'read_file', arguments: {path: 'README.md', line: 1}}
      ]}),
      message(7, sub2.id, 'input', {type: 'function_call_output', call_id: 'call-3', output: 'inna treść'}),
      message(8, sub2.id, 'output', {role: 'assistant', parts: [
        {type: 'function_call', call_id: 'call-4', name: 'read_file', arguments: {line: 1, path: 'README.md'}}
      ]})
    ];
    const compactions: SessionView['contextCompactions'] = [{
      id: 'compaction-1', sessionId: 2, spanId: 20, agentName: 'summarizeConversationHistory-full',
      startedAt: '2026-01-01T10:00:03.750Z', resultCharacters: 100
    }];
    const sessionView = view([main1, main2, main3, sub1, sub2], messages, compactions);
    sessionView.costGroups = [
      {id: 'main', kind: 'main', spans: [main1, main2, main3]},
      {id: 'subagent-1', kind: 'subagent', spans: [sub1, sub2]}
    ];

    const read = analyzeToolUsage(sessionView).rows.find(row => row.name === 'read_file')!;

    expect(read.duplicates).toEqual({
      total: 3,
      acrossAgents: 2,
      afterCompaction: 2,
      identicalResult: 1,
      differentResult: 1,
      missingResult: 1,
      roundLabels: ['M2', 'S1:M1', 'S1:M2'],
      argumentGroups: [{
        argumentsJson: '{\n  "line": 1,\n  "path": "README.md"\n}',
        firstRoundLabel: 'M1',
        repeatedRoundLabels: ['M2', 'S1:M1', 'S1:M2'],
        repetitions: 3
      }]
    });
  });
});

function definition(name: string, description: string) {
  return {type: 'function', function: {name, description, parameters: {type: 'object'}}};
}

function span(id: number, spanId: string, inputTokens: number, outputTokens: number, definitions: unknown[], cacheReadTokens: number | null = 0): SpanRecord {
  const attributes: Record<string, unknown> = {
    'gen_ai.usage.input_tokens': inputTokens,
    'gen_ai.usage.output_tokens': outputTokens,
    'gen_ai.tool.definitions': definitions,
    'copilot_chat.request.shape': {hasPreviousResponseId: false}
  };
  if (cacheReadTokens !== null) attributes['gen_ai.usage.cache_read.input_tokens'] = cacheReadTokens;
  return {
    id,
    signalId: 1,
    traceId: 'trace-1',
    spanId,
    spanName: 'chat',
    operationName: 'chat',
    startedAt: `2026-01-01T10:00:0${id}Z`,
    endedAt: `2026-01-01T10:00:0${id}.500Z`,
    statusCode: 'STATUS_CODE_OK',
    model: 'gpt-test',
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    attributesJson: JSON.stringify(attributes),
    eventsJson: '[]'
  };
}

function message(id: number, spanId: number, direction: 'input' | 'output', content: unknown): MessageRecord {
  return {id, spanId, direction, sequenceNo: 0, content: JSON.stringify(content), sourceKind: 'telemetry'};
}

function view(spans: SpanRecord[], messages: MessageRecord[], contextCompactions: SessionView['contextCompactions'] = []): SessionView {
  const source: SessionDetail = {
    session: {
      id: 1,
      conversationId: 'conversation-1',
      lastSeenAt: '2026-01-01T10:00:10Z',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      turnCount: spans.length,
      toolCount: 0,
      errorCount: 0,
      contentCaptured: true
    },
    spans,
    messages,
    signals: []
  };
  return {
    source,
    relatedSource: [],
    tools: [],
    primaryModelSpans: spans,
    billingModelSpans: spans,
    costGroups: [{id: 'main', kind: 'main', spans}],
    modelTurns: [],
    interactions: [],
    contextCompactions,
    relatedModelCalls: [],
    assistantAnswer: '',
    toolDefinitionNames: [],
    contextualMessageCount: 0,
    madeFileChanges: false
  };
}
