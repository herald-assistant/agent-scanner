import {RelatedModelCall, SessionDetail, SpanRecord} from '../app/models/scanner.models';
import {capturedMessages, modelResponse} from './model-response';
import {TelemetryReader} from './workflow/telemetry';

const technicalAgentTitles: Readonly<Record<string, string>> = {
  title: 'Generowanie tytułu',
  progressmessages: 'Komunikaty postępu',
  'copilot-chat': 'Techniczny wrapper Copilota',
  backgroundtodoagent: 'Aktualizacja planu w tle',
  copilotlanguagemodelwrapper: 'Pomocnicze przetwarzanie treści',
  healapplypatch: 'Naprawa formatu zmiany',
  executionsubagenttool: 'Subagent wykonawczy',
  'summarizeconversationhistory-full': 'Kompaktowanie kontekstu'
};

export function isContextCompactionAgentName(name?: string): boolean {
  return name?.toLowerCase() === 'summarizeconversationhistory-full';
}

export function isExecutionSubagentAgentName(name?: string): boolean {
  return name?.toLowerCase() === 'executionsubagenttool';
}

export function isAuxiliaryAgentName(name?: string): boolean {
  return !!name && Object.hasOwn(technicalAgentTitles, name.toLowerCase());
}

export function auxiliaryAgentTitle(name?: string): string {
  return technicalAgentTitles[(name ?? '').toLowerCase()] ?? name ?? 'Sesja agenta';
}

/**
 * Copilot can emit a technical model call with the same conversation and trace IDs as the main agent.
 * Keep it outside the primary loop. Tool executions are removed only when captured model responses
 * prove that their name/ID belongs exclusively to the technical call.
 */
export function separateInlineAuxiliaryCalls(
  source: SessionDetail,
  reader = new TelemetryReader(),
  preservedModelSpanIds: ReadonlySet<number> = new Set()
): {
  primary: SessionDetail;
  auxiliary: RelatedModelCall[];
} {
  const chats = source.spans.filter(span => span.operationName === 'chat');
  const auxiliarySpans = chats.filter(span =>
    !preservedModelSpanIds.has(span.id) && isAuxiliaryAgentName(reader.string(span, 'gen_ai.agent.name')));
  if (!auxiliarySpans.length) return {primary: source, auxiliary: []};

  const auxiliaryIds = new Set(auxiliarySpans.map(span => span.id));
  const primaryChats = chats.filter(span => !auxiliaryIds.has(span.id));
  const auxiliaryResponses = auxiliarySpans.map(span => modelResponse(capturedMessages(span, source, 'output', reader)));
  const primaryResponses = primaryChats.map(span => modelResponse(capturedMessages(span, source, 'output', reader)));
  const auxiliaryCallIds = new Set(auxiliaryResponses.flatMap(response => response.calls.map(call => call.id).filter((id): id is string => !!id)));
  const primaryCallIds = new Set(primaryResponses.flatMap(response => response.calls.map(call => call.id).filter((id): id is string => !!id)));
  const auxiliaryNames = new Set(auxiliaryResponses.flatMap(response => response.calls.map(call => call.name)));
  const primaryNames = new Set(primaryResponses.flatMap(response => response.calls.map(call => call.name)));
  const primaryOutputCovered = primaryResponses.every(response => response.observed);

  const auxiliaryToolIds = new Set(source.spans.filter(span => {
    if (span.operationName !== 'execute_tool') return false;
    const callId = reader.string(span, 'gen_ai.tool.call.id');
    if (callId) return auxiliaryCallIds.has(callId) && !primaryCallIds.has(callId);
    const name = reader.string(span, 'gen_ai.tool.name');
    return primaryOutputCovered && !!name && auxiliaryNames.has(name) && !primaryNames.has(name);
  }).map(span => span.id));
  const excludedSpanIds = new Set([...auxiliaryIds, ...auxiliaryToolIds]);

  return {
    primary: {
      ...source,
      spans: source.spans.filter(span => !excludedSpanIds.has(span.id)),
      messages: source.messages.filter(message => !auxiliaryIds.has(message.spanId))
    },
    auxiliary: auxiliarySpans.map(span => ({span, label: auxiliaryAgentTitle(reader.string(span, 'gen_ai.agent.name'))}))
  };
}
