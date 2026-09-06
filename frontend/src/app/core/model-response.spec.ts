import {describe, expect, it} from 'vitest';
import {capturedMessages, modelResponse, toolResultIds, toolResults} from './model-response';
import {chat, detail} from './workflow/workflow.fixtures';
import {TelemetryReader} from './workflow/telemetry';

describe('captured model response', () => {
  it('reads OTel, Chat Completions, Responses and tool_use envelopes without reading payloads as calls', () => {
    const result = modelResponse([{type: 'reasoning', content: [{type: 'reasoning_text', text: 'Internal analysis'}]},
      {role: 'assistant', parts: [{type: 'text', text: 'Checking.'},
      {type: 'tool_call', id: 'a', name: 'read_file', arguments: {content: {type: 'tool_call', id: 'fake', name: 'fake'}}}]},
      {role: 'assistant', tool_calls: [{id: 'b', type: 'function', function: {name: 'shell', arguments: '{"command":"rg endpoint src"}'}}]},
      {output: [{type: 'function_call', id: 'item-id', call_id: 'c', name: 'write', arguments: '{"path":"report.md"}'}]},
      {role: 'assistant', content: [{type: 'tool_use', id: 'd', name: 'delegate', input: {task: 'Find endpoint'}}]}]);
    expect(result.text).toBe('Checking.');
    expect(result.calls.map(call => call.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.calls[1].arguments).toEqual({command: 'rg endpoint src'});
  });
  it('deduplicates identical calls but preserves conflicting requests sharing a call ID', () => {
    const call = {type: 'tool_call', id: 'a', name: 'read_file', arguments: {path: 'a'}};
    expect(modelResponse([call, call, {...call, arguments: {path: 'b'}}]).calls).toHaveLength(2);
  });
  it('collects result IDs from message envelopes without walking into returned content', () => {
    const values = [{role: 'tool', id: 'message-id', parts: [{type: 'tool_call_response', id: 'a', response: {type: 'tool_result', tool_use_id: 'fake'}}]},
      {role: 'tool', tool_call_id: 'b', content: '{"type":"tool_result","id":"fake"}'},
      {type: 'function_call_output', call_id: 'c', output: 'result'}, {type: 'tool_result', tool_use_id: 'd', content: []}];
    expect([...toolResultIds(values)]).toEqual(['a', 'b', 'c', 'd']);
    expect(toolResults(values).map(result => result.characters).every(characters => characters > 0)).toBe(true);
  });
  it('uses normalized messages once, with raw attributes as a fallback, and distinguishes missing from empty', () => {
    const model = chat(1, 100, 0, 10, {'gen_ai.output.messages': []}), source = detail([model]), reader = new TelemetryReader();
    expect(modelResponse(capturedMessages(model, source, 'output', reader)).observed).toBe(true);
    expect(modelResponse(capturedMessages(chat(2), source, 'output', reader)).observed).toBe(false);
    source.messages = [{id: 1, spanId: 1, direction: 'output', roleName: 'assistant', sequenceNo: 0, sourceKind: 'telemetry', content: '{"content":"Only once"}'}];
    expect(modelResponse(capturedMessages(model, source, 'output', reader)).text).toBe('Only once');
  });
});
