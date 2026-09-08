import {OptimizationTechnique, OptimizationTopic} from '../models/optimization-guidance.models';

const TECHNIQUE_IDS_BY_TOPIC: Record<OptimizationTopic, readonly string[]> = {
  GENERAL: ['T01'],
  ACQUIRE_DATA: ['T03', 'T04'],
  MODIFY: ['T14', 'T01'],
  WRITE_INTERMEDIATE: ['T11'],
  WRITE_FINAL: ['T11', 'T01'],
  VALIDATE: ['T14'],
  DELEGATE: ['T11', 'T01'],
  MANAGE_CONTEXT: ['T15', 'T03'],
  RESPOND: ['T01'],
  OTHER: ['T01'],
  UNKNOWN: ['T01'],
  CONTEXT_COMPACTION: ['T15', 'T03'],
  UNMAPPED: ['T01'],
  UNATTRIBUTED: ['T01']
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
