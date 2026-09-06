import {describe, expect, it} from 'vitest';
import {compactArguments, estimateClassificationTokens, flowToolCatalog} from './flow-tool-catalog';
import {WorkflowAnalysisService} from './workflow-analysis.service';
import {at, chat as baseChat, detail, span, tool} from './workflow/workflow.fixtures';
import {mixedEpisodeFixture} from './workflow/mixed-episode.fixture';

const chat: typeof baseChat = (id, input, cache, output, extra = {}, overrides = {}) => baseChat(id, input, cache, output, {
  'gen_ai.output.messages': [{role: 'assistant', parts: [{type: 'tool_call', id: `call-${10 + id}`, name: 'read_file',
    arguments: {path: 'src/Main.java', explanation: 'PRIVATE ARGUMENT'}}]}], ...extra}, overrides);
const definition = {name: 'read_file', description: 'Read a file', parameters: {type: 'object', properties: {path: {type: 'string'}}}};
const defs = (values: unknown[]) => ({'gen_ai.tool.definitions': JSON.stringify(values)});
const used = (id: number, after: number) => tool(id, after, 'PRIVATE TOOL RESULT', {'gen_ai.tool.name': 'read_file',
  'gen_ai.tool.call.arguments': JSON.stringify({path: 'src/Main.java', explanation: 'PRIVATE ARGUMENT'})});
const analyze = async (spans: Parameters<typeof detail>[0]) => flowToolCatalog(await new WorkflowAnalysisService().analyze(detail(spans), []));

describe('flowToolCatalog', () => {
  it('deduplicates full definitions independently of JSON key order and includes only requested tools', async () => {
    const catalog = await analyze([chat(1, 1000, 800, 50, defs([definition, {name: 'unused'}])), used(11, 1),
      chat(2, 1000, 800, 50, defs([{parameters: definition.parameters, description: definition.description, name: definition.name}])), used(12, 2)]);
    expect(catalog.request.tools).toHaveLength(1);
    expect(catalog.definitionsSeen).toBe(2);
    expect(catalog.usages.map(usage => usage.toolId)).toEqual(['tool-1', 'tool-1']);
    expect(JSON.stringify(catalog.request)).toContain('PRIVATE ARGUMENT');
    expect(JSON.stringify(catalog.request)).not.toContain('PRIVATE TOOL RESULT');
    expect(JSON.stringify(catalog.request)).not.toContain('unused');
    expect(catalog.request.contexts[0].goal).toBeNull();
    expect(catalog.request.contexts[0].rounds.flatMap(round => round.invocations)).toHaveLength(2);
    expect(catalog.request.contexts[0].rounds).toHaveLength(2);
    expect(catalog.request.agents).toHaveLength(1);
  });
  it('preserves changed schemas under the same tool name and associates the exact round version', async () => {
    const changed = {...definition, description: 'Read a named symbol from an indexed file'};
    const catalog = await analyze([chat(1, 1000, 800, 50, defs([definition])), used(11, 1), chat(2, 1000, 800, 50, defs([changed])), used(12, 2)]);
    expect(catalog.request.tools).toHaveLength(2);
    expect(catalog.usages[0].toolId).not.toBe(catalog.usages[1].toolId);
  });
  it('supports function wrappers and normalized definition messages', async () => {
    const source = detail([chat(1), used(11, 1), chat(2, 1000, 800, 50, defs([{type: 'function', function: definition}])), used(12, 2)]);
    source.messages = [{id: 1, spanId: 1, direction: 'definition', roleName: 'tool', content: JSON.stringify(definition), sequenceNo: 0, sourceKind: 'explicit'}];
    const catalog = flowToolCatalog(await new WorkflowAnalysisService().analyze(source, []));
    expect(catalog.request.tools).toHaveLength(1);
    expect(catalog.missing).toBe(0);
  });
  it('does not guess missing, ambiguous or explicitly empty definitions from future catalogues', async () => {
    const catalog = await analyze([chat(1), used(11, 1), chat(2, 1000, 800, 50, defs([definition, {...definition, description: 'different'}])), used(12, 2),
      chat(3, 1000, 800, 50, defs([])), used(13, 3), chat(4, 1000, 800, 50, {...defs([definition]), 'gen_ai.output.messages': []})]);
    expect(catalog.missing).toBe(3);
    expect(catalog.request.tools).toHaveLength(0);
  });
  it('uses an earlier emitted catalogue only within the same trace', async () => {
    const catalog = await analyze([span(20, {...defs([definition]), 'gen_ai.conversation.id': 'root'}, {operationName: 'invoke_agent', startedAt: at(0)}),
      chat(1), used(11, 1), chat(2, 1000, 800, 50, {}, {traceId: 'another'}), {...used(12, 2), traceId: 'another'}]);
    expect(catalog.usages[0].toolId).toBeDefined();
    expect(catalog.usages[1].toolId).toBeUndefined();
  });
  it('does not manufacture model requests from executions, delegation links or agent goals', async () => {
    const [root, child] = mixedEpisodeFixture();
    const analysis = await new WorkflowAnalysisService().analyze(root, [child]);
    const catalog = flowToolCatalog(analysis);
    expect(catalog.request.tools).toHaveLength(0);
    expect(catalog.usages).toHaveLength(0);
    expect(catalog.request.contexts.map(context => context.goal)).toEqual(['Syntetyczne zlecenie rodzica', null, 'Syntetyczne zlecenie dziecka']);
    expect(catalog.request.contexts.flatMap(context => context.rounds).every(round => !round.outputObserved)).toBe(true);
    expect(catalog.request.agents).toHaveLength(analysis.streams.filter(stream => stream.rounds.length).length);
  });
  it('keeps a requested action without its definition or execution and marks shortened arguments', async () => {
    const catalog = await analyze([baseChat(1, 1000, 800, 50, {'gen_ai.output.messages': [{type: 'function_call',
      call_id: 'not-executed', name: 'run_in_terminal', arguments: JSON.stringify({command: 'rg ' + 'x'.repeat(200), mode: 'sync'})} ]})]);
    const invocation = catalog.request.contexts[0].rounds[0].invocations[0];
    expect(invocation.name).toBe('run_in_terminal');
    expect(invocation.toolId).toBeNull();
    expect(invocation.argumentsTruncated).toBe(true);
    expect(catalog.usages[0].callId).toBe('not-executed');
    expect(catalog.missing).toBe(1);
  });
  it('classification input is unaffected by later tool results, errors or compaction events', async () => {
    const model = chat(1, 1000, 800, 50, defs([definition]));
    const first = await analyze([model, used(11, 1)]);
    const changed = await analyze([model, tool(11, 1, {isError: true, output: 'DIFFERENT OUTCOME'}, {}, {
      eventsJson: JSON.stringify([{name: 'github.copilot.session.compaction_complete', attributes: {success: false}}])})]);
    expect(first.key).toBe(changed.key);
    expect(JSON.stringify(changed.request)).not.toContain('DIFFERENT OUTCOME');
  });
  it('extracts a captured user message goal and omits environment-only messages', async () => {
    const source = detail([span(20, {'gen_ai.conversation.id': 'root'}, {operationName: 'invoke_agent', startedAt: at(0)}),
      chat(1, 1000, 800, 50, defs([definition])), used(11, 1)]);
    source.messages = ['<environment_info>synthetic</environment_info>', 'Znajdź wskazany endpoint.'].map((text, index) => ({
      id: index + 1, spanId: 20, direction: 'input', roleName: 'user', sequenceNo: index, sourceKind: 'telemetry',
      content: JSON.stringify({role: 'user', parts: [{type: 'text', text}]})}));
    const catalog = flowToolCatalog(await new WorkflowAnalysisService().analyze(source, []));
    expect(catalog.request.contexts[0].goal).toBe('Znajdź wskazany endpoint.');
  });
  it('adds only a bounded model-output excerpt to the semantic round input', async () => {
    const source = detail([chat(1, 1000, 800, 50, defs([definition])), used(11, 1)]);
    source.messages = [{id: 1, spanId: 1, direction: 'output', roleName: 'assistant', sequenceNo: 0, sourceKind: 'telemetry',
      content: JSON.stringify({role: 'assistant', parts: [{type: 'text', text: `BEGIN-${'x'.repeat(1100)}-END`}]})}];
    const catalog = flowToolCatalog(await new WorkflowAnalysisService().analyze(source, []));
    const excerpt = catalog.request.contexts[0].rounds[0].modelOutput!;
    expect(excerpt).toHaveLength(1000);
    expect(excerpt).toMatch(/^BEGIN-/);
    expect(excerpt).toMatch(/-END$/);
    expect(excerpt).toContain('...');
  });
  it('keeps every argument property and bounds long text to a 100 character head and tail preview', () => {
    const value = compactArguments({command: 'A'.repeat(50) + 'MIDDLE' + 'Z'.repeat(60), mode: 'sync', timeout: 120000}) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(['command', 'mode', 'timeout']);
    expect(value['command']).toBe('A'.repeat(50) + '...' + 'Z'.repeat(47));
    expect((value['command'] as string).length).toBe(100);
  });
  it('estimates rounded input, expected output and a larger output scenario', async () => {
    const catalog = await analyze([chat(1, 1000, 800, 50, defs([definition])), used(11, 1)]);
    const estimate = estimateClassificationTokens(catalog.request);
    expect(estimate.input).toBeGreaterThan(100);
    expect(estimate.output).toBeGreaterThan(100);
    expect(estimate.outputMax).toBeGreaterThan(estimate.output);
    expect(estimate.input % 100).toBe(0);
  });
});
