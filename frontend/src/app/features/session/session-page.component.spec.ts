import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ActivatedRoute, convertToParamMap, Router} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ScannerShellStateService} from '../../core/scanner-shell-state.service';
import {workflowFixture} from '../../core/workflow/workflow.fixtures';
import {SessionPageComponent} from './session-page.component';

const status = {
  paused: false,
  connected: true,
  lastSignalAt: null,
  traces: 0,
  metrics: 0,
  logs: 0,
  contentCaptured: false,
  retentionDays: 30
};

describe('SessionPageComponent', () => {
  let fixture: ComponentFixture<SessionPageComponent>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routeParams = new BehaviorSubject(convertToParamMap({}));
    navigate = vi.fn(async (commands: unknown[]) => {
      const sessionId = commands[0] === '/sessions' ? String(commands[1]) : undefined;
      routeParams.next(convertToParamMap(sessionId ? {sessionId} : {}));
      return true;
    });
    TestBed.configureTestingModule({
      providers: [
        ScannerShellStateService,
        {provide: ActivatedRoute, useValue: {paramMap: routeParams.asObservable()}},
        {provide: Router, useValue: {navigate}}
      ]
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith('/api/status') ? status : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {'Content-Type': 'application/json'}
      });
    }));
    fixture = TestBed.createComponent(SessionPageComponent);
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('opens the dedicated workflow tab and loads raw candidates for custom-tool linking', async () => {
    await vi.waitFor(() => expect(fixture.componentInstance.loading).toBe(false));
    const sources = workflowFixture();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith('/api/status') ? status : url.endsWith('/api/sessions') ? sources.map(source => source.session) :
        sources.find(source => url.endsWith(`/api/sessions/${source.session.id}`));
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    }));
    routeParams.next(convertToParamMap({sessionId: String(sources[0].session.id)}));
    await fixture.componentInstance.refresh();
    await vi.waitFor(() => expect(fixture.componentInstance.detail?.session.id).toBe(sources[0].session.id));
    await vi.waitFor(() => expect(TestBed.inject(ScannerShellStateService).selectedTurnCount()).toBeGreaterThan(0));
    await fixture.whenStable();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect([...element.querySelector('.loop-view')!.children].map(child => child.tagName)).toEqual([
      'AS-COST-DASHBOARD', 'AS-TOOL-OPTIMIZATION-OVERVIEW', 'AS-INTERACTION-TIMELINE'
    ]);
    const tab = [...element.querySelectorAll<HTMLButtonElement>('.tabs button')].find(button => button.textContent?.trim() === 'Mapa pracy');
    expect(tab).toBeDefined(); tab!.click();
    await vi.waitFor(() => expect(fixture.componentInstance.workflowState()?.streams).toHaveLength(2));
    fixture.detectChanges();
    expect(element.querySelector('as-workflow-view')).not.toBeNull();
    expect(element.querySelector('as-cost-dashboard')).toBeNull();
    expect(element.querySelector('as-technical-view')).toBeNull();
  });

  it('groups model rounds by the user interaction trace and does not mix tools between interactions', () => {
    const component = fixture.componentInstance;
    const conversationId = 'conversation-1';
    const root = (id: number, traceId: string, startedAt: string, prompt: string) => span({
      id, traceId, spanId: `root-${id}`, operationName: 'invoke_agent', startedAt,
      attributesJson: JSON.stringify({
        'gen_ai.conversation.id': conversationId,
        'copilot_chat.user_request': prompt
      })
    });
    const chat = (id: number, traceId: string, startedAt: string, endedAt: string) => span({
      id, traceId, spanId: `chat-${id}`, operationName: 'chat', startedAt, endedAt, model: 'gpt-test',
      attributesJson: JSON.stringify({'gen_ai.conversation.id': conversationId})
    });
    const tool = (id: number, traceId: string, startedAt: string) => span({
      id, traceId, spanId: `tool-${id}`, operationName: 'execute_tool', startedAt,
      attributesJson: JSON.stringify({'gen_ai.tool.name': 'read_file'})
    });
    const firstChat = chat(2, 'trace-1', '2026-01-01T10:00:01Z', '2026-01-01T10:00:02Z');
    const secondChat = chat(3, 'trace-1', '2026-01-01T10:00:04Z', '2026-01-01T10:00:05Z');
    const thirdChat = chat(6, 'trace-2', '2026-01-01T11:00:01Z', '2026-01-01T11:00:02Z');
    const firstTool = tool(4, 'trace-1', '2026-01-01T10:00:03Z');
    const secondTool = tool(7, 'trace-2', '2026-01-01T11:00:03Z');
    (component as any).detailState.set({
      session: {
        id: 1, conversationId, responseModel: 'gpt-test', lastSeenAt: '2026-01-01T11:00:03Z',
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
        reasoningTokens: 0, turnCount: 3, toolCount: 2, errorCount: 0, contentCaptured: true
      },
      spans: [
        root(1, 'trace-1', '2026-01-01T10:00:00Z', 'pierwszy prompt'), firstChat, firstTool, secondChat,
        root(5, 'trace-2', '2026-01-01T11:00:00Z', 'drugi prompt'), thirdChat, secondTool,
        root(8, 'subagent-trace', '2026-01-01T11:00:02Z', 'Execution query'),
        span({id: 9, traceId: 'subagent-trace', operationName: 'chat', model: 'gpt-test', attributesJson: JSON.stringify({'gen_ai.conversation.id': 'call-subagent'})})
      ],
      messages: [], signals: []
    });

    expect(component.interactions()).toHaveLength(2);
    expect(component.interactions().map(interaction => interaction.prompt)).toEqual(['pierwszy prompt', 'drugi prompt']);
    expect(component.interactions()[0].turns.map(turn => turn.interactionTurnIndex)).toEqual([1, 2]);
    expect(component.interactions()[1].turns.map(turn => turn.interactionTurnIndex)).toEqual([1]);
    expect(component.interactions()[0].turns[0].tools).toEqual([firstTool]);
    expect(component.interactions()[1].turns[0].tools).toEqual([secondTool]);
  });

  it('loads a compaction session created after the selected session ended', async () => {
    await vi.waitFor(() => expect(fixture.componentInstance.loading).toBe(false));
    const mainSession = {
      id: 169, conversationId: 'conversation-main', agentName: 'panel/editAgent', startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:30:00Z', lastSeenAt: '2026-01-01T10:30:00Z', inputTokens: 100, outputTokens: 20,
      cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, turnCount: 1, toolCount: 0, errorCount: 0, contentCaptured: true
    };
    const compactionSession = {
      ...mainSession, id: 196, conversationId: 'trace:late-compaction', agentName: 'summarizeConversationHistory-full',
      startedAt: '2026-01-02T14:00:00Z', endedAt: '2026-01-02T14:01:00Z', lastSeenAt: '2026-01-02T14:01:00Z',
      inputTokens: 12793, outputTokens: 4474
    };
    const mainDetail = {
      session: mainSession,
      spans: [span({id: 1, traceId: 'main', spanId: 'main-chat', operationName: 'chat', model: 'gpt-main', durationMs: 1000,
        inputTokens: 100, outputTokens: 20, startedAt: '2026-01-01T10:00:01Z', endedAt: '2026-01-01T10:00:02Z',
        attributesJson: JSON.stringify({'gen_ai.conversation.id': 'conversation-main', 'copilot_chat.copilot_usage_nano_aiu': 1000000000})})], messages: [], signals: []
    };
    const compactionSpan = span({id: 2, traceId: 'compact', spanId: 'compact-chat', operationName: 'chat', model: 'gpt-compact', durationMs: 60000,
      startedAt: '2026-01-02T14:00:00Z', endedAt: '2026-01-02T14:01:00Z', attributesJson: JSON.stringify({
        'gen_ai.agent.name': 'summarizeConversationHistory-full', 'gen_ai.usage.input_tokens': 12793,
        'gen_ai.usage.cache_read.input_tokens': 0, 'gen_ai.usage.output_tokens': 4474,
        'copilot_chat.copilot_usage_nano_aiu': 8563300000
      })});
    const compactionDetail = {
      session: compactionSession, spans: [compactionSpan],
      messages: [{id: 1, spanId: 2, direction: 'input', sequenceNo: 0, roleName: 'user',
        content: JSON.stringify({role: 'user', content: 'transcripts/conversation-main.jsonl'}), sourceKind: 'telemetry'}], signals: []
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith('/api/status') ? status : url.endsWith('/api/sessions') ? [mainSession, compactionSession] :
        url.endsWith('/api/sessions/169') ? mainDetail : compactionDetail;
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    }));

    routeParams.next(convertToParamMap({sessionId: String(mainSession.id)}));
    await fixture.componentInstance.refresh();
    await vi.waitFor(() => expect(fixture.componentInstance.relatedDetails.map(detail => detail.session.id)).toContain(196));

    expect(fixture.componentInstance.relatedDetails.map(detail => detail.session.id)).toContain(196);
    expect(fixture.componentInstance.contextCompactions()).toHaveLength(1);
    expect(fixture.componentInstance.contextCompactions()[0].placementBeforeModelId).toBeUndefined();
    expect(fixture.componentInstance.costDashboard().totals.credits).toBe('9,563');
    expect(fixture.componentInstance.costDashboard().totals.output).toBe('4494');
    expect(fixture.componentInstance.costDashboard().breakdown.map(row => row.label)).toEqual(['Agent główny', 'Kompaktowanie 1']);
    expect(fixture.componentInstance.costDashboard().breakdown[1]).toMatchObject({detail: expect.stringContaining('gpt-compact'), credits: '8,563'});
  });
});

function span(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    signalId: 1,
    traceId: 'trace',
    spanId: 'span',
    spanName: 'chat',
    operationName: 'chat',
    statusCode: 'STATUS_CODE_OK',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    attributesJson: '{}',
    eventsJson: '[]',
    ...overrides
  } as any;
}
