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
  const deleteClassification = vi.fn();
  const sessionChats = vi.fn();

  beforeEach(async () => {
    cached.mockReset().mockResolvedValue(null);
    classify.mockReset();
    deleteClassification.mockReset().mockResolvedValue(undefined);
    sessionChats.mockReset().mockResolvedValue([]);
    TestBed.configureTestingModule({providers: [
      {provide: ScannerApiService, useValue: {
        cachedToolClassification: cached,
        classifyTools: classify,
        deleteToolClassification: deleteClassification,
        toolClassificationStatus: vi.fn().mockResolvedValue({configured: true, model: 'gpt-test', running: false}),
        sessionChats
      }},
      {provide: NotificationService, useValue: {error: vi.fn(), success: vi.fn()}}
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

  afterEach(() => { fixture.destroy(); vi.unstubAllGlobals(); TestBed.resetTestingModule(); });

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

  it('deletes a saved analysis and brings back the normal start action', async () => {
    const catalog = fixture.componentInstance.catalog();
    const result: ToolClassificationResult = {version: 'model-actions-v5', model: 'gpt-test', analyzedAt: '2026-01-01T00:00:00Z',
      tools: [], assessments: [], rounds: catalog.rounds.map(round => ({roundId: round.id, actions: ['RESPOND'], evidenceInvocationIds: [], reason: 'test'}))};
    classify.mockResolvedValue(result);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const element: HTMLElement = fixture.nativeElement;
    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find(item => item.textContent?.includes('Uruchom Quick Analysis'))!.click();
    await vi.waitFor(() => expect(classify).toHaveBeenCalledOnce());
    fixture.detectChanges();

    const remove = [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find(item => item.textContent?.includes('Usuń analizę'));
    expect(remove).toBeDefined();
    remove!.click();
    await vi.waitFor(() => expect(deleteClassification).toHaveBeenCalledOnce());
    fixture.detectChanges();

    expect(fixture.componentInstance.result()).toBeUndefined();
    expect(element.textContent).toContain('Uruchom Quick Analysis');
  });

  it('formats missing turn counts and very small credit values without misleading zeroes', () => {
    expect(fixture.componentInstance.turnLabel(undefined)).toBe('liczba tur niedostępna');
    expect(fixture.componentInstance.credits(0.0004)).toBe('< 0,001');
    expect(fixture.componentInstance.credits(0.0032)).toBe('0,003');
  });
});
