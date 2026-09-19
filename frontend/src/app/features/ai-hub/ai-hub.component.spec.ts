import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AiHubComponent} from './ai-hub.component';
import {ScannerApiService} from '../../core/scanner-api.service';
import {NotificationService} from '../../core/notification.service';
import {WorkflowAnalysisService} from '../../core/workflow-analysis.service';
import {workflowFixture} from '../../core/workflow/workflow.fixtures';
import {ToolClassificationResult} from '../../models/tool-classification.models';

describe('AiHubComponent', () => {
  let fixture: ComponentFixture<AiHubComponent>;
  const cached = vi.fn();
  const classify = vi.fn();
  const sessionChats = vi.fn();

  beforeEach(async () => {
    cached.mockReset().mockResolvedValue(null);
    classify.mockReset();
    sessionChats.mockReset().mockResolvedValue([]);
    TestBed.configureTestingModule({providers: [
      {provide: ScannerApiService, useValue: {
        cachedToolClassification: cached,
        classifyTools: classify,
        toolClassificationStatus: vi.fn().mockResolvedValue({configured: true, model: 'gpt-test', running: false}),
        sessionChats
      }},
      {provide: NotificationService, useValue: {error: vi.fn()}}
    ]});
    const [source, related] = workflowFixture();
    const analysis = await new WorkflowAnalysisService().analyze(source, [related]);
    fixture = TestBed.createComponent(AiHubComponent);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.componentRef.setInput('contextCompactions', []);
    fixture.detectChanges();
    await vi.waitFor(() => expect(cached).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.componentInstance.restoring()).toBe(false));
    fixture.detectChanges();
  });

  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  it('restores local state and history without invoking AI', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('AI QUICK ANALYSIS');
    expect(element.textContent).toContain('AI CHAT');
    expect(element.textContent).toContain('Uruchom Quick Analysis');
    expect(classify).not.toHaveBeenCalled();
    expect(sessionChats).toHaveBeenCalledOnce();
  });

  it('runs classification only after the explicit action', async () => {
    const catalog = fixture.componentInstance.catalog();
    const result: ToolClassificationResult = {version: 'model-actions-v5', model: 'gpt-test', analyzedAt: '2026-01-01T00:00:00Z',
      tools: [], assessments: [], rounds: catalog.rounds.map(round => ({roundId: round.id, actions: ['RESPOND'], evidenceInvocationIds: [], reason: 'test'}))};
    classify.mockResolvedValue(result);
    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find(item => item.textContent?.includes('Uruchom Quick Analysis'))!;
    button.click();
    await vi.waitFor(() => expect(classify).toHaveBeenCalledOnce());
    expect(classify.mock.calls[0][0]).toBe(fixture.componentInstance.analysis().source.session.id);
  });

  it('formats missing turn counts and very small credit values without misleading zeroes', () => {
    expect(fixture.componentInstance.turnLabel(undefined)).toBe('liczba tur niedostępna');
    expect(fixture.componentInstance.credits(0.0004)).toBe('< 0,001');
    expect(fixture.componentInstance.credits(0.0032)).toBe('0,003');
  });
});
