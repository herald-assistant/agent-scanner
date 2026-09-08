import {describe, expect, it} from 'vitest';
import {OptimizationTechnique} from '../models/optimization-guidance.models';
import {matchOptimizationTechniques} from './optimization-technique-matcher';

const technique = (id: string): OptimizationTechnique => ({
  id, revision: 1, title: id, explanation: id, mechanism: id, firstExperimentGoal: id, simplerAlternative: id,
  topics: ['GENERAL'], whenUseful: [id], whenNotUseful: [id], prerequisites: [id], applyAt: ['PROMPT'],
  firstExperiment: [id], example: {before: id, after: id}, setup: {level: 'SMALL', tasks: [id]},
  maintenance: {tasks: [id], triggers: [id]}, qualityChecks: [id], compare: [id], relatedTechniqueIds: []
});

describe('matchOptimizationTechniques', () => {
  const catalog = ['T01', 'T03', 'T04', 'T11', 'T14', 'T15'].map(technique);

  it('maps topics without AI and deduplicates mixed phases in stable order', () => {
    expect(matchOptimizationTechniques(['ACQUIRE_DATA', 'MANAGE_CONTEXT', 'ACQUIRE_DATA'], catalog).map(item => item.id))
      .toEqual(['T03', 'T04', 'T15']);
  });

  it('keeps compaction distinct and ignores unavailable future techniques', () => {
    expect(matchOptimizationTechniques(['CONTEXT_COMPACTION'], catalog).map(item => item.id)).toEqual(['T15', 'T03']);
    expect(matchOptimizationTechniques(['VALIDATE'], catalog).map(item => item.id)).toEqual(['T14']);
  });
});
