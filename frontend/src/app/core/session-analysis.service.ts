import {Injectable} from '@angular/core';
import {RelatedModelCall, Session, SessionDetail, SessionView, SpanRecord, UserInteraction, ModelTurn} from '../models/scanner.models';
import {WorkflowAnalysisService} from './workflow-analysis.service';
import {WorkflowAnalysis} from '../models/workflow.models';
import {episodeLaunches, sessionEpisodes} from './session-episodes';
import {TelemetryReader} from './workflow/telemetry';

@Injectable({providedIn: 'root'})
export class SessionAnalysisService {
  private readonly workflow = new WorkflowAnalysisService();
  private cachedView?: SessionView;
  private readonly attributeCache = new WeakMap<SpanRecord, Record<string, unknown>>();

  buildWorkflow(source: SessionDetail, related: SessionDetail[]): Promise<WorkflowAnalysis> {
    return this.workflow.analyze(source, related);
  }

  build(source: SessionDetail | undefined, relatedSource: SessionDetail[]): SessionView | undefined {
    if (!source) return undefined;
    if (this.cachedView?.source === source && this.cachedView.relatedSource === relatedSource) return this.cachedView;

    const episodes = sessionEpisodes(source, relatedSource);
    const own = episodes[0].source;
    const tools = own.spans
      .filter(span => span.operationName === 'execute_tool' || span.operationName === 'execute_hook')
      .sort((a, b) => this.timestamp(a.startedAt) - this.timestamp(b.startedAt));
    const primaryModelSpans = own.spans.filter(span => span.operationName === 'chat')
      .sort((a, b) => this.timestamp(a.startedAt) - this.timestamp(b.startedAt));
    const executedTools = tools.filter(span => span.operationName === 'execute_tool');
    const primaryTraceIds = new Set(primaryModelSpans.map(span => span.traceId));
    const interactionRoots = own.spans
      .filter(span => span.operationName === 'invoke_agent' && primaryTraceIds.has(span.traceId))
      .sort((a, b) => this.timestamp(a.startedAt) - this.timestamp(b.startedAt));
    const rootByTrace = new Map(interactionRoots.map(root => [root.traceId, root]));
    const interactionTraceIds = [...new Set(primaryModelSpans.map(span => span.traceId))]
      .sort((left, right) => {
        const leftStart = rootByTrace.get(left)?.startedAt ?? primaryModelSpans.find(span => span.traceId === left)?.startedAt;
        const rightStart = rootByTrace.get(right)?.startedAt ?? primaryModelSpans.find(span => span.traceId === right)?.startedAt;
        return this.timestamp(leftStart) - this.timestamp(rightStart);
      });

    let globalTurnIndex = 0;
    const interactions: UserInteraction[] = interactionTraceIds.map((traceId, interactionPosition) => {
      const root = rootByTrace.get(traceId);
      const calls = primaryModelSpans.filter(span => span.traceId === traceId);
      const traceTools = executedTools.filter(span => span.traceId === traceId);
      const traceDiagnostics = tools.filter(span => span.traceId === traceId);
      const rootPrompt = root ? this.attributes(root)['copilot_chat.user_request'] : undefined;
      const promptMessage = root ? own.messages
        .filter(message => message.spanId === root.id && message.direction === 'input' && message.roleName === 'user')
        .map(message => this.messageText(message.content))
        .find(text => text && !text.startsWith('<environment_info>') && !text.startsWith('<context>')) : undefined;
      const prompt = typeof rootPrompt === 'string' && rootPrompt.trim()
        ? rootPrompt.trim()
        : promptMessage || (interactionPosition === 0 ? 'Treść promptu nie została wyemitowana.' : 'Treść kolejnego promptu nie została wyemitowana.');
      const interactionIndex = interactionPosition + 1;
      const turns = calls.map((model, turnPosition): ModelTurn => {
        const from = this.timestamp(model.endedAt || model.startedAt);
        const to = turnPosition + 1 < calls.length ? this.timestamp(calls[turnPosition + 1].startedAt) : Number.MAX_SAFE_INTEGER;
        return {
          index: ++globalTurnIndex,
          interactionIndex,
          interactionTurnIndex: turnPosition + 1,
          interactionPrompt: prompt,
          interactionStartedAt: root?.startedAt ?? calls[0]?.startedAt,
          model,
          tools: traceTools.filter(tool => {
            const at = this.timestamp(tool.startedAt);
            return at >= from && at < to;
          }),
          diagnostics: traceDiagnostics.filter(span => {
            const at = this.timestamp(span.startedAt);
            return at >= from && at < to;
          })
        };
      });
      return {index: interactionIndex, traceId, prompt, startedAt: root?.startedAt ?? calls[0]?.startedAt, turns};
    });
    const modelTurns = interactions.flatMap(interaction => interaction.turns);

    const relatedCalls = new Map<number, RelatedModelCall>();
    for (const {source: related} of episodes.slice(1)) {
      for (const span of related.spans.filter(item => item.operationName === 'chat')) {
        relatedCalls.set(span.id, {span, label: this.sessionTitle(related.session)});
      }
    }

    const root = interactionRoots[0];
    const rootMessages = root ? own.messages.filter(message => message.spanId === root.id) : [];
    const latestRoot = interactionRoots.at(-1);
    const latestRootMessages = latestRoot ? own.messages.filter(message => message.spanId === latestRoot.id) : [];
    const answerMessage = [...latestRootMessages, ...rootMessages, ...own.messages]
      .find(message => message.direction === 'output' && message.roleName === 'assistant');
    const definitionNames = new Set<string>();
    for (const message of own.messages) {
      if (message.direction !== 'definition') continue;
      try {
        const definition = JSON.parse(message.content) as {name?: string};
        if (definition.name) definitionNames.add(definition.name);
      } catch { /* Surowa definicja pozostaje dostępna w widoku technicznym. */ }
    }
    const mutating = new Set(['apply_patch', 'create_file', 'create_directory', 'edit_notebook_file', 'vscode_renameSymbol']);
    const included = new Set([episodes[0].id]);
    const pending = [episodes[0]];
    const launches = episodeLaunches(episodes);
    while (pending.length) {
      const episode = pending.shift()!;
      for (const tool of episode.source.spans.filter(span => span.operationName === 'execute_tool')) {
        const child = launches.get(tool);
        if (child && !included.has(child.id)) {
          included.add(child.id); pending.push(child);
        }
      }
    }

    this.cachedView = {
      source,
      relatedSource,
      tools,
      primaryModelSpans,
      billingModelSpans: episodes.filter(episode => included.has(episode.id)).flatMap(episode => episode.source.spans.filter(span => span.operationName === 'chat')),
      modelTurns,
      interactions,
      relatedModelCalls: [...relatedCalls.values()].sort((a, b) => this.timestamp(a.span.startedAt) - this.timestamp(b.span.startedAt)),
      assistantAnswer: answerMessage ? this.messageText(answerMessage.content) : 'Odpowiedź nie została wyemitowana.',
      toolDefinitionNames: [...definitionNames].sort(),
      contextualMessageCount: own.messages.filter(message => message.direction === 'input' &&
        (message.content.includes('<environment_info>') || message.content.includes('<context>'))).length,
      madeFileChanges: tools.some(span => mutating.has(this.attribute(span, 'gen_ai.tool.name')))
    };
    return this.cachedView;
  }

  sessionStatus(source: SessionDetail, related: SessionDetail[]): string {
    const reader = new TelemetryReader();
    const spans = sessionEpisodes(source, related, reader)[0].source.spans;
    const last = spans.filter(span => span.operationName === 'chat').at(-1);
    const canceled = last && reader.events(last).some(event => {
      const attributes = event['attributes'] as Record<string, unknown> | undefined;
      return event['name'] === 'github.copilot.session.abort' || ['Canceled', 'Cancelled', 'CancellationError'].includes(String(attributes?.['exception.type']));
    });
    if (canceled) return 'OSTATNIE ŻĄDANIE ANULOWANE';
    return spans.some(span => reader.errors(span).length) ? 'WYSTĄPIŁY BŁĘDY' : 'BRAK POTWIERDZONYCH BŁĘDÓW';
  }

  withDepth(spans: SpanRecord[]): SpanRecord[] {
    const byId = new Map(spans.map(span => [span.spanId, span]));
    return spans.map(span => {
      let depth = 0;
      let parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
      const visited = new Set<number>();
      while (parent && depth < 8 && !visited.has(parent.id)) {
        visited.add(parent.id);
        depth++;
        parent = parent.parentSpanId ? byId.get(parent.parentSpanId) : undefined;
      }
      return {...span, depth};
    });
  }

  messageText(content: string): string {
    try {
      const parsed = JSON.parse(content) as {content?: unknown; parts?: Array<{content?: string; text?: string}>};
      if (Array.isArray(parsed.parts)) return parsed.parts.map(part => part.content ?? part.text ?? '').filter(Boolean).join('\n');
      if (typeof parsed.content === 'string') return parsed.content;
      return content;
    } catch { return content; }
  }

  isAuxiliarySession(session: Session): boolean {
    const name = (session.agentName ?? '').toLowerCase();
    const technicalNames = new Set(['title', 'copilot-chat', 'backgroundtodoagent', 'copilotlanguagemodelwrapper',
      'healapplypatch', 'executionsubagenttool']);
    return session.conversationId.startsWith('trace:') || session.conversationId.startsWith('call_') || technicalNames.has(name);
  }

  sessionTitle(session: Session): string {
    const titles: Record<string, string> = {
      title: 'Generowanie tytułu',
      'copilot-chat': 'Techniczny wrapper Copilota',
      backgroundtodoagent: 'Aktualizacja planu w tle',
      copilotlanguagemodelwrapper: 'Pomocnicze przetwarzanie treści',
      healapplypatch: 'Naprawa formatu zmiany',
      executionsubagenttool: 'Subagent wykonawczy'
    };
    return titles[(session.agentName ?? '').toLowerCase()] ?? session.agentName ?? 'Sesja agenta';
  }

  private attributes(span: SpanRecord): Record<string, unknown> {
    const cached = this.attributeCache.get(span);
    if (cached) return cached;
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(span.attributesJson) as Record<string, unknown>; } catch { /* Niepoprawna telemetria. */ }
    this.attributeCache.set(span, parsed);
    return parsed;
  }

  private attribute(span: SpanRecord, key: string): string {
    const value = this.attributes(span)[key];
    return value == null || value === '' ? '—' : String(value);
  }

  private timestamp(value?: string): number {
    return value ? new Date(value).getTime() : 0;
  }
}
