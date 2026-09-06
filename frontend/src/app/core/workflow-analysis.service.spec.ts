import {describe, expect, it} from 'vitest';
import {WorkflowAnalysisService} from './workflow-analysis.service';
import {and, contentElement, known, not, or, TelemetryReader} from './workflow/telemetry';
import {state} from './workflow/phases';
import {shareAtLeast} from './workflow/profiles';
import {at, chat, detail, span, tool, workflowFixture} from './workflow/workflow.fixtures';

describe('WorkflowAnalysisService evidence-first contract', () => {
  const analyze = async (spans: ReturnType<typeof chat>[]) => (await new WorkflowAnalysisService().analyze(detail(spans), [])).streams[0].rounds;

  it('keeps missing metrics distinct from explicitly emitted zero and never uses normalized defaults', async () => {
    const rounds = await analyze([span(1), chat(2, 0, 0, 0)]);
    expect(rounds[0].input.availability).toBe('missing');
    expect(rounds[0].fresh.availability).toBe('missing');
    expect(rounds[0].pressure.value).toBeUndefined();
    expect(rounds[1].input).toMatchObject({availability: 'emitted', value: 0});
    expect(rounds[1].fresh).toMatchObject({availability: 'derived', value: 0});
    expect(rounds[1].cacheWrite.availability).toBe('missing');
  });

  it.each([[-1, 0], [100, 200], [100, -1]])('rejects invalid input/cache pairs %s/%s', async (i, k) => {
    const [round] = await analyze([chat(1, i, k)]);
    expect(known(round.fresh)).toBeUndefined();
    expect(round.fresh.availability).toBe('invalid');
  });

  it.each([[0, 'LOW'], [.2499, 'LOW'], [.25, 'MODERATE'], [.5999, 'MODERATE'], [.6, 'HIGH'], [.8499, 'HIGH'], [.85, 'CRITICAL'], [1, 'CRITICAL'], [1.01, 'UNKNOWN']])(
    'uses the current round pressure band at %s', async (pressure, band) => {
      const [round] = await analyze([chat(1, Number(pressure) * 20000, 0)]);
      expect(round.band).toBe(band);
      expect(round.pressure.value).toBe(pressure);
      if (pressure === 1.01) expect(round.pressure.availability).toBe('ambiguous');
    });

  it('counts cache as part of occupancy and separates prompt pressure from the full window', async () => {
    const [round] = await analyze([chat(1, 12000, 11000, 50)]);
    expect(round.pressure.value).toBe(.6);
    expect(round.occupancy.value).toBe(.5);
    expect(round.fresh.value).toBe(1000);
  });

  it('classifies the same volumes identically for completely different tool names', async () => {
    const [root, child] = workflowFixture();
    const first = await new WorkflowAnalysisService().analyze(root, [child]);
    const renamed = {...root, spans: root.spans.map(item => ({...item, attributesJson: item.attributesJson.replaceAll('custom_operation', 'whatever_arbitrary_name')}))};
    const second = await new WorkflowAnalysisService().analyze(renamed, [child]);
    expect(first.streams.map(stream => stream.rounds.map(round => [round.profile, round.scores]))).toEqual(second.streams.map(stream => stream.rounds.map(round => [round.profile, round.scores])));
    expect(first.streams[0].rounds[0].profile).toBe('CONTEXT_ACCUMULATION');
    expect(first.streams[0].rounds.some(round => round.profile === 'CONTEXT_PROCESSING')).toBe(true);
    expect(first.streams[0].rounds.some(round => round.profile === 'OUTPUT_DOMINANT')).toBe(true);
  });

  it('does not infer a historical output burst or synthesis from one output-heavy round', async () => {
    const [round] = await analyze([chat(1, 1000, 800, 500)]);
    expect(state(round, 'highOutputRatio')).toBe(true);
    expect(state(round, 'outputBurst')).toBe('unknown');
    expect(round.provisional).toBe(true);
    expect(round.confidence).toBe('low');
  });

  it('applies absolute burst minima even without history or a prompt limit', async () => {
    const first = chat(1, 255, 0, 31);
    const attrs = JSON.parse(first.attributesJson) as Record<string, unknown>;
    delete attrs['copilot_chat.request.max_prompt_tokens']; first.attributesJson = JSON.stringify(attrs);
    const [round] = await analyze([first]);
    expect(state(round, 'freshBurst')).toBe(false);
    expect(state(round, 'outputBurst')).toBe(false);
    const [boundary] = await analyze([chat(2, 256, 0, 32)]);
    expect(state(boundary, 'outputBurst')).toBe('unknown');
  });

  it('resets at interaction, model and limit boundaries including X → missing → Y', async () => {
    const middle = chat(2); middle.model = undefined;
    const attrs = JSON.parse(middle.attributesJson) as Record<string, unknown>; delete attrs['gen_ai.request.model']; middle.attributesJson = JSON.stringify(attrs);
    const rounds = await analyze([chat(1), middle, chat(3, 1000, 800, 50, {'gen_ai.request.model': 'other'}),
      chat(4, 1000, 800, 50, {'gen_ai.request.model': 'other', 'gen_ai.request.max_tokens': 5000}), chat(5, 1000, 800, 50, {}, {traceId: 'other-trace'})]);
    expect(rounds[0].sequence).toBe(rounds[1].sequence);
    expect(rounds[2].sequence).not.toBe(rounds[1].sequence);
    expect(rounds[3].sequence).not.toBe(rounds[2].sequence);
    expect(rounds[4].sequence).not.toBe(rounds[3].sequence);
    expect(rounds[2].markers).toContain('MODEL_CHANGE');
    expect(known(rounds[2].deltaPressure)).toBeUndefined();
  });

  it('does not carry priors or trends across overlapping timestamps', async () => {
    const rounds = await analyze([chat(1, 1000, 800, 50, {}, {endedAt: at(22)}), chat(2)]);
    expect(rounds.every(round => !round.orderKnown)).toBe(true);
    expect(rounds[0].sequence).not.toBe(rounds[1].sequence);
    expect(known(rounds[1].deltaPressure)).toBeUndefined();
  });

  it('keeps each interaction sequence together when distinct traces interleave in wall time', async () => {
    const rounds = await analyze([chat(1), chat(2, 1000, 800, 50, {}, {traceId: 'second'}), chat(3), chat(4, 1000, 800, 50, {}, {traceId: 'second'})]);
    expect(rounds.map(round => round.turn.model.traceId)).toEqual(['trace-root', 'trace-root', 'second', 'second']);
    expect(rounds[0].sequence).toBe(rounds[1].sequence);
    expect(rounds[2].sequence).toBe(rounds[3].sequence);
    expect(rounds[2].sequence).not.toBe(rounds[1].sequence);
  });

  it('adds POST_ERROR with its own profile, but neither large latency nor input drops create errors or compaction', async () => {
    const rounds = await analyze([chat(1, 6000, 2000, 50), tool(20, 1, {ok: false}), chat(2, 1000, 800, 50, {}, {durationMs: 999999})]);
    expect(rounds[0].errors[0].codes).toContain('ok=false');
    expect(rounds[1].markers).toContain('POST_ERROR');
    expect(rounds[1].errors).toEqual([]);
    expect(rounds[1].compactionRefs).toEqual([]);
    expect(rounds[1].sequence).not.toBe(rounds[0].sequence);
  });

  it('keeps compaction as an event and gates success/rehydration until an emitter fixture exists', async () => {
    const rounds = await analyze([chat(1, 6000, 2000, 50, {}, {eventsJson: JSON.stringify([{name: 'github.copilot.session.compaction_complete', attributes: {success: true}}])}), chat(2, 1000, 0)]);
    expect(rounds[0].markers).toContain('COMPACTION_EVENT');
    expect(rounds[1].sequence).not.toBe(rounds[0].sequence);
    expect(rounds.every(round => !round.qualifiers.includes('REHYDRATION_PATTERN'))).toBe(true);
  });

  it('can detect iterative volume without capture content', async () => {
    const tools = [tool(20, 1), tool(21, 2)].map(item => {
      const attrs = JSON.parse(item.attributesJson) as Record<string, unknown>; delete attrs['gen_ai.tool.call.result'];
      return {...item, attributesJson: JSON.stringify(attrs)};
    });
    const rounds = await analyze([chat(1), chat(2), chat(3), ...tools]);
    expect(rounds.every(round => round.qualifiers.includes('ITERATIVE_FLOW'))).toBe(true);
    expect(rounds[0].duplicateRatio.availability).toBe('missing');
  });

  it('requires reconciled request content and explicit absence of retained state for condensation', async () => {
    const content = {'gen_ai.input.messages': [{role: 'user', content: 'x'.repeat(5000)}], 'gen_ai.system_instructions': [], 'gen_ai.tool.definitions': [],
      'gen_ai.output.messages': [{role: 'assistant', parts: [{type: 'text', content: 'Short response'}]}],
      'copilot_chat.request.shape': {inputItemCount: 1, hasPreviousResponseId: false}};
    const [complete] = await analyze([chat(1, 5000, 4000, 50, content)]);
    expect(complete.qualifiers).toContain('CONDENSING');
    const [retained] = await analyze([chat(1, 5000, 4000, 50, {...content, 'copilot_chat.request.shape': {inputItemCount: 1, hasPreviousResponseId: true}})]);
    expect(retained.qualifiers).not.toContain('CONDENSING');
    const [partial] = await analyze([chat(1, 5000, 4000, 50, {...content, 'copilot_chat.request.shape': {inputItemCount: 2, hasPreviousResponseId: false}})]);
    expect(state(partial, 'condensing')).toBe('unknown');
  });

  it('maps explicit timestamped root events to a round and does not invent event timing', async () => {
    const root = span(99, {'gen_ai.conversation.id': 'root'}, {operationName: 'invoke_agent', startedAt: at(0), endedAt: at(30),
      eventsJson: JSON.stringify([{name: 'error', time: at(12), attributes: {}}])});
    const rounds = await analyze([root, chat(1), chat(2)]);
    expect(rounds[0].errors.some(error => error.ref === 'trace-root/span-99')).toBe(true);
    expect(rounds[1].markers).toContain('POST_ERROR');
  });

  it('downgrades captured content when raw OTLP reports dropped elements', async () => {
    const source = detail([chat(1), tool(20, 1, 'x'.repeat(4000)), chat(2)]);
    source.signals.push({id: 1, signalType: 'traces', receivedAt: at(30), resourceAttributes: '{}', itemCount: 3,
      rawJson: JSON.stringify({resourceSpans: [{scopeSpans: [{spans: [{droppedAttributesCount: 1}]}]}]})});
    const result = await new WorkflowAnalysisService().analyze(source, []);
    expect(result.upstreamCompleteness).toBe('truncated');
    expect(result.streams[0].rounds[0].toolCoverage).toBe(false);
    expect(result.linkCoverage).toBe(false);
  });

  it('links custom tools by raw ID, including nested children, without double counting', async () => {
    const root = detail([chat(1), tool(20, 1, 'return', {'gen_ai.tool.call.id': 'child'})]);
    const child = detail([chat(2, 1000, 800, 50, {'gen_ai.conversation.id': 'child'}, {traceId: 'child-trace'}),
      tool(21, 2, 'return', {'gen_ai.conversation.id': 'child', 'gen_ai.tool.call.id': 'grandchild'}, {traceId: 'child-trace'})], 2, 'child');
    const grandchild = detail([chat(3, 1000, 800, 50, {'gen_ai.conversation.id': 'grandchild'}, {traceId: 'grandchild-trace'})], 3, 'grandchild');
    const result = await new WorkflowAnalysisService().analyze(root, [grandchild, child]);
    expect(result.streams.map(stream => stream.depth)).toEqual([0, 1, 2]);
    expect(result.treeCredits.known).toBeCloseTo(.3);
    expect(result.streams[1].subtreeCredits.known).toBeCloseTo(.2);
    expect(result.streams[1].credits.known).toBeCloseTo(.1);
  });

  it('does not link a normalized session ID without its raw conversation attribute', async () => {
    const root = detail([chat(1), tool(20, 1, '', {'gen_ai.tool.call.id': 'child'})]);
    const child = detail([span(2, {}, {traceId: 'child-trace'})], 2, 'child');
    const result = await new WorkflowAnalysisService().analyze(root, [child]);
    expect(result.streams).toHaveLength(1);
    expect(result.treeCredits.total).toBe(1);
  });

  it('rejects collisions independent of candidate order', async () => {
    const root = detail([chat(1), tool(20, 1, '', {'gen_ai.tool.call.id': 'child'})]);
    const a = detail([chat(2, 1000, 800, 50, {'gen_ai.conversation.id': 'child'}, {traceId: 'child-a'})], 2, 'child');
    const b = detail([chat(3, 1000, 800, 50, {'gen_ai.conversation.id': 'child'}, {traceId: 'child-b'})], 3, 'child');
    const one = await new WorkflowAnalysisService().analyze(root, [a, b]);
    const two = await new WorkflowAnalysisService().analyze(root, [b, a]);
    expect(one.streams).toHaveLength(1);
    expect(one.linkIssues).toEqual(two.linkIssues);
    expect(one.linkIssues.some(issue => issue.state === 'ambiguous')).toBe(true);
  });

  it('cuts a cycle and preserves subtree totals', async () => {
    const root = detail([chat(1), tool(20, 1, '', {'gen_ai.tool.call.id': 'child'})]);
    const child = detail([chat(2, 1000, 800, 50, {'gen_ai.conversation.id': 'child'}, {traceId: 'child'}), tool(21, 2, '',
      {'gen_ai.conversation.id': 'child', 'gen_ai.tool.call.id': 'root'}, {traceId: 'child'})], 2, 'child');
    const result = await new WorkflowAnalysisService().analyze(root, [child]);
    expect(result.streams).toHaveLength(2);
    expect(result.linkIssues.some(issue => issue.state === 'invalidCycle')).toBe(true);
    expect(result.treeCredits.total).toBe(2);
  });

  it('deduplicates retransmitted spans, but keeps different executions as transfers', async () => {
    const exchange = tool(20, 1, 'x'.repeat(2000));
    const result = await new WorkflowAnalysisService().analyze(detail([chat(1), exchange, {...exchange, id: 99}, tool(21, 1, 'x'.repeat(2000)), chat(2)]), []);
    const round = result.streams[0].rounds[0];
    expect(round.tools).toHaveLength(2);
    expect(round.resultBytes.value).toBe(4000);
    expect(round.uniqueResultBytes.value).toBe(2000);
    expect(result.recommendations[0].code).toBe('REPEATED_IDENTICAL_TOOL_EXCHANGE');
    expect(result.recommendations[0].refs).toContain(round.ref);
  });

  it('keeps incomplete child metrics out of LOW_VOLUME and credit rate comparisons', async () => {
    const [root, child] = workflowFixture();
    child.spans.push(span(10, {'gen_ai.conversation.id': 'child'}, {traceId: 'trace-child'}));
    const result = await new WorkflowAnalysisService().analyze(root, [child]);
    expect(result.streams[1].rates[0].value).toBeNull();
    expect(result.streams[1].profiles.find(profile => profile.code === 'LOW_VOLUME')?.state).not.toBe(true);
    expect(result.streams[1].credits).toMatchObject({covered: 2, total: 3});
  });

  it('uses a ratio of sums for credits and blocks comparison when cache write is positive', async () => {
    const root = detail([chat(1), tool(20, 1, '', {'gen_ai.tool.call.id': 'child'})]);
    const child = detail([chat(2, 1000, 800, 50, {'gen_ai.conversation.id': 'child'}, {traceId: 'child'}),
      chat(3, 2000, 1600, 100, {'gen_ai.conversation.id': 'child', 'copilot_chat.copilot_usage_nano_aiu': 400000000, 'gen_ai.usage.cache_creation.input_tokens': 10}, {traceId: 'child'})], 2, 'child');
    const result = await new WorkflowAnalysisService().analyze(root, [child]);
    const rate = result.streams[1].rates[0];
    expect(rate.value).toBeCloseTo(.5 / (2400 + 6000 + 15000));
    expect(rate.relative).toBeNull(); expect(rate.cacheWriteNotModelled).toBe(true);
  });

  it('is deterministic with reordered records and evolves the snapshot cutoff', async () => {
    const [root, child] = workflowFixture();
    const service = new WorkflowAnalysisService();
    const a = await service.analyze(root, [child]);
    const b = await service.analyze({...root, spans: [...root.spans].reverse()}, [{...child, spans: [...child.spans].reverse()}]);
    expect(a.streams.map(stream => stream.rounds)).toEqual(b.streams.map(stream => stream.rounds));
    const updated = {...root, spans: [...root.spans, chat(11, 12300, 11800, 2000, {}, {signalId: 2})]};
    const c = await service.analyze(updated, [child]);
    expect(c.cutoffSignalId).toBe(2);
    expect(c.streams[0].rounds.at(-2)?.provisional).toBe(false);
  });

  it('makes every predicate auditable from source spans', async () => {
    const [root, child] = workflowFixture();
    const result = await new WorkflowAnalysisService().analyze(root, [child]);
    for (const stream of result.streams) for (const round of stream.rounds) {
      for (const predicate of round.predicates.filter(predicate => predicate.state === true)) expect(predicate.refs.length).toBeGreaterThan(0);
      for (let index = 0; index < 3; index++) {
        const local = round.predicates.filter(predicate => predicate.state === true).reduce((sum, predicate) => sum + predicate.weights[index], 0);
        const adjustments = round.adjustments.reduce((sum, adjustment) => sum + adjustment.points[index], 0);
        expect(round.scores[index]).toBe(local + adjustments);
      }
    }
  });
});

describe('workflow primitives', () => {
  it('preserves three-valued boolean algebra and bounded aggregate uncertainty', () => {
    expect(and(true, 'unknown')).toBe('unknown'); expect(and(false, 'unknown')).toBe(false);
    expect(or(false, 'unknown')).toBe('unknown'); expect(or(true, 'unknown')).toBe(true); expect(not('unknown')).toBe('unknown');
    expect(shareAtLeast([true, true, 'unknown'], .5)).toBe(true);
    expect(shareAtLeast([false, false, 'unknown'], .5)).toBe(false);
    expect(shareAtLeast([true, false, 'unknown'], .5)).toBe('unknown');
  });
  it('hashes canonical JSON with UTF-8 bytes and preserves textual whitespace', async () => {
    const a = await contentElement('{"z":1,"a":"ą"}', 'a'), b = await contentElement('{ "a": "ą", "z": 1 }', 'b');
    expect(a.hash).toBe(b.hash); expect(a.bytes).toBe(new TextEncoder().encode('{"a":"ą","z":1}').length);
    expect((await contentElement('x y', 'a')).hash).not.toBe((await contentElement('x  y', 'b')).hash);
    expect((await contentElement('[1,2]', 'a')).hash).not.toBe((await contentElement('[2,1]', 'b')).hash);
  });
  it('detects structured failures, failed compaction and known textual exit codes only', () => {
    const reader = new TelemetryReader();
    expect(reader.errors(tool(1, 1, {isError: true}))).toContain('isError=true');
    expect(reader.errors(tool(1, 1, 'Process Exit Code: 2'))).toContain('exitCode=2');
    expect(reader.errors(tool(1, 1, 'error handling documentation'))).toEqual([]);
    expect(reader.errors(span(1, {}, {eventsJson: JSON.stringify([{name: 'github.copilot.session.compaction_complete', attributes: {success: 'false'}}])}))).toHaveLength(1);
  });
});
