import {ACTIONS, ActionCategory, FlowToolCatalog, RoundCategory, ToolClassificationResult} from '../app/models/tool-classification.models';
import {RoundObservation, ToolObservation, WorkflowAnalysis, WorkflowStream} from '../app/models/workflow.models';
import {capturedMessages, toolResultIds} from './model-response';
import {spanRef, TelemetryReader} from './workflow/telemetry';

export interface ActionEvidence {
  execution?: ToolObservation;
  executionState: 'linked' | 'missing' | 'ambiguous' | 'no-id';
  consumers: RoundObservation[];
  children: WorkflowStream[];
}

/** Links are independent of AI labels. They indicate relationships, never a transfer of credits. */
export function modelActionEvidence(analysis: WorkflowAnalysis, catalog: FlowToolCatalog): Map<string, ActionEvidence> {
  const result = new Map<string, ActionEvidence>(), reader = new TelemetryReader();
  for (const stream of analysis.streams) {
    const usages = catalog.usages.filter(usage => usage.streamId === stream.id);
    const inputs = new Map(stream.rounds.map(round => [round.ref, toolResultIds(capturedMessages(round.turn.model, stream.source, 'input', reader))]));
    for (const usage of usages) {
      const ownerIndex = stream.rounds.findIndex(round => round.ref === usage.roundRef);
      const owner = stream.rounds[ownerIndex];
      const evidence: ActionEvidence = {executionState: usage.callId ? 'missing' : 'no-id', consumers: [], children: []};
      result.set(usage.invocationId, evidence);
      if (!usage.callId || !owner) continue;
      const sameTrace = stream.rounds.filter(round => round.turn.model.traceId === owner.turn.model.traceId);
      const refs = new Set(sameTrace.map(round => round.ref));
      const requests = usages.filter(other => other.callId === usage.callId && refs.has(other.roundRef));
      const executions = [...new Map(sameTrace.flatMap(round => round.tools).filter(tool => tool.callId === usage.callId)
        .map(tool => [spanRef(tool.span), tool])).values()];
      if (requests.length !== 1 || executions.length > 1 || executions.some(tool => {
        const name = reader.string(tool.span, 'gen_ai.tool.name');
        return name && name !== usage.name;
      })) { evidence.executionState = 'ambiguous'; continue; }
      evidence.execution = executions[0];
      if (evidence.execution) evidence.executionState = 'linked';
      // A result can be retained/repeated in many later inputs, even if no execution span was captured.
      evidence.consumers = stream.rounds.slice(ownerIndex + 1).filter(round => refs.has(round.ref) && inputs.get(round.ref)?.has(usage.callId!));
      if (evidence.execution) evidence.children = analysis.streams.filter(child => child.parentId === stream.id && child.launch &&
        spanRef(child.launch.span) === spanRef(evidence.execution!.span));
    }
  }
  return result;
}

export function orderedActions(actions: readonly ActionCategory[]): ActionCategory[] { return ACTIONS.filter(action => actions.includes(action)); }
export function actionCategory(actions: readonly ActionCategory[]): RoundCategory | 'UNMAPPED' {
  return actions.length > 1 ? 'MIXED' : actions[0] ?? 'UNMAPPED';
}
export function actionsByRound(catalog: FlowToolCatalog, result?: ToolClassificationResult): Map<string, ActionCategory[]> {
  const classified = new Map(result?.rounds.map(round => [round.roundId, orderedActions(round.actions)]) ?? []);
  return new Map(catalog.rounds.map(round => [round.ref, classified.get(round.id) ?? []]));
}

/** A subagent's profile describes its own observed responses, never a role inferred from its goal. */
export function agentActionProfile(rounds: RoundObservation[], actions: Map<string, ActionCategory[]>) {
  return ACTIONS.flatMap(action => {
    const count = rounds.filter(round => actions.get(round.ref)?.includes(action)).length;
    return count ? [{action, count}] : [];
  }).sort((a, b) => b.count - a.count);
}
