import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {buildContextCompactionContent} from '../../core/context-compaction';
import {ContextCompactionMeasurement, SessionDetail} from '../../models/scanner.models';

@Component({
  selector: 'as-context-compaction-details',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './context-compaction-details.component.html',
  styleUrl: './context-compaction-details.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContextCompactionDetailsComponent {
  readonly compaction = input.required<ContextCompactionMeasurement>();
  readonly source = input.required<SessionDetail>();
  readonly creditTooltip = input.required<string>();
  readonly content = computed(() => buildContextCompactionContent(this.source(), this.compaction().spanId));

  private readonly standardNumberFormat = new Intl.NumberFormat('pl-PL');
  private readonly compactNumberFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact'});
  private readonly callCreditFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 2, maximumFractionDigits: 3});
  private readonly percentFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 1, maximumFractionDigits: 1});

  exact(value?: number): string { return value == null ? '—' : this.standardNumberFormat.format(value); }

  compact(value?: number): string {
    if (value == null) return '—';
    return value >= 10000 ? this.compactNumberFormat.format(value) : this.exact(value);
  }

  credits(value?: number): string { return value == null ? '—' : this.callCreditFormat.format(value); }

  duration(value?: number): string {
    if (value == null) return '—';
    return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${Math.round(value)} ms`;
  }

  estimatedTokens(characters: number): number { return Math.round(characters / 4.25); }

  roleLabel(role: string): string {
    const labels: Record<string, string> = {user: 'user', assistant: 'assistant', system: 'system', tool: 'tool'};
    return labels[role.toLowerCase()] ?? role;
  }

  toolChoiceLabel(): string {
    const choice = this.content().toolChoice;
    if (choice?.toLowerCase() === 'none') return 'Model otrzymał definicje, ale w tym wywołaniu miał wyłączone ich użycie.';
    return choice ? `Tryb wyboru narzędzi w żądaniu: ${choice}.` : 'Telemetria nie podała trybu wyboru narzędzi.';
  }

  resultStatus(): string {
    const compaction = this.compaction();
    return compaction.resultObservedInModelId != null
      ? `Ten wynik został odnaleziony w inputcie interakcji ${compaction.afterInteractionIndex}.`
      : 'To rezultat wywołania kompaktującego. W telemetrii nie ma jeszcze kolejnego requestu, który potwierdzałby jego użycie.';
  }

  resultTitle(): string {
    return this.compaction().resultObservedInModelId != null
      ? 'Co model zobaczył w kolejnej interakcji'
      : 'Wynik przygotowany dla kolejnych tur';
  }

  hasMeasuredEffect(): boolean { return this.compaction().resultObservedInModelId != null; }

  reductionLabel(): string {
    const before = this.compaction().beforeInputTokens, after = this.compaction().afterInputTokens;
    if (before == null || after == null || before <= 0) return '—';
    const change = (after - before) / before;
    if (Math.abs(change) < .0005) return 'bez zmiany';
    return `${this.percentFormat.format(Math.abs(change) * 100)}% ${change < 0 ? 'mniej' : 'więcej'}`;
  }

  occupancyLabel(): string {
    const before = this.compaction().beforeOccupancy, after = this.compaction().afterOccupancy;
    if (before == null || after == null) return '—';
    return `${this.percentFormat.format(before * 100)}% → ${this.percentFormat.format(after * 100)}%`;
  }

  pretty(value: string): string {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
}
