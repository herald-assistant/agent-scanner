import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {CostDashboardComponent, CostDashboardView} from './cost-dashboard.component';

describe('CostDashboardComponent', () => {
  let fixture: ComponentFixture<CostDashboardComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CostDashboardComponent);
    fixture.componentRef.setInput('creditTooltip', 'AI credits');
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('shows one all-session total and an ordered comparable cost breakdown', () => {
    fixture.componentRef.setInput('view', view());
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const total = element.querySelector('.session-totals') as HTMLElement;
    const details = element.querySelector('.cost-breakdown') as HTMLDetailsElement;
    const rows = [...element.querySelectorAll<HTMLElement>('.breakdown-row')];

    expect(total.textContent).toContain('133,772');
    expect(total.textContent).toContain('35/35 wywołań z credits');
    expect(details.open).toBe(false);
    expect(rows.map(row => row.querySelector('.breakdown-identity strong')?.textContent?.trim()))
      .toEqual(['Agent główny', 'Subagent 1', 'Kompaktowanie 1']);
    expect(rows.every(row => row.children.length === 7)).toBe(true);
    expect(rows[2].textContent).toContain('29,672');
    expect(element.textContent).not.toContain('Input + output');
    expect(element.textContent).not.toContain('Input łącznie');
  });
});

function view(): CostDashboardView {
  const row = (id: string, kind: 'main' | 'subagent' | 'compaction', label: string, credits: string) => ({
    id, kind, label, detail: '1 wywołanie modelu · gpt-test', freshInput: '100', cacheRead: '200', cacheWrite: '—',
    output: '30', duration: '2.00 s', durationCoverage: '1/1 wywołań z czasem', credits,
    creditCoverage: '1/1 wywołań z credits'
  });
  return {
    headingSummary: '13 wywołań agenta głównego · 20 wywołań subagentów · 2 kompaktowania',
    wallDuration: '30 min',
    totalsScope: 'agent główny, subagenci i kompaktowanie',
    breakdownSummary: 'Agent główny · 1 subagent · 1 kompaktowanie',
    breakdown: [row('main', 'main', 'Agent główny', '104,00'), row('child', 'subagent', 'Subagent 1', '0,10'),
      row('compact', 'compaction', 'Kompaktowanie 1', '29,672')],
    totals: {freshInput: '282 tys.', cacheRead: '2,1 mln', cacheWrite: '67 tys.', hasCacheWrite: true,
      output: '41 tys.', duration: '9 min 12 s', durationCoverage: '35/35 wywołań z czasem',
      credits: '133,772', creditCoverage: '35/35 wywołań z credits'},
    records: {}
  };
}
