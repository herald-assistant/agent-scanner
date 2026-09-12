import {capturedMessages} from '../model-response';
import {parse, record, TelemetryReader} from '../workflow/telemetry';
import {
  GuidanceObservation,
  GuidanceSourceRef,
  OptimizationAdvicePreview,
  OptimizationAdvicePreviewRequest,
  OptimizationAdviceScope
} from '../../models/optimization-guidance.models';
import {ContextCompactionMeasurement, MessageRecord, SessionDetail, SpanRecord} from '../../models/scanner.models';
import {FlowToolCatalog, ToolClassificationResult} from '../../models/tool-classification.models';
import {Metric, RoundObservation, WorkflowAnalysis, WorkflowStream} from '../../models/workflow.models';

const EVIDENCE_VERSION = 'guidance-evidence-v2' as const;
const REDACTION_VERSION = 'guidance-redaction-v1' as const;
const MAX_SUPPORTING_ROUNDS = 8;
const MAX_FRAGMENTS = 16;
const MAX_EXCERPT_CHARACTERS = 4_000;
const MAX_PHASE_FRAGMENTS = 12;
const MAX_PHASE_EXCERPT_CHARACTERS = 800;

export interface GuidanceEvidenceBuildInput extends OptimizationAdvicePreviewRequest {
  analysis: WorkflowAnalysis;
  catalog: FlowToolCatalog;
  classification?: ToolClassificationResult;
  compactions: readonly ContextCompactionMeasurement[];
  relatedDetails: readonly SessionDetail[];
  interactionTraceId?: string;
  capturedAt?: string;
}

interface FragmentCandidate {
  id: string;
  kind: string;
  provenance: GuidanceObservation['provenance'];
  stream: WorkflowStream;
  span: SpanRecord;
  roundRef: string | null;
  value: unknown;
  message?: MessageRecord;
  attribute?: string;
  callId?: string;
  supporting?: boolean;
}

interface ResolvedRound {
  stream: WorkflowStream;
  round: RoundObservation;
}

export async function buildGuidanceEvidencePreview(input: GuidanceEvidenceBuildInput): Promise<OptimizationAdvicePreview> {
  const selectedRoundRefs = input.context.evidence.filter(item => item.kind === 'ROUND').map(item => item.id);
  const selectedCompactionRefs = input.context.evidence.filter(item => item.kind === 'COMPACTION').map(item => item.id);
  if (input.context.kind === 'CATEGORY') throw new Error('Podgląd AI wymaga wybrania konkretnej fazy albo pojedynczego kompaktowania.');
  if (input.context.kind === 'PHASE' && !selectedRoundRefs.length) throw new Error('Wybrana faza nie zawiera rund możliwych do analizy.');
  if (input.context.kind === 'COMPACTION' && selectedCompactionRefs.length !== 1) {
    throw new Error('Podgląd AI dla kompaktowania wymaga wybrania dokładnie jednego zdarzenia.');
  }
  const selectedRefs = [...new Set(input.context.kind === 'PHASE' ? selectedRoundRefs : selectedCompactionRefs)];
  const observations: GuidanceObservation[] = [];
  const fragments: FragmentCandidate[] = [];
  const supportingRefs: string[] = [];
  const omitted: {ref: string; reason: string}[] = [];
  const warnings: string[] = [];
  let scope: OptimizationAdviceScope;
  let goal: string | null = null;
  let phaseRounds: ResolvedRound[] = [];

  if (input.context.kind === 'PHASE') {
    const selected = resolveRounds(input.analysis, selectedRefs);
    phaseRounds = selected;
    if (selected.length !== selectedRefs.length) throw new Error('Nie wszystkie rundy fazy należą do aktualnej migawki sesji.');
    const traceId = input.interactionTraceId ?? selected[0].round.turn.model.traceId;
    scope = {kind: 'phase', rootSessionId: input.analysis.source.session.id, interactionTraceId: traceId,
      roundRefs: selectedRefs, actions: [...input.context.topics]};
    goal = selected.map(item => item.round.turn.interactionPrompt?.trim()).find(Boolean) ?? catalogGoal(input.catalog, selected[0].round.ref);

    for (const {stream, round} of selected) {
      const classifiedActions = input.classification && classifiedRoundActions(input.catalog, input.classification, round.ref);
      const classificationRoundId = input.catalog.rounds.find(item => item.ref === round.ref)?.id;
      observations.push(await roundCostSummaryObservation(stream, round, classificationRoundId, classifiedActions));
      const model = round.turn.model;
      const inputMessages = capturedMessages(model, stream.source, 'input', new TelemetryReader());
      const outputMessages = capturedMessages(model, stream.source, 'output', new TelemetryReader());
      fragments.push({id: `${round.ref}:request`, kind: 'MODEL_REQUEST', provenance: 'EMITTED', stream, span: model,
        roundRef: round.ref, value: inputMessages, attribute: 'gen_ai.input.messages'});
      fragments.push({id: `${round.ref}:response`, kind: 'MODEL_RESPONSE', provenance: 'EMITTED', stream, span: model,
        roundRef: round.ref, value: outputMessages, attribute: 'gen_ai.output.messages'});
      const definitions = capturedDefinitions(model, stream.source);
      if (definitions.length) fragments.push({id: `${round.ref}:definitions`, kind: 'TOOL_DEFINITIONS', provenance: 'EMITTED', stream,
        span: model, roundRef: round.ref, value: definitions, attribute: 'gen_ai.tool.definitions'});
      for (const tool of round.tools) fragments.push({id: `${round.ref}:execution:${tool.span.id}`, kind: 'TOOL_EXECUTION', provenance: 'EMITTED', stream,
        span: tool.span, roundRef: round.ref, callId: tool.callId, value: toolExecutionPreview(tool.span)});
    }

    const selectedSet = new Set(selectedRefs);
    const candidates = selected.flatMap(({stream, round}) => {
      const index = stream.rounds.findIndex(item => item.ref === round.ref);
      const next = index >= 0 ? stream.rounds[index + 1] : undefined;
      return next && next.turn.model.traceId === round.turn.model.traceId && !selectedSet.has(next.ref) ? [{stream, round: next}] : [];
    });
    const uniqueSupport = [...new Map(candidates.map(item => [item.round.ref, item])).values()];
    for (const item of uniqueSupport.slice(0, MAX_SUPPORTING_ROUNDS)) {
      supportingRefs.push(item.round.ref);
      fragments.push({id: `${item.round.ref}:receiving-request`, kind: 'RECEIVING_MODEL_REQUEST', provenance: 'EMITTED',
        stream: item.stream, span: item.round.turn.model, roundRef: item.round.ref,
        value: capturedMessages(item.round.turn.model, item.stream.source, 'input', new TelemetryReader()),
        attribute: 'gen_ai.input.messages', supporting: true});
    }
    uniqueSupport.slice(MAX_SUPPORTING_ROUNDS).forEach(item => omitted.push({ref: item.round.ref, reason: 'SUPPORTING_ROUND_LIMIT'}));
  } else {
    const compaction = input.compactions.find(item => item.id === selectedRefs[0]);
    if (!compaction) throw new Error('Wybrane kompaktowanie nie należy do aktualnej migawki sesji.');
    scope = {kind: 'compaction', rootSessionId: input.analysis.source.session.id, compactionRef: compaction.id};
    const detail = [input.analysis.source, ...input.relatedDetails].find(item => item.session.id === compaction.sessionId);
    const span = detail?.spans.find(item => item.id === compaction.spanId);
    if (!detail || !span) throw new Error('Brakuje źródłowego spanu wybranego kompaktowania.');
    const stream = compactionStream(detail);
    observations.push(...await compactionMetricObservations(stream, span, compaction));
    fragments.push({id: `${compaction.id}:request`, kind: 'COMPACTION_REQUEST', provenance: 'EMITTED', stream, span,
      roundRef: null, value: capturedMessages(span, detail, 'input', new TelemetryReader()), attribute: 'gen_ai.input.messages'});
    fragments.push({id: `${compaction.id}:result`, kind: 'COMPACTION_RESULT', provenance: 'EMITTED', stream, span,
      roundRef: null, value: capturedMessages(span, detail, 'output', new TelemetryReader()), attribute: 'gen_ai.output.messages'});
    if (compaction.resultObservedInModelId != null) {
      const receipt = input.analysis.streams.flatMap(item => item.rounds.map(round => ({stream: item, round})))
        .find(item => item.round.turn.model.id === compaction.resultObservedInModelId);
      if (receipt) {
        supportingRefs.push(receipt.round.ref);
        const receiptIndex = receipt.stream.rounds.findIndex(round => round.ref === receipt.round.ref);
        const previous = receiptIndex > 0 ? receipt.stream.rounds[receiptIndex - 1] : undefined;
        observations.push(await normalizedMetricObservation(`${compaction.id}:context-before`, 'CONTEXT_BEFORE_COMPACTION',
          receipt.stream, previous?.turn.model ?? receipt.round.turn.model, compaction.id, previous?.ref ?? receipt.round.ref,
          compaction.beforeInputTokens, 'token', 'EMITTED',
          'gen_ai.usage.input_tokens', previous ? [] : ['PREVIOUS_ROUND_NOT_AVAILABLE']));
        observations.push(await normalizedMetricObservation(`${compaction.id}:context-after`, 'CONTEXT_AFTER_COMPACTION',
          receipt.stream, receipt.round.turn.model, compaction.id, receipt.round.ref, compaction.afterInputTokens, 'token', 'EMITTED',
          'gen_ai.usage.input_tokens'));
        fragments.push({id: `${compaction.id}:receipt`, kind: 'COMPACTION_RECEIPT', provenance: 'EMITTED', stream: receipt.stream,
          span: receipt.round.turn.model, roundRef: receipt.round.ref,
          value: capturedMessages(receipt.round.turn.model, receipt.stream.source, 'input', new TelemetryReader()),
          attribute: 'gen_ai.input.messages', supporting: true});
      } else warnings.push('Telemetria wskazuje późniejszy odbiór kompaktowania, ale jego request nie jest dostępny w tej migawce.');
    } else warnings.push('Nie potwierdzono odbioru wyniku kompaktowania w późniejszym requestcie.');
  }

  if (goal) {
    const reader = new TelemetryReader();
    const owner = input.analysis.streams.find(stream => stream.source.spans.some(span =>
      reader.string(span, 'copilot_chat.user_request') === goal));
    const span = owner?.source.spans.find(candidate => reader.string(candidate, 'copilot_chat.user_request') === goal);
    if (owner && span) fragments.unshift({id: 'scope:goal', kind: 'USER_GOAL', provenance: 'EMITTED', stream: owner, span,
      roundRef: selectedRoundRefs[0] ?? null, value: goal, attribute: 'copilot_chat.user_request'});
  }

  const fragmentSelection = input.context.kind === 'PHASE'
    ? selectPhaseFragments(fragments, phaseRounds)
    : {allowed: fragments.slice(0, MAX_FRAGMENTS), omitted: fragments.slice(MAX_FRAGMENTS)};
  const allowedFragments = fragmentSelection.allowed;
  addGroupedFragmentOmissions(omitted, fragmentSelection.omitted);
  for (const fragment of allowedFragments) {
    observations.push(await fragmentObservation(fragment,
      input.context.kind === 'PHASE' ? MAX_PHASE_EXCERPT_CHARACTERS : MAX_EXCERPT_CHARACTERS));
  }
  if (input.context.kind === 'PHASE' && phaseRounds.length > representativeRounds(phaseRounds).length) {
    warnings.push(`Treść dobrano z ${representativeRounds(phaseRounds).length} reprezentatywnych rund; zwarte metryki nadal obejmują wszystkie ${phaseRounds.length} rund fazy.`);
  }
  if (fragmentSelection.omitted.length) {
    warnings.push(`Pakiet zachował ${allowedFragments.length} z ${fragments.length} fragmentów treści, wybierając dowody z początku, końca i najbardziej kosztownych lub narzędziowych rund.`);
  }

  const privacyOmissionCodes = new Set(['SYSTEM_OR_DEVELOPER_CONTENT_REMOVED', 'EXPLICIT_REASONING_REMOVED', 'RECOGNIZED_SECRET_REDACTED']);
  for (const observation of observations) {
    for (const code of observation.limitationCodes.filter(candidate => privacyOmissionCodes.has(candidate))) {
      if (!omitted.some(item => item.ref === observation.id && item.reason === code)) omitted.push({ref: observation.id, reason: code});
    }
  }

  const candidateTechniqueIds = [...new Set(input.candidateTechniqueIds)].slice(0, 3);
  const sanitizedGoalResult = sanitize(goal);
  const sanitizedGoalValue = typeof sanitizedGoalResult.value === 'string' ? sanitizedGoalResult.value : null;
  const sanitizedGoalExcerpt = sanitizedGoalValue == null ? null : compactExcerpt(sanitizedGoalValue, sanitizedGoalResult.redacted);
  const sanitizedGoal = sanitizedGoalExcerpt?.text ?? null;
  if (sanitizedGoalExcerpt?.truncated) {
    omitted.push({ref: 'userContext.goal', reason: `TRUNCATED_TO_${MAX_EXCERPT_CHARACTERS}_CHARACTERS`});
    warnings.push(`Cel użytkownika został skrócony do ${MAX_EXCERPT_CHARACTERS} znaków.`);
  }
  const userContext = {goal: sanitizedGoal, frequency: 'UNKNOWN' as const, effort: 'UNKNOWN' as const, constraints: [] as string[]};
  const classificationFingerprint = input.classification ? await sha256(canonicalJson(input.classification)) : null;
  const fingerprintMaterial = {catalogVersion: input.catalogVersion, scope, selectedRefs, supportingRefs,
    omitted, observations, candidateTechniqueIds, userContext, evidenceVersion: EVIDENCE_VERSION, redactionVersion: REDACTION_VERSION};
  const dataFingerprint = await sha256(canonicalJson(fingerprintMaterial));
  const manifest = {
    capturedAt: input.capturedAt ?? new Date().toISOString(), dataFingerprint, selectedRefs, supportingRefs,
    omitted, classificationFingerprint, evidenceVersion: EVIDENCE_VERSION, redactionVersion: REDACTION_VERSION,
    upstreamCompleteness: input.analysis.upstreamCompleteness === 'truncated' ? 'TRUNCATED' as const : 'UNVERIFIED' as const
  };
  const request: OptimizationAdvicePreview['request'] = {
    version: 'optimization-advice-v1', catalogVersion: input.catalogVersion, scope, manifest, observations,
    candidateTechniqueIds, userContext
  };
  const payloadCharacters = canonicalJson(request).length;
  if (manifest.upstreamCompleteness === 'TRUNCATED') warnings.push('Źródłowa telemetria oznacza niepełny zakres nadrzędny.');
  warnings.push('To lokalny szkic pakietu. Przed użyciem backend musi potwierdzić referencje w raw telemetry i modelu znormalizowanym.');
  return {request, summary: {selectedRounds: selectedRoundRefs.length, supportingRounds: supportingRefs.length,
    observations: observations.length, contentFragments: allowedFragments.length, payloadCharacters,
    // Kept in the v1 response for stored-preview compatibility. Local package-size heuristics never block analysis;
    // only the selected model/provider can reject the final prompt for exceeding its context window.
    estimatedInputTokens: Math.ceil(payloadCharacters / 4.25), sendBlocked: false}, warnings};
}

function resolveRounds(analysis: WorkflowAnalysis, refs: readonly string[]): ResolvedRound[] {
  const resolved = new Map(analysis.streams.flatMap(stream => stream.rounds.map(round => [round.ref, {stream, round}] as const)));
  return refs.flatMap(ref => resolved.get(ref) ?? []);
}

function representativeRounds(rounds: readonly ResolvedRound[]): ResolvedRound[] {
  if (rounds.length <= 4) return [...rounds];
  const refs = new Set<string>();
  const add = (item: ResolvedRound | undefined): void => { if (item) refs.add(item.round.ref); };
  add(rounds[0]);
  add(rounds.at(-1));
  add([...rounds].sort((left, right) => (finite(right.round.credits.value) ?? -1) - (finite(left.round.credits.value) ?? -1))[0]);
  add([...rounds].sort((left, right) => {
    const leftWeight = left.round.tools.length + (left.round.errors.length ? 10_000 : 0);
    const rightWeight = right.round.tools.length + (right.round.errors.length ? 10_000 : 0);
    return rightWeight - leftWeight;
  })[0]);
  for (const index of [Math.floor(rounds.length / 3), Math.floor(2 * rounds.length / 3)]) {
    if (refs.size >= 4) break;
    add(rounds[index]);
  }
  return rounds.filter(item => refs.has(item.round.ref)).slice(0, 4);
}

function selectPhaseFragments(fragments: readonly FragmentCandidate[], rounds: readonly ResolvedRound[]): {
  allowed: FragmentCandidate[];
  omitted: FragmentCandidate[];
} {
  const allowed: FragmentCandidate[] = [];
  const allowedIds = new Set<string>();
  const add = (candidate: FragmentCandidate | undefined): void => {
    if (!candidate || allowed.length >= MAX_PHASE_FRAGMENTS || allowedIds.has(candidate.id) || !hasCapturedContent(candidate.value)) return;
    allowed.push(candidate);
    allowedIds.add(candidate.id);
  };
  const find = (kind: string, roundRef?: string): FragmentCandidate | undefined => fragments.find(item =>
    item.kind === kind && (roundRef === undefined || item.roundRef === roundRef));
  const representatives = representativeRounds(rounds);

  add(find('USER_GOAL'));
  add(find('MODEL_REQUEST', rounds[0]?.round.ref));

  const definitionHashes = new Set<string>();
  for (const definition of fragments.filter(item => item.kind === 'TOOL_DEFINITIONS')) {
    const hash = canonicalJson(definition.value);
    if (!definitionHashes.has(hash)) {
      definitionHashes.add(hash);
      add(definition);
      break;
    }
  }

  for (const item of representatives) add(find('MODEL_RESPONSE', item.round.ref));
  for (const item of representatives) {
    const executions = fragments.filter(candidate => candidate.kind === 'TOOL_EXECUTION' && candidate.roundRef === item.round.ref)
      .sort((left, right) => fragmentImportance(right) - fragmentImportance(left));
    add(executions[0]);
  }
  add(fragments.find(item => item.supporting));

  for (const candidate of fragments.filter(item => item.kind === 'TOOL_EXECUTION')
    .sort((left, right) => fragmentImportance(right) - fragmentImportance(left))) add(candidate);

  return {allowed, omitted: fragments.filter(item => !allowedIds.has(item.id))};
}

function fragmentImportance(candidate: FragmentCandidate): number {
  const value = record(candidate.value);
  const failed = value['error.type'] != null || String(value['statusCode'] ?? '').includes('ERROR');
  return (failed ? 10_000_000 : 0) + canonicalJson(candidate.value).length;
}

function hasCapturedContent(value: unknown): boolean {
  const serialized = canonicalJson(value);
  return serialized !== '' && serialized !== '""' && serialized !== '[]' && serialized !== '{}' && serialized !== 'null';
}

function addGroupedFragmentOmissions(target: {ref: string; reason: string}[], omitted: readonly FragmentCandidate[]): void {
  const counts = new Map<string, number>();
  for (const fragment of omitted) counts.set(fragment.kind, (counts.get(fragment.kind) ?? 0) + 1);
  for (const [kind, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    target.push({ref: `content:${kind.toLowerCase()}`, reason: `REPRESENTATIVE_SAMPLE_OMITTED_${count}`});
  }
}

async function roundCostSummaryObservation(stream: WorkflowStream, round: RoundObservation,
                                           classificationRoundId?: string, classifiedActions?: readonly string[]): Promise<GuidanceObservation> {
  const value = {
    roundRef: round.ref,
    metrics: {
      inputTokens: compactMetric(round.input),
      freshInputTokens: compactMetric(round.fresh),
      cacheReadTokens: compactMetric(round.cache),
      outputTokens: compactMetric(round.output),
      cacheWriteTokens: compactMetric(round.cacheWrite),
      credits: compactMetric(round.credits),
      contextOccupancy: compactMetric(round.occupancy)
    },
    classification: classificationRoundId && classifiedActions?.length ? {
      roundId: classificationRoundId,
      actions: classifiedActions,
      provenance: 'AI_CLASSIFICATION'
    } : null
  };
  return textObservation(`${round.ref}:cost-summary`, 'ROUND_COST_SUMMARY', 'DERIVED', stream, round.turn.model,
    round.ref, value, 'guidance.round.cost-summary-v2', undefined,
    ['COMPACT_ROUND_SUMMARY', 'FIELD_LEVEL_PROVENANCE', ...(classifiedActions?.length ? ['CLASSIFICATION_IS_INTERPRETATION'] : [])]);
}

function compactMetric(metric: Metric): {
  value: number | null;
  provenance: 'EMITTED' | 'DERIVED' | 'MISSING';
  availability: Metric['availability'];
  formulaId: string | null;
} {
  const value = finite(metric.value);
  return {
    value,
    provenance: value == null ? 'MISSING' : metric.formula ? 'DERIVED' : 'EMITTED',
    availability: metric.availability,
    formulaId: metric.formula ?? null
  };
}

async function compactionMetricObservations(stream: WorkflowStream, span: SpanRecord, compaction: ContextCompactionMeasurement): Promise<GuidanceObservation[]> {
  const attributes = record(parse(span.attributesJson));
  const cacheWriteAttribute = Object.hasOwn(attributes, 'gen_ai.usage.cache_creation.input_tokens')
    ? 'gen_ai.usage.cache_creation.input_tokens' : 'gen_ai.usage.cache_write.input_tokens';
  const creditsAttribute = Object.hasOwn(attributes, 'copilot_chat.copilot_usage_nano_aiu')
    ? 'copilot_chat.copilot_usage_nano_aiu' : 'github.copilot.nano_aiu';
  const metrics: [string, number | undefined, string, GuidanceObservation['provenance'], string | null, string][] = [
    ['COMPACTION_INPUT_TOKENS', compaction.inputTokens, 'token', 'EMITTED', null, 'gen_ai.usage.input_tokens'],
    ['COMPACTION_FRESH_INPUT_TOKENS', compaction.freshInputTokens, 'token', 'DERIVED', 'max(0, inputTokens - cacheReadTokens)', 'gen_ai.usage.input_tokens, gen_ai.usage.cache_read.input_tokens'],
    ['COMPACTION_CACHE_READ_TOKENS', compaction.cacheReadTokens, 'token', 'EMITTED', null, 'gen_ai.usage.cache_read.input_tokens'],
    ['COMPACTION_CACHE_WRITE_TOKENS', compaction.cacheWriteTokens, 'token', 'EMITTED', null, cacheWriteAttribute],
    ['COMPACTION_OUTPUT_TOKENS', compaction.outputTokens, 'token', 'EMITTED', null, 'gen_ai.usage.output_tokens'],
    ['COMPACTION_REASONING_TOKENS', compaction.reasoningTokens, 'token', 'EMITTED', null, 'gen_ai.usage.reasoning.output_tokens | gen_ai.usage.reasoning_tokens'],
    ['COMPACTION_DURATION', compaction.durationMs, 'millisecond', 'DERIVED', 'endedAt - startedAt', 'span.start_time, span.end_time'],
    ['COMPACTION_CREDITS', compaction.credits, 'credit', 'DERIVED', 'nano AIU / 1 000 000 000', creditsAttribute]
  ];
  return Promise.all(metrics.map(([kind, value, unit, provenance, formula, attribute], index) =>
    normalizedMetricObservation(`${compaction.id}:metric:${index + 1}`, kind, stream, span, compaction.id, null,
      value, unit, provenance, attribute, [], formula)));
}

async function normalizedMetricObservation(id: string, kind: string, stream: WorkflowStream, span: SpanRecord,
                                           population: string, sourceRoundRef: string | null, rawValue: number | undefined, unit: string,
                                           knownProvenance: GuidanceObservation['provenance'], attribute: string,
                                           extraLimitations: string[] = [], formulaId: string | null = null): Promise<GuidanceObservation> {
  const value = finite(rawValue);
  return {id, kind, provenance: value == null ? 'MISSING' : knownProvenance,
    sources: [await sourceRef(stream, span, sourceRoundRef, undefined, attribute)], ruleVersion: formulaId ? EVIDENCE_VERSION : null,
    metric: {value, unit, population, covered: value == null ? 0 : 1, total: 1, formulaId}, excerpt: null,
    limitationCodes: [...extraLimitations, ...(value == null ? ['MISSING_VALUE'] : [])]};
}

async function fragmentObservation(candidate: FragmentCandidate, maxCharacters: number): Promise<GuidanceObservation> {
  const sanitized = sanitize(candidate.value);
  const serialized = canonicalJson(sanitized.value);
  const excerpt = compactExcerpt(serialized, sanitized.redacted, maxCharacters);
  const limitations = [
    ...(excerpt.truncated ? ['TRUNCATED_EXCERPT'] : []),
    ...(excerpt.redacted ? ['SENSITIVE_VALUE_REDACTED'] : []),
    ...sanitized.limitationCodes,
    ...(!serialized || serialized === '[]' || serialized === 'null' ? ['CONTENT_NOT_CAPTURED'] : []),
    ...(candidate.supporting ? ['SUPPORTING_CONTEXT_OUTSIDE_SELECTED_SCOPE'] : [])
  ];
  return {id: candidate.id, kind: candidate.kind, provenance: candidate.provenance,
    sources: [await sourceRef(candidate.stream, candidate.span, candidate.roundRef, candidate.message, candidate.attribute, candidate.callId, candidate.value)],
    ruleVersion: EVIDENCE_VERSION, metric: null, excerpt, limitationCodes: limitations};
}

async function textObservation(id: string, kind: string, provenance: GuidanceObservation['provenance'], stream: WorkflowStream,
                               span: SpanRecord, roundRef: string | null, value: unknown, attribute?: string,
                               callId?: string, limitationCodes: string[] = []): Promise<GuidanceObservation> {
  const sanitized = sanitize(value);
  const excerpt = compactExcerpt(canonicalJson(sanitized.value), sanitized.redacted);
  return {id, kind, provenance, sources: [await sourceRef(stream, span, roundRef, undefined, attribute, callId, value)],
    ruleVersion: EVIDENCE_VERSION, metric: null, excerpt,
    limitationCodes: [...limitationCodes, ...(excerpt.truncated ? ['TRUNCATED_EXCERPT'] : []),
      ...(excerpt.redacted ? ['SENSITIVE_VALUE_REDACTED'] : []), ...sanitized.limitationCodes]};
}

export async function sourceRef(stream: WorkflowStream, span: SpanRecord, roundRef: string | null, message?: MessageRecord,
                         attribute?: string, callId?: string, snapshotValue?: unknown): Promise<GuidanceSourceRef> {
  // Hash the complete normalized source record, rather than the selected excerpt. The backend can
  // reproduce this snapshot from its own store and still detect a later MERGE of the span or message.
  // `snapshotValue` intentionally remains an argument for call sites that describe the excerpt; it
  // is not the immutable source boundary.
  void snapshotValue;
  void message;
  const snapshot = canonicalJson({
    attributes: parse(span.attributesJson),
    events: parse(span.eventsJson),
    messages: stream.source.messages
      .filter(item => item.spanId === span.id)
      .sort((left, right) => left.direction.localeCompare(right.direction) || left.sequenceNo - right.sequenceNo || left.id - right.id)
      .map(item => ({id: item.id, direction: item.direction, sequenceNo: item.sequenceNo,
        roleName: item.roleName ?? null, content: item.content, sourceKind: item.sourceKind}))
  });
  const sourcePointer = `normalized:span:${span.id}${attribute ? `#${attribute}` : ''}`;
  return {sessionId: stream.source.session.id, spanId: span.id, signalId: span.signalId, traceId: span.traceId,
    rawSpanId: span.spanId, sourcePointer,
    sourceContentHash: await sha256(snapshot), roundRef, callId: callId ?? null, messageId: null,
    attribute: attribute ?? null};
}

export function capturedDefinitions(span: SpanRecord, source: SessionDetail): unknown[] {
  const messages = source.messages.filter(message => message.spanId === span.id && message.direction === 'definition')
    .sort((left, right) => left.sequenceNo - right.sequenceNo);
  if (messages.length) return messages.map(message => parse(message.content));
  const attributes = new TelemetryReader().attributes(span);
  return Object.hasOwn(attributes, 'gen_ai.tool.definitions') ? [parse(attributes['gen_ai.tool.definitions'])] : [];
}

export function toolExecutionPreview(span: SpanRecord): Record<string, unknown> {
  const attributes = new TelemetryReader().attributes(span);
  const selected: Record<string, unknown> = {spanId: span.spanId, statusCode: span.statusCode ?? null};
  for (const key of ['gen_ai.tool.name', 'gen_ai.tool.call.id', 'gen_ai.tool.call.arguments', 'gen_ai.tool.call.result', 'error.type']) {
    if (Object.hasOwn(attributes, key)) selected[key] = attributes[key];
  }
  return selected;
}

function classifiedRoundActions(catalog: FlowToolCatalog, result: ToolClassificationResult, roundRef: string): string[] | undefined {
  const roundId = catalog.rounds.find(round => round.ref === roundRef)?.id;
  return result.rounds.find(round => round.roundId === roundId)?.actions;
}

function catalogGoal(catalog: FlowToolCatalog, roundRef: string): string | null {
  const round = catalog.rounds.find(item => item.ref === roundRef);
  const context = catalog.request.contexts.find(item => item.rounds.some(candidate => candidate.id === round?.id));
  return context?.goal ?? null;
}

function compactionStream(source: SessionDetail): WorkflowStream {
  return {id: `compaction:${source.session.id}`, sessionId: source.session.id, label: source.session.agentName ?? 'Kompaktor', source,
    depth: 0, rounds: [], segments: [], profiles: [], credits: {known: null, covered: 0, total: 0},
    subtreeCredits: {known: null, covered: 0, total: 0}, rates: []};
}

function compactExcerpt(text: string, redacted: boolean, maxCharacters = MAX_EXCERPT_CHARACTERS): NonNullable<GuidanceObservation['excerpt']> {
  if (text.length <= maxCharacters) return {text, originalCharacters: text.length, truncated: false, redacted};
  const head = Math.ceil((maxCharacters - 3) / 2);
  return {text: `${text.slice(0, head)}...${text.slice(-(maxCharacters - 3 - head))}`,
    originalCharacters: text.length, truncated: true, redacted};
}

export function sanitize(value: unknown): {value: unknown; redacted: boolean; limitationCodes: string[]} {
  let redacted = false;
  const limitationCodes = new Set<string>();
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      const next = item
        .replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}\b/g, () => { redacted = true; limitationCodes.add('RECOGNIZED_SECRET_REDACTED'); return '[REDACTED_TOKEN]'; })
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, () => { redacted = true; limitationCodes.add('RECOGNIZED_SECRET_REDACTED'); return 'Bearer [REDACTED]'; })
        .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)[^\s,;"']{6,}/gi,
          (_match, prefix: string) => { redacted = true; limitationCodes.add('RECOGNIZED_SECRET_REDACTED'); return `${prefix}[REDACTED]`; });
      return next;
    }
    if (Array.isArray(item)) return item.map(visit).filter(child => child !== undefined);
    if (!item || typeof item !== 'object') return item;
    const source = record(item);
    const role = String(source['role'] ?? '').toLowerCase();
    if (role === 'system' || role === 'developer') {
      redacted = true;
      limitationCodes.add('SYSTEM_OR_DEVELOPER_CONTENT_REMOVED');
      return undefined;
    }
    const target: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      if (/^(?:reasoning|reasoning_content|thinking)$/i.test(key)) {
        redacted = true;
        limitationCodes.add('EXPLICIT_REASONING_REMOVED');
        continue;
      }
      const next = visit(child);
      if (next !== undefined) target[key] = next;
    }
    return target;
  };
  return {value: visit(value) ?? null, redacted, limitationCodes: [...limitationCodes]};
}

function finite(value: number | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = record(value);
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
