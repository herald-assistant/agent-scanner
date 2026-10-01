import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
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

  it('offers JSON import as an icon action in the session heading', () => {
    fixture.componentRef.setInput('sessions', []);
    fixture.detectChanges();
    const heading: HTMLElement = fixture.nativeElement.querySelector('.aside-title');
    const button: HTMLButtonElement = heading.querySelector('button[aria-label="Importuj sesję JSON"]')!;
    const input: HTMLInputElement = heading.querySelector('input[type="file"]')!;
    expect(button.querySelector('mat-icon')?.textContent?.trim()).toBe('upload_file');
    expect(input.accept).toContain('.json');
    expect(fixture.nativeElement.querySelector('.session-import')).toBeNull();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    button.click();
    expect(click).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('importing', true);
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
  });

  it('shows saved analyses as direct session-like cards in groups of five', () => {
    fixture.componentRef.setInput('sessions', []);
    fixture.componentRef.setInput('repositories', [{id: 'repository-1', name: 'Projekt', createdAt: '2026-09-22T10:00:00Z',
      analyses: Array.from({length: 7}, (_, index) => ({id: `analysis-${index}`,
        analyzedAt: `2026-09-22T10:0${index}:00Z`, model: 'model-a', fileCount: 2}))}]);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.repository-item')).toHaveLength(5);
    expect(element.querySelector('.repository-item .session-head strong')?.textContent).toBe('Projekt');
    expect(element.querySelector('.repository-item .session-meta')?.textContent).toContain('2 pliki');
    expect(element.querySelector('.repository-item [aria-expanded]')).toBeNull();
    expect(element.querySelector('.repository-heading h2')?.textContent).toBe('Repozytoria');
    expect(element.querySelector('.repository-heading .aside-title-actions mat-icon')?.textContent?.trim()).toBe('add_circle');
    const selected = vi.fn();
    fixture.componentInstance.analysisSelected.subscribe(selected);
    (element.querySelector('.repository-item') as HTMLButtonElement).click();
    expect(selected).toHaveBeenCalledWith({repositoryId: 'repository-1', analysisId: 'analysis-6'});
    (element.querySelector('.show-more') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.querySelectorAll('.repository-item')).toHaveLength(7);
    expect(element.querySelector('.show-more')).toBeNull();
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
