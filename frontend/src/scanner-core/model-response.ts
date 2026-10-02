import {SessionDetail, SpanRecord} from '../app/models/scanner.models';
import {parse, record, TelemetryReader} from './workflow/telemetry';

export interface ModelToolRequest { id?: string; name: string; arguments: unknown; }
export interface ModelToolResult { id: string; characters: number; content: unknown; }
export interface ModelResponse { observed: boolean; text: string; calls: ModelToolRequest[]; }
const structuralKeys = ['parts', 'output', 'content', 'messages', 'tool_calls'];
const requestTypes = new Set(['tool_call', 'function_call', 'tool_use']);
const resultTypes = new Set(['tool_call_response', 'function_call_output', 'tool_result', 'tool_response']);

/** Walk message envelopes only. Never interpret JSON inside arguments or returned payloads. */
function walk(value: unknown, visit: (item: Record<string, unknown>) => boolean, text?: (value: string) => void, depth = 0): void {
  if (depth > 30) return;
  if (typeof value === 'string') { text?.(value); return; }
  if (Array.isArray(value)) { value.forEach(item => walk(item, visit, text, depth + 1)); return; }
  const item = record(value);
  if (!visit(item)) return;
  if (typeof item['text'] === 'string') text?.(item['text']);
  for (const key of structuralKeys) if (item[key] != null) walk(item[key], visit, text, depth + 1);
}
function callId(item: Record<string, unknown>, allowItemId = true): string | undefined {
  for (const key of ['call_id', 'callId', 'tool_call_id', 'toolCallId', 'tool_use_id', 'id']) {
    if ((key !== 'id' || allowItemId) && typeof item[key] === 'string' && item[key]) return item[key];
  }
  return undefined;
}
export function modelResponse(values: unknown[], observed = values.length > 0): ModelResponse {
  const calls: ModelToolRequest[] = [], texts: string[] = [];
  const seen = new Set<string>();
  for (const value of values) walk(value, item => {
    const type = String(item['type'] ?? '');
    if (resultTypes.has(type) || item['role'] === 'tool' || ['reasoning', 'reasoning_text', 'thinking'].includes(type)) return false;
    const fn = record(item['function']);
    if (requestTypes.has(type) || typeof fn['name'] === 'string') {
      const name = fn['name'] ?? item['name'] ?? item['tool_name'] ?? item['toolName'];
      const call = {id: callId(item), name: typeof name === 'string' && name ? name : 'unknown',
        arguments: parse(fn['arguments'] ?? item['arguments'] ?? item['args'] ?? item['input'] ?? item['parameters'] ?? null)};
      const key = JSON.stringify(call);
      // Identical duplicate envelopes are common; conflicting requests sharing an ID stay ambiguous.
      if (!call.id || !seen.has(key)) calls.push(call);
      seen.add(key);
      return false;
    }
    return true;
  }, text => { if (text.trim()) texts.push(text); });
  return {observed, text: texts.join('\n'), calls};
}
export function toolResultIds(values: unknown[]): Set<string> {
  return new Set(toolResults(values).map(result => result.id));
}
export function toolResults(values: unknown[]): ModelToolResult[] {
  const results: ModelToolResult[] = [];
  for (const value of values) walk(value, item => {
    const isResult = resultTypes.has(String(item['type'] ?? ''));
    if (isResult || item['role'] === 'tool' && callId(item, false)) {
      const id = callId(item, isResult);
      if (id) {
        const serialized = JSON.stringify(item);
        results.push({id, characters: serialized?.length ?? 0, content: resultContent(item)});
      }
      return false;
    }
    return !requestTypes.has(String(item['type'] ?? '')) && !item['function'];
  });
  return results;
}

function resultContent(item: Record<string, unknown>): unknown {
  for (const key of ['response', 'output', 'result', 'content', 'value']) {
    if (Object.hasOwn(item, key)) return normalizeResultContent(item[key]);
  }
  const metadata = new Set([
    'type', 'role', 'name', 'call_id', 'callId', 'tool_call_id', 'toolCallId', 'tool_use_id', 'id'
  ]);
  return Object.fromEntries(Object.entries(item).filter(([key]) => !metadata.has(key)));
}

/** Normalize only a transport wrapper that carries one plain text result. */
function normalizeResultContent(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) return value;
  const part = record(value[0]);
  const keys = Object.keys(part);
  return part['type'] === 'text' && typeof part['text'] === 'string' &&
    keys.every(key => key === 'type' || key === 'text') ? part['text'] : value;
}
export function capturedMessages(model: SpanRecord, source: Pick<SessionDetail, 'messages'>, direction: 'input' | 'output', reader: TelemetryReader): unknown[] {
  const messages = source.messages.filter(message => message.spanId === model.id && message.direction === direction).sort((a, b) => a.sequenceNo - b.sequenceNo);
  if (messages.length) return messages.map(message => parse(message.content));
  const attrs = reader.attributes(model), key = `gen_ai.${direction}.messages`;
  return Object.hasOwn(attrs, key) ? [parse(attrs[key])] : [];
}
