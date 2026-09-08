import {capturedMessages} from '../model-response';
import {known, TelemetryReader} from '../workflow/telemetry';
import {RoundObservation, WorkflowAnalysis, WorkflowStream} from '../../models/workflow.models';
import {
  RoundDiscussionBoundary,
  RoundDiscussionEvidenceSnapshot,
  RoundDiscussionRoundEvidence
} from '../../models/round-discussion.models';
import {
  canonicalJson,
  capturedDefinitions,
  sanitize,
  sha256,
  sourceRef,
  toolExecutionPreview
} from './guidance-evidence';

export interface RoundDiscussionEvidenceInput {
  analysis: WorkflowAnalysis;
  stream: WorkflowStream;
  rounds: readonly RoundObservation[];
  actorLabel: string;
  capturedAt?: string;
}

export async function buildRoundDiscussionEvidence(input: RoundDiscussionEvidenceInput): Promise<RoundDiscussionEvidenceSnapshot> {
  if (!input.rounds.length) throw new Error('Wybierz co najmniej jedną rundę.');
  const streamRounds = input.stream.rounds.filter(round => round.turn.model.traceId === input.rounds[0].turn.model.traceId);
  const firstIndex = streamRounds.findIndex(round => round.ref === input.rounds[0].ref);
  const lastIndex = streamRounds.findIndex(round => round.ref === input.rounds.at(-1)?.ref);
  if (input.rounds.some(round => round.streamId !== input.stream.id)
      || input.rounds.some(round => round.turn.model.traceId !== input.rounds[0].turn.model.traceId)
      || firstIndex < 0 || lastIndex < firstIndex
      || canonicalJson(streamRounds.slice(firstIndex, lastIndex + 1).map(round => round.ref))
        !== canonicalJson(input.rounds.map(round => round.ref))) {
    throw new Error('Do rozmowy można wybrać tylko jeden ciąg sąsiednich rund tego samego agenta i interakcji.');
  }

  const selectedRefs = new Set(input.rounds.map(round => round.ref));
  const boundaries: RoundDiscussionBoundary[] = [];
  const rounds: RoundDiscussionRoundEvidence[] = [];
  const definitionHashes = new Set<string>();
  const reader = new TelemetryReader();

  for (const [sequenceIndex, round] of input.rounds.entries()) {
    const span = round.turn.model;
    const next = streamRounds[streamRounds.findIndex(candidate => candidate.ref === round.ref) + 1];
    rounds.push({
      roundRef: round.ref,
      sequenceIndex,
      interactionTurnIndex: round.turn.interactionTurnIndex ?? sequenceIndex + 1,
      nextRoundRef: next?.ref ?? null,
      model: round.model ?? span.model ?? null,
      metrics: {
        inputTokens: metric(round.input),
        freshInputTokens: metric(round.fresh),
        cacheReadTokens: metric(round.cache),
        cacheWriteTokens: metric(round.cacheWrite),
        outputTokens: metric(round.output),
        credits: metric(round.credits),
        contextOccupancy: metric(round.occupancy),
        durationMs: span.durationMs ?? null,
        confirmedErrors: round.errors.map(error => ({ref: error.ref, codes: error.codes})),
        toolExecutions: round.tools.length
      },
      source: await sourceRef(input.stream, span, round.ref)
    });

    await addBoundary(boundaries, input.stream, round, 'MODEL_REQUEST', span,
      capturedMessages(span, input.stream.source, 'input', reader), 'gen_ai.input.messages');
    await addBoundary(boundaries, input.stream, round, 'MODEL_RESPONSE', span,
      capturedMessages(span, input.stream.source, 'output', reader), 'gen_ai.output.messages');

    const definitions = capturedDefinitions(span, input.stream.source);
    if (definitions.length) {
      const definitionHash = await sha256(canonicalJson(definitions));
      if (!definitionHashes.has(definitionHash)) {
        definitionHashes.add(definitionHash);
        await addBoundary(boundaries, input.stream, round, 'TOOL_DEFINITIONS', span, definitions,
          'gen_ai.tool.definitions', ['IDENTICAL_DEFINITIONS_DEDUPLICATED']);
      }
    }
    for (const [toolIndex, tool] of round.tools.entries()) {
      await addBoundary(boundaries, input.stream, round, 'TOOL_EXECUTION', tool.span,
        toolExecutionPreview(tool.span), undefined, tool.errors, toolIndex + 1);
    }
    if (next && !selectedRefs.has(next.ref)) {
      await addBoundary(boundaries, input.stream, round, 'NEXT_MODEL_REQUEST', next.turn.model,
        capturedMessages(next.turn.model, input.stream.source, 'input', reader), 'gen_ai.input.messages');
    }
  }

  const rawPrompt = input.rounds.map(round => round.turn.interactionPrompt?.trim()).find(Boolean) ?? null;
  const promptSanitized = sanitize(rawPrompt);
  const initialPrompt = promptSanitized.redacted ? null
    : typeof promptSanitized.value === 'string' ? promptSanitized.value : null;
  const selection = {
    rootSessionId: input.analysis.source.session.id,
    streamId: input.stream.id,
    actorLabel: input.actorLabel,
    interactionTraceId: input.rounds[0].turn.model.traceId,
    startRoundRef: input.rounds[0].ref,
    endRoundRef: input.rounds.at(-1)!.ref,
    roundRefs: input.rounds.map(round => round.ref),
    initialPrompt
  };
  const material = {
    version: 'round-discussion-evidence-v1' as const,
    selection,
    rounds,
    boundaries,
    redactionVersion: 'guidance-redaction-v1' as const,
    upstreamCompleteness: input.analysis.upstreamCompleteness === 'truncated' ? 'TRUNCATED' as const : 'UNVERIFIED' as const
  };
  return {...material, capturedAt: input.capturedAt ?? new Date().toISOString(),
    contentHash: await sha256(canonicalJson(material))};
}

async function addBoundary(target: RoundDiscussionBoundary[], stream: WorkflowStream, round: RoundObservation,
                           kind: RoundDiscussionBoundary['kind'], span: RoundObservation['turn']['model'], value: unknown,
                           attribute?: string, extraLimitations: readonly string[] = [], occurrence = 1): Promise<void> {
  const sanitized = sanitize(value);
  target.push({
    id: `${round.ref}:${kind.toLowerCase()}:${occurrence}`,
    roundRef: round.ref,
    kind,
    source: await sourceRef(stream, span, round.ref, undefined, attribute),
    value: sanitized.value,
    limitationCodes: [...new Set([
      ...extraLimitations,
      ...sanitized.limitationCodes,
      ...(sanitized.redacted ? ['SENSITIVE_CONTENT_REDACTED'] : []),
      ...(empty(sanitized.value) ? ['CONTENT_NOT_CAPTURED'] : [])
    ])]
  });
}

function metric(value: RoundObservation['input']): Record<string, unknown> {
  const measured = known(value);
  return {
    value: measured ?? null,
    provenance: measured === undefined ? 'MISSING' : value.formula ? 'DERIVED' : 'EMITTED',
    availability: value.availability,
    formulaId: value.formula ?? null
  };
}

function empty(value: unknown): boolean {
  const encoded = canonicalJson(value);
  return encoded === 'null' || encoded === '[]' || encoded === '{}' || encoded === '""';
}
