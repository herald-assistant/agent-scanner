import {MessageRecord, SessionView, SpanRecord} from '../app/models/scanner.models';
import {capturedMessages, modelResponse, toolResults} from './model-response';
import {compareText, known, parse, record, TelemetryReader, time} from './workflow/telemetry';

const definitionsKey = 'gen_ai.tool.definitions';
const inputMessagesKey = 'gen_ai.input.messages';
const inputTokensKey = 'gen_ai.usage.input_tokens';
const outputTokensKey = 'gen_ai.usage.output_tokens';
const fallbackCharactersPerToken = 4.25;

export type ToolUsageState = 'used' | 'unused' | 'unverified';

export interface ToolDefinitionVersion {
  version: number;
  canonicalJson: string;
}

export interface ToolDuplicateSummary {
  total: number;
  acrossAgents: number;
  afterCompaction: number;
  identicalResult: number;
  differentResult: number;
  missingResult: number;
  roundLabels: string[];
  argumentGroups: ToolDuplicateArgumentGroup[];
}

export interface ToolDuplicateArgumentGroup {
  argumentsJson: string;
  firstRoundLabel: string;
  repeatedRoundLabels: string[];
  repetitions: number;
}

export interface ToolUsageRow {
  name: string;
  state: ToolUsageState;
  agents: string[];
  definitionVersions: number;
  definitions: ToolDefinitionVersion[];
  availableCalls: number;
  responseCoveredCalls: number;
  invocations: number;
  duplicates: ToolDuplicateSummary;
  resultOccurrences: number;
  definitionTokens: number;
  invocationTokens: number;
  resultTokens: number;
  retainedResultOccurrences: number;
  cachedResultTokens?: number;
  cacheEstimateCoverage: number;
}

export interface ToolUsageOverview {
  rows: ToolUsageRow[];
  modelCalls: number;
  callsWithDefinitions: number;
  callsWithOutput: number;
  unusedTools: number;
  unlinkedResultOccurrences: number;
}

interface DefinitionOccurrence {
  name: string;
  canonical: string;
  characters: number;
}

interface ObservedCall {
  callId?: string;
  groupId: string;
  traceId: string;
  modelIndex: number;
  name: string;
  observedAt: number;
  argumentSignature?: string;
  roundLabel: string;
}

interface MutableToolUsage {
  name: string;
  agents: Set<string>;
  definitions: Set<string>;
  exposureSpanIds: Set<number>;
  coveredExposureSpanIds: Set<number>;
  invocations: number;
  resultOccurrences: number;
  definitionTokens: number;
  invocationTokens: number;
  resultTokens: number;
  retainedResultOccurrences: number;
  cachedResultTokens: number;
  cacheEstimateCoverage: number;
}

/**
 * Builds a session-wide, deterministic tool inventory. Token values are
 * navigation estimates for captured request/response parts, never provider
 * billing data or proof that disabling a tool will reduce credits.
 */
export function analyzeToolUsage(view: SessionView): ToolUsageOverview {
  const reader = new TelemetryReader();
  const messages = uniqueMessages([view.source, ...view.relatedSource].flatMap(detail => detail.messages));
  const contentSource = {messages};
  let subagentNumber = 0;
  const groups = view.costGroups.map(group => {
    const subagentIndex = group.kind === 'subagent' ? ++subagentNumber : undefined;
    return {
      ...group,
      subagentIndex,
      actor: group.kind === 'main' ? 'Agent główny' : `Subagent ${subagentIndex}`,
      spans: [...group.spans].sort((left, right) => time(left.startedAt) - time(right.startedAt))
    };
  });
  const modelCalls = groups.flatMap(group => group.spans);
  const requestCharacters = new Map(modelCalls.map(span => [span.id, capturedRequestCharacters(span, messages, reader)]));
  const calibration = inputCalibration(modelCalls, requestCharacters, reader);
  const tools = new Map<string, MutableToolUsage>();
  const observedCalls: ObservedCall[] = [];
  let callsWithDefinitions = 0;
  let callsWithOutput = 0;

  const usageFor = (name: string): MutableToolUsage => {
    const displayName = name.trim() || 'Nazwa niewyemitowana';
    let usage = tools.get(displayName);
    if (!usage) {
      usage = {
        name: displayName,
        agents: new Set<string>(),
        definitions: new Set<string>(),
        exposureSpanIds: new Set<number>(),
        coveredExposureSpanIds: new Set<number>(),
        invocations: 0,
        resultOccurrences: 0,
        definitionTokens: 0,
        invocationTokens: 0,
        resultTokens: 0,
        retainedResultOccurrences: 0,
        cachedResultTokens: 0,
        cacheEstimateCoverage: 0
      };
      tools.set(displayName, usage);
    }
    return usage;
  };

  for (const group of groups) {
    const roundByTrace = new Map<string, number>();
    for (const [modelIndex, span] of group.spans.entries()) {
      const roundNumber = (roundByTrace.get(span.traceId) ?? 0) + 1;
      roundByTrace.set(span.traceId, roundNumber);
      const definitions = definitionsFor(span, messages, reader);
      const response = modelResponse(capturedMessages(span, contentSource, 'output', reader));
      if (definitions.length) callsWithDefinitions++;
      if (response.observed) callsWithOutput++;

      for (const definition of definitions) {
        const usage = usageFor(definition.name);
        usage.agents.add(group.actor);
        usage.definitions.add(definition.canonical);
        usage.exposureSpanIds.add(span.id);
        if (response.observed) usage.coveredExposureSpanIds.add(span.id);
        usage.definitionTokens += estimateInputPart(span, definition.characters, requestCharacters, calibration, reader);
      }

      const callCharacters = response.calls.map(call => serializedLength({name: call.name, arguments: call.arguments}));
      const responseCharacters = response.text.length + callCharacters.reduce((sum, value) => sum + value, 0);
      const emittedOutput = known(reader.metric(span, outputTokensKey));
      for (const [callIndex, call] of response.calls.entries()) {
        const name = call.name === 'unknown' ? 'Nazwa niewyemitowana' : call.name;
        const usage = usageFor(name);
        usage.agents.add(group.actor);
        usage.invocations++;
        usage.invocationTokens += emittedOutput !== undefined && responseCharacters > 0
          ? emittedOutput * callCharacters[callIndex] / responseCharacters
          : callCharacters[callIndex] / fallbackCharactersPerToken;
        observedCalls.push({
          callId: call.id,
          groupId: group.id,
          traceId: span.traceId,
          modelIndex,
          name: usage.name,
          observedAt: time(span.endedAt || span.startedAt),
          argumentSignature: call.arguments == null ? undefined : canonicalJson(call.arguments),
          roundLabel: group.kind === 'main' ? `M${roundNumber}` : `S${group.subagentIndex}:M${roundNumber}`
        });
      }
    }
  }

  const compactionStarts = view.contextCompactions.map(compaction => time(compaction.startedAt))
    .filter(Number.isFinite).sort((left, right) => left - right);
  const firstReceiptIndex = new Map<ObservedCall, number>();
  const resultSignatures = new Map<ObservedCall, string>();
  let unlinkedResultOccurrences = 0;
  for (const group of groups) {
    for (const [modelIndex, span] of group.spans.entries()) {
      for (const result of toolResults(capturedMessages(span, contentSource, 'input', reader))) {
        const candidates = observedCalls.filter(call => call.callId === result.id && call.groupId === group.id &&
          call.traceId === span.traceId && call.modelIndex < modelIndex);
        if (candidates.length !== 1) {
          unlinkedResultOccurrences++;
          continue;
        }
        const call = candidates[0];
        if (!resultSignatures.has(call)) resultSignatures.set(call, canonicalJson(result.content));
        const nextCompaction = compactionStarts.find(start => start > call.observedAt);
        if (nextCompaction !== undefined && time(span.startedAt) >= nextCompaction) continue;
        const usage = usageFor(call.name);
        const estimatedTokens = estimateInputPart(span, result.characters, requestCharacters, calibration, reader);
        const firstIndex = firstReceiptIndex.get(call);
        if (firstIndex === undefined) {
          firstReceiptIndex.set(call, modelIndex);
          usage.resultOccurrences++;
          usage.resultTokens += estimatedTokens;
        } else if (modelIndex > firstIndex) {
          usage.retainedResultOccurrences++;
          const cacheShare = inputCacheShare(span, reader);
          if (cacheShare !== undefined) {
            usage.cachedResultTokens += estimatedTokens * cacheShare;
            usage.cacheEstimateCoverage++;
          }
        }
      }
    }
  }

  const duplicateSummaries = analyzeDuplicateCalls(observedCalls, resultSignatures, compactionStarts);

  const rows = [...tools.values()].map((usage): ToolUsageRow => {
    const availableCalls = usage.exposureSpanIds.size;
    const responseCoveredCalls = usage.coveredExposureSpanIds.size;
    const state: ToolUsageState = usage.invocations > 0
      ? 'used'
      : availableCalls > 0 && responseCoveredCalls === availableCalls
        ? 'unused'
        : 'unverified';
    return {
      name: usage.name,
      state,
      agents: [...usage.agents],
      definitionVersions: usage.definitions.size,
      definitions: [...usage.definitions].sort(compareText)
        .map((canonicalJson, index) => ({version: index + 1, canonicalJson})),
      availableCalls,
      responseCoveredCalls,
      invocations: usage.invocations,
      duplicates: duplicateSummaries.get(usage.name) ?? emptyDuplicateSummary(),
      resultOccurrences: usage.resultOccurrences,
      definitionTokens: Math.round(usage.definitionTokens),
      invocationTokens: Math.round(usage.invocationTokens),
      resultTokens: Math.round(usage.resultTokens),
      retainedResultOccurrences: usage.retainedResultOccurrences,
      cachedResultTokens: usage.cacheEstimateCoverage ? Math.round(usage.cachedResultTokens)
        : usage.retainedResultOccurrences ? undefined : 0,
      cacheEstimateCoverage: usage.cacheEstimateCoverage
    };
  }).sort((left, right) => {
    const tabOrder = (row: ToolUsageRow) => row.state === 'used' ? 1 : 0;
    const confidenceOrder: Record<ToolUsageState, number> = {unused: 0, unverified: 1, used: 0};
    return tabOrder(left) - tabOrder(right)
      || toolPriority(right) - toolPriority(left)
      || confidenceOrder[left.state] - confidenceOrder[right.state]
      || compareText(left.name, right.name);
  });

  return {
    rows,
    modelCalls: modelCalls.length,
    callsWithDefinitions,
    callsWithOutput,
    unusedTools: rows.filter(row => row.state === 'unused').length,
    unlinkedResultOccurrences
  };
}

function analyzeDuplicateCalls(calls: ObservedCall[], results: Map<ObservedCall, string>,
    compactionStarts: number[]): Map<string, ToolDuplicateSummary> {
  const summaries = new Map<string, ToolDuplicateSummary>();
  const firstBySignature = new Map<string, ObservedCall>();
  const argumentGroupBySignature = new Map<string, ToolDuplicateArgumentGroup>();
  const ordered = [...calls].sort((left, right) => left.observedAt - right.observedAt
    || compareText(left.groupId, right.groupId)
    || left.modelIndex - right.modelIndex
    || compareText(left.callId ?? '', right.callId ?? ''));

  for (const call of ordered) {
    if (call.argumentSignature === undefined) continue;
    const signature = `${call.name}\u0000${call.argumentSignature}`;
    const first = firstBySignature.get(signature);
    if (!first) {
      firstBySignature.set(signature, call);
      continue;
    }

    const summary = summaries.get(call.name) ?? emptyDuplicateSummary();
    summary.total++;
    if (call.groupId !== first.groupId) summary.acrossAgents++;
    if (compactionStarts.some(start => start > first.observedAt && start <= call.observedAt)) summary.afterCompaction++;

    const firstResult = results.get(first);
    const repeatedResult = results.get(call);
    if (firstResult === undefined || repeatedResult === undefined) summary.missingResult++;
    else if (firstResult === repeatedResult) summary.identicalResult++;
    else summary.differentResult++;

    if (!summary.roundLabels.includes(call.roundLabel)) summary.roundLabels.push(call.roundLabel);
    let argumentGroup = argumentGroupBySignature.get(signature);
    if (!argumentGroup) {
      argumentGroup = {
        argumentsJson: prettyJson(first.argumentSignature!),
        firstRoundLabel: first.roundLabel,
        repeatedRoundLabels: [],
        repetitions: 0
      };
      argumentGroupBySignature.set(signature, argumentGroup);
      summary.argumentGroups.push(argumentGroup);
    }
    argumentGroup.repetitions++;
    if (!argumentGroup.repeatedRoundLabels.includes(call.roundLabel)) argumentGroup.repeatedRoundLabels.push(call.roundLabel);
    summaries.set(call.name, summary);
  }
  return summaries;
}

function emptyDuplicateSummary(): ToolDuplicateSummary {
  return {
    total: 0,
    acrossAgents: 0,
    afterCompaction: 0,
    identicalResult: 0,
    differentResult: 0,
    missingResult: 0,
    roundLabels: [],
    argumentGroups: []
  };
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return value;
  }
}

/**
 * Sorting aid only: definitions, first receipts and the estimated cached share
 * of later receipts are model input, while tool requests are model output. The
 * multiplier is deliberately simple and must not be presented as measured
 * credits or provider billing.
 */
function toolPriority(row: ToolUsageRow): number {
  return row.definitionTokens + row.resultTokens + (row.cachedResultTokens ?? 0) + 10 * row.invocationTokens;
}

function inputCacheShare(span: SpanRecord, reader: TelemetryReader): number | undefined {
  const input = known(reader.metric(span, inputTokensKey));
  const cacheRead = known(reader.metric(span, 'gen_ai.usage.cache_read.input_tokens'));
  if (input === undefined || cacheRead === undefined || input <= 0) return undefined;
  return Math.max(0, Math.min(1, cacheRead / input));
}

function definitionsFor(span: SpanRecord, messages: MessageRecord[], reader: TelemetryReader): DefinitionOccurrence[] {
  const attributes = reader.attributes(span);
  let values: unknown[] = [];
  if (Object.hasOwn(attributes, definitionsKey)) {
    const parsed = parse(attributes[definitionsKey]);
    values = Array.isArray(parsed) ? parsed : parsed == null ? [] : [parsed];
  } else {
    values = messages.filter(message => message.spanId === span.id && message.direction === 'definition')
      .flatMap(message => {
        const parsed = parse(message.content);
        return Array.isArray(parsed) ? parsed : [parsed];
      });
  }
  const definitions = values.flatMap(value => {
    const outer = record(value);
    const inner = record(outer['function']);
    const definition = typeof inner['name'] === 'string' ? inner : outer;
    const name = typeof definition['name'] === 'string' ? definition['name'].trim() : '';
    if (!name) return [];
    const canonical = canonicalJson(definition);
    return [{name, canonical, characters: canonical.length}];
  });
  return [...new Map(definitions.map(definition => [definition.canonical, definition])).values()];
}

function capturedRequestCharacters(span: SpanRecord, messages: MessageRecord[], reader: TelemetryReader): number {
  const attributes = reader.attributes(span);
  const inputMessages = messages.filter(message => message.spanId === span.id && message.direction === 'input');
  const definitionMessages = messages.filter(message => message.spanId === span.id && message.direction === 'definition');
  const inputCharacters = inputMessages.length
    ? inputMessages.reduce((sum, message) => sum + message.content.length, 0)
    : Object.hasOwn(attributes, inputMessagesKey) ? serializedLength(attributes[inputMessagesKey]) : 0;
  const definitionCharacters = Object.hasOwn(attributes, definitionsKey)
    ? serializedLength(attributes[definitionsKey])
    : definitionMessages.reduce((sum, message) => sum + message.content.length, 0);
  return inputCharacters + definitionCharacters + systemInstructionCharacters(attributes['gen_ai.system_instructions']);
}

function systemInstructionCharacters(value: unknown): number {
  const parsed = parse(value);
  if (parsed == null) return 0;
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.reduce((sum, item) => {
    if (typeof item === 'string') return sum + item.length;
    const entry = record(item);
    return sum + serializedLength(entry['content'] ?? entry['text'] ?? entry['value'] ?? item);
  }, 0);
}

function inputCalibration(spans: SpanRecord[], requestCharacters: Map<number, number>, reader: TelemetryReader): Map<string, number> {
  const ratios = new Map<string, number[]>();
  for (const span of spans) {
    const characters = requestCharacters.get(span.id) ?? 0;
    const tokens = known(reader.metric(span, inputTokensKey));
    if (usesPreviousResponseState(span, reader) || tokens === undefined || tokens <= 0 || characters <= 0) continue;
    const ratio = characters / tokens;
    if (ratio < 1 || ratio > 12) continue;
    const model = span.model ?? '';
    ratios.set(model, [...(ratios.get(model) ?? []), ratio]);
  }
  return new Map([...ratios].map(([model, values]) => [model, median(values)]));
}

function estimateInputPart(span: SpanRecord, characters: number, requestCharacters: Map<number, number>,
    calibration: Map<string, number>, reader: TelemetryReader): number {
  if (characters <= 0) return 0;
  const captured = requestCharacters.get(span.id) ?? 0;
  const input = known(reader.metric(span, inputTokensKey));
  if (!usesPreviousResponseState(span, reader) && input !== undefined && input > 0 && captured > 0) {
    return input * characters / captured;
  }
  return characters / (calibration.get(span.model ?? '') ?? fallbackCharactersPerToken);
}

function usesPreviousResponseState(span: SpanRecord, reader: TelemetryReader): boolean {
  const shape = record(parse(reader.attributes(span)['copilot_chat.request.shape']));
  return shape['hasPreviousResponseId'] === true;
}

function uniqueMessages(messages: MessageRecord[]): MessageRecord[] {
  return [...new Map(messages.map(message => [message.id, message])).values()];
}

function serializedLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  return JSON.stringify(value)?.length ?? String(value ?? '').length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const item = record(value);
    return `{${Object.keys(item).sort(compareText).map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
