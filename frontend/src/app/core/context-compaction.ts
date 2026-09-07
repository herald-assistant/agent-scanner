import {ContextCompactionMeasurement, MessageRecord, ModelTurn, SessionDetail, SpanRecord} from '../models/scanner.models';
import {capturedMessages, modelResponse} from './model-response';
import {isContextCompactionAgentName} from './auxiliary-model-calls';
import {known, parse, record, TelemetryReader, time} from './workflow/telemetry';

const receiptMatchThreshold = .8;

export interface ContextCompactionTextBlock {
  id: string;
  content: string;
}

export interface ContextCompactionMessageView {
  id: string;
  sequenceNo: number;
  role: string;
  content: string;
  characters: number;
  preview: string;
}

export interface ContextCompactionToolView {
  id: string;
  sequenceNo: number;
  name: string;
  content: string;
  characters: number;
}

export interface ContextCompactionContent {
  taskInstruction?: string;
  userInstruction?: string;
  systemInstructions: ContextCompactionTextBlock[];
  messages: ContextCompactionMessageView[];
  tools: ContextCompactionToolView[];
  toolChoice?: string;
  result: string;
  rawResult: string;
  resultIsSummary: boolean;
}

/**
 * Finds actual compaction model calls associated with the selected conversation.
 * A later summary-shaped request is evidence that a result was consumed, never the
 * identity of the compaction itself.
 */
export function findContextCompactions(
  primary: SessionDetail,
  candidateSources: SessionDetail[],
  turns: ModelTurn[],
  reader = new TelemetryReader()
): ContextCompactionMeasurement[] {
  const conversationIds = primaryConversationIds(primary, reader);
  const sources = [...new Map(candidateSources.map(source => [source.session.id, source])).values()];
  const orderedTurns = [...turns].sort((left, right) => time(left.model.startedAt) - time(right.model.startedAt));

  return sources.flatMap(detail => detail.spans
    .filter(span => span.operationName === 'chat' && isContextCompactionAgentName(reader.string(span, 'gen_ai.agent.name')))
    .flatMap(span => {
      const content = buildContextCompactionContent(detail, span.id, reader);
      const receipt = findResultReceipt(content.result, span, primary, orderedTurns);
      const exactConversationId = compactionConversationIds(detail, span, reader)
        .some(value => conversationIds.has(value)) || inputContainsConversationId(detail, span, conversationIds, reader);
      const sameEmitterSession = resourceSessionId(detail, span) != null &&
        resourceSessionId(detail, span) === (receipt ? resourceSessionId(primary, receipt.model) : undefined);
      if (!exactConversationId && !(receipt && sameEmitterSession)) return [];

      const endedAt = time(span.endedAt || span.startedAt);
      const placement = orderedTurns.find(turn => time(turn.model.startedAt) >= endedAt);
      const receiptIndex = receipt ? orderedTurns.indexOf(receipt) : -1;
      const previous = receiptIndex > 0 ? orderedTurns[receiptIndex - 1] : undefined;
      const beforeInput = previous ? known(reader.metric(previous.model, 'gen_ai.usage.input_tokens')) : undefined;
      const afterInput = receipt ? known(reader.metric(receipt.model, 'gen_ai.usage.input_tokens')) : undefined;
      const inputTokens = known(reader.metric(span, 'gen_ai.usage.input_tokens'));
      const cacheReadTokens = known(reader.metric(span, 'gen_ai.usage.cache_read.input_tokens'));
      const emittedReasoning = [
        known(reader.metric(span, 'gen_ai.usage.reasoning.output_tokens')),
        known(reader.metric(span, 'gen_ai.usage.reasoning_tokens'))
      ].filter((value): value is number => value != null);
      const nanoAiu = known(reader.metric(span, 'copilot_chat.copilot_usage_nano_aiu'));
      return [{
        id: `${detail.session.id}/${span.id}`,
        sessionId: detail.session.id,
        spanId: span.id,
        agentName: reader.string(span, 'gen_ai.agent.name')!,
        model: span.model,
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        durationMs: span.durationMs,
        inputTokens,
        freshInputTokens: inputTokens != null && cacheReadTokens != null ? Math.max(0, inputTokens - cacheReadTokens) : undefined,
        cacheReadTokens,
        cacheWriteTokens: known(reader.metric(span, 'gen_ai.usage.cache_creation.input_tokens')),
        outputTokens: known(reader.metric(span, 'gen_ai.usage.output_tokens')),
        reasoningTokens: emittedReasoning.length ? Math.max(...emittedReasoning) : undefined,
        credits: nanoAiu == null ? undefined : nanoAiu / 1_000_000_000,
        resultCharacters: content.result.trim().length,
        placementBeforeModelId: placement?.model.id,
        resultObservedInModelId: receipt?.model.id,
        beforeInteractionIndex: previous?.interactionIndex,
        afterInteractionIndex: receipt?.interactionIndex,
        observedAt: receipt?.model.startedAt,
        beforeInputTokens: beforeInput,
        afterInputTokens: afterInput,
        beforeOccupancy: previous ? occupancy(previous.model, beforeInput, reader) : undefined,
        afterOccupancy: receipt ? occupancy(receipt.model, afterInput, reader) : undefined
      }];
    }))
    .sort((left, right) => time(left.startedAt) - time(right.startedAt));
}

export function buildContextCompactionContent(
  detail: SessionDetail,
  spanId: number,
  reader = new TelemetryReader()
): ContextCompactionContent {
  const span = detail.spans.find(item => item.id === spanId);
  if (!span) return {systemInstructions: [], messages: [], tools: [], result: '', rawResult: '', resultIsSummary: false};

  const systemInstructions = textBlocks(reader.attributes(span)['gen_ai.system_instructions']);
  const inputRecords = detail.messages.filter(message => message.spanId === span.id && message.direction === 'input')
    .sort((left, right) => left.sequenceNo - right.sequenceNo);
  const messages = inputRecords.map(messageView);
  const tools = detail.messages.filter(message => message.spanId === span.id && message.direction === 'definition')
    .sort((left, right) => left.sequenceNo - right.sequenceNo).map(toolView);
  const inputValues = capturedMessages(span, detail, 'input', reader);
  if (!messages.length) inputValues.forEach((value, index) => messages.push(messageView({
    id: -(index + 1), spanId: span.id, direction: 'input', sequenceNo: index,
    roleName: nestedString(value, 'role'), content: serialize(value), sourceKind: 'attribute'
  })));

  const rawResult = modelResponse(capturedMessages(span, detail, 'output', reader)).text.trim();
  const extractedSummary = extractElement(rawResult, 'summary')?.trim();
  const messageUserInstruction = inputValues.flatMap(structuralStrings)
    .map(value => extractElement(value, 'userRequest')?.trim()).find((value): value is string => Boolean(value));
  const systemUserInstruction = systemInstructions.map(block => additionalUserInstruction(block.content))
    .find((value): value is string => Boolean(value));
  return {
    taskInstruction: instructionText(reader.string(span, 'copilot_chat.user_request')),
    userInstruction: systemUserInstruction ?? messageUserInstruction,
    systemInstructions,
    messages,
    tools,
    toolChoice: nestedString(parse(reader.attributes(span)['copilot_chat.request.options']), 'tool_choice'),
    result: extractedSummary ?? rawResult,
    rawResult,
    resultIsSummary: extractedSummary != null
  };
}

function primaryConversationIds(primary: SessionDetail, reader: TelemetryReader): Set<string> {
  const ids = new Set<string>();
  addId(ids, primary.session.conversationId);
  for (const span of primary.spans) {
    for (const key of ['gen_ai.conversation.id', 'copilot_chat.chat_session_id', 'copilot_chat.parent_chat_session_id'])
      addId(ids, reader.string(span, key));
  }
  return ids;
}

function compactionConversationIds(detail: SessionDetail, span: SpanRecord, reader: TelemetryReader): string[] {
  return [detail.session.conversationId, ...['gen_ai.conversation.id', 'copilot_chat.chat_session_id', 'copilot_chat.parent_chat_session_id']
    .map(key => reader.string(span, key))].filter((value): value is string => Boolean(value));
}

function addId(ids: Set<string>, value?: string): void {
  if (value?.trim() && !value.startsWith('trace:') && !value.startsWith('call_')) ids.add(value.trim());
}

function inputContainsConversationId(
  detail: SessionDetail,
  span: SpanRecord,
  conversationIds: Set<string>,
  reader: TelemetryReader
): boolean {
  if (!conversationIds.size) return false;
  return capturedMessages(span, detail, 'input', reader).flatMap(structuralStrings)
    .some(value => [...conversationIds].some(id => value.includes(id)));
}

function findResultReceipt(result: string, compaction: SpanRecord, primary: SessionDetail, turns: ModelTurn[]): ModelTurn | undefined {
  if (!result.trim()) return undefined;
  const endedAt = time(compaction.endedAt || compaction.startedAt);
  return turns.filter(turn => time(turn.model.startedAt) >= endedAt).find(turn => primary.messages
    .filter(message => message.spanId === turn.model.id && message.direction === 'input')
    .flatMap(message => structuralStrings(parse(message.content)))
    .some(value => lineCoverage(result, value) >= receiptMatchThreshold));
}

function occupancy(span: SpanRecord, input: number | undefined, reader: TelemetryReader): number | undefined {
  const prompt = known(reader.metric(span, 'copilot_chat.request.max_prompt_tokens'));
  const output = known(reader.metric(span, 'gen_ai.request.max_tokens'));
  return input != null && prompt != null && output != null && prompt + output > 0 ? input / (prompt + output) : undefined;
}

function messageView(message: MessageRecord): ContextCompactionMessageView {
  const parsed = parse(message.content);
  const callName = nestedString(parsed, 'name') || nestedString(parsed, 'tool_name');
  const values = [...(callName ? [`Narzędzie: ${callName}`] : []), ...structuralStrings(parsed)]
    .map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const preview = values.join(' ').slice(0, 220);
  return {
    id: String(message.id), sequenceNo: message.sequenceNo, role: message.roleName || nestedString(parse(message.content), 'role') || 'input',
    content: message.content, characters: message.content.length, preview: preview || 'Treść bez podglądu tekstowego'
  };
}

function toolView(message: MessageRecord): ContextCompactionToolView {
  const value = parse(message.content);
  return {
    id: String(message.id), sequenceNo: message.sequenceNo,
    name: nestedString(value, 'name') || nestedString(value, 'tool_name') || `tool ${message.sequenceNo + 1}`,
    content: message.content, characters: message.content.length
  };
}

function textBlocks(value: unknown): ContextCompactionTextBlock[] {
  const parsed = parse(value);
  if (typeof parsed === 'string') return parsed.trim() ? [{id: 'system-0', content: parsed}] : [];
  const blocks: string[] = [];
  const visit = (item: unknown, depth = 0): void => {
    if (depth > 20) return;
    if (typeof item === 'string') { if (item.trim()) blocks.push(item); return; }
    if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1)); return; }
    const object = record(item);
    for (const key of ['content', 'text', 'value']) if (object[key] != null) visit(object[key], depth + 1);
  };
  visit(parsed);
  return [...new Set(blocks)].map((content, index) => ({id: `system-${index}`, content}));
}

function structuralStrings(value: unknown, depth = 0): string[] {
  if (depth > 30) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(item => structuralStrings(item, depth + 1));
  const item = record(value);
  return ['parts', 'output', 'content', 'text', 'messages', 'response', 'result', 'arguments', 'input']
    .flatMap(key => item[key] == null ? [] : structuralStrings(item[key], depth + 1));
}

function instructionText(value?: string): string | undefined {
  if (!value) return undefined;
  const parts = structuralStrings(parse(value)).map(part => part.trim()).filter(Boolean);
  return parts.length ? parts.join('\n') : value;
}

function extractElement(value: string, element: 'summary' | 'userRequest'): string | undefined {
  const expression = element === 'summary'
    ? /<summary>\s*([\s\S]*?)\s*<\/summary>/i
    : /<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/i;
  return value.match(expression)?.[1];
}

function additionalUserInstruction(value: string): string | undefined {
  const marker = value.match(/additional instructions from the user\s*:\s*/i);
  if (marker?.index == null) return undefined;
  const remainder = value.slice(marker.index + marker[0].length).trim();
  const nextHeading = remainder.search(/\r?\n#{1,6}\s+/);
  const instruction = (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();
  return instruction || undefined;
}

function nestedString(value: unknown, key: string, depth = 0): string | undefined {
  if (depth > 20 || value == null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = nestedString(child, key, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const item = record(value);
  if (typeof item[key] === 'string' && item[key]) return item[key];
  for (const child of Object.values(item)) {
    const found = nestedString(child, key, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function resourceSessionId(detail: SessionDetail, span: SpanRecord): string | undefined {
  const signal = detail.signals.find(item => item.id === span.signalId);
  return signal ? nestedString(parse(signal.resourceAttributes), 'session.id') : undefined;
}

function lineCoverage(left: string, right: string): number {
  const normalize = (value: string) => value.replace(/\r\n/g, '\n').split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const leftLines = new Set(normalize(left)), rightLines = new Set(normalize(right));
  if (!leftLines.size || !rightLines.size) return 0;
  const compactLeft = [...leftLines].join('\n'), compactRight = [...rightLines].join('\n');
  if (compactRight.includes(compactLeft)) return 1;
  if (leftLines.size < 4) return compactLeft === compactRight ? 1 : 0;
  return [...leftLines].filter(line => rightLines.has(line)).length / leftLines.size;
}

function serialize(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
