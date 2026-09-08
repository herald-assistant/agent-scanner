import {describe, expect, it} from 'vitest';
import {buildRoundDiscussionEvidence} from './round-discussion-evidence';
import {MessageRecord, ModelTurn, SessionDetail, SpanRecord} from '../../models/scanner.models';
import {Metric, RoundObservation, WorkflowAnalysis, WorkflowStream} from '../../models/workflow.models';

describe('buildRoundDiscussionEvidence', () => {
  it('keeps every boundary of a continuous range and redacts untrusted secrets', async () => {
    const fixture = workflow();
    const first = await buildRoundDiscussionEvidence({...fixture, rounds: fixture.stream.rounds.slice(0, 2),
      capturedAt: '2026-09-08T10:00:00Z'});
    const second = await buildRoundDiscussionEvidence({...fixture, rounds: fixture.stream.rounds.slice(0, 2),
      capturedAt: '2026-09-08T11:00:00Z'});
    const encoded = JSON.stringify(first);

    expect(first.selection.roundRefs).toEqual(['trace-1/chat-1', 'trace-1/chat-2']);
    expect(first.rounds.map(round => round.nextRoundRef)).toEqual(['trace-1/chat-2', 'trace-1/chat-3']);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.boundaries.filter(boundary => boundary.kind === 'MODEL_REQUEST')).toHaveLength(2);
    expect(first.boundaries.filter(boundary => boundary.kind === 'MODEL_RESPONSE')).toHaveLength(2);
    expect(first.boundaries.filter(boundary => boundary.kind === 'TOOL_EXECUTION')).toHaveLength(1);
    expect(first.boundaries.filter(boundary => boundary.kind === 'NEXT_MODEL_REQUEST')).toHaveLength(1);
    expect(encoded).not.toContain('SECRET SYSTEM');
    expect(encoded).not.toContain('hidden reasoning');
    expect(encoded).not.toContain('ghp_12345678901234567890');
    expect(encoded).toContain('[REDACTED_TOKEN]');
  });

  it('rejects a range with a missing middle round', async () => {
    const fixture = workflow();
    await expect(buildRoundDiscussionEvidence({...fixture,
      rounds: [fixture.stream.rounds[0], fixture.stream.rounds[2]]}))
      .rejects.toThrow('ciąg sąsiednich rund');
  });
});

function workflow(): {analysis: WorkflowAnalysis; stream: WorkflowStream; actorLabel: string} {
  const models = [span(1), span(2), span(3)];
  const tool = toolSpan();
  const messages: MessageRecord[] = models.flatMap((model, index) => [
    message(index * 3 + 1, model.id, 'input', index === 0
      ? [{role: 'system', content: 'SECRET SYSTEM'}, {role: 'user', content: 'użyj ghp_12345678901234567890'},
        {role: 'assistant', reasoning_content: 'hidden reasoning'}]
      : [{role: 'tool', content: `wynik-${index}`}]),
    message(index * 3 + 2, model.id, 'output', [{role: 'assistant', content: `odpowiedź-${index + 1}`}]),
    message(index * 3 + 3, model.id, 'definition', [{type: 'function', name: 'read', description: 'czyta dane'}])
  ]);
  const source: SessionDetail = {
    session: {id: 7, conversationId: 'conversation-7', lastSeenAt: '2026-09-08T10:01:00Z', inputTokens: 6000,
      outputTokens: 300, cacheReadTokens: 3000, cacheCreationTokens: 0, reasoningTokens: 0,
      turnCount: 3, toolCount: 1, errorCount: 0, contentCaptured: true},
    spans: [...models, tool], messages,
    signals: [{id: 1, signalType: 'traces', receivedAt: '2026-09-08T10:01:01Z', rawJson: '{}', resourceAttributes: '{}', itemCount: 4}]
  };
  const rounds = models.map((model, index) => round(model, index + 1, index === 0 ? tool : undefined));
  const stream: WorkflowStream = {id: 'root', sessionId: 7, label: 'Agent główny', source, depth: 0, rounds,
    segments: [], profiles: [], credits: {known: .6, covered: 3, total: 3},
    subtreeCredits: {known: .6, covered: 3, total: 3}, rates: []};
  const analysis: WorkflowAnalysis = {source, classifierVersion: 'rules-v1', componentVersions: {}, cutoffSignalId: 1,
    streams: [stream], linkIssues: [], linkCoverage: true, treeCredits: stream.credits, profiles: [], recommendations: [],
    upstreamCompleteness: 'unverified'};
  return {analysis, stream, actorLabel: 'Główny agent'};
}

function span(index: number): SpanRecord {
  return {id: index, signalId: 1, traceId: 'trace-1', spanId: `chat-${index}`, spanName: 'chat', operationName: 'chat',
    startedAt: `2026-09-08T10:00:0${index}Z`, endedAt: `2026-09-08T10:00:0${index + 1}Z`, durationMs: 1000,
    statusCode: 'STATUS_CODE_OK', model: 'gpt-test', inputTokens: 1000 + index * 100, outputTokens: 100,
    cacheReadTokens: 500, cacheCreationTokens: 0, reasoningTokens: 0,
    attributesJson: JSON.stringify({'gen_ai.usage.input_tokens': 1000 + index * 100,
      'gen_ai.usage.output_tokens': 100}), eventsJson: '[]'};
}

function toolSpan(): SpanRecord {
  return {id: 10, signalId: 1, traceId: 'trace-1', spanId: 'tool-1', parentSpanId: 'chat-1', spanName: 'execute_tool',
    operationName: 'execute_tool', startedAt: '2026-09-08T10:00:02Z', endedAt: '2026-09-08T10:00:03Z',
    durationMs: 1000, statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, attributesJson: JSON.stringify({'gen_ai.tool.name': 'read',
      'gen_ai.tool.call.id': 'call-1', 'gen_ai.tool.call.arguments': {path: 'README.md'},
      'gen_ai.tool.call.result': {text: 'treść'}}), eventsJson: '[]'};
}

function round(model: SpanRecord, index: number, tool?: SpanRecord): RoundObservation {
  const turn: ModelTurn = {index, interactionIndex: 1, interactionTurnIndex: index,
    interactionPrompt: 'Przeanalizuj przepływ', model, tools: tool ? [tool] : []};
  const missing: Metric = {availability: 'missing', sourceAttributes: [], evidenceRefs: []};
  return {ref: `${model.traceId}/${model.spanId}`, streamId: 'root', turn, sequence: `root:${index}`, orderKnown: true,
    model: model.model, input: emitted(model.inputTokens), cache: emitted(model.cacheReadTokens),
    fresh: derived(model.inputTokens - model.cacheReadTokens), output: emitted(model.outputTokens), cacheWrite: missing,
    credits: emitted(.2), promptLimit: emitted(16000), outputLimit: emitted(2000), pressure: derived(model.inputTokens + 2000),
    occupancy: derived((model.inputTokens + 2000) / 18000), deltaPressure: missing, band: 'LOW',
    tools: tool ? [{span: tool, callId: 'call-1', errors: []}] : [], toolCoverage: true, resultBytes: missing,
    uniqueResultBytes: missing, duplicateRatio: missing, distinctResults: tool ? 1 : 0, errors: [], errorCoverage: true,
    compactionCoverage: true, compactionRefs: [], markers: [], qualifiers: [], predicates: [], profile: 'UNKNOWN',
    candidates: [], scores: [], adjustments: [], coverage: 1, confidence: 'high', provisional: false};
}

function message(id: number, spanId: number, direction: string, content: unknown): MessageRecord {
  return {id, spanId, direction, sequenceNo: id, content: JSON.stringify(content), sourceKind: 'attribute'};
}

function emitted(value: number): Metric {
  return {value, availability: 'emitted', sourceAttributes: ['test'], evidenceRefs: ['trace-1/chat-1']};
}

function derived(value: number): Metric {
  return {value, availability: 'derived', sourceAttributes: [], evidenceRefs: ['trace-1/chat-1'], formula: 'test-v1'};
}
