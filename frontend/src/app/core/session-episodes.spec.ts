import {describe, expect, it} from 'vitest';
import {WorkflowAnalysisService} from './workflow-analysis.service';
import {SessionAnalysisService} from './session-analysis.service';
import {mixedEpisodeFixture} from './workflow/mixed-episode.fixture';
import {chat, detail, span} from './workflow/workflow.fixtures';

describe('copilot-episode-v1', () => {
  it('reconstructs all three streams from historical batch partitions without changing raw spans', async () => {
    const [root, child] = mixedEpisodeFixture();
    const before = JSON.stringify([root, child]);
    const result = await new WorkflowAnalysisService().analyze(root, [child]);
    expect(result.streams.map(stream => stream.rounds.length)).toEqual([14, 2, 16]);
    expect(result.streams[0].rounds.flatMap(round => round.markers)).not.toContain('MODEL_CHANGE');
    expect(result.streams[2].rounds[4].errors).toHaveLength(1);
    expect(result.streams[2].rounds[0].turn.interactionPrompt).toBe('Syntetyczne zlecenie dziecka');
    expect(result.treeCredits).toMatchObject({covered: 32, total: 32});
    expect(result.treeCredits.known).toBeCloseTo(3.2);
    expect(result.linkIssues).toEqual([]);
    expect(result.linkCoverage).toBe(true);
    expect(JSON.stringify([root, child])).toBe(before);
  });

  it('keeps classification and attribution identical after repartitioning, reordering and duplicate delivery', async () => {
    const [root, child] = mixedEpisodeFixture();
    const service = new WorkflowAnalysisService();
    const before = await service.analyze(root, [child]);
    const combined = {...root, spans: [...child.spans, ...root.spans, root.spans[0]].reverse()};
    const after = await service.analyze(combined, []);
    const snapshot = (value: typeof before) => value.streams.map(stream => ({id: stream.id, credits: stream.credits,
      rounds: stream.rounds.map(round => ({ref: round.ref, profile: round.profile, scores: round.scores, tools: round.tools.map(tool => tool.span.id)}))}));
    expect(snapshot(after)).toEqual(snapshot(before));
  });

  it('uses the same primary rounds and entire linked tree for the cost view', () => {
    const [root, child] = mixedEpisodeFixture();
    const view = new SessionAnalysisService().build(root, [child])!;
    expect(view.primaryModelSpans).toHaveLength(14);
    expect(view.billingModelSpans).toHaveLength(32);
    expect(view.interactions[0].prompt).toBe('Syntetyczne zlecenie rodzica');
    expect(view.relatedModelCalls).toHaveLength(18);
    expect(new Set(view.billingModelSpans.map(span => span.id)).size).toBe(32);
  });

  it('rejects contradictory parent metadata instead of attributing the child to the main lane', async () => {
    const [root, child] = mixedEpisodeFixture();
    root.spans = root.spans.map(span => span.id === 1001 ? {...span, attributesJson: span.attributesJson.replace('"copilot_chat.parent_chat_session_id":"root"', '"copilot_chat.parent_chat_session_id":"other"')} : span);
    const result = await new WorkflowAnalysisService().analyze(root, [child]);
    expect(result.streams[0].rounds).toHaveLength(14);
    expect(result.linkCoverage).toBe(false);
    expect(result.linkIssues.length).toBeGreaterThan(0);
  });

  it('excludes a child with competing launches from both the map and cost totals', async () => {
    const [root, child] = mixedEpisodeFixture();
    const launch = root.spans.find(span => span.id === 2000)!;
    root.spans.push({...launch, id: 2002, spanId: 'competing-launch'});
    const map = await new WorkflowAnalysisService().analyze(root, [child]);
    const costs = new SessionAnalysisService().build(root, [child])!;
    expect(map.linkCoverage).toBe(false);
    expect(map.streams.map(stream => stream.rounds.length)).toEqual([14, 2]);
    expect(costs.billingModelSpans).toHaveLength(map.treeCredits.total);
    expect(costs.billingModelSpans).toHaveLength(16);
  });

  it('does not lower link completeness because an unrelated session lacks conversation IDs', async () => {
    const [root, child] = mixedEpisodeFixture();
    const result = await new WorkflowAnalysisService().analyze(root, [child, detail([span(900, {}, {traceId: 'unrelated'})], 9, 'unrelated')]);
    expect(result.linkCoverage).toBe(true);
    expect(result.treeCredits.total).toBe(32);
  });

  it('reports cancellation from the last request without treating a historical error counter as final status', () => {
    const service = new SessionAnalysisService();
    const source = detail([chat(1), chat(2, 0, 0, 0, {}, {statusCode: 'STATUS_CODE_ERROR',
      eventsJson: JSON.stringify([{name: 'exception', attributes: {'exception.type': 'Canceled'}}])})]);
    expect(service.sessionStatus(source, [])).toBe('OSTATNIE ŻĄDANIE ANULOWANE');
    expect(service.sessionStatus(detail([chat(1)]), [])).toBe('BRAK POTWIERDZONYCH BŁĘDÓW');
  });
});
