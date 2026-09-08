import {describe, expect, it} from 'vitest';
import {buildGuidanceEvidencePreview, GuidanceEvidenceBuildInput} from './guidance-evidence';
import {MessageRecord, ModelTurn, SessionDetail, SpanRecord} from '../../models/scanner.models';
import {FlowToolCatalog, ToolClassificationResult} from '../../models/tool-classification.models';
import {Metric, RoundObservation, WorkflowAnalysis, WorkflowStream} from '../../models/workflow.models';

describe('buildGuidanceEvidencePreview', () => {
  it('freezes a deterministic phase package, redacts secrets and preserves missing values', async () => {
    const fixture = phaseInput();
    const first = await buildGuidanceEvidencePreview({...fixture, capturedAt: '2026-09-08T09:00:00Z'});
    const second = await buildGuidanceEvidencePreview({...fixture, capturedAt: '2026-09-08T10:00:00Z'});
    const serialized = JSON.stringify(first.request);

    expect(first.request.version).toBe('optimization-advice-v1');
    expect(first.request.manifest.evidenceVersion).toBe('guidance-evidence-v2');
    expect(first.request.manifest.dataFingerprint).toBe(second.request.manifest.dataFingerprint);
    expect(first.request.scope).toMatchObject({kind: 'phase', roundRefs: ['r1']});
    expect(first.request.manifest.selectedRefs).toEqual(['r1']);
    expect(first.request.manifest.supportingRefs).toEqual(['r2']);
    expect(first.summary).toMatchObject({selectedRounds: 1, supportingRounds: 1, sendBlocked: false});
    expect(first.request.candidateTechniqueIds).toEqual(['T03', 'T01', 'T04']);
    const compactSummary = first.request.observations.find(item => item.kind === 'ROUND_COST_SUMMARY');
    expect(JSON.parse(compactSummary?.excerpt?.text ?? '{}').metrics.cacheWriteTokens).toMatchObject({
      provenance: 'MISSING', value: null
    });
    expect(serialized).not.toContain('SECRET SYSTEM');
    expect(serialized).not.toContain('ghp_12345678901234567890');
    expect(serialized).not.toContain('hidden reasoning');
    expect(serialized).toContain('[REDACTED_TOKEN]');
    expect(serialized).toContain('call-1');
    expect(first.request.observations.find(item => item.kind === 'TOOL_EXECUTION')?.sources[0].callId).toBe('call-1');
    expect(first.request.manifest.omitted).toEqual(expect.arrayContaining([
      {ref: 'r1:request', reason: 'SYSTEM_OR_DEVELOPER_CONTENT_REMOVED'},
      {ref: 'r1:request', reason: 'EXPLICIT_REASONING_REMOVED'},
      {ref: 'r1:request', reason: 'RECOGNIZED_SECRET_REDACTED'}
    ]));
    expect(first.warnings).toContain('To lokalny szkic pakietu. Przed użyciem backend musi potwierdzić referencje w raw telemetry i modelu znormalizowanym.');
  });

  it('changes the fingerprint when captured evidence changes', async () => {
    const first = await buildGuidanceEvidencePreview(phaseInput('pierwszy wariant'));
    const second = await buildGuidanceEvidencePreview(phaseInput('drugi wariant'));
    expect(first.request.manifest.dataFingerprint).not.toBe(second.request.manifest.dataFingerprint);
  });

  it('compacts a content-heavy seventeen-round phase and samples the whole phase', async () => {
    const preview = await buildGuidanceEvidencePreview(largePhaseInput());
    const kinds = preview.request.observations.map(item => item.kind);
    const sampledResponses = preview.request.observations
      .filter(item => item.kind === 'MODEL_RESPONSE')
      .map(item => item.sources[0].roundRef);
    const sourceSpans = new Set(preview.request.observations.flatMap(item => item.sources)
      .map(item => `${item.sessionId}:${item.spanId}`));

    expect(preview.summary.selectedRounds).toBe(17);
    expect(preview.summary.observations).toBeLessThanOrEqual(64);
    expect(preview.summary.contentFragments).toBeLessThanOrEqual(12);
    expect(preview.summary.payloadCharacters).toBeLessThan(50_000);
    expect(preview.summary.sendBlocked).toBe(false);
    expect(sourceSpans.size).toBeLessThanOrEqual(64);
    expect(kinds.filter(kind => kind === 'ROUND_COST_SUMMARY')).toHaveLength(17);
    expect(kinds).not.toContain('INPUT_TOKENS');
    expect(sampledResponses).toEqual(expect.arrayContaining(['trace-large/phase-span-1', 'trace-large/phase-span-17']));
    expect(preview.request.manifest.omitted.length).toBeLessThan(10);
    expect(preview.request.manifest.omitted.some(item => item.reason.startsWith('REPRESENTATIVE_SAMPLE_OMITTED_'))).toBe(true);
    expect(preview.warnings).toContain('Treść dobrano z 4 reprezentatywnych rund; zwarte metryki nadal obejmują wszystkie 17 rund fazy.');
  });

  it('does not block analysis because of local package counts or character thresholds', async () => {
    const preview = await buildGuidanceEvidencePreview(largePhaseInput(80));

    expect(preview.summary.selectedRounds).toBe(80);
    expect(preview.summary.observations).toBeGreaterThan(64);
    expect(preview.summary.payloadCharacters).toBeGreaterThan(56_000);
    expect(preview.summary.sendBlocked).toBe(false);
    expect(preview.warnings.join(' ')).not.toMatch(/limit wysyłki|przed wysłaniem trzeba zejść/);
  });

  it('truncates long text fields and records the exact omission rule', async () => {
    const preview = await buildGuidanceEvidencePreview(phaseInput('x'.repeat(5000)));
    const goal = preview.request.userContext.goal;
    const goalObservation = preview.request.observations.find(item => item.kind === 'USER_GOAL');

    expect(goal).toHaveLength(4000);
    expect(goalObservation?.excerpt).toMatchObject({originalCharacters: 5002, truncated: true});
    expect(preview.request.manifest.omitted).toContainEqual({ref: 'userContext.goal', reason: 'TRUNCATED_TO_4000_CHARACTERS'});
  });

  it('rejects a broad category because the first version requires an exact scope', async () => {
    const input = phaseInput();
    await expect(buildGuidanceEvidencePreview({...input, context: {...input.context, kind: 'CATEGORY'}}))
      .rejects.toThrow('konkretnej fazy albo pojedynczego kompaktowania');
  });

  it('keeps compaction before/after measurements out when receipt is not confirmed', async () => {
    const fixture = phaseInput();
    const preview = await buildGuidanceEvidencePreview({
      ...fixture,
      context: {
        kind: 'COMPACTION', title: 'Kompaktowanie', scopeLabel: 'przed interakcją 2', explanation: 'Zmierzona operacja.',
        topics: ['CONTEXT_COMPACTION'], measurement: {credits: .2, creditEstimated: false, coveredCalls: 1, totalCalls: 1},
        evidenceLabels: [], evidence: [{kind: 'COMPACTION', id: 'c1', label: 'K1', description: 'Wywołanie kompaktora'}]
      },
      compactions: [{id: 'c1', sessionId: 1, spanId: 1, agentName: 'compactor', inputTokens: 8000, outputTokens: 600,
        credits: .2, resultCharacters: 1200, beforeInputTokens: 12000, afterInputTokens: 4000}],
      relatedDetails: []
    });

    expect(preview.request.scope).toEqual({kind: 'compaction', rootSessionId: 1, compactionRef: 'c1'});
    expect(preview.request.observations.some(item => item.kind === 'CONTEXT_BEFORE_COMPACTION')).toBe(false);
    expect(preview.request.observations.some(item => item.kind === 'CONTEXT_AFTER_COMPACTION')).toBe(false);
    expect(preview.warnings).toContain('Nie potwierdzono odbioru wyniku kompaktowania w późniejszym requestcie.');
  });
});

function phaseInput(userText = 'Użyj ghp_12345678901234567890 i zbierz dane.'): GuidanceEvidenceBuildInput {
  const first = span(1, 1);
  const second = span(2, 2);
  const execution = toolSpan();
  const source = detail(first, second, userText);
  source.spans.push(execution, userRoot(userText));
  const rounds = [round('r1', first, 1, userText, execution), round('r2', second, 2, userText)];
  const stream: WorkflowStream = {
    id: 'root', sessionId: 1, label: 'Agent główny', source, depth: 0, rounds, segments: [], profiles: [],
    credits: {known: .5, covered: 2, total: 2}, subtreeCredits: {known: .5, covered: 2, total: 2}, rates: []
  };
  const analysis: WorkflowAnalysis = {
    source, classifierVersion: 'rules-v1', componentVersions: {}, cutoffSignalId: 1, streams: [stream],
    linkIssues: [], linkCoverage: true, treeCredits: stream.credits, profiles: [], recommendations: [], upstreamCompleteness: 'unverified'
  };
  const catalog: FlowToolCatalog = {
    request: {
      tools: [], agents: [{id: 'agent-root', parentId: null, contextIds: ['ctx-1']}],
      contexts: [{id: 'ctx-1', agentId: 'agent-root', goal: userText, rounds: [
        {id: 'round-1', order: 1, modelOutput: 'Wywołam narzędzie.', outputObserved: true, invocations: []},
        {id: 'round-2', order: 2, modelOutput: 'Gotowe.', outputObserved: true, invocations: []}
      ]}]
    },
    key: 'catalog-key', usages: [], rounds: [{ref: 'r1', id: 'round-1', streamId: 'root'}, {ref: 'r2', id: 'round-2', streamId: 'root'}],
    agents: [{streamId: 'root', id: 'agent-root'}], definitionsSeen: 0, missing: 0
  };
  return {
    context: {
      kind: 'PHASE', title: 'Pozyskiwanie danych', scopeLabel: 'interakcja 1 · M1', explanation: 'Jedna faza.',
      topics: ['ACQUIRE_DATA'], measurement: {credits: .3, creditEstimated: false, coveredCalls: 1, totalCalls: 1},
      evidenceLabels: [], evidence: [{kind: 'ROUND', id: 'r1', label: 'M1', description: 'Pierwsza runda'}]
    },
    catalogVersion: 'techniques-v1', candidateTechniqueIds: ['T03', 'T01', 'T04', 'T99'], analysis, catalog,
    compactions: [], relatedDetails: [], interactionTraceId: 'trace-1'
  };
}

function largePhaseInput(roundCount = 17): GuidanceEvidenceBuildInput {
  const prompt = 'Przeanalizuj projekt i zbierz dowody.';
  const models: SpanRecord[] = [];
  const tools: SpanRecord[] = [];
  const messages: MessageRecord[] = [];
  const rounds: RoundObservation[] = [];
  const catalogRounds: FlowToolCatalog['rounds'] = [];
  const catalogInputs: FlowToolCatalog['request']['contexts'][number]['rounds'] = [];
  const classifications: ToolClassificationResult['rounds'] = [];

  for (let index = 1; index <= roundCount; index++) {
    const inputTokens = 8_000 + index * 400;
    const cacheReadTokens = 6_000 + index * 300;
    const outputTokens = 100 + index * 10;
    const credits = .25 + index / 100;
    const model: SpanRecord = {
      id: index, signalId: 1, traceId: 'trace-large', spanId: `phase-span-${index}`, spanName: 'chat', operationName: 'chat',
      startedAt: new Date(Date.UTC(2026, 8, 8, 9, 0, index * 2)).toISOString(),
      endedAt: new Date(Date.UTC(2026, 8, 8, 9, 0, index * 2 + 1)).toISOString(), durationMs: 1000,
      statusCode: 'STATUS_CODE_OK', model: 'gpt-test', inputTokens, outputTokens, cacheReadTokens,
      cacheCreationTokens: 20, reasoningTokens: 0,
      attributesJson: JSON.stringify({
        'gen_ai.usage.input_tokens': inputTokens,
        'gen_ai.usage.cache_read.input_tokens': cacheReadTokens,
        'gen_ai.usage.cache_creation.input_tokens': 20,
        'gen_ai.usage.output_tokens': outputTokens,
        'copilot_chat.copilot_usage_nano_aiu': credits * 1_000_000_000,
        'copilot_chat.request.max_prompt_tokens': 16_000,
        'gen_ai.request.max_tokens': 2_000
      }), eventsJson: '[]'
    };
    const roundTools = Array.from({length: 4}, (_, toolIndex): SpanRecord => ({
      id: 100 + index * 10 + toolIndex, signalId: 1, traceId: 'trace-large', spanId: `tool-${index}-${toolIndex}`,
      parentSpanId: model.spanId, spanName: 'execute_tool', operationName: 'execute_tool',
      startedAt: model.endedAt, endedAt: new Date(Date.parse(model.endedAt!) + 500).toISOString(), durationMs: 500,
      statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
      attributesJson: JSON.stringify({'gen_ai.tool.name': 'search', 'gen_ai.tool.call.id': `call-${index}-${toolIndex}`,
        'gen_ai.tool.call.arguments': {query: `endpoint-${index}-${toolIndex}`},
        'gen_ai.tool.call.result': {content: `wynik-${index}-${toolIndex}-` + 'x'.repeat(5_000)}}), eventsJson: '[]'
    }));
    models.push(model);
    tools.push(...roundTools);
    messages.push(
      message(index * 3, model.id, 'input', [{role: 'user', content: `historia-${index}-` + 'i'.repeat(8_000)}]),
      message(index * 3 + 1, model.id, 'output', [{role: 'assistant', content: `odpowiedź-${index}-` + 'o'.repeat(4_000)}]),
      message(index * 3 + 2, model.id, 'definition', [{type: 'function', name: 'search', description: 'd'.repeat(5_000)}])
    );
    const observed = round(`trace-large/${model.spanId}`, model, index, prompt);
    observed.streamId = 'subagent';
    observed.turn = {...observed.turn, tools: roundTools};
    observed.tools = roundTools.map((spanRecord, toolIndex) => ({span: spanRecord, callId: `call-${index}-${toolIndex}`, errors: []}));
    observed.cacheWrite = emitted(20, 'gen_ai.usage.cache_creation.input_tokens');
    observed.credits = derived(credits, 'nano AIU / 1 000 000 000');
    observed.occupancy = derived(inputTokens / 18_000, 'I / (Pmax + Omax)');
    rounds.push(observed);
    catalogRounds.push({ref: observed.ref, id: `round-${index}`, streamId: 'subagent'});
    catalogInputs.push({id: `round-${index}`, order: index, modelOutput: `odpowiedź-${index}`, outputObserved: true, invocations: []});
    classifications.push({roundId: `round-${index}`, actions: ['ACQUIRE_DATA'], evidenceInvocationIds: [], reason: 'Pozyskanie danych.'});
  }

  const root = userRoot(prompt);
  root.id = 999;
  root.traceId = 'trace-large';
  root.spanId = 'root-large';
  const source: SessionDetail = {
    session: {id: 1, conversationId: 'conversation-large', lastSeenAt: '2026-09-08T09:01:00Z', inputTokens: 200_000,
      outputTokens: 4_000, cacheReadTokens: 150_000, cacheCreationTokens: 340, reasoningTokens: 0,
      turnCount: roundCount, toolCount: tools.length, errorCount: 0, contentCaptured: true},
    spans: [...models, ...tools, root], messages,
    signals: [{id: 1, signalType: 'traces', receivedAt: '2026-09-08T09:01:01Z', rawJson: '{}', resourceAttributes: '{}', itemCount: 1}]
  };
  const stream: WorkflowStream = {
    id: 'subagent', sessionId: 1, label: 'Subagent 1', source, depth: 1, rounds, segments: [], profiles: [],
    credits: {known: 5, covered: roundCount, total: roundCount},
    subtreeCredits: {known: 5, covered: roundCount, total: roundCount}, rates: []
  };
  const analysis: WorkflowAnalysis = {source, classifierVersion: 'rules-v1', componentVersions: {}, cutoffSignalId: 1,
    streams: [stream], linkIssues: [], linkCoverage: true, treeCredits: stream.credits, profiles: [], recommendations: [],
    upstreamCompleteness: 'unverified'};
  const catalog: FlowToolCatalog = {
    request: {tools: [], agents: [{id: 'agent-sub', parentId: null, contextIds: ['ctx-large']}],
      contexts: [{id: 'ctx-large', agentId: 'agent-sub', goal: prompt, rounds: catalogInputs}]},
    key: 'large-catalog', usages: [], rounds: catalogRounds, agents: [{streamId: 'subagent', id: 'agent-sub'}],
    definitionsSeen: roundCount, missing: 0
  };
  const classification: ToolClassificationResult = {
    version: 'model-actions-v5', model: 'gpt-test', analyzedAt: '2026-09-08T09:02:00Z', tools: [], assessments: [], rounds: classifications
  };
  return {
    context: {kind: 'PHASE', title: 'Pozyskanie danych', scopeLabel: `S1:M1–M${roundCount}`, explanation: 'Długa faza.',
      topics: ['ACQUIRE_DATA'], measurement: {credits: 5, creditEstimated: true, coveredCalls: roundCount, totalCalls: roundCount},
      evidenceLabels: [], evidence: rounds.map((item, index) => ({kind: 'ROUND', id: item.ref, label: `S1:M${index + 1}`, description: 'Runda subagenta'}))},
    catalogVersion: 'techniques-v1', candidateTechniqueIds: ['T03', 'T04'], analysis, catalog, classification,
    compactions: [], relatedDetails: [], interactionTraceId: 'trace-large'
  };
}

function detail(first: SpanRecord, second: SpanRecord, userText: string): SessionDetail {
  const messages: MessageRecord[] = [
    message(1, first.id, 'input', [{role: 'system', content: 'SECRET SYSTEM'}, {role: 'user', content: userText},
      {role: 'assistant', content: 'bezpieczny kontekst', reasoning: 'hidden reasoning'}]),
    message(2, first.id, 'output', [{role: 'assistant', content: 'Sprawdzam.', tool_calls: [{id: 'call-1', type: 'function_call', name: 'search'}]}]),
    message(3, second.id, 'input', [{role: 'tool', tool_call_id: 'call-1', content: 'wynik narzędzia'}]),
    message(4, second.id, 'output', [{role: 'assistant', content: 'Gotowe.'}])
  ];
  return {
    session: {id: 1, conversationId: 'conversation-1', lastSeenAt: '2026-09-08T09:00:02Z', inputTokens: 3000, outputTokens: 300,
      cacheReadTokens: 1000, cacheCreationTokens: 0, reasoningTokens: 0, turnCount: 2, toolCount: 0, errorCount: 0, contentCaptured: true},
    spans: [first, second], messages,
    signals: [{id: 1, signalType: 'traces', receivedAt: '2026-09-08T09:00:03Z', rawJson: '{}', resourceAttributes: '{}', itemCount: 2}]
  };
}

function message(id: number, spanId: number, direction: string, content: unknown): MessageRecord {
  return {id, spanId, direction, sequenceNo: id, content: JSON.stringify(content), sourceKind: 'attribute'};
}

function span(id: number, second: number): SpanRecord {
  return {id, signalId: 1, traceId: 'trace-1', spanId: `span-${id}`, spanName: 'chat', operationName: 'chat',
    startedAt: `2026-09-08T09:00:0${second}Z`, endedAt: `2026-09-08T09:00:0${second + 1}Z`, durationMs: 1000,
    statusCode: 'STATUS_CODE_OK', model: 'gpt-test', inputTokens: id === 1 ? 1800 : 2200, outputTokens: id === 1 ? 160 : 140,
    cacheReadTokens: id === 1 ? 600 : 900, cacheCreationTokens: 0, reasoningTokens: 0,
    attributesJson: JSON.stringify({'gen_ai.usage.input_tokens': id === 1 ? 1800 : 2200, 'gen_ai.usage.output_tokens': id === 1 ? 160 : 140}),
    eventsJson: '[]'};
}

function round(ref: string, model: SpanRecord, index: number, prompt: string, execution?: SpanRecord): RoundObservation {
  const turn: ModelTurn = {index, interactionIndex: 1, interactionTurnIndex: index, interactionPrompt: prompt, model, tools: execution ? [execution] : []};
  const missing: Metric = {availability: 'missing', sourceAttributes: [], evidenceRefs: []};
  return {
    ref, streamId: 'root', turn, sequence: `root:${index}`, orderKnown: true, model: model.model,
    input: emitted(model.inputTokens, 'gen_ai.usage.input_tokens'), cache: emitted(model.cacheReadTokens, 'gen_ai.usage.cache_read.input_tokens'),
    fresh: derived(model.inputTokens - model.cacheReadTokens, 'fresh-input-v1'), output: emitted(model.outputTokens, 'gen_ai.usage.output_tokens'),
    cacheWrite: missing, credits: emitted(index === 1 ? .3 : .2, 'copilot_chat.copilot_usage_nano_aiu'),
    promptLimit: emitted(16000, 'copilot_chat.request.max_prompt_tokens'), outputLimit: emitted(2000, 'gen_ai.request.max_tokens'),
    pressure: derived(model.inputTokens + 2000, 'context-pressure-v1'), occupancy: derived((model.inputTokens + 2000) / 18000, 'context-occupancy-v1'),
    deltaPressure: missing, band: 'LOW', tools: execution ? [{span: execution, callId: 'call-1', errors: []}] : [], toolCoverage: true,
    resultBytes: missing, uniqueResultBytes: missing,
    duplicateRatio: missing, distinctResults: 0, errors: [], errorCoverage: true, compactionCoverage: true, compactionRefs: [], markers: [],
    qualifiers: [], predicates: [], profile: 'UNKNOWN', candidates: [], scores: [], adjustments: [], coverage: 1, confidence: 'high', provisional: false
  };
}

function toolSpan(): SpanRecord {
  return {id: 3, signalId: 1, traceId: 'trace-1', spanId: 'tool-1', parentSpanId: 'span-1', spanName: 'execute_tool',
    operationName: 'execute_tool', startedAt: '2026-09-08T09:00:01Z', endedAt: '2026-09-08T09:00:02Z', durationMs: 500,
    statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    attributesJson: JSON.stringify({'gen_ai.tool.name': 'search', 'gen_ai.tool.call.id': 'call-1',
      'gen_ai.tool.call.arguments': {query: 'endpoint'}, 'gen_ai.tool.call.result': {ok: true, count: 1}}), eventsJson: '[]'};
}

function userRoot(prompt: string): SpanRecord {
  return {id: 4, signalId: 1, traceId: 'trace-1', spanId: 'root-1', spanName: 'invoke_agent', operationName: 'invoke_agent',
    startedAt: '2026-09-08T09:00:00Z', endedAt: '2026-09-08T09:00:03Z', durationMs: 3000,
    statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    attributesJson: JSON.stringify({'copilot_chat.user_request': prompt}), eventsJson: '[]'};
}

function emitted(value: number, attribute: string): Metric {
  return {value, availability: 'emitted', sourceAttributes: [attribute], evidenceRefs: ['trace-1/span-1']};
}

function derived(value: number, formula: string): Metric {
  return {value, availability: 'derived', sourceAttributes: [], evidenceRefs: ['trace-1/span-1'], formula};
}
