import {describe, expect, it} from 'vitest';
import {buildAiQuickAnalysis, quickInteractions} from './ai-quick-analysis';
import {workflowFixture} from './workflow/workflow.fixtures';
import {WorkflowAnalysisService} from './workflow-analysis.service';
import {flowToolCatalog} from './flow-tool-catalog';
import {TOOL_CLASSIFICATION_VERSION, ToolClassificationResult} from '../models/tool-classification.models';

describe('ai quick analysis', () => {
  it('keeps interaction selection explicit and adds compaction outside estimated categories', async () => {
    const [source, related] = workflowFixture();
    const analysis = await new WorkflowAnalysisService().analyze(source, [related]);
    const catalog = flowToolCatalog(analysis);
    const classification: ToolClassificationResult = {
      version: TOOL_CLASSIFICATION_VERSION, model: 'test', analyzedAt: '2026-01-01T00:00:00Z', tools: [], assessments: [],
      rounds: catalog.rounds.map(round => ({roundId: round.id, actions: ['RESPOND'], evidenceInvocationIds: [], reason: 'test'}))
    };
    const interaction = quickInteractions(analysis)[0];
    const view = buildAiQuickAnalysis(analysis, catalog, classification, [{
      id: 'compaction-1', sessionId: source.session.id, spanId: 99, agentName: 'compactor',
      credits: 0.25, resultCharacters: 120, afterInteractionIndex: interaction.interactionIndex
    }], interaction.traceId);
    expect(view.interactionIndex).toBe(interaction.interactionIndex);
    expect(view.categories.some(item => item.id === 'RESPOND')).toBe(true);
    expect(view.categories.find(item => item.id === 'CONTEXT_COMPACTION')).toMatchObject({
      totalCredits: 0.25, estimated: false, compactionRefs: ['compaction-1']
    });
    expect(view.knownCredits).toBeGreaterThanOrEqual(0.25);
  });
});
