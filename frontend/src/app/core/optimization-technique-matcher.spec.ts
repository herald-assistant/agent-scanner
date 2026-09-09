import {describe, expect, it} from 'vitest';
import {OptimizationTechnique, OptimizationTopic} from '../models/optimization-guidance.models';
import {matchOptimizationTechniques} from './optimization-technique-matcher';

const technique = (id: string): OptimizationTechnique => ({
  id, revision: 1, title: id, explanation: id, mechanism: id, firstExperimentGoal: id, simplerAlternative: id,
  topics: ['GENERAL'], whenUseful: [id], whenNotUseful: [id], prerequisites: [id], applyAt: ['PROMPT'],
  firstExperiment: [id], example: {before: id, after: id}, setup: {level: 'SMALL', tasks: [id]},
  maintenance: {tasks: [id], triggers: [id]}, qualityChecks: [id], compare: [id], relatedTechniqueIds: []
});

describe('matchOptimizationTechniques', () => {
  const techniqueIds = Array.from({length: 16}, (_, index) => `T${String(index + 1).padStart(2, '0')}`);
  const catalog = techniqueIds.map(technique);

  const expectedByTopic: Record<OptimizationTopic, readonly string[]> = {
    GENERAL: ['T01', 'T07', 'T08', 'T16'],
    ACQUIRE_DATA: ['T03', 'T04', 'T05', 'T06'],
    MODIFY: ['T09', 'T06', 'T14'],
    WRITE_INTERMEDIATE: ['T02', 'T10', 'T11'],
    WRITE_FINAL: ['T02', 'T09', 'T11'],
    VALIDATE: ['T14', 'T05', 'T06'],
    DELEGATE: ['T13', 'T11', 'T12'],
    MANAGE_CONTEXT: ['T10', 'T03', 'T15'],
    RESPOND: ['T02', 'T01', 'T16'],
    OTHER: ['T01', 'T16'],
    UNKNOWN: ['T01', 'T16'],
    CONTEXT_COMPACTION: ['T15', 'T03', 'T10'],
    UNMAPPED: ['T01', 'T07', 'T08', 'T16'],
    UNATTRIBUTED: ['T16', 'T01', 'T07', 'T08']
  };

  it.each(Object.entries(expectedByTopic) as [OptimizationTopic, readonly string[]][])(
    'maps %s to the documented techniques in stable order',
    (topic, expected) => {
      expect(matchOptimizationTechniques([topic], catalog, 20).map(item => item.id)).toEqual(expected);
    }
  );

  it('deduplicates mixed phases while preserving the first topic order', () => {
    expect(matchOptimizationTechniques(['ACQUIRE_DATA', 'VALIDATE', 'ACQUIRE_DATA'], catalog, 20).map(item => item.id))
      .toEqual(['T03', 'T04', 'T05', 'T06', 'T14']);
  });

  it('keeps the initial recommendation list bounded to three techniques', () => {
    expect(matchOptimizationTechniques(['ACQUIRE_DATA'], catalog).map(item => item.id)).toEqual(['T03', 'T04', 'T05']);
  });

  it('covers every catalog technique through at least one documented topic', () => {
    const matched = Object.keys(expectedByTopic)
      .flatMap(topic => matchOptimizationTechniques([topic as OptimizationTopic], catalog, 20))
      .map(item => item.id);

    expect([...new Set(matched)].sort()).toEqual(techniqueIds);
  });

  it('ignores techniques that are not available in the loaded catalog', () => {
    const partialCatalog = ['T03', 'T04', 'T15'].map(technique);
    expect(matchOptimizationTechniques(['ACQUIRE_DATA', 'MANAGE_CONTEXT'], partialCatalog, 20).map(item => item.id))
      .toEqual(['T03', 'T04', 'T15']);
  });
});
