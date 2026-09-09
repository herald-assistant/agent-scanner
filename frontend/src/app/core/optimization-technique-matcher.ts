import {OptimizationTechnique, OptimizationTopic} from '../models/optimization-guidance.models';

const TECHNIQUE_IDS_BY_TOPIC: Record<OptimizationTopic, readonly string[]> = {
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

/** Selects catalog entries from an explicit, reviewable map. It never infers a technique from telemetry text. */
export function matchOptimizationTechniques(
  topics: readonly OptimizationTopic[],
  catalog: readonly OptimizationTechnique[],
  limit = 3
): OptimizationTechnique[] {
  const catalogById = new Map(catalog.map(technique => [technique.id, technique]));
  const selected: OptimizationTechnique[] = [];
  const seen = new Set<string>();
  for (const topic of topics) {
    for (const id of TECHNIQUE_IDS_BY_TOPIC[topic]) {
      const technique = catalogById.get(id);
      if (!technique || seen.has(id)) continue;
      selected.push(technique);
      seen.add(id);
      if (selected.length === limit) return selected;
    }
  }
  return selected;
}
