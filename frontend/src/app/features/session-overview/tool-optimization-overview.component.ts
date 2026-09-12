import {ChangeDetectionStrategy, Component, computed, inject, input, signal} from '@angular/core';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ToolUsageOverview, ToolUsageRow} from '../../core/tool-usage-analysis';
import {ToolDefinitionDialogComponent} from './tool-definition-dialog.component';

@Component({
  selector: 'as-tool-optimization-overview',
  imports: [MatDialogModule, MatIconModule, MatTooltipModule],
  templateUrl: './tool-optimization-overview.component.html',
  styleUrl: './tool-optimization-overview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToolOptimizationOverviewComponent {
  private readonly dialog = inject(MatDialog);
  readonly overview = input.required<ToolUsageOverview>();
  readonly sdkTelemetry = input(false);
  readonly expanded = signal(false);
  readonly activeTab = signal<'unused' | 'used'>('unused');
  readonly unusedRows = computed(() => this.overview().rows.filter(row => row.state !== 'used'));
  readonly usedRows = computed(() => this.overview().rows.filter(row => row.state === 'used'));
  readonly visibleRows = computed(() => this.activeTab() === 'unused' ? this.unusedRows() : this.usedRows());
  private readonly numberFormat = new Intl.NumberFormat('pl-PL');

  number(value: number): string {
    return this.numberFormat.format(value);
  }

  stateLabel(row: ToolUsageRow): string {
    if (row.state === 'unused') return 'Niewykorzystane';
    if (row.state === 'unverified') return 'Brak pełnego potwierdzenia';
    return 'Wykorzystane';
  }

  openDefinition(row: ToolUsageRow): void {
    this.dialog.open(ToolDefinitionDialogComponent, {
      data: {tool: row},
      width: 'min(760px, calc(100vw - 32px))',
      maxWidth: '760px',
      maxHeight: '90vh',
      panelClass: 'tool-definition-dialog-panel',
      autoFocus: 'dialog',
      restoreFocus: true
    });
  }

  recommendation(row: ToolUsageRow): string {
    if (row.state === 'unused') return 'Sprawdź, czy to narzędzie musi być dostępne w tym profilu agenta.';
    if (row.state === 'unverified') return 'Brak pełnego outputu — najpierw sprawdź pokrycie telemetrii.';
    if ((row.cachedResultTokens ?? 0) > row.resultTokens) return 'Wyniki pozostają w kolejnych rundach — sprawdź węższy rezultat lub wcześniejsze kompaktowanie.';
    if (row.resultTokens > row.invocationTokens) return 'Najwięcej treści wraca w wynikach — sprawdź węższy zakres lub bardziej celowaną alternatywę.';
    return 'Sprawdź, czy prostszy kontrakt wywołania może wykonać tę samą pracę.';
  }
}
