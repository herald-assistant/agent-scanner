import {describe, expect, it} from 'vitest';
import {SpanRecord} from '../models/scanner.models';
import {cacheWriteMetric, creditsMetric, creditsValue, inputCacheTotals, sdkContextState} from './copilot-telemetry';
import {TelemetryReader} from './workflow/telemetry';

describe('Copilot telemetry compatibility', () => {
  const reader = new TelemetryReader();

  it('reads SDK credits and cache write from retained raw attributes', () => {
    const span = chat({'github.copilot.nano_aiu': 7_436_400_000, 'gen_ai.usage.cache_write.input_tokens': 29_448});
    expect(creditsValue(reader, span)).toBe(7.4364);
    expect(creditsMetric(reader, span).sourceAttributes).toEqual(['github.copilot.nano_aiu']);
    expect(cacheWriteMetric(reader, span)).toMatchObject({value: 29_448, availability: 'emitted',
      sourceAttributes: ['gen_ai.usage.cache_write.input_tokens']});
  });

  it('prefers the existing field and does not mask an invalid primary measurement', () => {
    const span = chat({'copilot_chat.copilot_usage_nano_aiu': 1_000_000_000, 'github.copilot.nano_aiu': 9_000_000_000,
      'gen_ai.usage.cache_creation.input_tokens': 12, 'gen_ai.usage.cache_write.input_tokens': 30});
    expect(creditsValue(reader, span)).toBe(1);
    expect(cacheWriteMetric(reader, span).value).toBe(12);
    const invalid = chat({'copilot_chat.copilot_usage_nano_aiu': 'invalid', 'github.copilot.nano_aiu': 9_000_000_000});
    expect(creditsMetric(reader, invalid).availability).toBe('invalid');
    expect(creditsValue(reader, invalid)).toBeUndefined();
  });

  it('keeps the SDK context event separate from request token usage', () => {
    const span = chat({}, [{name: 'github.copilot.session.usage_info', attributes: {
      'github.copilot.current_tokens': 73_401, 'github.copilot.token_limit': 200_000}}]);
    expect(sdkContextState(reader, span)).toEqual({currentTokens: 73_401, tokenLimit: 200_000});
    const ambiguous = chat({}, [
      {name: 'github.copilot.session.usage_info', attributes: {'github.copilot.current_tokens': 2, 'github.copilot.token_limit': 10}},
      {name: 'github.copilot.session.usage_info', attributes: {'github.copilot.current_tokens': 3, 'github.copilot.token_limit': 10}}
    ]);
    expect(sdkContextState(reader, ambiguous)).toBeUndefined();
  });

  it('uses a matching invoke_agent aggregate for a summary without filling the missing chat value', () => {
    const first = {...chat({'gen_ai.conversation.id': 'sdk', 'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 10}), id: 1, spanId: 'first'};
    const second = {...chat({'gen_ai.conversation.id': 'sdk', 'gen_ai.usage.input_tokens': 200,
      'gen_ai.usage.cache_read.input_tokens': 100, 'gen_ai.usage.output_tokens': 20}), id: 2, spanId: 'second'};
    const root = {...chat({'gen_ai.conversation.id': 'sdk', 'gen_ai.usage.input_tokens': 300,
      'gen_ai.usage.cache_read.input_tokens': 100, 'gen_ai.usage.output_tokens': 30,
      'github.copilot.turn_count': 2}), id: 3, spanId: 'root', operationName: 'invoke_agent'};
    expect(inputCacheTotals(reader, [first, second], [root, first, second])).toEqual({
      cacheReadTokens: 100, freshInputTokens: 200, aggregateFallbacks: 1
    });
    expect(reader.metric(first, 'gen_ai.usage.cache_read.input_tokens').availability).toBe('missing');
    const mismatched = {...root, attributesJson: JSON.stringify({...JSON.parse(root.attributesJson), 'github.copilot.turn_count': 3})};
    expect(inputCacheTotals(reader, [first, second], [mismatched, first, second])).toEqual({
      cacheReadTokens: undefined, freshInputTokens: undefined, aggregateFallbacks: 0
    });
    const invalid = {...first, attributesJson: JSON.stringify({...JSON.parse(first.attributesJson),
      'gen_ai.usage.cache_read.input_tokens': 'invalid'})};
    expect(inputCacheTotals(reader, [invalid, second], [root, invalid, second]).aggregateFallbacks).toBe(0);
  });
});

function chat(attributes: Record<string, unknown>, events: unknown[] = []): SpanRecord {
  return {id: 1, signalId: 1, traceId: 'trace', spanId: 'chat', spanName: 'chat', operationName: 'chat',
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    attributesJson: JSON.stringify(attributes), eventsJson: JSON.stringify(events)};
}
