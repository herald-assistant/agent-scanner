import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';

export interface DashboardRecord {
  reference: string;
  value: string;
}

export interface CostDashboardView {
  modelCalls: string;
  toolActions: string;
  totals: {
    freshInput: string;
    cacheRead: string;
    cacheWrite: string;
    hasCacheWrite: boolean;
    output: string;
    duration: string;
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
