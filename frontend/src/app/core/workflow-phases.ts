import {ContextCompactionMeasurement} from '../models/scanner.models';
import {ToolSpecialization} from '../models/tool-classification.models';
import {RoundObservation} from '../models/workflow.models';

export interface WorkflowPhaseRoundInput {
  round: RoundObservation;
  signature: string;
  label: string;
  icon: string;
  roundLabel: string;
  actorLabel: string;
  hasSubagent: boolean;
  credits: number | null;
  toolSpecializations: ToolSpecialization[];
}

export interface WorkflowPhaseCompactionInput {
  compaction: ContextCompactionMeasurement;
  roundLabel: string;
  actorLabel: string;
}

export interface GroupedWorkflowPhase {
  id: string;
  signature: string;
  label: string;
  icon: string;
  compaction?: ContextCompactionMeasurement;
  hasSubagent: boolean;
  actorLabels: string[];
  rounds: RoundObservation[];
  roundLabels: string[];
  credits: number | null;
  creditCovered: number;
  totalCalls: number;
  toolSpecializations: ToolSpecialization[];
}

export function groupWorkflowPhases(
  rounds: readonly WorkflowPhaseRoundInput[],
  leadingCompactions: readonly WorkflowPhaseCompactionInput[] = [],
  trailingCompactions: readonly WorkflowPhaseCompactionInput[] = []
): GroupedWorkflowPhase[] {
  const phases = leadingCompactions.map(compactionPhase);
  for (const input of rounds) {
    const previous = phases.at(-1);
    if (previous && !previous.compaction && previous.signature === input.signature) {
      previous.rounds.push(input.round);
      previous.roundLabels.push(input.roundLabel);
      previous.totalCalls++;
      previous.hasSubagent ||= input.hasSubagent;
      if (!previous.actorLabels.includes(input.actorLabel)) previous.actorLabels.push(input.actorLabel);
      previous.toolSpecializations.push(...input.toolSpecializations);
      if (input.credits !== null) {
        previous.credits = (previous.credits ?? 0) + input.credits;
        previous.creditCovered++;
      }
      continue;
    }
    phases.push({
      id: input.round.ref,
      signature: input.signature,
      label: input.label,
      icon: input.icon,
      hasSubagent: input.hasSubagent,
      actorLabels: [input.actorLabel],
      rounds: [input.round],
      roundLabels: [input.roundLabel],
      credits: input.credits,
      creditCovered: input.credits === null ? 0 : 1,
      totalCalls: 1,
      toolSpecializations: [...input.toolSpecializations]
    });
  }
  phases.push(...trailingCompactions.map(compactionPhase));
  return phases;
}

function compactionPhase(input: WorkflowPhaseCompactionInput): GroupedWorkflowPhase {
  const emittedCredits = input.compaction.credits;
  const credits = emittedCredits != null && Number.isFinite(emittedCredits) ? emittedCredits : null;
  return {
    id: `compaction:${input.compaction.id}`,
    signature: `COMPACTION:${input.compaction.id}`,
    label: 'Kompaktowanie kontekstu',
    icon: 'compress',
    compaction: input.compaction,
    hasSubagent: false,
    actorLabels: [input.actorLabel],
    rounds: [],
    roundLabels: [input.roundLabel],
    credits,
    creditCovered: credits === null ? 0 : 1,
    totalCalls: 1,
    toolSpecializations: []
  };
}
