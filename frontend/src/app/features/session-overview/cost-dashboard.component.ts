import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';

export interface DashboardRecord {
  reference: string;
  value: string;
}

export interface CostBreakdownRow {
  id: string;
  kind: 'main' | 'subagent' | 'compaction';
  label: string;
  detail: string;
  freshInput: string;
  cacheRead: string;
  cacheWrite: string;
  output: string;
  duration: string;
  durationCoverage: string;
  credits: string;
  creditCoverage: string;
}

export interface CostDashboardView {
  headingSummary: string;
  wallDuration: string;
  totalsScope: string;
  breakdownSummary: string;
  breakdown: CostBreakdownRow[];
  totals: {
    freshInput: string;
    cacheRead: string;
    cacheWrite: string;
    hasCacheWrite: boolean;
    output: string;
    duration: string;
    durationCoverage: string;
    credits: string;
    creditCoverage: string;
  };
  records: {
    freshInput?: DashboardRecord;
    cacheRead?: DashboardRecord;
    cacheWrite?: DashboardRecord;
    output?: DashboardRecord;
    longest?: DashboardRecord;
    mostExpensive?: DashboardRecord;
  };
}

@Component({
  selector: 'as-cost-dashboard',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './cost-dashboard.component.html',
  styleUrl: './cost-dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CostDashboardComponent {
  readonly view = input.required<CostDashboardView>();
  readonly creditTooltip = input.required<string>();
}
