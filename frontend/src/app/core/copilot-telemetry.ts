import {SpanRecord} from '../models/scanner.models';
import {Metric} from '../models/workflow.models';
import {known, record, TelemetryReader} from './workflow/telemetry';

const creditsKey = 'copilot_chat.copilot_usage_nano_aiu';
const sdkCreditsKey = 'github.copilot.nano_aiu';
const cacheWriteKey = 'gen_ai.usage.cache_creation.input_tokens';
const sdkCacheWriteKey = 'gen_ai.usage.cache_write.input_tokens';

/** An invalid primary value remains invalid; only an absent field permits a fallback. */
export function metricWithFallback(reader: TelemetryReader, span: SpanRecord, primary: string, fallback: string): Metric {
  const metric = reader.metric(span, primary);
  return metric.availability === 'missing' ? reader.metric(span, fallback) : metric;
}

export function creditsMetric(reader: TelemetryReader, span: SpanRecord): Metric {
  return metricWithFallback(reader, span, creditsKey, sdkCreditsKey);
}

export function creditsValue(reader: TelemetryReader, span: SpanRecord): number | undefined {
  const nanoAiu = known(creditsMetric(reader, span));
  return nanoAiu === undefined ? undefined : nanoAiu / 1_000_000_000;
}

export function cacheWriteMetric(reader: TelemetryReader, span: SpanRecord): Metric {
  return metricWithFallback(reader, span, cacheWriteKey, sdkCacheWriteKey);
}

export function cacheWriteValue(reader: TelemetryReader, span: SpanRecord): number | undefined {
  return known(cacheWriteMetric(reader, span));
}

export interface InputCacheTotals {
  cacheReadTokens?: number;
  freshInputTokens?: number;
  aggregateFallbacks: number;
}

/** The SDK invoke_agent total may complete a summary; it never fills a missing chat-span value. */
export function inputCacheTotals(reader: TelemetryReader, chats: SpanRecord[], candidates: SpanRecord[]): InputCacheTotals {
  if (!chats.length) return {aggregateFallbacks: 0};
  const groups = new Map<string, SpanRecord[]>();
  for (const chat of chats) {
    const key = `${chat.traceId}\u0000${reader.string(chat, 'gen_ai.conversation.id') ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), chat]);
  }
  const roots = [...new Map(candidates.filter(span => span.operationName === 'invoke_agent').map(span => [span.id, span])).values()];
  const parts = [...groups.values()].map(group => inputCacheForTrace(reader, group, roots));
  const complete = (values: (number | undefined)[]): number | undefined =>
    values.every((value): value is number => value !== undefined) ? values.reduce((sum, value) => sum + value!, 0) : undefined;
  return {
    cacheReadTokens: complete(parts.map(part => part.cacheReadTokens)),
    freshInputTokens: complete(parts.map(part => part.freshInputTokens)),
    aggregateFallbacks: parts.reduce((sum, part) => sum + Number(part.aggregateFallback), 0)
  };
}

function inputCacheForTrace(reader: TelemetryReader, chats: SpanRecord[], roots: SpanRecord[]): {
  cacheReadTokens?: number; freshInputTokens?: number; aggregateFallback: boolean
} {
  const inputs = chats.map(span => known(reader.metric(span, 'gen_ai.usage.input_tokens')));
  const readMetrics = chats.map(span => reader.metric(span, 'gen_ai.usage.cache_read.input_tokens'));
  const reads = readMetrics.map(known);
  const completeInputs = inputs.every((value): value is number => value !== undefined);
  const completeReads = reads.every((value): value is number => value !== undefined);
  if (completeReads) {
    return {
      cacheReadTokens: reads.reduce((sum, value) => sum + value!, 0),
      freshInputTokens: completeInputs && reads.every((value, index) => value! <= inputs[index]!)
        ? inputs.reduce((sum, value, index) => sum + value! - reads[index]!, 0) : undefined,
      aggregateFallback: false
    };
  }
  if (readMetrics.some(metric => metric.availability !== 'emitted' && metric.availability !== 'missing'))
    return {aggregateFallback: false};
  const conversation = reader.string(chats[0], 'gen_ai.conversation.id');
  const matches = conversation ? roots.filter(root => root.traceId === chats[0].traceId &&
    reader.string(root, 'gen_ai.conversation.id') === conversation) : [];
  if (!completeInputs || matches.length !== 1) return {aggregateFallback: false};
  const root = matches[0];
  const rootInput = known(reader.metric(root, 'gen_ai.usage.input_tokens'));
  const rootOutput = known(reader.metric(root, 'gen_ai.usage.output_tokens'));
  const rootRead = known(reader.metric(root, 'gen_ai.usage.cache_read.input_tokens'));
  const rootTurns = known(reader.metric(root, 'github.copilot.turn_count'));
  const outputs = chats.map(span => known(reader.metric(span, 'gen_ai.usage.output_tokens')));
  const knownRead = reads.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (rootInput !== inputs.reduce<number>((sum, value) => sum + value!, 0) ||
    rootOutput === undefined || outputs.some(value => value === undefined) ||
    rootOutput !== outputs.reduce<number>((sum, value) => sum + value!, 0) ||
    rootTurns !== chats.length || rootRead === undefined || rootRead < knownRead || rootRead > rootInput)
    return {aggregateFallback: false};
  return {cacheReadTokens: rootRead, freshInputTokens: rootInput - rootRead, aggregateFallback: true};
}

export interface SdkContextState {
  currentTokens: number;
  tokenLimit: number;
}

/** A usage-info event is a session-window snapshot, not request input token usage. */
export function sdkContextState(reader: TelemetryReader, span: SpanRecord): SdkContextState | undefined {
  const events = reader.events(span).filter(event => event['name'] === 'github.copilot.session.usage_info');
  if (events.length !== 1) return undefined;
  const attributes = record(events[0]['attributes']);
  const currentTokens = nonnegative(attributes['github.copilot.current_tokens']);
  const tokenLimit = nonnegative(attributes['github.copilot.token_limit']);
  return currentTokens !== undefined && tokenLimit !== undefined && tokenLimit > 0 && currentTokens <= tokenLimit
    ? {currentTokens, tokenLimit} : undefined;
}

function nonnegative(raw: unknown): number | undefined {
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
