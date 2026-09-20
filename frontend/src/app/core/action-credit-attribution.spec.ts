import {describe, expect, it} from 'vitest';
import {estimateActionCredits} from './action-credit-attribution';
import {flowToolCatalog} from './flow-tool-catalog';
import {WorkflowAnalysisService} from './workflow-analysis.service';
import {chat, detail, tool, workflowFixture} from './workflow/workflow.fixtures';
import {ActionCategory, FlowToolCatalog, ToolClassificationResult} from '../models/tool-classification.models';

const output = (id: string, name: string) => ({'gen_ai.output.messages': [{type: 'function_call', call_id: id, name, arguments: {query: 'synthetic query'}}]});
const input = (...items: {id: string; value: string}[]) => ({'gen_ai.input.messages': items.map(item => ({type: 'function_call_output', call_id: item.id, output: item.value}))});

describe('action credit attribution', () => {
  it('reconciles category estimates with known credits and separates request, first result and retention', async () => {
    const source = detail([
      chat(1, 100, 0, 100, output('read', 'read_file')),
      chat(2, 100, 0, 100, {...input({id: 'read', value: 'result '.repeat(12)}), ...output('validate', 'run_tests')}),
      chat(3, 100, 0, 100, {...input({id: 'read', value: 'result '.repeat(12)}, {id: 'validate', value: 'tests passed'}),
        'gen_ai.output.messages': [{role: 'assistant', parts: [{type: 'text', text: 'Done'}]}]})
    ]);
    const analysis = await new WorkflowAnalysisService().analyze(source, []), catalog = flowToolCatalog(analysis);
    const classification = classified(catalog, usage => usage.name === 'read_file' ? ['ACQUIRE_DATA'] : ['VALIDATE'],
      roundId => roundId === catalog.rounds[2].id ? ['RESPOND'] : undefined);
    const estimate = estimateActionCredits(analysis, catalog, classification, analysis.streams[0].rounds);
    const acquire = estimate.categories.find(item => item.action === 'ACQUIRE_DATA')!;
    const validate = estimate.categories.find(item => item.action === 'VALIDATE')!;
    const respond = estimate.categories.find(item => item.action === 'RESPOND')!;

    expect(estimate.knownCredits).toBeCloseTo(.3);
    expect(acquire.requestCredits).toBeGreaterThan(0);
    expect(acquire.firstResultCredits).toBeGreaterThan(0);
    expect(acquire.retainedResultCredits).toBeGreaterThan(0);
    expect(validate.requestCredits).toBeGreaterThan(0);
    expect(validate.firstResultCredits).toBeGreaterThan(0);
    expect(respond.requestCredits).toBeCloseTo(.05);
    expect(estimate.linkedResultOccurrences).toBe(3);
    expect(estimate.unlinkedResultOccurrences).toBe(0);
    expect(estimate.initialMessageCredits).toBeCloseTo(.05);
    expect(estimate.assignedCredits).toBeCloseTo(.25);
    expect(estimate.unattributedCredits).toBeCloseTo(0);
    expect(estimate.categories.reduce((sum, item) => sum + item.totalCredits, 0)).toBeCloseTo(estimate.assignedCredits!);
    expect(estimate.initialMessageCredits! + estimate.assignedCredits! + estimate.unattributedCredits!).toBeCloseTo(estimate.knownCredits!);
  });

  it('reports the exact known subtree credits behind a root delegation without adding them to category estimates', async () => {
    const [root, child] = workflowFixture();
    root.spans = root.spans.map(span => span.id === 2 ? {...span, attributesJson: JSON.stringify({...JSON.parse(span.attributesJson), ...output('child', 'custom_operation')})} : span);
    const analysis = await new WorkflowAnalysisService().analyze(root, [child]), catalog = flowToolCatalog(analysis);
    const classification = classified(catalog, () => ['DELEGATE']);
    const estimate = estimateActionCredits(analysis, catalog, classification, analysis.streams.flatMap(stream => stream.rounds));

    expect(estimate.delegatedSubtreeCredits).toBeCloseTo(.2);
    expect(estimate.delegatedSubtreeCoveredCalls).toBe(2);
    expect(estimate.delegatedSubtreeTotalCalls).toBe(2);
    expect((estimate.initialMessageCredits ?? 0) + estimate.assignedCredits! + estimate.unattributedCredits!).toBeCloseTo(estimate.knownCredits!);
  });

  it('keeps missing credits missing instead of presenting a zero estimate', async () => {
    const model = chat(1, 100, 0, 20, {'gen_ai.output.messages': [{role: 'assistant', content: 'Done'}]});
    const attributes = JSON.parse(model.attributesJson) as Record<string, unknown>;
    delete attributes['copilot_chat.copilot_usage_nano_aiu'];
    model.attributesJson = JSON.stringify(attributes);
    const analysis = await new WorkflowAnalysisService().analyze(detail([model]), []), catalog = flowToolCatalog(analysis);
    const estimate = estimateActionCredits(analysis, catalog, classified(catalog, () => ['RESPOND']), analysis.streams[0].rounds);

    expect(estimate.knownCredits).toBeNull();
    expect(estimate.initialMessageCredits).toBeNull();
    expect(estimate.assignedCredits).toBeNull();
    expect(estimate.unattributedCredits).toBeNull();
    expect(estimate.coveredCalls).toBe(0);
  });
});

function classified(catalog: FlowToolCatalog, invocationActions: (usage: FlowToolCatalog['usages'][number]) => ActionCategory[],
    roundOverride: (roundId: string) => ActionCategory[] | undefined = () => undefined): ToolClassificationResult {
  const usageById = new Map(catalog.usages.map(usage => [usage.invocationId, usage]));
  return {
    version: 'model-actions-v5', model: 'test', analyzedAt: '2026-01-01T00:00:00Z', tools: [],
    assessments: catalog.usages.map(usage => ({contextId: usage.contextId, invocationId: usage.invocationId, toolId: usage.toolId ?? null,
      actions: invocationActions(usage), fit: 'UNKNOWN', reason: 'Synthetic classification'})),
    rounds: catalog.request.contexts.flatMap(context => context.rounds.map(round => {
      const actions = roundOverride(round.id) ?? [...new Set(round.invocations.flatMap(invocation => invocationActions(usageById.get(invocation.id)!)))];
      return {roundId: round.id, actions: actions.length ? actions : ['RESPOND'],
        evidenceInvocationIds: round.invocations.map(invocation => invocation.id), reason: 'Synthetic classification'};
    }))
  };
}
