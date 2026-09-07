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

  it('keeps an inline background todo call and its exclusive tool outside the primary loop', () => {
    const service = new SessionAnalysisService();
    const main = span({id: 2, traceId: 'trace-1', spanId: 'main-1', operationName: 'chat', startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:10Z',
      attributesJson: JSON.stringify({'gen_ai.agent.name': 'panel/editAgent'})});
    const background = span({id: 3, traceId: 'trace-1', spanId: 'todo-model', operationName: 'chat', model: 'gpt-mini', startedAt: '2026-01-01T10:00:09Z', endedAt: '2026-01-01T10:00:10.400Z',
      attributesJson: JSON.stringify({'gen_ai.agent.name': 'backgroundTodoAgent'})});
    const todoTool = span({id: 4, traceId: 'trace-1', spanId: 'todo-tool', operationName: 'execute_tool', startedAt: '2026-01-01T10:00:10.500Z',
      attributesJson: JSON.stringify({'gen_ai.tool.name': 'manage_todo_list'})});
    const mainTool = span({id: 5, traceId: 'trace-1', spanId: 'main-tool', operationName: 'execute_tool', startedAt: '2026-01-01T10:00:10.600Z',
      attributesJson: JSON.stringify({'gen_ai.tool.name': 'apply_patch', 'gen_ai.tool.call.id': 'main-call'})});
    const receiver = span({id: 6, traceId: 'trace-1', spanId: 'main-2', operationName: 'chat', startedAt: '2026-01-01T10:00:11Z', endedAt: '2026-01-01T10:00:12Z',
      attributesJson: JSON.stringify({'gen_ai.agent.name': 'panel/editAgent'})});
    const source = detail([
      span({id: 1, traceId: 'trace-1', spanId: 'root', operationName: 'invoke_agent', startedAt: '2026-01-01T10:00:00Z'}),
      main, background, todoTool, mainTool, receiver
    ], [
      message(1, main.id, 'output', {role: 'assistant', parts: [{type: 'tool_call', id: 'main-call', name: 'apply_patch', arguments: '{}'}]}),
      message(2, background.id, 'output', {role: 'assistant', parts: [{type: 'tool_call', id: 'todo-call', name: 'manage_todo_list', arguments: '{}'}]}),
      message(3, receiver.id, 'output', {role: 'assistant', parts: [{type: 'text', content: 'Gotowe.'}]})
    ]);

    const result = service.build(source, []);

    expect(result?.primaryModelSpans.map(item => item.id)).toEqual([main.id, receiver.id]);
    expect(result?.modelTurns[0].tools.map(item => item.id)).toEqual([mainTool.id]);
    expect(result?.tools.map(item => item.id)).toEqual([mainTool.id]);
    expect(result?.billingModelSpans.map(item => item.id)).toEqual([main.id, receiver.id]);
    expect(result?.relatedModelCalls).toEqual([{span: background, label: 'Aktualizacja planu w tle'}]);
  });

  it('keeps exact-linked execution subagent calls in cost totals and the workflow', async () => {
    const service = new SessionAnalysisService();
    const parentId = 'conversation-1';
    const childId = 'call-execution-child';
    const main = span({id: 2, traceId: 'trace-main', spanId: 'main-chat', operationName: 'chat',
      startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:02Z', inputTokens: 1000, cacheReadTokens: 800, outputTokens: 50,
      attributesJson: JSON.stringify({'gen_ai.agent.name': 'panel/editAgent', 'gen_ai.conversation.id': parentId,
        'copilot_chat.chat_session_id': parentId, 'gen_ai.usage.input_tokens': 1000,
        'gen_ai.usage.cache_read.input_tokens': 800, 'gen_ai.usage.output_tokens': 50})});
    const launch = span({id: 3, traceId: 'trace-main', spanId: 'launch', operationName: 'execute_tool',
      startedAt: '2026-01-01T10:00:03Z', endedAt: '2026-01-01T10:00:04Z',
      attributesJson: JSON.stringify({'gen_ai.conversation.id': parentId, 'gen_ai.tool.name': 'execution_subagent',
        'gen_ai.tool.call.id': childId})});
    const source = detail([
      span({id: 1, traceId: 'trace-main', spanId: 'main-root', operationName: 'invoke_agent',
        startedAt: '2026-01-01T10:00:00Z', attributesJson: JSON.stringify({'gen_ai.conversation.id': parentId})}),
      main, launch
    ]);
    const childRoot = span({id: 10, traceId: 'trace-child', spanId: 'child-root', operationName: 'invoke_agent',
      startedAt: '2026-01-01T10:00:03.100Z', attributesJson: JSON.stringify({'gen_ai.agent.name': 'GitHub Copilot Chat',
        'gen_ai.conversation.id': parentId, 'copilot_chat.chat_session_id': childId,
        'copilot_chat.parent_chat_session_id': parentId})});
    const childCalls = [
      span({id: 11, traceId: 'trace-child', spanId: 'child-chat-1', parentSpanId: childRoot.spanId, operationName: 'chat',
        startedAt: '2026-01-01T10:00:03.200Z', endedAt: '2026-01-01T10:00:03.500Z', inputTokens: 1966, outputTokens: 205,
        attributesJson: JSON.stringify({'gen_ai.agent.name': 'executionSubagentTool', 'gen_ai.conversation.id': childId,
          'copilot_chat.chat_session_id': childId, 'copilot_chat.parent_chat_session_id': parentId,
          'gen_ai.usage.input_tokens': 1966, 'gen_ai.usage.cache_read.input_tokens': 0, 'gen_ai.usage.output_tokens': 205})}),
      span({id: 12, traceId: 'trace-child', spanId: 'child-chat-2', parentSpanId: childRoot.spanId, operationName: 'chat',
        startedAt: '2026-01-01T10:00:03.600Z', endedAt: '2026-01-01T10:00:03.900Z', inputTokens: 2141, cacheReadTokens: 1963, outputTokens: 124,
        attributesJson: JSON.stringify({'gen_ai.agent.name': 'executionSubagentTool', 'gen_ai.conversation.id': childId,
          'copilot_chat.chat_session_id': childId, 'copilot_chat.parent_chat_session_id': parentId,
          'gen_ai.usage.input_tokens': 2141, 'gen_ai.usage.cache_read.input_tokens': 1963, 'gen_ai.usage.output_tokens': 124})})
    ];
    const child = detail([childRoot, ...childCalls]);
    child.session = {...child.session, id: 2, conversationId: childId, agentName: 'GitHub Copilot Chat'};

    const result = service.build(source, [child])!;
    const workflow = await service.buildWorkflow(source, [child]);

    expect(result.primaryModelSpans.map(item => item.id)).toEqual([main.id]);
    expect(result.costGroups.map(group => ({kind: group.kind, calls: group.spans.length}))).toEqual([
      {kind: 'main', calls: 1}, {kind: 'subagent', calls: 2}
    ]);
    expect(result.billingModelSpans.map(item => item.id)).toEqual([main.id, ...childCalls.map(item => item.id)]);
    expect(workflow.streams.map(stream => stream.rounds.length)).toEqual([1, 2]);
    expect(workflow.treeCredits.total).toBe(3);
  });

  it('does not treat a summary-shaped message as proof that a compaction call happened', () => {
    const service = new SessionAnalysisService();
    const limits = {'copilot_chat.request.max_prompt_tokens': 272000, 'gen_ai.request.max_tokens': 128000};
    const before = span({id: 2, traceId: 'trace-1', spanId: 'before', operationName: 'chat', startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:02Z',
      attributesJson: JSON.stringify({...limits, 'gen_ai.usage.input_tokens': 120000})});
    const after = span({id: 4, traceId: 'trace-2', spanId: 'after', operationName: 'chat', startedAt: '2026-01-01T11:00:01Z', endedAt: '2026-01-01T11:00:02Z',
      attributesJson: JSON.stringify({...limits, 'gen_ai.usage.input_tokens': 28000})});
    const summary = 'Stan pracy po wcześniejszych rundach.';
    const source = detail([
      span({id: 1, traceId: 'trace-1', spanId: 'root-1', operationName: 'invoke_agent', startedAt: '2026-01-01T10:00:00Z'}), before,
      span({id: 3, traceId: 'trace-2', spanId: 'root-2', operationName: 'invoke_agent', startedAt: '2026-01-01T11:00:00Z'}), after
    ], [message(1, after.id, 'input', {role: 'user', parts: [{type: 'text', content: `<conversation-summary>\n${summary}\n</conversation-summary>`}]})]);

    const result = service.build(source, []);

    expect(result?.contextCompactions).toEqual([]);
  });

  it('keeps emitter session plus matching result as a conservative fallback link', () => {
    const service = new SessionAnalysisService();
    const before = span({id: 2, signalId: 1, traceId: 'trace-1', spanId: 'before', operationName: 'chat',
      startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:02Z'});
    const after = span({id: 4, signalId: 1, traceId: 'trace-2', spanId: 'after', operationName: 'chat',
      startedAt: '2026-01-01T11:00:01Z', endedAt: '2026-01-01T11:00:02Z'});
    const outputSummary = ['linia 1', 'linia 2', 'linia 3', 'linia 4', 'linia 5'].join('\n');
    const receivingSummary = `${outputSummary}\nlinia dodana przez emitter`;
    const source = detail([
      span({id: 1, signalId: 1, traceId: 'trace-1', spanId: 'root-1', operationName: 'invoke_agent', startedAt: '2026-01-01T10:00:00Z'}), before,
      span({id: 3, signalId: 1, traceId: 'trace-2', spanId: 'root-2', operationName: 'invoke_agent', startedAt: '2026-01-01T11:00:00Z'}), after
    ], [message(1, after.id, 'input', {role: 'user', parts: [{type: 'text', content: `<conversation-summary>${receivingSummary}</conversation-summary>`}]})]);
    source.session.startedAt = '2026-01-01T10:00:00Z';
    source.signals = [signal(1, 'vscode-session')];
    const compaction = span({id: 20, signalId: 9, traceId: 'detached', spanId: 'compact', operationName: 'chat', model: 'gpt-test',
      startedAt: '2026-01-01T10:30:00Z', endedAt: '2026-01-01T10:30:52Z', durationMs: 52000,
      attributesJson: JSON.stringify({
        'gen_ai.agent.name': 'summarizeConversationHistory-full',
        'gen_ai.usage.input_tokens': 96756,
        'gen_ai.usage.cache_read.input_tokens': 7872,
        'gen_ai.usage.output_tokens': 6081,
        'gen_ai.usage.reasoning_tokens': 54,
        'copilot_chat.copilot_usage_nano_aiu': 29671890000
      })});
    const detached = detail([compaction], [message(2, compaction.id, 'output', {
      role: 'assistant', parts: [{type: 'text', content: `<analysis>plan</analysis><summary>${outputSummary}</summary>`}]
    })]);
    detached.session = {...detached.session, id: 192, conversationId: 'trace:detached', agentName: 'summarizeConversationHistory-full'};
    detached.signals = [signal(9, 'vscode-session')];

    const result = service.build(source, [detached]);
    const measurement = result?.contextCompactions[0];

    expect(measurement).toMatchObject({
      sessionId: 192, spanId: compaction.id, agentName: 'summarizeConversationHistory-full', model: 'gpt-test', durationMs: 52000,
      inputTokens: 96756, freshInputTokens: 88884, cacheReadTokens: 7872, outputTokens: 6081,
      reasoningTokens: 54, credits: 29.67189, resultCharacters: outputSummary.length,
      placementBeforeModelId: after.id, resultObservedInModelId: after.id
    });
    expect(result?.relatedModelCalls).toEqual([]);

    detached.signals = [signal(9, 'different-vscode-session')];
    const unmatched = new SessionAnalysisService().build(source, [detached]);
    expect(unmatched?.contextCompactions).toEqual([]);
  });

  it('links a later manual compaction by exact conversation ID even before another request exists', () => {
    const service = new SessionAnalysisService();
    const main = span({id: 2, signalId: 1, traceId: 'main', spanId: 'main-chat', operationName: 'chat',
      startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:02Z',
      attributesJson: JSON.stringify({'gen_ai.conversation.id': 'conversation-1'})});
    const source = detail([
      span({id: 1, signalId: 1, traceId: 'main', spanId: 'root', operationName: 'invoke_agent', startedAt: '2026-01-01T10:00:00Z'}), main
    ]);
    source.signals = [signal(1, 'main-emitter-session')];
    const compaction = span({id: 30, signalId: 10, traceId: 'late-compaction', spanId: 'late-chat', operationName: 'chat',
      startedAt: '2026-01-02T14:00:00Z', endedAt: '2026-01-02T14:01:00Z', durationMs: 60000,
      attributesJson: JSON.stringify({
        'gen_ai.agent.name': 'summarizeConversationHistory-full',
        'gen_ai.usage.input_tokens': 12793,
        'gen_ai.usage.cache_read.input_tokens': 0,
        'gen_ai.usage.output_tokens': 4474,
        'copilot_chat.copilot_usage_nano_aiu': 8563300000
      })});
    const detached = detail([compaction], [
      message(10, compaction.id, 'input', {role: 'user', parts: [{type: 'text', content: 'transcripts/conversation-1.jsonl'}]}),
      message(11, compaction.id, 'output', {role: 'assistant', parts: [{type: 'text', content: '<summary>Nowy skrót</summary>'}]})
    ]);
    detached.session = {...detached.session, id: 196, conversationId: 'trace:late-compaction', agentName: 'summarizeConversationHistory-full'};
    detached.signals = [signal(10, 'different-emitter-session')];

    const result = service.build(source, [detached]);

    expect(result?.contextCompactions).toHaveLength(1);
    expect(result?.contextCompactions[0]).toMatchObject({
      id: '196/30', sessionId: 196, inputTokens: 12793, outputTokens: 4474, credits: 8.5633,
      resultCharacters: 10
    });
    expect(result?.contextCompactions[0].placementBeforeModelId).toBeUndefined();
    expect(result?.contextCompactions[0].resultObservedInModelId).toBeUndefined();
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

function detail(spans: any[], messages: any[] = []) {
  return {
    session: {id: 1, conversationId: 'conversation-1', lastSeenAt: '2026-01-01T11:00:02Z'},
    spans, messages, signals: []
  } as any;
}

function message(id: number, spanId: number, direction: 'input' | 'output', content: unknown) {
  return {id, spanId, direction, sequenceNo: 0, roleName: direction === 'input' ? 'user' : 'assistant', content: JSON.stringify(content), sourceKind: 'telemetry'};
}

function signal(id: number, sessionId: string) {
  return {id, signalType: 'traces', receivedAt: '2026-01-01T11:00:03Z', rawJson: '{}',
    resourceAttributes: JSON.stringify({0: {'session.id': sessionId}}), itemCount: 1};
}
