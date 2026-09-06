import {Injectable} from '@angular/core';
import {SessionDetail} from '../models/scanner.models';
import {LinkIssue, WorkflowAnalysis, WorkflowStream} from '../models/workflow.models';
import {classifyRounds} from './workflow/phases';
import {observeRounds} from './workflow/observations';
import {contentQualifiers} from './workflow/content-qualifiers';
import {creditRates, creditSummary, recommendations, sessionProfiles, subagentProfiles} from './workflow/profiles';
import {compareText, ordered, parse, record, spanRef, TelemetryReader} from './workflow/telemetry';
import {sessionEpisodes} from './session-episodes';

@Injectable({providedIn: 'root'})
export class WorkflowAnalysisService {
  private readonly reader = new TelemetryReader();

  async analyze(source: SessionDetail, related: SessionDetail[]): Promise<WorkflowAnalysis> {
    const sources = [source, ...related.filter(item => item.session.id !== source.session.id)].sort((a, b) => a.session.id - b.session.id);
    const ambiguousTools = new Set<string>();
    const rawGroups = sessionEpisodes(source, related, this.reader).map((episode, index) => {
      const detail = episode.source;
      const stream: WorkflowStream = {id: episode.id, sessionId: detail.session.id, source: detail,
        label: index === 0 ? 'Główny agent' : detail.session.agentName || 'Subagent', depth: 0,
        rounds: [], segments: [], profiles: [], rates: [], credits: {known: null, covered: 0, total: 0},
        subtreeCredits: {known: null, covered: 0, total: 0}};
      return {stream, spans: detail.spans, identity: episode.identity};
    });
    const truncatedSources = new Set(rawGroups.filter(group => group.stream.source.signals.some(signal => hasDropped(parse(signal.rawJson)))).map(group => group.stream.id));
    for (const group of rawGroups) {
      group.stream.rounds = await observeRounds(group.stream.id, group.stream.source, group.spans, this.reader, ambiguousTools, truncatedSources.has(group.stream.id));
      group.stream.credits = creditSummary(group.stream.rounds);
    }
    const root = rawGroups[0];
    const rawIndex = new Map<string, typeof rawGroups>();
    for (const group of rawGroups) {
      if (!group.identity || !group.spans.some(span => this.reader.string(span, 'gen_ai.conversation.id') === group.identity ||
        this.reader.string(span, 'copilot_chat.chat_session_id') === group.identity)) continue;
      const candidates = rawIndex.get(group.identity) ?? []; candidates.push(group); rawIndex.set(group.identity, candidates);
    }
    const issues: LinkIssue[] = [];
    const edges: {parent: WorkflowStream; child: WorkflowStream; roundRef: string; tool: NonNullable<WorkflowStream['launch']>}[] = [];
    for (const group of rawGroups) for (const round of group.stream.rounds) for (const tool of round.tools) {
      if (!tool.callId) continue;
      const candidates = rawIndex.get(tool.callId) ?? [];
      if (candidates.length > 1) issues.push({state: 'ambiguous', refs: [round.ref, spanRef(tool.span)], candidateIds: candidates.map(item => item.stream.id)});
      else if (candidates.length === 1) edges.push({parent: group.stream, child: candidates[0].stream, roundRef: round.ref, tool});
      else {
        const hints = rawGroups.filter(candidate => candidate.stream.source.session.conversationId === tool.callId);
        if (hints.length) issues.push({state: 'unlinked', refs: [round.ref, spanRef(tool.span)], candidateIds: hints.map(candidate => candidate.stream.id)});
      }
    }
    // A child with multiple launches is ambiguous, independent of iteration order.
    const colliding = new Set(edges.filter(edge => edges.filter(other => other.child.id === edge.child.id).length > 1).map(edge => edge.child.id));
    for (const id of [...colliding].sort(compareText)) issues.push({state: 'ambiguous', refs: edges.filter(edge => edge.child.id === id).map(edge => spanRef(edge.tool.span)), candidateIds: [id]});
    const streams: WorkflowStream[] = [], visited = new Set<string>();
    const visit = (stream: WorkflowStream, ancestors: Set<string>): void => {
      visited.add(stream.id); streams.push(stream);
      for (const edge of edges.filter(edge => edge.parent.id === stream.id && !colliding.has(edge.child.id)).sort((a, b) => ordered(a.tool.span, b.tool.span) || compareText(a.child.id, b.child.id))) {
        if (ancestors.has(edge.child.id) || edge.child.id === stream.id) {
          issues.push({state: 'invalidCycle', refs: [edge.roundRef, spanRef(edge.tool.span)], candidateIds: [edge.child.id]}); continue;
        }
        if (visited.has(edge.child.id)) continue;
        edge.child.parentId = stream.id; edge.child.depth = stream.depth + 1; edge.child.launch = edge.tool; edge.child.launchRoundRef = edge.roundRef;
        stream.rounds.find(round => round.ref === edge.roundRef)?.markers.push('DELEGATION');
        visit(edge.child, new Set([...ancestors, stream.id]));
      }
    };
    visit(root.stream, new Set());
    const rootTraceIds = new Set(root.stream.rounds.map(round => round.turn.model.traceId));
    for (const group of rawGroups.filter(group => !visited.has(group.stream.id))) {
      const candidate = group.spans.some(span => rootTraceIds.has(span.traceId)) ||
        edges.some(edge => visited.has(edge.parent.id) && edge.child.id === group.stream.id);
      if (candidate && group.stream.rounds.length) issues.push({state: 'unlinked', refs: group.stream.rounds.map(round => round.ref), candidateIds: [group.stream.id]});
    }
    const relevantRefs = new Set(streams.flatMap(stream => stream.source.spans.map(spanRef)));
    const relevantIssues = issues.filter(issue => issue.refs.some(ref => relevantRefs.has(ref)) ||
      issue.candidateIds.some(id => rawGroups.find(group => group.stream.id === id)?.spans.some(span => rootTraceIds.has(span.traceId))));
    const truncated = streams.some(stream => truncatedSources.has(stream.id));
    // Unrelated sessions do not lower the selected tree's completeness.
    const linkCoverage = !truncated && !relevantIssues.length && streams.every(stream => stream.rounds.every(round =>
      this.reader.string(round.turn.model, 'gen_ai.conversation.id') && round.tools.every(tool => !!tool.callId)));
    for (const stream of streams) {
      stream.segments = classifyRounds(stream.rounds);
      await contentQualifiers(stream.rounds, this.reader, truncatedSources.has(stream.id));
    }
    for (const stream of [...streams].reverse()) {
      const subtreeIds = new Set([stream.id]);
      for (const child of streams) if (child.parentId && subtreeIds.has(child.parentId)) subtreeIds.add(child.id);
      stream.subtreeCredits = creditSummary(streams.filter(child => subtreeIds.has(child.id)).flatMap(child => child.rounds));
      stream.profiles = subagentProfiles(stream, streams, linkCoverage);
      stream.rates = creditRates(stream, streams.find(parent => parent.id === stream.parentId));
    }
    return {source, classifierVersion: 'workflow-mvp-0.2', componentVersions: {episodes: 'copilot-episode-v1',
      phases: 'phase-rules-v1', order: 'round-order-v1', sequences: 'sequence-scope-v1', context: 'context-bands-v1',
      segmentation: 'phase-segmentation-v1', subagents: 'subagent-profile-rules-v1', content: 'content-bytes-v1', hash: 'SHA-256',
      credits: 'weighted-credits-v1', confidence: 'confidence-v1', recommendations: 'recommendation-rules-v1'
    }, cutoffSignalId: sources.reduce((cutoff, detail) => Math.max(cutoff,
      detail.signals.reduce((max, signal) => Math.max(max, signal.id), 0),
      detail.spans.reduce((max, span) => Math.max(max, span.signalId), 0)), 0),
      streams, linkIssues: relevantIssues, linkCoverage, treeCredits: creditSummary(streams.flatMap(stream => stream.rounds)),
      profiles: sessionProfiles(streams, linkCoverage), recommendations: recommendations(streams), upstreamCompleteness: truncated ? 'truncated' : 'unverified'};
  }
}

function hasDropped(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDropped);
  const object = record(value);
  return Object.entries(object).some(([key, item]) => /^dropped.*(?:Count|_count)$/.test(key) && Number(item) > 0 || typeof item === 'object' && item !== null && hasDropped(item));
}
