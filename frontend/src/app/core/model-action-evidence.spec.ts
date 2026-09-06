import {describe, expect, it} from 'vitest';
import {agentActionProfile, modelActionEvidence} from './model-action-evidence';
import {ActionCategory} from '../models/tool-classification.models';
import {flowToolCatalog} from './flow-tool-catalog';
import {WorkflowAnalysisService} from './workflow-analysis.service';
import {chat, detail, tool, workflowFixture} from './workflow/workflow.fixtures';

const output = (id: string, name = 'shell') => ({'gen_ai.output.messages': [{type: 'function_call', call_id: id, name, arguments: {command: 'rg endpoint src'}}]});
const input = (id: string) => ({'gen_ai.input.messages': [{type: 'function_call_output', call_id: id, output: 'Synthetic result'}]});

describe('model action evidence and credits', () => {
  it('joins delayed and repeated result inputs by call ID, without assigning credits to the requesting action', async () => {
    const analysis = await new WorkflowAnalysisService().analyze(detail([
      chat(1, 1000, 800, 50, output('a')), tool(11, 1, 'Synthetic result', {'gen_ai.tool.call.id': 'a', 'gen_ai.tool.name': 'shell'}),
      chat(2, 1000, 800, 50, input('unrelated')), chat(3, 1000, 800, 50, input('a')), chat(4, 1000, 800, 50, input('a')),
      chat(5, 1000, 800, 50, input('a'), {traceId: 'other-interaction'})]), []);
    const catalog = flowToolCatalog(analysis), evidence = modelActionEvidence(analysis, catalog).get('invocation-1')!;
    expect(evidence.executionState).toBe('linked');
    expect(evidence.consumers.map(round => round.turn.model.id)).toEqual([3, 4]);
    expect(evidence.consumers.every(round => round.credits.value === .1)).toBe(true);
    expect(analysis.streams[0].rounds[0].credits.value).toBe(.1);
  });
  it('keeps result evidence even without an execution, but never joins missing or conflicting request IDs', async () => {
    const run = async (responses: unknown[]) => {
      const analysis = await new WorkflowAnalysisService().analyze(detail([chat(1, 1000, 800, 50, {'gen_ai.output.messages': responses}),
        chat(2, 1000, 800, 50, input('a'))]), []);
      return [...modelActionEvidence(analysis, flowToolCatalog(analysis)).values()];
    };
    const call = {type: 'function_call', call_id: 'a', name: 'read_file', arguments: {path: 'a'}};
    const missingExecution = (await run([call]))[0];
    expect(missingExecution.executionState).toBe('missing');
    expect(missingExecution.consumers).toHaveLength(1);
    expect((await run([{...call, call_id: undefined}]))[0].executionState).toBe('no-id');
    const conflict = await run([call, {...call, arguments: {path: 'b'}}]);
    expect(conflict.every(item => item.executionState === 'ambiguous' && item.consumers.length === 0)).toBe(true);
  });
  it('rejects duplicate executions and mismatching names instead of guessing a join', async () => {
    for (const executions of [
      [tool(11, 1, '', {'gen_ai.tool.call.id': 'a', 'gen_ai.tool.name': 'different'})],
      [tool(11, 1, '', {'gen_ai.tool.call.id': 'a', 'gen_ai.tool.name': 'shell'}), tool(12, 1, '', {'gen_ai.tool.call.id': 'a', 'gen_ai.tool.name': 'shell'})]
    ]) {
      const analysis = await new WorkflowAnalysisService().analyze(detail([chat(1, 1000, 800, 50, output('a')), ...executions]), []);
      expect(modelActionEvidence(analysis, flowToolCatalog(analysis)).get('invocation-1')?.executionState).toBe('ambiguous');
    }
  });
  it('links the exact delegated subtree while keeping its own and inclusive totals separate', async () => {
    const [root, child] = workflowFixture();
    root.spans = root.spans.map(span => span.id === 2 ? {...span, attributesJson: JSON.stringify({...JSON.parse(span.attributesJson), ...output('child', 'custom_operation')})} : span);
    const analysis = await new WorkflowAnalysisService().analyze(root, [child]);
    const evidence = modelActionEvidence(analysis, flowToolCatalog(analysis)).get('invocation-1')!;
    expect(evidence.children).toHaveLength(1);
    expect(evidence.children[0].credits.known).toBeCloseTo(.2);
    expect(evidence.consumers).toHaveLength(0); // An execution result alone does not prove a receiving model request.
    expect(analysis.treeCredits.known).toBeCloseTo(.9);
  });
  it('builds the agent profile from its own requested actions', async () => {
    const analysis = await new WorkflowAnalysisService().analyze(detail([chat(1), chat(2), chat(3), chat(4)]), []);
    const rounds = analysis.streams[0].rounds;
    const actions = new Map<string, ActionCategory[]>([[rounds[0].ref, ['ACQUIRE_DATA', 'VALIDATE']], [rounds[1].ref, ['VALIDATE', 'ACQUIRE_DATA']],
      [rounds[2].ref, ['WRITE_FINAL']], [rounds[3].ref, ['ACQUIRE_DATA']]]);
    expect(agentActionProfile(rounds, actions)).toEqual([
      {action: 'ACQUIRE_DATA', count: 3}, {action: 'VALIDATE', count: 2}, {action: 'WRITE_FINAL', count: 1}
    ]);
  });
});
