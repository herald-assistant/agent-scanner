import {SessionDetail, SpanRecord} from '../../models/scanner.models';
import {Metric, RoundObservation, ToolObservation} from '../../models/workflow.models';
import {derived, known, measured, ordered, parse, ratio, record, spanRef, TelemetryReader, time, uniqueBytes} from './telemetry';

export async function observeRounds(streamId: string, source: SessionDetail, spans: SpanRecord[], reader: TelemetryReader,
                                    ambiguousTools: Set<string>, truncated = false): Promise<RoundObservation[]> {
  const chronological = spans.filter(span => span.operationName === 'chat').sort(ordered);
  const traceIds = [...new Set(chronological.map(chat => chat.traceId))];
  const chats = traceIds.flatMap(traceId => chronological.filter(chat => chat.traceId === traceId));
  const tools = await Promise.all(spans.filter(span => span.operationName === 'execute_tool').sort(ordered).map(async (span): Promise<ToolObservation> => ({
    span, callId: reader.string(span, 'gen_ai.tool.call.id'), operationKey: reader.string(span, 'gen_ai.tool.name'),
    arguments: await reader.content(span, 'gen_ai.tool.call.arguments'), result: await reader.content(span, 'gen_ai.tool.call.result'),
    errors: reader.errors(span)
  })));
  return Promise.all(chats.map(async (model, index): Promise<RoundObservation> => {
    const traceChats = chats.filter(chat => chat.traceId === model.traceId), position = traceChats.indexOf(model);
    const previous = traceChats[position - 1], next = traceChats[position + 1];
    const start = time(model.startedAt), end = time(model.endedAt);
    const orderKnown = Number.isFinite(start) && Number.isFinite(end) && end >= start &&
      (!previous || time(previous.endedAt) <= start && time(previous.startedAt) < start) &&
      (!next || end <= time(next.startedAt) && start < time(next.startedAt));
    const belongs = (span: SpanRecord): boolean => span.traceId === model.traceId &&
      time(span.startedAt) >= end && (!next || time(span.startedAt) < time(next.startedAt));
    const roundTools = tools.filter(tool => belongs(tool.span));
    const toolCoverage = !truncated && orderKnown && !ambiguousTools.has(model.traceId) && roundTools.every(tool => tool.result !== undefined &&
      (!tool.span.parentSpanId || tool.span.parentSpanId === model.spanId || !traceChats.some(chat => chat.spanId === tool.span.parentSpanId)));
    const diagnostics = spans.filter(span => span.operationName === 'execute_hook' && belongs(span));
    const input = reader.metric(model, 'gen_ai.usage.input_tokens'), cache = reader.metric(model, 'gen_ai.usage.cache_read.input_tokens');
    const output = reader.metric(model, 'gen_ai.usage.output_tokens');
    const i = known(input), k = known(cache);
    const fresh = i === undefined || k === undefined ? derived(undefined, [input, cache], 'I − K') :
      derived(i - k, [input, cache], 'I − K', k > i ? 'invalid' : 'derived');
    if (i !== undefined && k !== undefined && k > i) cache.availability = 'invalid';
    const promptLimit = reader.metric(model, 'copilot_chat.request.max_prompt_tokens', true);
    const outputLimit = reader.metric(model, 'gen_ai.request.max_tokens', true);
    const p = known(promptLimit), o = known(outputLimit);
    const fullLimit = derived(p !== undefined && o !== undefined ? p + o : undefined, [promptLimit, outputLimit], 'Pmax + Omax');
    const pressure = ratio(input, promptLimit, 'I / Pmax', true), occupancy = ratio(input, fullLimit, 'I / (Pmax + Omax)', true);
    const pressureValue = known(pressure);
    const refs = roundTools.map(tool => spanRef(tool.span));
    const results = roundTools.flatMap(tool => tool.result ? [tool.result] : []);
    const resultBytes = resultMetric(toolCoverage, results.reduce((total, item) => total + item.bytes, 0), refs, 'Σ UTF-8(tool.result)');
    const uniqueResultBytes = resultMetric(toolCoverage, uniqueBytes(results), refs, 'Σ UTF-8(unique SHA-256(tool.result))');
    const duplicateBytes = derived(toolCoverage ? resultBytes.value! - uniqueResultBytes.value! : undefined, [resultBytes, uniqueResultBytes], 'total − unique');
    const root = spans.find(span => span.traceId === model.traceId && span.operationName === 'invoke_agent');
    const rawPrompt = root && reader.string(root, 'copilot_chat.user_request');
    const message = root && source.messages.find(item => item.spanId === root.id && item.direction === 'input' && item.roleName === 'user' &&
      !item.content.includes('<environment_info>') && !item.content.includes('<context>'));
    const prompt = rawPrompt ?? (message ? messageText(message.content) : 'Treść promptu nie została wyemitowana.');
    const eventSpans = [model, ...roundTools.map(tool => tool.span), ...diagnostics];
    // Events on an interaction root are assigned only by their explicit event timestamp.
    if (root) {
      const events = reader.events(root).filter(event => {
        const at = eventTime(event);
        return Number.isFinite(at) && at >= start && (!next ? at <= Math.max(end, ...roundTools.map(tool => time(tool.span.endedAt)).filter(Number.isFinite)) : at < time(next.startedAt));
      });
      if (events.length) eventSpans.push({...root, statusCode: undefined, attributesJson: '{}', eventsJson: JSON.stringify(events)});
    }
    const errors = eventSpans.map(span => ({ref: spanRef(span), codes: reader.errors(span)})).filter(error => error.codes.length);
    const errorCoverage = !truncated && toolCoverage && eventSpans.every(span => !!span.statusCode && Array.isArray(parse(span.eventsJson))) &&
      (!root || !reader.errors(root).length || reader.events(root).every(event => Number.isFinite(eventTime(event))));
    const compactionCoverage = !truncated && spans.filter(span => span.traceId === model.traceId).every(span => Array.isArray(parse(span.eventsJson))) &&
      (!root || reader.events(root).filter(event => event['name'] === 'github.copilot.session.compaction_complete').every(event => Number.isFinite(eventTime(event))));
    const compactionRefs = eventSpans.filter(span => reader.events(span).some(event =>
      event['name'] === 'github.copilot.session.compaction_complete')).map(spanRef);
    const nano = reader.metric(model, 'copilot_chat.copilot_usage_nano_aiu');
    const credits = derived(known(nano) === undefined ? undefined : nano.value! / 1_000_000_000, [nano], 'nano AIU / 1 000 000 000');
    return {
      ref: spanRef(model), streamId, model: reader.string(model, 'gen_ai.response.model') ?? reader.string(model, 'gen_ai.request.model') ?? model.model,
      turn: {index: index + 1, interactionIndex: traceIds.indexOf(model.traceId) + 1, interactionTurnIndex: position + 1,
        interactionPrompt: prompt, interactionStartedAt: root?.startedAt, model, tools: roundTools.map(tool => tool.span), diagnostics},
      sequence: '', orderKnown, input, cache, fresh, output, cacheWrite: reader.metric(model, 'gen_ai.usage.cache_creation.input_tokens'), credits,
      promptLimit, outputLimit, pressure, occupancy, deltaPressure: derived(undefined, [], 'pressure(t) − pressure(t−1)'),
      band: pressureValue === undefined ? 'UNKNOWN' : pressureValue < .25 ? 'LOW' : pressureValue < .6 ? 'MODERATE' : pressureValue < .85 ? 'HIGH' : 'CRITICAL',
      tools: roundTools, toolCoverage, resultBytes, uniqueResultBytes, duplicateRatio: ratio(duplicateBytes, resultBytes, '(total − unique) / total'),
      distinctResults: new Set(results.filter(item => item.bytes > 0).map(item => item.hash)).size,
      errors, errorCoverage, compactionCoverage, compactionRefs, markers: [...(errors.length ? ['CONFIRMED_ERROR'] : []), ...(compactionRefs.length ? ['COMPACTION_EVENT'] : [])],
      qualifiers: [], predicates: [], profile: 'UNKNOWN', candidates: [], scores: [0, 0, 0], adjustments: [], coverage: 0, confidence: 'unknown', provisional: true
    };
  }));
}

function resultMetric(complete: boolean, value: number, refs: string[], formula: string): Metric {
  return complete ? measured(value, refs, formula) : {availability: 'missing', sourceAttributes: ['gen_ai.tool.call.result'], evidenceRefs: refs, formula};
}
function messageText(raw: string): string {
  const parsed = parse(raw), object = record(parsed);
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(object['parts'])) return object['parts'].map(part => record(part)['content'] ?? record(part)['text'] ?? '').join('\n');
  return typeof object['content'] === 'string' ? object['content'] : raw;
}
function eventTime(event: Record<string, unknown>): number {
  if (event['timeUnixNano'] != null) return Number(event['timeUnixNano']) / 1_000_000;
  const value = event['time'] ?? event['timestamp'];
  return typeof value === 'string' ? time(value) : NaN;
}
