import {WorkflowAnalysis, WorkflowStream} from '../models/workflow.models';
import {FlowToolCatalog, CatalogUsage, ToolClassificationRequest} from '../models/tool-classification.models';
import {compareText, ordered, parse, record, TelemetryReader} from './workflow/telemetry';
import {SpanRecord} from '../models/scanner.models';
import {capturedMessages, modelResponse} from './model-response';

const definitionsKey = 'gen_ai.tool.definitions';
const argumentLimit = 100;
const promptOverheadCharacters = 6_500;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareText(a, b)).map(([key, child]) => [key, canonical(child)])) : value;

/** Classifies captured M→A requests, including requests without an execution. Outcomes stay local. */
export function flowToolCatalog(analysis: WorkflowAnalysis): FlowToolCatalog {
  const reader = new TelemetryReader();
  const entries = new Map<string, {name: string; definition: Record<string, unknown>}>();
  const usages: (CatalogUsage & {definitionKey?: string; arguments: unknown; argumentsTruncated: boolean})[] = [];
  const contexts: {id: string; agentId: string; goal: string | null; rounds: {id: string; ref: string; order: number; modelOutput: string | null; outputObserved: boolean; invocationIds: string[]}[]}[] = [];
  const agentIds = new Map(analysis.streams.map((stream, index) => [stream.id, `agent-${index + 1}`]));
  const catalogAgents: {streamId: string; id: string}[] = [];
  const catalogRounds: {ref: string; id: string; streamId: string}[] = [];
  let definitionsSeen = 0;
  for (const stream of analysis.streams) {
    const agentId = agentIds.get(stream.id)!;
    const agentContextIds: string[] = [];
    const traceIds = [...new Set(stream.rounds.map(round => round.turn.model.traceId))];
    for (const trace of traceIds) {
      const contextId = `context-${contexts.length + 1}`;
      const rounds = stream.rounds.filter(round => round.turn.model.traceId === trace);
      const root = stream.source.spans.find(span => span.traceId === trace && span.operationName === 'invoke_agent');
      const rawGoal = root && reader.string(root, 'copilot_chat.user_request');
      const delegated = stream.launch ? record(parse(reader.attributes(stream.launch.span)['gen_ai.tool.call.arguments'])) : {};
      const delegatedGoal = delegated['prompt'] ?? delegated['task'] ?? delegated['description'] ?? delegated['query'];
      const inputGoal = root ? stream.source.messages.filter(message => message.spanId === root.id && message.direction === 'input' && message.roleName === 'user')
        .map(message => messageText(parse(message.content))).find(content => !!content.trim() && !content.trim().startsWith('<environment_info>') && !content.trim().startsWith('<context>')) : undefined;
      const rawContextGoal = rawGoal ?? (typeof delegatedGoal === 'string' ? delegatedGoal : inputGoal) ?? null;
      const goal = rawContextGoal == null ? null : compactText(rawContextGoal, 4000);
      const contextRounds: (typeof contexts)[number]['rounds'] = [];
      agentContextIds.push(contextId);
      for (const [roundIndex, round] of rounds.entries()) {
        const roundId = `round-${catalogRounds.length + 1}`;
        const invocationIds: string[] = [];
        catalogRounds.push({ref: round.ref, id: roundId, streamId: stream.id});
        const catalog = definitionsFor(round.turn.model, stream, reader);
        const response = modelResponse(capturedMessages(round.turn.model, stream.source, 'output', reader));
        for (const tool of response.calls) {
          const name = tool.name;
          const matches = [...new Map(catalog.filter(definition => definition['name'] === name)
            .map(definition => [JSON.stringify(canonical(definition)), definition])).entries()];
          const match = matches.length === 1 ? matches[0] : undefined;
          if (match) { entries.set(match[0], {name, definition: match[1]}); definitionsSeen++; }
          const invocationId = `invocation-${usages.length + 1}`;
          invocationIds.push(invocationId);
          const argumentsPreview = compactArguments(tool.arguments);
          usages.push({ref: `${round.ref}/${invocationId}`, roundRef: round.ref, roundId, streamId: stream.id, agentId, contextId, invocationId, callId: tool.id,
            name: name || 'Nazwa niewyemitowana', definitionKey: match?.[0],
            arguments: argumentsPreview, argumentsTruncated: JSON.stringify(argumentsPreview) !== JSON.stringify(tool.arguments)});
        }
        contextRounds.push({id: roundId, ref: round.ref, order: roundIndex + 1, modelOutput: response.text ? compactText(response.text, 1000) : null,
          outputObserved: response.observed, invocationIds});
      }
      contexts.push({id: contextId, agentId, goal, rounds: contextRounds});
    }
    if (agentContextIds.length) catalogAgents.push({streamId: stream.id, id: agentId});
  }
  const tools = [...entries].sort(([a], [b]) => compareText(a, b)).map(([key, value], index) => ({key, id: `tool-${index + 1}`, ...value}));
  const ids = new Map(tools.map(tool => [tool.key, tool.id]));
  for (const usage of usages) usage.toolId = usage.definitionKey ? ids.get(usage.definitionKey) : undefined;
  const usageById = new Map(usages.map(usage => [usage.invocationId, usage]));
  const streamById = new Map(analysis.streams.map(stream => [stream.id, stream]));
  const includedAgentIds = new Set(catalogAgents.map(agent => agent.id));
  const request: ToolClassificationRequest = {
    tools: tools.map(({id, name, definition}) => ({id, name, definition})),
    agents: catalogAgents.map(agent => {
      const parentAgentId = agentIds.get(streamById.get(agent.streamId)?.parentId ?? '');
      return {id: agent.id, parentId: parentAgentId && includedAgentIds.has(parentAgentId) ? parentAgentId : null,
        contextIds: contexts.filter(context => context.agentId === agent.id).map(context => context.id)};
    }),
    contexts: contexts.map(context => ({id: context.id, agentId: context.agentId, goal: context.goal,
      rounds: context.rounds.map(round => ({id: round.id, order: round.order, modelOutput: round.modelOutput,
        outputObserved: round.outputObserved,
        invocations: round.invocationIds.map(id => usageById.get(id)!)
          .map(usage => ({id: usage.invocationId, toolId: usage.toolId ?? null, name: usage.name, arguments: usage.arguments,
            argumentsTruncated: usage.argumentsTruncated}))}))}))
  };
  return {request, key: JSON.stringify(canonical(request)), usages, rounds: catalogRounds, agents: catalogAgents,
    definitionsSeen, missing: usages.filter(usage => !usage.toolId).length};
}

export function compactArguments(value: unknown): unknown {
  if (typeof value === 'string') return value.length <= argumentLimit ? value : `${value.slice(0, 50)}...${value.slice(-47)}`;
  if (Array.isArray(value)) return value.map(compactArguments);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compactArguments(child)]));
  return value ?? null;
}

function compactText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const head = Math.ceil((limit - 3) / 2);
  return `${value.slice(0, head)}...${value.slice(-(limit - 3 - head))}`;
}

export function estimateClassificationTokens(request: ToolClassificationRequest): {input: number; output: number; outputMax: number} {
  const rounds = request.contexts.flatMap(context => context.rounds);
  const invocations = rounds.reduce((total, round) => total + round.invocations.length, 0);
  const records = request.tools.length + invocations + rounds.length;
  const roundedTokens = (characters: number): number => Math.max(100, Math.ceil(characters / 4 / 100) * 100);
  return {
    input: roundedTokens(JSON.stringify(request).length + promptOverheadCharacters),
    output: roundedTokens(160 + request.tools.length * 260 + invocations * 330 + rounds.length * 300),
    outputMax: roundedTokens(160 + request.tools.length * 740 + invocations * 980 + rounds.length * 920 + invocations * 84 + records * 20)
  };
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(messageText).filter(Boolean).join('\n');
  const item = record(value);
  return messageText(item['text'] ?? item['content'] ?? item['parts'] ?? '');
}

function definitionsFor(model: SpanRecord, stream: WorkflowStream, reader: TelemetryReader): Record<string, unknown>[] {
  const fromSpan = (span: SpanRecord): unknown => {
    const attrs = reader.attributes(span);
    if (Object.hasOwn(attrs, definitionsKey)) return parse(attrs[definitionsKey]);
    const messages = stream.source.messages.filter(message => message.spanId === span.id && message.direction === 'definition');
    return messages.length ? messages.flatMap(message => {
      const value = parse(message.content); return Array.isArray(value) ? value : [value];
    }) : undefined;
  };
  let raw = fromSpan(model);
  if (raw === undefined) {
    const previous = stream.source.spans.filter(span => span.traceId === model.traceId &&
      Date.parse(span.startedAt ?? '') <= Date.parse(model.startedAt ?? '') && fromSpan(span) !== undefined).sort(ordered).at(-1);
    if (previous) raw = fromSpan(previous);
  }
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(value => {
    const outer = record(value), inner = record(outer['function']);
    return record(canonical(typeof inner['name'] === 'string' ? inner : outer));
  }).filter(definition => typeof definition['name'] === 'string' && !!definition['name']);
}
