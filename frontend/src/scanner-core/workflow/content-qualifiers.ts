import {encodeUtf8} from '../sha256';
import {RoundObservation, Truth} from '../../app/models/workflow.models';
import {and, contentElement, parse, record, RULES as R, TelemetryReader, test, uniqueBytes} from './telemetry';
import {state} from './phases';

/** Content-only qualifiers cannot add points to the primary phase. */
export async function contentQualifiers(rounds: RoundObservation[], reader: TelemetryReader, truncated: boolean): Promise<void> {
  for (const round of rounds) {
    const attrs = reader.attributes(round.turn.model), shape = record(parse(attrs['copilot_chat.request.shape']));
    const input = parse(attrs['gen_ai.input.messages']), instructions = parse(attrs['gen_ai.system_instructions']), definitions = parse(attrs['gen_ai.tool.definitions']);
    const output = parse(attrs['gen_ai.output.messages']);
    const requestComplete = !truncated && Array.isArray(input) && Array.isArray(definitions) && instructions !== undefined &&
      typeof shape['inputItemCount'] === 'number' && shape['inputItemCount'] === input.length;
    let contentState: Truth = 'unknown';
    if (requestComplete && Array.isArray(output)) {
      const elements = [...input, ...(Array.isArray(instructions) ? instructions : [instructions]), ...definitions];
      const union = uniqueBytes(await Promise.all(elements.map(item => contentElement(item, round.ref))));
      const response = responseShape(output);
      contentState = response.complete ? and(union >= R.largeContent, response.calls === 0,
        union > 0 ? response.bytes / union <= R.condensation : 'unknown') : 'unknown';
    }
    const retained: Truth = shape['hasPreviousResponseId'] === false ? true : shape['hasPreviousResponseId'] === true ? false : 'unknown';
    const condensing = and(retained, test(round.output, value => value >= R.minOutput), contentState);
    round.predicates.push({code: 'condensing', state: condensing, refs: [round.ref], weights: [0, 0, 0]});
    if (condensing === true) round.qualifiers.push('CONDENSING');
  }
  for (let index = 0; index + 2 < rounds.length; index++) {
    const window = rounds.slice(index, index + 3);
    if (window.some(round => round.sequence !== window[0].sequence)) continue;
    const tools = window.flatMap(round => round.tools), results = tools.flatMap(tool => tool.result ? [tool.result] : []);
    const total = results.reduce((sum, item) => sum + item.bytes, 0);
    const churn = and(tools.length >= 3, new Set(tools.map(tool => tool.callId).filter(Boolean)).size >= 2,
      window.every(round => round.toolCoverage) && total > 0 ? (total - uniqueBytes(results)) / total >= R.duplicateRatio : 'unknown',
      ...window.map(round => { const burst = state(round, 'outputBurst'); return burst === 'unknown' ? 'unknown' : !burst; }));
    if (churn === true) for (const round of window) {
      if (!round.markers.includes('REPETITIVE_CHURN')) round.markers.push('REPETITIVE_CHURN');
      round.predicates.push({code: `repetitiveChurn:${window[0].ref}`, state: true, refs: [...window.map(item => item.ref), ...results.map(item => item.ref)], weights: [0, 0, 0]});
    }
  }
}

function responseShape(messages: unknown[]): {bytes: number; calls: number; complete: boolean} {
  let bytes = 0, calls = 0, complete = true;
  const encoder = {encode: encodeUtf8};
  for (const message of messages) {
    const object = record(message);
    if (['function_call', 'tool_call', 'tool_use'].includes(String(object['type']))) { calls++; continue; }
    const parts = object['parts'] ?? object['content'];
    if (object['role'] !== 'assistant') { complete = false; continue; }
    if (typeof parts === 'string') { bytes += encoder.encode(parts).length; continue; }
    if (!Array.isArray(parts)) { complete = false; continue; }
    for (const part of parts) {
      const item = record(part), type = item['type'];
      if (['tool_call', 'function_call', 'tool_use'].includes(String(type))) calls++;
      else if (['text', 'output_text'].includes(String(type)) && typeof (item['content'] ?? item['text']) === 'string') {
        bytes += encoder.encode(String(item['content'] ?? item['text'])).length;
      } else complete = false;
    }
  }
  return {bytes, calls, complete};
}
