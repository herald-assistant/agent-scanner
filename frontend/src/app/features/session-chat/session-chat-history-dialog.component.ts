import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {ScannerApiService} from '../../core/scanner-api.service';
import {SessionChatView} from '../../models/session-chat.models';

export interface SessionChatHistoryDialogData { sessionId: number; }

@Component({
  selector: 'as-session-chat-history-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './session-chat-history-dialog.component.html',
  styleUrl: './session-chat-history-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionChatHistoryDialogComponent {
  readonly data = inject<SessionChatHistoryDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SessionChatHistoryDialogComponent, SessionChatView | undefined>);
  private readonly api = inject(ScannerApiService);
  readonly conversations = signal<SessionChatView[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor() { void this.load(); }

  close(): void { this.dialogRef.close(); }
  select(item: SessionChatView): void { this.dialogRef.close(item); }

  async delete(item: SessionChatView, event: Event): Promise<void> {
    event.stopPropagation();
    if (!window.confirm('Usunąć tę rozmowę i jej lokalny stan Copilot SDK?')) return;
    try {
      await this.api.deleteSessionChat(item.sessionId, item.id);
      this.conversations.update(items => items.filter(candidate => candidate.id !== item.id));
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Nie udało się usunąć rozmowy.');
    }
  }

  title(item: SessionChatView): string {
    return item.turns.at(-1)?.question || item.turns[0]?.question || 'Rozmowa bez wiadomości';
  }

  turnLabel(count: number): string {
    if (count === 1) return '1 tura';
    if (count > 1 && count < 5) return `${count} tury`;
    return `${count} tur`;
  }

  focusLabel(item: SessionChatView): string {
    const count = item.focus.roundRefs.length;
    return count ? `${count} wskazanych rund` : 'cała sesja';
  }

  date(value: string): string {
    return new Intl.DateTimeFormat('pl-PL', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
  }

  private async load(): Promise<void> {
    try {
      this.conversations.set(await this.api.sessionChats(this.data.sessionId));
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Nie udało się pobrać poprzednich rozmów.');
    } finally {
      this.loading.set(false);
    }
  }
}
