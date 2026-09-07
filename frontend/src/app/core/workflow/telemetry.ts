import {SpanRecord} from '../../models/scanner.models';
import {ContentElement, Metric, Truth} from '../../models/workflow.models';

export const RULES = {
  minInput: 256, minOutput: 32, minContent: 1024, largeContent: 4096,
  pressureGrowth: .10, pressureDrop: .20, stableDelta: .05, burstFactor: 1.5,
  outputRatio: .05, duplicateRatio: .5, iterativeRounds: 3, roundShare: .6,
  inputCv: .5, initialPressure: .6, initialInput: 4096, condensation: .25,
  threshold: 50, mixedMargin: 10
} as const;
export const spanRef = (span: SpanRecord): string => `${span.traceId}/${span.spanId}`;
export const time = (value?: string): number => {
  if (!value) return NaN;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  // The backend preserves database timestamps with microseconds while ECMAScript's ISO grammar
  // only guarantees milliseconds. Truncate excess fractional digits without changing the instant.
  const milliseconds = value.replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/, '$1');
  const parsed = Date.parse(milliseconds);
  return Number.isFinite(parsed) ? parsed : NaN;
};
export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const orderingTime = (value?: string): number => Number.isFinite(time(value)) ? time(value) : Infinity;
export const ordered = (a: SpanRecord, b: SpanRecord): number =>
  (orderingTime(a.startedAt) - orderingTime(b.startedAt)) ||
  (orderingTime(a.endedAt) - orderingTime(b.endedAt)) || compareText(a.spanId, b.spanId);
export const and = (...values: Truth[]): Truth => values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true;
export const or = (...values: Truth[]): Truth => values.includes(true) ? true : values.includes('unknown') ? 'unknown' : false;
export const not = (value: Truth): Truth => value === 'unknown' ? value : !value;
export const usable = (metric: Metric): boolean => metric.availability === 'emitted' || metric.availability === 'derived';
export const known = (metric: Metric): number | undefined => usable(metric) ? metric.value : undefined;
export const test = (metric: Metric, predicate: (value: number) => boolean): Truth => {
  const value = known(metric);
  return value === undefined ? 'unknown' : predicate(value);
};
export function derived(value: number | undefined, sources: Metric[], formula: string, availability?: Metric['availability']): Metric {
  return {value, availability: availability ?? (value === undefined ?
    sources.find(source => source.availability === 'invalid' || source.availability === 'ambiguous')?.availability ?? 'missing' : 'derived'),
  sourceAttributes: [...new Set(sources.flatMap(source => source.sourceAttributes))],
  evidenceRefs: [...new Set(sources.flatMap(source => source.evidenceRefs))], formula};
}
export function ratio(a: Metric, b: Metric, formula: string, bounded = false): Metric {
  const x = known(a), y = known(b);
  if (x === undefined || y === undefined) return derived(undefined, [a, b], formula);
  if (y <= 0) return derived(undefined, [a, b], formula, 'invalid');
  return derived(x / y, [a, b], formula, bounded && x > y ? 'ambiguous' : 'derived');
}
export function sum(metrics: Metric[]): Metric {
  return derived(metrics.length && metrics.every(usable) ? metrics.reduce((total, metric) => total + metric.value!, 0) : undefined, metrics, 'Σ');
}
export function measured(value: number, refs: string[], formula: string): Metric {
  return {value, availability: 'derived', evidenceRefs: refs, sourceAttributes: [], formula};
}
export const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

/** Caches belong to source objects: no persistent hashes or telemetry copies. */
export class TelemetryReader {
  private readonly attributesCache = new WeakMap<SpanRecord, Record<string, unknown>>();
  private readonly contentCache = new WeakMap<SpanRecord, Map<string, Promise<ContentElement | undefined>>>();
  attributes(span: SpanRecord): Record<string, unknown> {
    let result = this.attributesCache.get(span);
    if (!result) { result = record(parse(span.attributesJson)); this.attributesCache.set(span, result); }
    return result;
  }
  string(span: SpanRecord, key: string): string | undefined {
    const value = this.attributes(span)[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  }
  metric(span: SpanRecord, key: string, positive = false): Metric {
    const attributes = this.attributes(span), raw = attributes[key];
    const base = {sourceAttributes: [key], evidenceRefs: [spanRef(span)]};
    if (!Object.hasOwn(attributes, key)) return {...base, availability: 'missing'};
    const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
    return {...base, value: Number.isFinite(value) ? value : undefined,
      availability: Number.isFinite(value) && value >= 0 && (!positive || value > 0) ? 'emitted' : 'invalid'};
  }
  content(span: SpanRecord, key: string): Promise<ContentElement | undefined> {
    let cache = this.contentCache.get(span);
    if (!cache) { cache = new Map(); this.contentCache.set(span, cache); }
    let result = cache.get(key);
    if (!result) {
      result = Object.hasOwn(this.attributes(span), key) ? contentElement(this.attributes(span)[key], spanRef(span)) : Promise.resolve(undefined);
      cache.set(key, result);
    }
    return result;
  }
  events(span: SpanRecord): Record<string, unknown>[] {
    const events = parse(span.eventsJson);
    return Array.isArray(events) ? events.map(record) : [];
  }
  errors(span: SpanRecord): string[] {
    const errors: string[] = [];
    if (span.statusCode === 'STATUS_CODE_ERROR') errors.push('STATUS_CODE_ERROR');
    const errorType = this.attributes(span)['error.type'];
    if (errorType != null && String(errorType).trim()) errors.push('error.type');
    for (const event of this.events(span)) {
      const name = String(event['name'] ?? '').toLowerCase(), attrs = record(event['attributes']);
      if (['exception', 'error', 'github.copilot.session.abort'].includes(name) || name.endsWith('.error') ||
          (name === 'github.copilot.session.compaction_complete' && String(attrs['success']).toLowerCase() === 'false')) errors.push(name);
    }
    if (span.operationName !== 'execute_tool') return errors;
    const raw = this.attributes(span)['gen_ai.tool.call.result'], result = record(parse(raw));
    for (const [key, failure] of [['isError', true], ['success', false], ['ok', false]] as const) {
      if (result[key] === failure) errors.push(`${key}=${failure}`);
    }
    if (['error', 'failed', 'failure'].includes(String(result['status']).toLowerCase())) errors.push(`status=${result['status']}`);
    const exit = result['exitCode'] ?? result['exit_code'];
    if (exit != null && Number.isFinite(Number(exit)) && Number(exit) !== 0) errors.push(`exitCode=${exit}`);
    if (typeof raw === 'string') {
      const match = raw.match(/^(?:Process\s+)?Exit Code:\s*(-?\d+)\s*$/im);
      if (match && Number(match[1]) !== 0) errors.push(`exitCode=${match[1]}`);
      if (this.string(span, 'gen_ai.tool.name') === 'apply_patch' && /Applying patch failed with error:\s*[^\r\n]+/i.test(raw)) errors.push('apply_patch.failure');
    }
    return errors;
  }
}

// Unicode code point ordering, including supplementary characters.
function unicodeCompare(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const delta = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (delta) return delta;
  }
  return x.length - y.length;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = record(value);
    return `{${Object.keys(object).sort(unicodeCompare).map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export async function contentElement(raw: unknown, ref: string): Promise<ContentElement> {
  let text: string;
  if (typeof raw === 'string') {
    try { text = canonicalJson(JSON.parse(raw)); } catch { text = raw; }
  } else text = canonicalJson(raw);
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {ref, bytes: bytes.length, hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')};
}
export function uniqueBytes(elements: ContentElement[]): number {
  return [...new Map(elements.map(element => [element.hash, element])).values()].reduce((total, element) => total + element.bytes, 0);
}
