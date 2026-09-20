import {estimateActionCredits} from './action-credit-attribution';
import {actionsByRound} from './model-action-evidence';
import {ordered} from './workflow/telemetry';
import {ContextCompactionMeasurement} from '../models/scanner.models';
import {ACTIONS, ActionCategory, FlowToolCatalog, ToolClassificationResult} from '../models/tool-classification.models';
import {RoundObservation, WorkflowAnalysis} from '../models/workflow.models';

export interface AiQuickInteraction {
  traceId: string;
  interactionIndex: number;
}

export interface AiQuickCategory {
  id: ActionCategory | 'INITIAL_MESSAGE' | 'CONTEXT_COMPACTION';
  action?: ActionCategory;
  totalCredits: number | null;
  shareOfKnown: number | null;
  estimated: boolean;
  coveredCalls: number;
  totalCalls: number;
  roundRefs: string[];
  compactionRefs: string[];
}

export interface AiQuickAnalysis {
  traceId: string;
  interactionIndex: number;
  rounds: RoundObservation[];
  classifiedRoundCount: number;
  knownCredits: number | null;
  initialMessageCredits: number | null;
  assignedCredits: number | null;
  unattributedCredits: number | null;
  coveredCalls: number;
  totalCalls: number;
  categories: AiQuickCategory[];
}

export function quickInteractions(analysis: WorkflowAnalysis): AiQuickInteraction[] {
  const root = analysis.streams[0];
  if (!root) return [];
  return [...new Set(root.rounds.map(round => round.turn.model.traceId))].map(traceId => ({
    traceId,
    interactionIndex: root.rounds.find(round => round.turn.model.traceId === traceId)?.turn.interactionIndex ?? 1
  }));
}

export function quickInteractionRounds(analysis: WorkflowAnalysis, traceId: string): RoundObservation[] {
  const root = analysis.streams[0];
  if (!root) return [];
  const rounds = root.rounds.filter(round => round.turn.model.traceId === traceId);
  const refs = new Set(rounds.map(round => round.ref));
  for (const stream of analysis.streams.slice(1)) {
    if (stream.launchRoundRef && refs.has(stream.launchRoundRef)) {
      rounds.push(...stream.rounds);
      stream.rounds.forEach(round => refs.add(round.ref));
    }
  }
  return rounds.sort((left, right) => ordered(left.turn.model, right.turn.model));
}

export function quickInteractionCompactions(analysis: WorkflowAnalysis, compactions: readonly ContextCompactionMeasurement[], traceId: string): ContextCompactionMeasurement[] {
  const interactions = quickInteractions(analysis);
  const selected = interactions.find(item => item.traceId === traceId);
  if (!selected) return [];
  const last = interactions.at(-1)?.interactionIndex;
  return compactions.filter(item => item.afterInteractionIndex === selected.interactionIndex
    || selected.interactionIndex === last && item.placementBeforeModelId == null);
}

export function buildAiQuickAnalysis(analysis: WorkflowAnalysis, catalog: FlowToolCatalog,
    classification: ToolClassificationResult, compactions: readonly ContextCompactionMeasurement[], traceId: string): AiQuickAnalysis {
  const rounds = quickInteractionRounds(analysis, traceId);
  const actions = actionsByRound(catalog, classification);
  const attribution = estimateActionCredits(analysis, catalog, classification, rounds);
  const selectedCompactions = quickInteractionCompactions(analysis, compactions, traceId);
  const compactionCredits = selectedCompactions.map(item => item.credits)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const compactionTotal = compactionCredits.length ? compactionCredits.reduce((sum, value) => sum + value, 0) : null;
  const coveredCalls = attribution.coveredCalls + compactionCredits.length;
  const knownCredits = coveredCalls ? (attribution.knownCredits ?? 0) + (compactionTotal ?? 0) : null;
  const initialMessageCredits = attribution.initialMessageCredits;
  const assignedCredits = coveredCalls ? (attribution.assignedCredits ?? 0) + (compactionTotal ?? 0) : null;
  const unattributedCredits = coveredCalls ? attribution.unattributedCredits ?? 0 : null;
  const categories: AiQuickCategory[] = ACTIONS.flatMap(action => {
    const categoryRounds = rounds.filter(round => actions.get(round.ref)?.includes(action));
    if (!categoryRounds.length) return [];
    const totalCredits = attribution.categories.find(item => item.action === action)?.totalCredits ?? null;
    return [{id: action, action, totalCredits,
      shareOfKnown: totalCredits != null && knownCredits != null && knownCredits > 0 ? totalCredits / knownCredits * 100 : null,
      estimated: true, coveredCalls: attribution.coveredCalls, totalCalls: attribution.totalCalls,
      roundRefs: categoryRounds.map(round => round.ref), compactionRefs: []}];
  });
  if (selectedCompactions.length) {
    categories.push({id: 'CONTEXT_COMPACTION', totalCredits: compactionTotal,
      shareOfKnown: compactionTotal != null && knownCredits != null && knownCredits > 0 ? compactionTotal / knownCredits * 100 : null,
      estimated: false, coveredCalls: compactionCredits.length, totalCalls: selectedCompactions.length,
      roundRefs: [], compactionRefs: selectedCompactions.map(item => item.id)});
  }
  categories.sort((left, right) => (right.totalCredits ?? -1) - (left.totalCredits ?? -1));
  if (initialMessageCredits != null) {
    const initialRound = rounds.find(round => round.streamId === analysis.streams[0]?.id);
    categories.unshift({id: 'INITIAL_MESSAGE', totalCredits: initialMessageCredits,
      shareOfKnown: knownCredits != null && knownCredits > 0 ? initialMessageCredits / knownCredits * 100 : null,
      estimated: true, coveredCalls: 1, totalCalls: 1,
      roundRefs: initialRound ? [initialRound.ref] : [], compactionRefs: []});
  }
  return {
    traceId,
    interactionIndex: quickInteractions(analysis).find(item => item.traceId === traceId)?.interactionIndex ?? 1,
    rounds,
    classifiedRoundCount: rounds.filter(round => (actions.get(round.ref)?.length ?? 0) > 0).length,
    knownCredits,
    initialMessageCredits,
    assignedCredits,
    unattributedCredits,
    coveredCalls,
    totalCalls: attribution.totalCalls + selectedCompactions.length,
    categories
  };
}
