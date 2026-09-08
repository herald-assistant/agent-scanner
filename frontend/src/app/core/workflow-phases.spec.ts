import {describe, expect, it} from 'vitest';
import {ContextCompactionMeasurement, ModelTurn, SpanRecord} from '../models/scanner.models';
import {RoundObservation} from '../models/workflow.models';
import {groupWorkflowPhases, WorkflowPhaseRoundInput} from './workflow-phases';

describe('groupWorkflowPhases', () => {
  it('groups only adjacent rounds with the same action signature and sums known credits', () => {
    const phases = groupWorkflowPhases([
      input('r1', 'ACQUIRE_DATA', 1.2, 'M1'),
      input('r2', 'ACQUIRE_DATA', null, 'M2', true),
      input('r3', 'VALIDATE', 0.4, 'M3'),
      input('r4', 'ACQUIRE_DATA', 0.3, 'M4')
    ]);

    expect(phases.map(phase => phase.roundLabels)).toEqual([['M1', 'M2'], ['M3'], ['M4']]);
    expect(phases[0].credits).toBe(1.2);
    expect(phases[0].creditCovered).toBe(1);
    expect(phases[0].totalCalls).toBe(2);
    expect(phases[0].hasSubagent).toBe(true);
    expect(phases[0].actorLabels).toEqual(['Główny agent', 'Subagent 1']);
  });

  it('keeps compactions as factual boundaries even when neighboring signatures match', () => {
    const compaction = compact('c1', 0.25);
    const phases = groupWorkflowPhases(
      [input('r1', 'MANAGE_CONTEXT', 0.5, 'M1')],
      [{compaction, roundLabel: 'K1', actorLabel: 'gpt-test'}]
    );

    expect(phases).toHaveLength(2);
    expect(phases[0].compaction?.id).toBe('c1');
    expect(phases[0].credits).toBe(0.25);
    expect(phases[1].signature).toBe('MANAGE_CONTEXT');
  });

  it('keeps missing compaction credits missing instead of converting them to zero', () => {
    const phases = groupWorkflowPhases([], [], [{compaction: compact('c2', null), roundLabel: 'K2', actorLabel: 'Model nieznany'}]);
    expect(phases[0].credits).toBeNull();
    expect(phases[0].creditCovered).toBe(0);
  });
});

function input(ref: string, signature: string, credits: number | null, roundLabel: string, hasSubagent = false): WorkflowPhaseRoundInput {
  return {
    round: round(ref), signature, label: signature, icon: 'search', roundLabel,
    actorLabel: hasSubagent ? 'Subagent 1' : 'Główny agent', hasSubagent, credits,
    toolSpecializations: hasSubagent ? ['TASK_SPECIFIC'] : ['GENERAL_PURPOSE']
  };
}

function round(ref: string): RoundObservation {
  const model = span(ref);
  const turn: ModelTurn = {index: 1, interactionIndex: 1, interactionTurnIndex: 1, model, tools: []};
  const metric = {value: 0, availability: 'emitted' as const, sourceAttributes: [], evidenceRefs: []};
  return {
    ref, streamId: 'stream', turn, sequence: ref, orderKnown: true,
    input: metric, cache: metric, fresh: metric, output: metric, cacheWrite: metric,
    credits: metric, promptLimit: metric, outputLimit: metric, pressure: metric,
    occupancy: metric, deltaPressure: metric, band: 'LOW', tools: [], toolCoverage: true,
    resultBytes: metric, uniqueResultBytes: metric, duplicateRatio: metric, distinctResults: 0,
    errors: [], errorCoverage: true, compactionCoverage: true, compactionRefs: [], markers: [],
    qualifiers: [], predicates: [], profile: 'UNKNOWN', candidates: [], scores: [], adjustments: [],
    coverage: 1, confidence: 'high', provisional: false
  };
}

function span(id: string): SpanRecord {
  return {id: Number(id.replace(/\D/g, '')) || 1, signalId: 1, traceId: 'trace', spanId: id, spanName: 'chat', operationName: 'chat', statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, attributesJson: '{}', eventsJson: '[]'};
}

function compact(id: string, credits: number | null): ContextCompactionMeasurement {
  return {id, sessionId: 1, spanId: 1, agentName: 'compactor', startedAt: '2026-01-01T00:00:00Z',
    inputTokens: 100, outputTokens: 10, resultCharacters: 20, ...(credits === null ? {} : {credits})};
}
