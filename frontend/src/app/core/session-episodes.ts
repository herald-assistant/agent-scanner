import {SessionDetail, SpanRecord} from '../models/scanner.models';
import {compareText, ordered, spanRef, TelemetryReader} from './workflow/telemetry';

export interface SessionEpisode {
  id: string;
  identity?: string;
  source: SessionDetail;
}

/** Only unique, raw-evidence-backed launches participate in totals and detail views. */
export function episodeLaunches(episodes: SessionEpisode[], reader = new TelemetryReader()): Map<SpanRecord, SessionEpisode> {
  const candidates = episodes.filter(episode => episode.identity && episode.source.spans.some(span =>
    reader.string(span, 'gen_ai.conversation.id') === episode.identity || reader.string(span, 'copilot_chat.chat_session_id') === episode.identity));
  const edges = episodes.flatMap(episode => episode.source.spans.filter(span => span.operationName === 'execute_tool').flatMap(tool => {
    const callId = reader.string(tool, 'gen_ai.tool.call.id');
    const children = candidates.filter(child => child.identity === callId);
    const start = Date.parse(tool.startedAt ?? '');
    const previous = episode.source.spans.filter(span => span.operationName === 'chat' && span.traceId === tool.traceId &&
      Date.parse(span.startedAt ?? '') <= start).sort(ordered).at(-1);
    return children.length === 1 && previous && Date.parse(previous.endedAt || previous.startedAt || '') <= start
      ? [{tool, child: children[0]}] : [];
  }));
  return new Map(edges.filter(edge => edges.filter(other => other.child.id === edge.child.id).length === 1)
    .map(edge => [edge.tool, edge.child]));
}

/** Reconstruct ownership from spans, never from the historical batch/session partition. */
export function sessionEpisodes(source: SessionDetail, related: SessionDetail[], reader = new TelemetryReader()): SessionEpisode[] {
  const sources = [source, ...related.filter(item => item.session.id !== source.session.id)];
  const entries = sources.flatMap(detail => detail.spans.map(span => ({detail, span}))).sort((a, b) =>
    b.span.signalId - a.span.signalId || a.detail.session.id - b.detail.session.id || ordered(a.span, b.span));
  const unique = new Map<string, typeof entries[number]>();
  for (const entry of entries) if (!unique.has(spanRef(entry.span))) unique.set(spanRef(entry.span), entry);
  const spans = [...unique.values()].map(entry => entry.span).sort(ordered);
  const byRef = new Map(spans.map(span => [spanRef(span), span]));
  const parent = (span: SpanRecord) => byRef.get(`${span.traceId}/${span.parentSpanId}`);
  const str = (span: SpanRecord, key: string) => reader.string(span, key);
  const conversation = (span: SpanRecord) => str(span, 'gen_ai.conversation.id');
  const callIds = new Set(spans.filter(span => span.operationName === 'execute_tool').map(span => str(span, 'gen_ai.tool.call.id')).filter(Boolean));
  const roots = new Map<string, SpanRecord | undefined>();
  for (const span of spans) {
    let current: SpanRecord | undefined = span;
    const visited = new Set<string>();
    while (current && current.operationName !== 'invoke_agent' && !visited.has(spanRef(current))) {
      visited.add(spanRef(current)); current = parent(current);
    }
    roots.set(spanRef(span), current?.operationName === 'invoke_agent' ? current : undefined);
  }
  const primaryId = `conversation:${source.session.conversationId}`;
  const rootIdentities = new Map<string, {id: string; identity?: string}>();
  for (const root of spans.filter(span => span.operationName === 'invoke_agent')) {
    const launch = parent(root), raw = conversation(root);
    const callId = launch?.operationName === 'execute_tool' ? str(launch, 'gen_ai.tool.call.id') : undefined;
    const chatId = str(root, 'copilot_chat.chat_session_id'), parentChatId = str(root, 'copilot_chat.parent_chat_session_id');
    // Copilot may retain the parent's conversation ID in child chat/invoke spans.
    // Require both the structural launch and the exact, explicitly emitted chat IDs.
    const mixedIdentity = callId && chatId === callId && parentChatId && launch &&
      (parentChatId === str(launch, 'copilot_chat.chat_session_id') || parentChatId === conversation(launch)) ? callId : undefined;
    const childChatIds = [...new Set(spans.filter(span => span.operationName === 'chat' && roots.get(spanRef(span)) === root)
      .map(conversation).filter((id): id is string => !!id))];
    const detachedIdentity = !launch && childChatIds.length === 1 && callIds.has(childChatIds[0]) ? childChatIds[0] : undefined;
    const identity = mixedIdentity ?? detachedIdentity ?? raw ?? (unique.get(spanRef(root))?.detail === source ? source.session.conversationId : undefined);
    const main = identity === source.session.conversationId && !launch && !detachedIdentity;
    rootIdentities.set(spanRef(root), {id: main ? primaryId : `agent:${spanRef(root)}`,
      // A nested root repeating its parent's ID must not pollute the parent stream or its ID index.
      identity: launch && identity === conversation(launch) && callId !== identity ? undefined : identity});
  }
  const grouped = new Map<string, {identity?: string; spans: SpanRecord[]}>();
  grouped.set(primaryId, {identity: source.session.conversationId, spans: []});
  for (const span of spans) {
    const raw = conversation(span), root = roots.get(spanRef(span));
    let group = root && rootIdentities.get(spanRef(root));
    // Direct raw child IDs can also identify a separate stream without an invoke span.
    if (!group || (span.operationName === 'chat' && raw && raw !== group.identity && raw !== (root && conversation(root)))) {
      const origin = unique.get(spanRef(span))!.detail;
      const identity = raw ?? (origin === source ? source.session.conversationId : undefined);
      group = {id: identity === source.session.conversationId ? primaryId : `trace:${span.traceId}:conversation:${identity ?? origin.session.id}`, identity};
    }
    const bucket = grouped.get(group.id) ?? {identity: group.identity, spans: []};
    bucket.spans.push(span); grouped.set(group.id, bucket);
  }
  // Unparented spans with a known raw ID join the uniquely identified episode in their trace.
  for (const [id, bucket] of [...grouped]) {
    if (!id.startsWith('trace:') || !bucket.identity) continue;
    const matches = [...grouped].filter(([key, other]) => key.startsWith('agent:') && other.identity === bucket.identity &&
      other.spans.some(span => span.traceId === bucket.spans[0]?.traceId));
    if (matches.length === 1) { matches[0][1].spans.push(...bucket.spans); grouped.delete(id); }
  }
  return [...grouped].sort(([a], [b]) => Number(b === primaryId) - Number(a === primaryId) || compareText(a, b)).map(([id, group]) => {
    const members = group.spans.sort(ordered), databaseIds = new Set(members.map(span => span.id));
    const origin = id === primaryId ? source : sources.find(detail => detail.session.conversationId === group.identity) ??
      unique.get(members[0] && spanRef(members[0]))?.detail ?? source;
    const root = members.find(span => span.operationName === 'invoke_agent');
    const representative = root ?? members.find(span => span.operationName === 'chat');
    const signalIds = new Set(members.map(span => span.signalId));
    return {id, identity: group.identity, source: {
      session: {...origin.session, conversationId: group.identity ?? origin.session.conversationId,
        agentName: representative && str(representative, 'gen_ai.agent.name') || origin.session.agentName},
      spans: members,
      messages: [...new Map(sources.flatMap(detail => detail.messages).filter(message => databaseIds.has(message.spanId)).map(message => [message.id, message])).values()],
      signals: [...new Map(sources.flatMap(detail => detail.signals).filter(signal => signalIds.has(signal.id)).map(signal => [signal.id, signal])).values()]
    }};
  });
}
