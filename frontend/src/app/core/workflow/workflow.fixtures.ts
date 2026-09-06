import type {SessionDetail, SpanRecord} from '../../models/scanner.models';

/** Synthetic telemetry only; deliberately unrelated to user sessions or repository contents. */
export function span(id: number, attrs: Record<string, unknown> = {}, overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {id, signalId: 1, traceId: 'trace-root', spanId: `span-${id}`, spanName: 'operation', operationName: 'chat',
    startedAt: at(id * 10), endedAt: at(id * 10 + 1), model: 'model-test', statusCode: 'STATUS_CODE_OK',
    inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    attributesJson: JSON.stringify(attrs), eventsJson: '[]', ...overrides};
}
export function at(seconds: number): string { return new Date(Date.UTC(2026, 0, 1, 12, 0, seconds)).toISOString(); }
export function chat(id: number, input = 1000, cache = 800, output = 50, extra: Record<string, unknown> = {}, overrides: Partial<SpanRecord> = {}): SpanRecord {
  return span(id, {'gen_ai.conversation.id': 'root', 'gen_ai.usage.input_tokens': input, 'gen_ai.usage.cache_read.input_tokens': cache,
    'gen_ai.usage.output_tokens': output, 'copilot_chat.request.max_prompt_tokens': 20000, 'gen_ai.request.max_tokens': 4000,
    'gen_ai.request.model': 'model-test', 'copilot_chat.copilot_usage_nano_aiu': 100000000, ...extra},
    {inputTokens: input, cacheReadTokens: cache, outputTokens: output, ...overrides});
}
export function tool(id: number, after: number, result: unknown = '', extra: Record<string, unknown> = {}, overrides: Partial<SpanRecord> = {}): SpanRecord {
  return span(id, {'gen_ai.conversation.id': 'root', 'gen_ai.tool.call.id': `call-${id}`, 'gen_ai.tool.name': 'custom_operation',
    'gen_ai.tool.call.arguments': '{"q":"synthetic"}', 'gen_ai.tool.call.result': result, ...extra},
    {operationName: 'execute_tool', startedAt: at(after * 10 + 2), endedAt: at(after * 10 + 3), ...overrides});
}
export function detail(spans: SpanRecord[], id = 1, conversationId = 'root'): SessionDetail {
  return {session: {id, conversationId, agentName: id === 1 ? 'agent' : `Subagent ${id - 1}`, responseModel: 'model-test',
    startedAt: at(0), endedAt: at(90), lastSeenAt: at(90), inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cacheCreationTokens: 0,
    reasoningTokens: 0, turnCount: spans.filter(span => span.operationName === 'chat').length, toolCount: 0, errorCount: 0, contentCaptured: true},
    spans, messages: [], signals: []};
}
export function workflowFixture(): SessionDetail[] {
  const root = detail([
    span(100, {'gen_ai.conversation.id': 'root', 'copilot_chat.user_request': 'Porównaj dwa warianty rozwiązania i przygotuj krótkie podsumowanie różnic.'},
      {operationName: 'invoke_agent', startedAt: at(0), endedAt: at(80)}),
    chat(1, 6000, 4000, 20), tool(21, 1, 'a'.repeat(5000)),
    chat(2, 9000, 6000, 24), tool(22, 2, 'b'.repeat(6000)),
    tool(23, 2, 'Zwięzły zwrot syntetyczny.', {'gen_ai.tool.call.id': 'child', 'gen_ai.tool.call.arguments': 'Zlecenie '.repeat(1000)}, {endedAt: at(38)}),
    chat(3, 12000, 11500, 64), tool(24, 3, ''), chat(4, 12100, 11700, 70),
    chat(5, 12200, 11700, 1500), chat(6, 12200, 11700, 50), chat(7, 12300, 11800, 2000)
  ]);
  const child = detail([
    chat(8, 8000, 7000, 40, {'gen_ai.conversation.id': 'child'}, {traceId: 'trace-child', startedAt: at(24), endedAt: at(25)}),
    chat(9, 8000, 7600, 80, {'gen_ai.conversation.id': 'child'}, {traceId: 'trace-child', startedAt: at(34), endedAt: at(35)})
  ], 2, 'child');
  return [root, child];
}
