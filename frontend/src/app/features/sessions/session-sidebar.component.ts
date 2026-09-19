import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {Session} from '../../models/scanner.models';
import {sessionEmitterLabel, sessionRepositoryName, sessionSourceIcon, sessionSourceLabel} from '../../core/session-presentation';

@Component({
  selector: 'as-session-sidebar',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './session-sidebar.component.html',
  styleUrl: './session-sidebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionSidebarComponent {
  readonly sessions = input.required<Session[]>();
  readonly selectedSessionId = input<number>();
  readonly selectedTurnCount = input(0);
  readonly retentionDays = input.required<number>();
  readonly importing = input(false);
  readonly canClear = input(false);

  readonly sessionSelected = output<Session>();
  readonly collapse = output<void>();
  readonly fileSelected = output<File>();
  readonly clearAll = output<void>();

  private readonly compactNumber = new Intl.NumberFormat('pl-PL', {notation: 'compact'});
  private readonly timeFormat = new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.fileSelected.emit(file);
    input.value = '';
  }

  turnCount(session: Session): number {
    return session.id === this.selectedSessionId() ? this.selectedTurnCount() : session.turnCount;
  }

  title(session: Session): string {
    return sessionRepositoryName(session) || (session.sourceKind === 'vscode' ? 'Sesja bez danych repozytorium' : session.agentName || 'Sesja agenta');
  }
  sourceLabel(session: Session): string { return sessionSourceLabel(session); }
  sourceDetails(session: Session): string | undefined { return sessionEmitterLabel(session); }
  sourceIcon(session: Session): string { return sessionSourceIcon(session); }
  model(session: Session): string { return session.responseModel || session.requestedModel || 'model —'; }
  tokens(session: Session): string { return this.compactNumber.format(session.inputTokens + session.outputTokens); }
  time(value?: string): string { return value ? this.timeFormat.format(new Date(value)) : '—'; }
}
