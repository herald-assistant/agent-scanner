import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AppComponent} from './app.component';
import {workflowFixture} from './core/workflow/workflow.fixtures';

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

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith('/api/status') ? status : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {'Content-Type': 'application/json'}
      });
    }));
    fixture = TestBed.createComponent(AppComponent);
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('starts in zoneless mode and loads scanner state', async () => {
    await vi.waitFor(() => expect(fixture.componentInstance.loading).toBe(false));

    expect(fixture.componentInstance.status.connected).toBe(true);
    expect(fixture.componentInstance.visibleSessions()).toEqual([]);
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
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
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
