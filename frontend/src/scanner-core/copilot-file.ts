import type {MessageRecord, Session, SessionDetail, SessionImportPreview, SpanRecord} from '../app/models/scanner.models';
import {isAuxiliaryAgentName} from './auxiliary-model-calls';
import {JsonObject, JsonValue, jsonEqual, jsonObject, jsonText, parseLosslessJson} from './lossless-json';
import {ScannerOperationError} from './operation-error';

export const FILE_PARSER_VERSION = 'copilot-file-v1';
export const CORE_VERSION = 'scanner-core-v1';
interface FileSpan {
  raw: JsonObject; line: string; key: string; traceId: string; spanId: string; parentSpanId?: string;
  start: bigint; end: bigint; attributes: JsonObject; resource: JsonObject; scope: JsonObject;
}
export interface ParsedCopilotFile {
  spans: FileSpan[]; groups: Map<string, FileSpan[]>; children: Map<string, Set<string>>;
  supporting: Map<string, Set<string>>; roots: string[]; ignoredRecords: number; duplicateRecords: number;
}
export interface PreparedSession {detail: SessionDetail; lines: string[]; spanKeys: string[];}
export interface PreparedImport {
  parserVersion: string; coreVersion: string; sessions: PreparedSession[];
  scopes: {conversationId: string; included: string[]}[];
}

const text = (object: JsonObject, key: string): string | undefined => {
  const value = object[key];
  return value === undefined || value === null || typeof value === 'object' ? undefined : String(value) || undefined;
};
const operation = (span: FileSpan): string | undefined => text(span.attributes, 'gen_ai.operation.name');
const objectField = (raw: JsonObject, key: string): JsonObject => raw[key] === undefined ? {} : jsonObject(raw[key]);
const arrayField = (raw: JsonObject, key: string): JsonValue[] => {
  if (raw[key] === undefined) return [];
  if (!Array.isArray(raw[key])) throw new SyntaxError();
  return raw[key];
};
function integer(value: JsonValue | undefined): number {
  if (typeof value !== 'bigint' || value < 0n || value > 2147483647n) throw new SyntaxError();
  return Number(value);
}
function id(value: JsonValue | undefined, length: number): string {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value) || /^0+$/.test(value)) throw new SyntaxError();
  return value.toLowerCase();
}
function nanos(value: JsonValue | undefined): bigint {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0]!=='bigint') throw new SyntaxError();
  const seconds = value[0];
  if (typeof seconds === 'number' && !Number.isSafeInteger(seconds)) throw new SyntaxError();
  if (typeof seconds !== 'number' && typeof seconds !== 'bigint') throw new SyntaxError();
  const fraction = integer(value[1]);
  const result = BigInt(seconds) * 1000000000n + BigInt(fraction);
  if (seconds < 0 || fraction >= 1000000000 || result > 9223372036854775807n) throw new SyntaxError();
  return result;
}
export function instant(value: bigint): string {
  const date = new Date(Number(value / 1000000000n) * 1000).toISOString().slice(0, -5);
  let fraction = (value % 1000000000n).toString().padStart(9, '0');
  while (fraction.endsWith('000')) fraction = fraction.slice(0, -3);
  return `${date}${fraction ? '.' + fraction : ''}Z`;
}
function required(raw: JsonObject, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || !value.trim()) throw new SyntaxError();
  return value;
}
function validateValue(value: JsonValue, depth = 0): void {
  if (depth > 30 || typeof value === 'bigint' && (value > 9223372036854775807n || value < -9223372036854775808n)) throw new SyntaxError();
  if (value && typeof value === 'object') Object.values(value).forEach(item => validateValue(item, depth + 1));
}
function convert(raw: JsonObject, line: string): FileSpan {
  const attributes = jsonObject(raw['attributes']); validateValue(attributes);
  const traceId = id(raw['traceId'], 32), spanId = id(raw['spanId'], 16);
  const start = nanos(raw['startTime']), end = nanos(raw['endTime']);
  if (start <= 0n || end < start) throw new SyntaxError();
  required(raw, 'name');
  let parentSpanId: string | undefined;
  if (raw['parentSpanContext'] != null) {
    const parent = jsonObject(raw['parentSpanContext']);
    if (id(parent['traceId'], 32) !== traceId) throw new SyntaxError();
    parentSpanId = id(parent['spanId'], 16);
  }
  if (raw['kind'] !== undefined && integer(raw['kind']) > 4) throw new SyntaxError();
  if (raw['traceFlags'] !== undefined) integer(raw['traceFlags']);
  if (raw['status'] && typeof raw['status'] === 'object' && !Array.isArray(raw['status'])) {
    if (integer(raw['status']['code']) > 2) throw new SyntaxError();
  }
  for (const item of arrayField(raw, 'events')) {
    const event = jsonObject(item); required(event, 'name'); validateValue(objectField(event, 'attributes'));
    if (event['time'] !== undefined) nanos(event['time']);
    if (event['droppedAttributesCount'] !== undefined) integer(event['droppedAttributesCount']);
  }
  for (const item of arrayField(raw, 'links')) {
    const link = jsonObject(item), context = jsonObject(link['context']);
    id(context['traceId'],32); id(context['spanId'],16); validateValue(objectField(link,'attributes'));
    if (context['traceFlags'] !== undefined) integer(context['traceFlags']);
    if (link['droppedAttributesCount'] !== undefined) integer(link['droppedAttributesCount']);
  }
  for (const key of ['droppedAttributesCount','droppedEventsCount','droppedLinksCount']) if (raw[key] !== undefined) integer(raw[key]);
  const resource = raw['resource'] && typeof raw['resource'] === 'object' && !Array.isArray(raw['resource']) ? raw['resource'] : {};
  const scope = raw['instrumentationScope'] && typeof raw['instrumentationScope'] === 'object' && !Array.isArray(raw['instrumentationScope']) ? raw['instrumentationScope'] : {};
  validateValue(objectField(resource,'attributes')); validateValue(objectField(scope,'attributes'));
  return {raw,line,traceId,spanId,parentSpanId,start,end,attributes,resource,scope,key: `${traceId}:${spanId}`};
}

function explicit(attributes: JsonObject): string | undefined {
  const conversation = text(attributes,'gen_ai.conversation.id');
  const child = text(attributes,'copilot_chat.chat_session_id');
  const parent = text(attributes,'copilot_chat.parent_chat_session_id');
  if (conversation && parent === conversation && child?.trim() && child !== conversation) return child;
  return conversation?.trim() ? conversation : undefined;
}
function auxiliary(span: FileSpan, group: FileSpan[]): boolean {
  if (operation(span) !== 'chat') return false;
  const name = text(span.attributes,'gen_ai.agent.name');
  if (name?.toLowerCase() === 'executionsubagenttool' && group.some(item => operation(item) === 'invoke_agent')) return false;
  return isAuxiliaryAgentName(name);
}
function evidence(group: FileSpan[]): boolean {
  return group.some(span => operation(span) === 'invoke_agent') || group.some(span => explicit(span.attributes) !== undefined &&
    ['chat','execute_tool'].includes(operation(span) ?? '') && !auxiliary(span, group));
}
const primary = (group: FileSpan[]): FileSpan[] => group.filter(span => operation(span) === 'chat' && !auxiliary(span,group));
function reachable(graph: Map<string,Set<string>>, start: string): Set<string> {
  const seen = new Set<string>(), pending = [start];
  for (let i=0; i<pending.length; i++) if (!seen.has(pending[i])) {
    seen.add(pending[i]); pending.push(...graph.get(pending[i]) ?? []);
  }
  return seen;
}
function link(graph: Map<string,Set<string>>, parent: string, child: string): void {
  const set = graph.get(parent) ?? new Set<string>(); set.add(child); graph.set(parent,set);
}
export function included(file: ParsedCopilotFile, root: string): Set<string> {
  const ids = reachable(file.children,root);
  for (const child of [...ids]) for (const support of file.supporting.get(child) ?? []) ids.add(support);
  return ids;
}
function selected(file: ParsedCopilotFile, ids: Set<string>): FileSpan[] {
  const keys = new Set([...ids].flatMap(key => file.groups.get(key) ?? []).map(span => span.key));
  return file.spans.filter(span => keys.has(span.key));
}

export function parseCopilotFile(source: string): ParsedCopilotFile {
  const unique = new Map<string,FileSpan>(); let ignoredRecords=0, duplicateRecords=0;
  const lines = source.replace(/^\uFEFF/,'').split(/\r?\n/);
  for (let index=0; index<lines.length; index++) {
    const line = lines[index]; if (!line.trim()) continue;
    try {
      const raw = jsonObject(parseLosslessJson(line,true));
      if (raw['startTime'] === undefined && raw['endTime'] === undefined) {ignoredRecords++; continue;}
      const span = convert(raw,line), prior = unique.get(span.key);
      if (prior) {
        if (!jsonEqual(prior.raw,raw)) throw new ScannerOperationError('invalid-file', `Sprzeczne rekordy tego samego spanu w wierszu ${index+1}.`,index+1);
        duplicateRecords++;
      } else unique.set(span.key,span);
    } catch (error) {
      if (error instanceof ScannerOperationError) throw error;
      throw new ScannerOperationError('invalid-file', `Niepoprawny rekord JSONL w wierszu ${index+1}. Sprawdź składnię i dane spanu.`,index+1);
    }
  }
  if (!unique.size) throw new ScannerOperationError('invalid-file','Plik nie zawiera odczytywalnych spanów Copilot OTel JSONL. Eksport Agent Scanner nie jest obsługiwany.');
  const spans = [...unique.values()], traces = new Map<string,FileSpan[]>(), groups = new Map<string,FileSpan[]>();
  for (const span of spans) {
    const trace=traces.get(span.traceId) ?? []; trace.push(span); traces.set(span.traceId,trace);
  }
  for (const [traceId, trace] of traces) {
    const byId = new Map(trace.map(span => [span.spanId,span]));
    const identities = new Set(trace.map(span => explicit(span.attributes)).filter((value): value is string => !!value));
    for (const span of trace) {
      let owner: string | undefined, ancestor: FileSpan | undefined = span;
      const visited = new Set<string>();
      while (!owner && ancestor && !visited.has(ancestor.spanId)) {
        visited.add(ancestor.spanId); owner = explicit(ancestor.attributes);
        ancestor = ancestor.parentSpanId ? byId.get(ancestor.parentSpanId) : undefined;
      }
      owner ??= identities.size === 1 ? [...identities][0] : `trace:${traceId}`;
      const group=groups.get(owner) ?? []; group.push(span); groups.set(owner,group);
    }
  }
  const parents = new Map<string,Set<string>>(), graph = new Map<string,Set<string>>(), children = new Map<string,Set<string>>(), supporting = new Map<string,Set<string>>();
  for (const [parent, group] of groups) for (const span of group.filter(item => operation(item) === 'execute_tool')) {
    const call = text(span.attributes,'gen_ai.tool.call.id');
    if (call && call !== parent && groups.get(call)?.some(item => operation(item) === 'invoke_agent')) link(parents,call,parent);
  }
  for (const [child,candidates] of parents) if (candidates.size === 1) link(graph,[...candidates][0],child);
  for (const [parent,linked] of graph) for (const child of linked) if (!reachable(graph,child).has(parent)) link(children,parent,child);
  for (const [key,group] of groups) if (!evidence(group)) {
    const candidates = new Set(group.map(span => text(span.attributes,'copilot_chat.parent_chat_session_id')).filter((value): value is string => !!value?.trim()));
    const parent = [...candidates][0];
    if (candidates.size === 1 && parent !== key && groups.has(parent) && evidence(groups.get(parent)!)) link(supporting,parent,key);
  }
  const linked = new Set([...children.values()].flatMap(set => [...set]));
  const roots = [...groups.keys()].filter(key => !linked.has(key) && evidence(groups.get(key)!));
  return {spans,groups,children,supporting,roots,ignoredRecords,duplicateRecords};
}

export function previewCopilotFile(file: ParsedCopilotFile, conversations = new Set<string>(), spanKeys = new Set<string>()): SessionImportPreview {
  const assigned = new Set<string>();
  const startTimes = new Map<string,bigint>();
  const sessions = file.roots.map(conversationId => {
    const group = file.groups.get(conversationId)!, scope = included(file,conversationId), records = selected(file,scope);
    records.forEach(span => assigned.add(span.key));
    const root = group.filter(span => operation(span) === 'invoke_agent').sort((a,b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0)[0] ?? group[0];
    const chats = primary(group), tree = reachable(file.children,conversationId);
    startTimes.set(conversationId,group.reduce((min,item)=>item.start<min ? item.start : min,group[0].start));
    const models = [...new Set(chats.map(span => text(span.attributes,'gen_ai.response.model') ?? text(span.attributes,'gen_ai.request.model')).filter(Boolean))];
    return {conversationId,agentName: text(root.attributes,'gen_ai.agent.name') ?? null,
      repository: text(root.attributes,'github.copilot.git.repository') ?? text(root.attributes,'copilot_chat.repo.remote_url') ?? null,
      model: models.join(', ') || null, startedAt: instant(group.reduce((min,item) => item.start < min ? item.start : min,group[0].start)),
      endedAt: instant(group.reduce((max,item) => item.end > max ? item.end : max,group[0].end)), spans: records.length,turns: chats.length,
      relatedSessions: tree.size-1,relatedTurns: [...tree].filter(key => key !== conversationId).reduce((sum,key) => sum + primary(file.groups.get(key)!).length,0),
      auxiliaryCalls: [...scope].reduce((count,key)=>count+file.groups.get(key)!.filter(span=>auxiliary(span,file.groups.get(key)!)).length,0),
      contentCaptured: captured(records), alreadyImported: [...scope].some(key => conversations.has(key)) || records.some(span => spanKeys.has(span.key))};
  }).sort((a,b) => {
    const left=startTimes.get(a.conversationId)!,right=startTimes.get(b.conversationId)!;
    return left<right ? 1 : left>right ? -1 : a.conversationId<b.conversationId ? -1 : a.conversationId>b.conversationId ? 1 : 0;
  });
  return {sessions,ignoredRecords: file.ignoredRecords,duplicateRecords: file.duplicateRecords,unassignedSpans: file.spans.length-assigned.size};
}

const captured = (spans: FileSpan[]): boolean => spans.some(span => ['gen_ai.input.messages','gen_ai.output.messages','gen_ai.tool.call.arguments'].some(key => Object.hasOwn(span.attributes,key)));
function metric(attrs: JsonObject, key: string): number {
  const raw = attrs[key], value = typeof raw==='bigint' && raw<=BigInt(Number.MAX_SAFE_INTEGER) && raw>=BigInt(Number.MIN_SAFE_INTEGER) ? Number(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(Math.trunc(value)) ? Math.trunc(value) : 0;
}
const cacheWrite = (attrs: JsonObject): number => metric(attrs,Object.hasOwn(attrs,'gen_ai.usage.cache_creation.input_tokens') ? 'gen_ai.usage.cache_creation.input_tokens' : 'gen_ai.usage.cache_write.input_tokens');
function messages(span: SpanRecord, attrs: JsonObject): MessageRecord[] {
  const result: MessageRecord[] = [];
  for (const [key,direction] of [['gen_ai.input.messages','input'],['gen_ai.output.messages','output'],['gen_ai.tool.definitions','definition']]) {
    let value = attrs[key]; if (value == null) continue;
    if (typeof value === 'string') {try {value = parseLosslessJson(value);} catch { /* retain malformed optional content */ }}
    for (const [sequenceNo,item] of (Array.isArray(value) ? value : [value]).entries()) {
      const object = item && typeof item === 'object' && !Array.isArray(item) ? item : undefined;
      const content = object?.['content'] ?? item;
      result.push({id: 0,spanId: span.id,direction,sequenceNo,roleName: object ? text(object,'role') : undefined,
        content: typeof content === 'string' ? content : jsonText(content),sourceKind: direction === 'definition' ? 'explicit' : 'telemetry'});
    }
  }
  return result;
}
function anyValue(value: JsonValue): JsonObject {
  if (value === null) return {};
  if (typeof value === 'string') return {string_value: value};
  if (typeof value === 'boolean') return {bool_value: value};
  if (typeof value === 'bigint') return {int_value: String(value)};
  if (typeof value === 'number') return {double_value: value};
  if (Array.isArray(value)) return {array_value: {values: value.map(anyValue)}};
  return {kvlist_value: {values: attributes(value)}};
}
function attributes(value: JsonObject): JsonValue[] {return Object.entries(value).map(([key,item]) => ({key,value: anyValue(item)}));}
function otlp(span: FileSpan): JsonObject {
  const raw=span.raw;
  const status=raw['status'] && typeof raw['status'] === 'object' && !Array.isArray(raw['status']) ? raw['status'] : {};
  const result: JsonObject = {trace_id: span.traceId,span_id: span.spanId,parent_span_id: span.parentSpanId ?? '',name: raw['name'],
    start_time_unix_nano: String(span.start),end_time_unix_nano: String(span.end),attributes: attributes(span.attributes),
    kind: ['SPAN_KIND_UNSPECIFIED','SPAN_KIND_INTERNAL','SPAN_KIND_SERVER','SPAN_KIND_CLIENT','SPAN_KIND_PRODUCER','SPAN_KIND_CONSUMER'][raw['kind'] === undefined ? 0 : integer(raw['kind'])+1],
    status: {code: ['STATUS_CODE_UNSET','STATUS_CODE_OK','STATUS_CODE_ERROR'][Number(status['code'] ?? 0)],message: text(status,'message') ?? ''},
    events: arrayField(raw,'events').map(item => {
      const event=jsonObject(item); return {name: event['name'],time_unix_nano: event['time'] === undefined ? '0' : String(nanos(event['time'])),attributes: attributes(objectField(event,'attributes')),dropped_attributes_count: event['droppedAttributesCount'] ?? 0};
    }),links: arrayField(raw,'links').map(item => {
      const link=jsonObject(item),context=jsonObject(link['context']); return {trace_id: id(context['traceId'],32),span_id: id(context['spanId'],16),trace_state: text(context,'traceState') ?? '',flags: context['traceFlags'] ?? 0,attributes: attributes(objectField(link,'attributes')),dropped_attributes_count: link['droppedAttributesCount'] ?? 0};
    }),trace_state: text(raw,'traceState') ?? '',flags: raw['traceFlags'] ?? 0,
    dropped_attributes_count: raw['droppedAttributesCount'] ?? 0,dropped_events_count: raw['droppedEventsCount'] ?? 0,dropped_links_count: raw['droppedLinksCount'] ?? 0};
  return {resource: {attributes: attributes(objectField(span.resource,'attributes'))},schema_url: text(span.resource,'schemaUrl') ?? '',scope_spans: [{
    scope: {name: text(span.scope,'name') ?? '',version: text(span.scope,'version') ?? '',attributes: attributes(objectField(span.scope,'attributes'))},
    schema_url: text(span.scope,'schemaUrl') ?? '',spans: [result]}]};
}

export function prepareCopilotImport(file: ParsedCopilotFile, selection: string[], receivedAt: string): PreparedImport {
  if (!selection.length || new Set(selection).size !== selection.length || selection.some(key => !file.roots.includes(key))) throw new ScannerOperationError('invalid-file','Wybierz sesje z listy podglądu importu.');
  const scopes=selection.map(conversationId => ({conversationId,included: [...included(file,conversationId)]}));
  const union=new Set(scopes.flatMap(scope => scope.included));
  let spanId=0,messageId=0,sessionId=0;
  const sessions=[...union].map(conversationId => {
    const group=file.groups.get(conversationId)!, root=group.filter(span => operation(span) === 'invoke_agent').sort((a,b) => a.start < b.start ? -1 : 1)[0] ?? group.reduce((a,b) => a.start < b.start ? a : b);
    const attrs=root.attributes, resource=objectField(root.resource,'attributes');
    const chats=group.filter(span => operation(span) === 'chat');
    const sum=(key: string): number => chats.reduce((total,span) => total+metric(span.attributes,key),0);
    const aggregate=(key: string): number => metric(attrs,key) || sum(key);
    const start=group.reduce((min,item) => item.start < min ? item.start : min,group[0].start), end=group.reduce((max,item) => item.end > max ? item.end : max,group[0].end);
    const normalized: SpanRecord[]=group.map(item => {
      const status=item.raw['status'] && typeof item.raw['status'] === 'object' && !Array.isArray(item.raw['status']) ? item.raw['status'] : {};
      return {id: ++spanId,signalId: sessionId+1,traceId: item.traceId,spanId: item.spanId,parentSpanId: item.parentSpanId,
        spanName: required(item.raw,'name'),operationName: operation(item),startedAt: instant(item.start),endedAt: instant(item.end),durationMs: Number(item.end-item.start)/1000000,
        statusCode: ['STATUS_CODE_UNSET','STATUS_CODE_OK','STATUS_CODE_ERROR'][Number(status['code'] ?? 0)],statusMessage: text(status,'message'),
        model: text(item.attributes,'gen_ai.response.model') ?? text(item.attributes,'gen_ai.request.model'),inputTokens: metric(item.attributes,'gen_ai.usage.input_tokens'),
        outputTokens: metric(item.attributes,'gen_ai.usage.output_tokens'),cacheReadTokens: metric(item.attributes,'gen_ai.usage.cache_read.input_tokens'),cacheCreationTokens: cacheWrite(item.attributes),
        reasoningTokens: Math.max(metric(item.attributes,'gen_ai.usage.reasoning.output_tokens'),metric(item.attributes,'gen_ai.usage.reasoning_tokens')),
        ttftMs: ['number','bigint'].includes(typeof item.attributes['copilot_chat.time_to_first_token']) ? Number(item.attributes['copilot_chat.time_to_first_token']) : undefined,
        attributesJson: jsonText(item.attributes),eventsJson: jsonText(arrayField(item.raw,'events').map(event => {
          const value=jsonObject(event); return {name: value['name'],attributes: objectField(value,'attributes'),...(value['time'] === undefined ? {} : {time: instant(nanos(value['time']))})};
        }))};
    });
    const sourceService=text(resource,'service.name'), sourceName=text(root.scope,'name');
    const session: Session={id: ++sessionId,conversationId,agentName: text(attrs,'gen_ai.agent.name') ?? sourceService,agentType: text(attrs,'github.copilot.agent.type'),
      requestedModel: text(attrs,'gen_ai.request.model'),responseModel: text(attrs,'gen_ai.response.model'),
      repository: text(attrs,'github.copilot.git.repository') ?? text(attrs,'copilot_chat.repo.remote_url'),branchName: text(attrs,'github.copilot.git.branch') ?? text(attrs,'copilot_chat.repo.head_branch_name'),
      sourceKind: sourceService === 'copilot-chat' || sourceName === 'copilot-chat' ? 'vscode' : 'unknown',sourceName,sourceService,sourceVersion: text(resource,'service.version') ?? text(root.scope,'version'),
      startedAt: instant(start),endedAt: instant(end),lastSeenAt: receivedAt,inputTokens: aggregate('gen_ai.usage.input_tokens'),outputTokens: aggregate('gen_ai.usage.output_tokens'),
      cacheReadTokens: aggregate('gen_ai.usage.cache_read.input_tokens'),cacheCreationTokens: cacheWrite(attrs) || chats.reduce((sum,span) => sum+cacheWrite(span.attributes),0),
      reasoningTokens: Math.max(metric(attrs,'gen_ai.usage.reasoning.output_tokens'),metric(attrs,'gen_ai.usage.reasoning_tokens')) || Math.max(sum('gen_ai.usage.reasoning.output_tokens'),sum('gen_ai.usage.reasoning_tokens')),
      turnCount: Math.max(metric(attrs,'copilot_chat.turn_count'),metric(attrs,'github.copilot.turn_count'),chats.length),toolCount: group.filter(span => operation(span)==='execute_tool').length,
      errorCount: normalized.filter(span => span.statusCode==='STATUS_CODE_ERROR' || text(jsonObject(parseLosslessJson(span.attributesJson)),'error.type')).length,contentCaptured: captured(group)};
    const rawJson=jsonText({resource_spans: group.map(otlp),sourceFormat: 'copilot-otel-jsonl',fileRecords: group.map(span => span.raw)});
    return {detail: {session,spans: normalized,messages: normalized.flatMap((span,index) => messages(span,group[index].attributes).map(message => ({...message,id: ++messageId}))),
      signals: [{id: sessionId,signalType: 'traces',receivedAt,rawJson,resourceAttributes: jsonText(group.map(span => objectField(span.resource,'attributes'))),itemCount: group.length}]},
      lines: group.map(span => span.line),spanKeys: group.map(span => span.key)};
  });
  return {parserVersion: FILE_PARSER_VERSION,coreVersion: CORE_VERSION,sessions,scopes};
}
