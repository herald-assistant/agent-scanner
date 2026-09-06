import {ACTIONS, ActionCategory, FlowToolCatalog, ToolClassificationResult} from '../models/tool-classification.models';
import {RoundObservation, WorkflowAnalysis, WorkflowStream} from '../models/workflow.models';
import {capturedMessages, modelResponse, toolResults} from './model-response';
import {modelActionEvidence, orderedActions} from './model-action-evidence';
import {known, TelemetryReader} from './workflow/telemetry';

const charactersPerToken = 4.25;

export interface ActionCreditCategoryEstimate {
  action: ActionCategory;
  requestCredits: number;
  firstResultCredits: number;
  retainedResultCredits: number;
  primaryCredits: number;
  subagentCredits: number;
  totalCredits: number;
  shareOfKnown: number;
}

export interface ActionCreditAttribution {
  categories: ActionCreditCategoryEstimate[];
  knownCredits: number | null;
  assignedCredits: number | null;
  unattributedCredits: number | null;
  coveredCalls: number;
  totalCalls: number;
  splitCalls: number;
  linkedResultOccurrences: number;
  unlinkedResultOccurrences: number;
  delegatedSubtreeCredits: number | null;
  delegatedSubtreeCoveredCalls: number;
  delegatedSubtreeTotalCalls: number;
}

interface MutableCategoryEstimate {
  requestCredits: number;
  firstResultCredits: number;
  retainedResultCredits: number;
  primaryCredits: number;
  subagentCredits: number;
}

/**
 * Attributes the full measurable input/output portions of a model call to the
 * classified actions that produced them. Captured sizes are relative weights,
 * never a reconstruction of the provider's AIU formula. Category totals plus the
 * unattributed remainder reconcile to known credits for the selected flow.
 */
export function estimateActionCredits(analysis: WorkflowAnalysis, catalog: FlowToolCatalog,
    classification: ToolClassificationResult, rounds: readonly RoundObservation[]): ActionCreditAttribution {
  const reader = new TelemetryReader(), scopedRefs = new Set(rounds.map(round => round.ref));
  const rootStreamId = analysis.streams[0]?.id;
  const usages = catalog.usages.filter(usage => scopedRefs.has(usage.roundRef));
  const usagesByRound = new Map<string, typeof usages>();
  for (const usage of usages) usagesByRound.set(usage.roundRef, [...(usagesByRound.get(usage.roundRef) ?? []), usage]);
  const assessments = new Map(classification.assessments.map(assessment => [assessment.invocationId, assessment]));
  const roundIds = new Map(catalog.rounds.map(round => [round.ref, round.id]));
  const roundClassifications = new Map(classification.rounds.map(round => [round.roundId, round]));
  const evidence = modelActionEvidence(analysis, catalog);
  const streams = new Map(analysis.streams.map(stream => [stream.id, stream]));
  const totals = new Map<ActionCategory, MutableCategoryEstimate>(ACTIONS.map(action => [action, {
    requestCredits: 0, firstResultCredits: 0, retainedResultCredits: 0, primaryCredits: 0, subagentCredits: 0
  }]));
  let knownCredits = 0, coveredCalls = 0, splitCalls = 0, linkedResultOccurrences = 0, unlinkedResultOccurrences = 0;

  const add = (actions: readonly ActionCategory[], amount: number, kind: 'requestCredits' | 'firstResultCredits' | 'retainedResultCredits', round: RoundObservation): void => {
    const unique = orderedActions(actions);
    if (!unique.length || !Number.isFinite(amount) || amount <= 0) return;
    const share = amount / unique.length;
    for (const action of unique) {
      const total = totals.get(action)!;
      total[kind] += share;
      if (round.streamId === rootStreamId) total.primaryCredits += share;
      else total.subagentCredits += share;
    }
  };

  for (const round of rounds) {
    const credits = known(round.credits);
    if (credits === undefined) continue;
    knownCredits += credits;
    coveredCalls++;
    const input = known(round.input), output = known(round.output);
    if (input === undefined || output === undefined || input + output <= 0) continue;
    splitCalls++;
    const inputCredits = credits * input / (input + output);
    const outputCredits = credits - inputCredits;
    const roundUsages = usagesByRound.get(round.ref) ?? [];
    if (roundUsages.length && output > 0) {
      const response = modelResponse(capturedMessages(round.turn.model, streams.get(round.streamId)?.source ?? analysis.source, 'output', reader));
      const allocations = roundUsages.map((usage, index) => ({
        actions: assessments.get(usage.invocationId)?.actions ?? [],
        weight: estimatedTokens(response.calls[index])
      })).filter(item => item.actions.length && item.weight > 0);
      const weight = allocations.reduce((sum, item) => sum + item.weight, 0);
      allocations.forEach(item => add(item.actions, outputCredits * item.weight / weight, 'requestCredits', round));
    } else if (output > 0) {
      const roundId = roundIds.get(round.ref);
      add(roundId ? roundClassifications.get(roundId)?.actions ?? [] : [], outputCredits, 'requestCredits', round);
    }

    if (input <= 0) continue;
    const results = toolResults(capturedMessages(round.turn.model, streams.get(round.streamId)?.source ?? analysis.source, 'input', reader));
    const allocations: {actions: readonly ActionCategory[]; weight: number; first: boolean}[] = [];
    results.forEach(result => {
      const candidates = usages.filter(usage => usage.callId === result.id &&
        evidence.get(usage.invocationId)?.consumers.some(consumer => consumer.ref === round.ref));
      if (candidates.length !== 1) { unlinkedResultOccurrences++; return; }
      const usage = candidates[0], usageEvidence = evidence.get(usage.invocationId)!;
      linkedResultOccurrences++;
      const actions = assessments.get(usage.invocationId)?.actions ?? [];
      if (actions.length) allocations.push({
        actions,
        weight: Math.max(1, result.characters / charactersPerToken),
        first: usageEvidence.consumers[0]?.ref === round.ref
      });
    });
    const weight = allocations.reduce((sum, item) => sum + item.weight, 0);
    allocations.forEach(item => add(item.actions, inputCredits * item.weight / weight,
      item.first ? 'firstResultCredits' : 'retainedResultCredits', round));
  }

  const assignedCredits = [...totals.values()].reduce((sum, item) => sum + item.requestCredits + item.firstResultCredits + item.retainedResultCredits, 0);
  const categories = ACTIONS.map(action => {
    const total = totals.get(action)!;
    const categoryCredits = total.requestCredits + total.firstResultCredits + total.retainedResultCredits;
    return {action, ...total, totalCredits: categoryCredits,
      shareOfKnown: knownCredits > 0 ? categoryCredits / knownCredits * 100 : 0};
  });

  const delegatedChildren = new Map<string, WorkflowStream>();
  for (const usage of usages.filter(usage => usage.streamId === rootStreamId && assessments.get(usage.invocationId)?.actions.includes('DELEGATE'))) {
    for (const child of evidence.get(usage.invocationId)?.children ?? []) delegatedChildren.set(child.id, child);
  }
  const delegatedStreams = [...delegatedChildren.values()];
  const delegatedCovered = delegatedStreams.reduce((sum, child) => sum + child.subtreeCredits.covered, 0);
  const delegatedTotal = delegatedStreams.reduce((sum, child) => sum + child.subtreeCredits.total, 0);
  const delegatedKnown = delegatedStreams.reduce((sum, child) => sum + (child.subtreeCredits.known ?? 0), 0);

  return {
    categories,
    knownCredits: coveredCalls ? knownCredits : null,
    assignedCredits: coveredCalls ? assignedCredits : null,
    unattributedCredits: coveredCalls ? Math.max(0, knownCredits - assignedCredits) : null,
    coveredCalls,
    totalCalls: rounds.length,
    splitCalls,
    linkedResultOccurrences,
    unlinkedResultOccurrences,
    delegatedSubtreeCredits: delegatedCovered ? delegatedKnown : null,
    delegatedSubtreeCoveredCalls: delegatedCovered,
    delegatedSubtreeTotalCalls: delegatedTotal
  };
}

function estimatedTokens(call: {name: string; arguments: unknown} | undefined): number {
  if (!call) return 0;
  return Math.max(1, JSON.stringify({name: call.name, arguments: call.arguments}).length / charactersPerToken);
}
