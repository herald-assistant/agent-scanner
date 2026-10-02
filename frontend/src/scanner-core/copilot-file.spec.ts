import {describe,expect,it} from 'vitest';
import {fixtures,expectations} from './testing/copilot-fixtures.generated';
import {instant,parseCopilotFile,prepareCopilotImport,previewCopilotFile} from './copilot-file';
import {jsonText,parseLosslessJson} from './lossless-json';
import {SessionEngine} from './session-engine';
import {TelemetryReader} from './workflow/telemetry';

const now='2026-01-01T00:00:00.000Z';
describe('shared Copilot file contract',()=>{
  for (const name of ['copilot-file-v1.jsonl','copilot-file-detached-v1.jsonl'] as const) {
    it(`matches the shared Java expectation: ${name}`,()=>{
      const parsed=parseCopilotFile(fixtures[name]);
      const {normalized,...preview} = expectations[name];
      expect(previewCopilotFile(parsed)).toMatchObject(preview);
      const prepared=prepareCopilotImport(parsed,preview.sessions.map(item=>item.conversationId),now);
      for (const [conversationId,{spans,...session}] of Object.entries(normalized)) {
        const detail=prepared.sessions.find(item=>item.detail.session.conversationId===conversationId)!.detail;
        expect(detail.session).toMatchObject(session);
        expect(detail.spans).toHaveLength(spans);
      }
      const reordered='\uFEFF'+fixtures[name].trim().split('\n').reverse().join('\r\n')+'\r\n\r\n';
      expect(previewCopilotFile(parseCopilotFile(reordered))).toEqual(previewCopilotFile(parsed));
    });
  }
  it('prepares one selected tree and keeps unknown raw without unrelated spans',()=>{
    const prepared=prepareCopilotImport(parseCopilotFile(fixtures['copilot-file-v1.jsonl']),['file-session-a'],now);
    expect(prepared.sessions.map(item=>item.detail.session.conversationId)).toEqual(['file-session-a','file-child-a']);
    const lines=prepared.sessions.flatMap(item=>item.lines).join('\n');
    expect(lines).toContain('unknownFileField');
    expect(lines).not.toContain('file-session-b');
    expect(lines).not.toContain('synthetic log');
    const main=prepared.sessions[0].detail,child=prepared.sessions[1].detail;
    const view=new SessionEngine().build(main,[child])!;
    expect(view.modelTurns).toHaveLength(1);
    expect(view.costGroups).toHaveLength(2);
    expect(main.session.inputTokens).toBe(100);
    expect(main.messages).toHaveLength(2);
    expect(main.messages.every(message=>main.spans.some(span=>span.id===message.spanId))).toBe(true);
  });
  it('offers only the main conversation in the detached fixture and separates its counters',async()=>{
    const parsed=parseCopilotFile(fixtures['copilot-file-detached-v1.jsonl']);
    const prepared=prepareCopilotImport(parsed,['fixture-main'],now);
    expect(prepared.sessions.flatMap(item=>item.lines)).toHaveLength(10);
    expect(prepared.sessions.flatMap(item=>item.lines).join('\n')).not.toContain('chat progress');
    const main=prepared.sessions.find(item=>item.detail.session.conversationId==='fixture-main')!.detail;
    const related=prepared.sessions.filter(item=>item.detail!==main).map(item=>item.detail);
    const engine=new SessionEngine(),view=engine.build(main,related)!;
    expect(view.modelTurns).toHaveLength(2);
    expect(view.costGroups.map(group=>group.spans.length)).toEqual([2,2]);
    const workflow=await engine.buildWorkflow(main,related);
    expect(workflow.streams).toHaveLength(2);
    expect(workflow.streams.map(stream=>stream.rounds.length)).toEqual([2,2]);
    expect(()=>prepareCopilotImport(parsed,['trace:'+'3'.repeat(32)],now)).toThrow('Wybierz sesje');
  });
  it('prepares the union of multiple roots and rejects missing or repeated selections',()=>{
    const file=parseCopilotFile(fixtures['copilot-file-v1.jsonl']);
    const prepared=prepareCopilotImport(file,['file-session-b','file-session-a'],now);
    expect(new Set(prepared.sessions.flatMap(item=>item.spanKeys)).size).toBe(7);
    expect(prepared.sessions).toHaveLength(3);
    for (const selection of [[],['file-session-a','file-session-a'],['missing']]) expect(()=>prepareCopilotImport(file,selection,now)).toThrow();
  });
  it('keeps depth inside one trace when span IDs collide and stops cyclic parents',()=>{
    const prepared=prepareCopilotImport(parseCopilotFile(fixtures['copilot-file-v1.jsonl']),['file-session-a'],now);
    const template=prepared.sessions[0].detail.spans[0];
    const first={...template,id:1,traceId:'1'.repeat(32),spanId:'a'.repeat(16),parentSpanId:undefined};
    const collision={...first,id:2,traceId:'2'.repeat(32),parentSpanId:first.spanId};
    const child={...first,id:3,spanId:'b'.repeat(16),parentSpanId:first.spanId};
    expect(new SessionEngine().withDepth([first,collision,child]).map(span=>span.depth)).toEqual([0,1,1]);
  });
  it('detects database identities for roots, descendants and individual spans',()=>{
    const parsed=parseCopilotFile(fixtures['copilot-file-v1.jsonl']);
    const descendant=previewCopilotFile(parsed,new Set(['file-child-a']));
    expect(descendant.sessions.map(item=>item.alreadyImported)).toEqual([false,true]);
    const span=parsed.spans[0];
    expect(previewCopilotFile(parsed,new Set(),new Set([span.key])).sessions.map(item=>item.alreadyImported)).toEqual([false,true]);
  });
  it('deduplicates identical spans and rejects conflicting records, bad lines and duplicate JSON keys',()=>{
    const source=fixtures['copilot-file-v1.jsonl'],first=source.split('\n')[0];
    expect(previewCopilotFile(parseCopilotFile(source+'\n'+first)).duplicateRecords).toBe(1);
    for (const extra of [first.replace('invoke_agent child','changed'),'{broken}','{"key":1,"key":2}','{} trailing']) {
      expect(()=>parseCopilotFile(source+'\n'+extra)).toThrow();
    }
    expect(()=>parseCopilotFile('{"format":"agent-scanner-session","version":1}')).toThrow('nie zawiera');
    expect(()=>parseCopilotFile(first.replace('"kind":0','"kind":0.0'))).toThrow();
    expect(()=>parseCopilotFile(first.replace('[1750000003,0]','[1750000003.0,0]'))).toThrow();
  });
  it('preserves nanoseconds and large integers without claiming an approximate metric is emitted',()=>{
    expect(instant(1750000005123456789n)).toBe('2025-06-15T15:06:45.123456789Z');
    const exact='{"large":9007199254740993,"items":[-9007199254740993,0]}';
    expect(jsonText(parseLosslessJson(exact))).toBe(exact);
    const prepared=prepareCopilotImport(parseCopilotFile(fixtures['copilot-file-v1.jsonl']),['file-session-a'],now);
    const span={...prepared.sessions[0].detail.spans[0],attributesJson:'{"gen_ai.usage.input_tokens":9007199254740993}'};
    expect(new TelemetryReader().metric(span,'gen_ai.usage.input_tokens').availability).toBe('invalid');
    expect(new TelemetryReader().metric({...span,attributesJson:'{}'},'gen_ai.usage.input_tokens').availability).toBe('missing');
    expect(new TelemetryReader().metric({...span,attributesJson:'{"gen_ai.usage.input_tokens":0}'},'gen_ai.usage.input_tokens')).toMatchObject({availability:'emitted',value:0});
  });
  it('rejects ambiguous exact joins and cycles without guessing by timestamp',()=>{
    const source=fixtures['copilot-file-v1.jsonl'];
    const lines=source.trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
    const launch=lines.find(item=>item['name']==='execute_tool A')!;
    const collision={...launch,traceId:'2'.repeat(32),spanId:'2222222222222203',parentSpanContext:{traceId:'2'.repeat(32),spanId:'2222222222222201'},
      attributes:{...(launch['attributes'] as Record<string,unknown>),'gen_ai.conversation.id':'file-session-b'}};
    expect(previewCopilotFile(parseCopilotFile(source+'\n'+JSON.stringify(collision))).sessions).toHaveLength(3);
    const reverse={...launch,spanId:'1111111111111199',attributes:{...(launch['attributes'] as Record<string,unknown>),'gen_ai.conversation.id':'file-child-a','gen_ai.tool.call.id':'file-session-a'}};
    const cyclic=parseCopilotFile(source+'\n'+JSON.stringify(reverse));
    expect(cyclic.children.size).toBe(0);
  });
});
