import {describe, expect, it} from 'vitest';
import {SessionAnalysisService} from './session-analysis.service';

describe('SessionAnalysisService', () => {
  it('groups model calls and tools inside their user interaction trace', () => {
    const service = new SessionAnalysisService();
    const firstModel = span({id: 2, traceId: 'trace-1', spanId: 'model-1', operationName: 'chat', model: 'gpt-test', startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:02Z'});
    const firstTool = span({id: 3, traceId: 'trace-1', spanId: 'tool-1', operationName: 'execute_tool', startedAt: '2026-01-01T10:00:03Z'});
    const secondModel = span({id: 5, traceId: 'trace-2', spanId: 'model-2', operationName: 'chat', model: 'gpt-test', startedAt: '2026-01-01T11:00:01Z', endedAt: '2026-01-01T11:00:02Z'});
    const source = {
      session: {
        id: 1,
        conversationId: 'conversation-1',
        responseModel: 'gpt-test',
        requestedModel: 'gpt-test'
      },
      spans: [
        span({id: 1, traceId: 'trace-1', spanId: 'root-1', operationName: 'invoke_agent', startedAt: '2026-01-01T10:00:00Z', attributesJson: JSON.stringify({'copilot_chat.user_request': 'pierwszy prompt'})}),
        firstModel,
        firstTool,
        span({id: 4, traceId: 'trace-2', spanId: 'root-2', operationName: 'invoke_agent', startedAt: '2026-01-01T11:00:00Z', attributesJson: JSON.stringify({'copilot_chat.user_request': 'drugi prompt'})}),
        secondModel
      ],
      messages: [],
      signals: []
    } as any;

    const result = service.build(source, []);

    expect(result?.interactions.map(interaction => interaction.prompt)).toEqual(['pierwszy prompt', 'drugi prompt']);
    expect(result?.modelTurns[0].tools).toEqual([firstTool]);
    expect(result?.modelTurns[1].tools).toEqual([]);
  });

  it('calculates span depth without looping over malformed parent chains', () => {
    const service = new SessionAnalysisService();
    const root = span({id: 1, spanId: 'root'});
    const child = span({id: 2, spanId: 'child', parentSpanId: 'root'});
    const cyclic = span({id: 3, spanId: 'cycle', parentSpanId: 'cycle'});

    const result = service.withDepth([root, child, cyclic]);

    expect(result.map(item => item.depth)).toEqual([0, 1, 1]);
  });
});

function span(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    signalId: 1,
    traceId: 'trace',
    spanId: 'span',
    spanName: 'span',
    operationName: 'chat',
    statusCode: 'STATUS_CODE_OK',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    attributesJson: '{}',
    eventsJson: '[]',
    ...overrides
  } as any;
}
