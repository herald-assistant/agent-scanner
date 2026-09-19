import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Session} from '../../models/scanner.models';
import {SessionSidebarComponent} from './session-sidebar.component';

describe('SessionSidebarComponent', () => {
  let fixture: ComponentFixture<SessionSidebarComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SessionSidebarComponent);
    fixture.componentRef.setInput('retentionDays', 30);
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('uses repository and VS Code emitter data to identify a session', () => {
    fixture.componentRef.setInput('sessions', [session({
      repository: 'https://github.com/example/copilot-playground.git', sourceKind: 'vscode',
      sourceName: 'Visual Studio Code', sourceService: 'copilot-chat', sourceVersion: '0.66.0'
    })]);
    fixture.detectChanges();

    const card: HTMLElement = fixture.nativeElement.querySelector('.session-card');
    expect(card.querySelector('strong')?.textContent).toContain('copilot-playground');
    expect(card.querySelector('.source-line')?.textContent).toContain('VS Code');
    expect(card.querySelector('.source-line')?.textContent).toContain('Copilot Chat 0.66.0');
    expect(card.querySelector('.source-avatar mat-icon')?.textContent?.trim()).toBe('code');
    expect(card.querySelector('.state')).toBeNull();
  });

  it('keeps an explicit unknown-source fallback and shows confirmed errors only', () => {
    fixture.componentRef.setInput('sessions', [session({errorCount: 1, sourceKind: 'unknown'})]);
    fixture.detectChanges();

    const card: HTMLElement = fixture.nativeElement.querySelector('.session-card');
    expect(card.querySelector('.source-line')?.textContent).toContain('Źródło nierozpoznane');
    expect(card.querySelector('.state')?.textContent).toContain('Błędy');
  });
});

function session(overrides: Partial<Session>): Session {
  return {
    id: 1, conversationId: 'session-1', agentName: 'GitHub Copilot Chat', responseModel: 'gpt-test',
    lastSeenAt: '2026-09-19T10:00:00Z', inputTokens: 100, outputTokens: 20, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, turnCount: 2, toolCount: 1, errorCount: 0,
    contentCaptured: true, ...overrides
  };
}
