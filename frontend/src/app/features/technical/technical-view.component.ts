import {ChangeDetectionStrategy, Component, computed, input, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ScannerStatus, SessionDetail, SpanRecord, TechnicalMode} from '../../models/scanner.models';

@Component({
  selector: 'as-technical-view',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './technical-view.component.html',
  styleUrl: './technical-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TechnicalViewComponent {
  readonly detail = input.required<SessionDetail>();
  readonly status = input.required<ScannerStatus>();

  readonly mode = signal<TechnicalMode>('spans');
  readonly query = signal('');
  readonly selectedSpanId = signal<number | undefined>(undefined);
  readonly selectedSignalId = signal<number | undefined>(undefined);

  readonly filteredSpans = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('pl');
    if (!query) return this.detail().spans;
    return this.detail().spans.filter(span => [
      span.spanName, span.operationName, span.model, span.traceId, span.spanId
    ].some(value => value?.toLocaleLowerCase('pl').includes(query)));
  });

  readonly selectedSpan = computed(() => {
    const spans = this.detail().spans;
    return spans.find(span => span.id === this.selectedSpanId()) ?? spans[0];
  });

  readonly selectedSignal = computed(() => {
    const signals = this.detail().signals;
    return signals.find(signal => signal.id === this.selectedSignalId()) ?? signals[0];
  });

  setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  operationIcon(span: SpanRecord): string {
    return ({invoke_agent: 'A', chat: 'M', execute_tool: 'T', execute_hook: 'H'} as Record<string, string>)[span.operationName ?? ''] ?? '·';
  }

  duration(value?: number): string {
    if (value == null) return '—';
    return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${Math.round(value)} ms`;
  }

  time(value?: string): string {
    return value ? new Intl.DateTimeFormat('pl-PL', {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(value)) : '—';
  }

  short(value?: string, size = 9): string {
    return value ? (value.length > size ? value.slice(0, size) + '…' : value) : '—';
  }

  pretty(json?: string): string {
    if (!json) return '—';
    try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
  }
}
