import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WorkflowViewComponent} from './workflow-view.component';
import {WorkflowAnalysisService} from '../../core/workflow-analysis.service';
import {workflowFixture} from '../../core/workflow/workflow.fixtures';
import {known} from '../../core/workflow/telemetry';

describe('WorkflowViewComponent', () => {
  let fixture: ComponentFixture<WorkflowViewComponent>;

  beforeEach(async () => {
    const [root, child] = workflowFixture();
    const analysis = await new WorkflowAnalysisService().analyze(root, [child]);
    fixture = TestBed.createComponent(WorkflowViewComponent);
    fixture.componentRef.setInput('analysis', analysis);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLDivElement>('.map-scroll')!.scrollTo = vi.fn();
  });

  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  it('renders only factual map controls and no AI, category, phase or chat actions', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.interaction-node')?.textContent).toContain('Porównaj dwa warianty');
    expect(element.querySelectorAll('.agent-lane')).toHaveLength(2);
    expect(element.querySelectorAll('.model-round-node')).toHaveLength(9);
    expect([...element.querySelectorAll('.layer-switch button')].map(button => button.textContent?.trim()))
      .toEqual(['Kontekst', 'Tokeny', 'Credits']);
    expect(element.textContent).not.toContain('Kategorie');
    expect(element.textContent).not.toContain('ZAGREGOWANY PRZEBIEG');
    expect(element.textContent).not.toContain('Zapytaj o sesję');
    expect(element.textContent).not.toContain('Poprzednie rozmowy');
    expect(element.querySelector('.phase-panel')).toBeNull();
    expect(element.querySelector('.action-summary')).toBeNull();
    expect(element.querySelector('.snapshot')?.textContent).toContain('Bez interpretacji AI');
  });

  it('changes the chart together with the selected factual layer', () => {
    const element: HTMLElement = fixture.nativeElement;
    const switches = element.querySelectorAll<HTMLButtonElement>('.layer-switch button');
    switches[1].click(); fixture.detectChanges();
    expect(element.querySelectorAll('.token-chart-row')).toHaveLength(4);
    expect([...element.querySelectorAll('.token-axis-title')].map(label => label.textContent?.trim()))
      .toEqual(['Nowy input', 'Input z cache', 'Output', 'Cache write']);
    const totals = new Map(fixture.componentInstance.layerChart().series.map(series => [series.id, series.total]));
    expect(totals.get('output')).toBe(fixture.componentInstance.columns().reduce((sum, round) => sum + (known(round.output) ?? 0), 0));
    switches[2].click(); fixture.detectChanges();
    expect(element.querySelector('.axis-label')?.textContent).toContain('Credits narastająco');
  });

  it('keeps deterministic tool-based captions on round nodes', () => {
    const round = fixture.componentInstance.columns()[0];
    expect(fixture.componentInstance.roundCaption(round)).toContain(round.tools.length ? 'użycie' : 'Model');
    expect(fixture.componentInstance.roundIcon(round)).toBe(round.tools.length ? 'build' : 'chat_bubble_outline');
  });
});
