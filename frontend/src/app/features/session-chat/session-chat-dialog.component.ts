import {ChangeDetectionStrategy, Component, computed, inject, signal, viewChild} from '@angular/core';
import {CdkTextareaAutosize, TextFieldModule} from '@angular/cdk/text-field';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatButtonModule} from '@angular/material/button';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSelectModule} from '@angular/material/select';
import {ScannerApiService} from '../../core/scanner-api.service';
import {SessionChatAnswerStatus, SessionChatModel, SessionChatTurn, SessionChatView} from '../../models/session-chat.models';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {marked} from 'marked';
import DOMPurify from 'dompurify';

export interface SessionChatDialogData {
  sessionId: number;
  initialChat?: SessionChatView;
  openEvidence?: (ref: string) => void;
}

@Component({
  selector: 'as-session-chat-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressSpinnerModule, MatSelectModule, TextFieldModule],
  templateUrl: './session-chat-dialog.component.html',
  styleUrl: './session-chat-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionChatDialogComponent {
  readonly data = inject<SessionChatDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SessionChatDialogComponent>);
  private readonly api = inject(ScannerApiService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly models = signal<SessionChatModel[]>([]);
  readonly selectedModel = signal('');
  readonly chat = signal<SessionChatView | null>(null);
  readonly question = signal('');
  readonly loadingModels = signal(true);
  readonly sending = signal(false);
  readonly error = signal('');
  private readonly textareaAutosize = viewChild(CdkTextareaAutosize);
  readonly selectedModelInfo = computed(() => this.models().find(model => model.id === this.selectedModel()));
  readonly canSend = computed(() => !this.sending() && this.selectedModel().length > 0
    && this.question().trim().length > 0 && this.question().trim().length <= 4_000);
  readonly starters = [
    'Co w tej sesji najbardziej zwiększyło liczbę rund i jak mogę tego uniknąć?',
    'Które fragmenty sesji zużyły najwięcej credits i co warto sprawdzić w kolejnym eksperymencie?',
    'Jak inaczej sformułować początkowe zlecenie, aby agent szybciej osiągnął cel?',
    'Czy konfiguracja instrukcji, skilli, agentów, MCP i narzędzi była dopasowana do zadania?'
  ];

  constructor() {
    if (this.data.initialChat) {
      this.chat.set(this.data.initialChat);
      this.selectedModel.set(this.data.initialChat.model);
    }
    void this.load();
  }

  close(): void { this.dialogRef.close(); }
  chooseStarter(value: string): void { this.setQuestion(value); }

  retry(question: string): void {
    this.setQuestion(question);
    this.error.set('');
  }

  openEvidence(ref: string): void {
    if (!this.data.openEvidence) return;
    this.dialogRef.close();
    this.data.openEvidence(ref);
  }

  async send(): Promise<void> {
    const question = this.question().trim();
    if (!this.canSend()) return;
    this.sending.set(true);
    this.error.set('');
    try {
      let current = this.chat();
      if (!current) {
        current = await this.api.createSessionChat(this.data.sessionId, this.selectedModel());
        this.chat.set(current);
      }
      const turn = await this.api.askSessionChat(current.sessionId, current.id, question, crypto.randomUUID());
      this.chat.set({...current, revision: current.revision + (turn.status === 'COMPLETED' ? 1 : 0),
        updatedAt: turn.completedAt ?? turn.createdAt, turns: [...current.turns, turn]});
      this.question.set('');
      this.resizeComposer();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Nie udało się zakończyć tury rozmowy.';
      const current = this.chat();
      if (current) {
        try {
          const refreshed = await this.api.sessionChat(current.sessionId, current.id);
          this.chat.set(refreshed);
          this.question.set(question);
          this.error.set('');
        } catch {
          this.error.set(message);
        }
      } else {
        this.error.set(message);
      }
    } finally {
      this.sending.set(false);
    }
  }

  answerLabel(turn: SessionChatTurn): string { return statusLabel(turn.answer?.status); }
  failureLabel(turn: SessionChatTurn): string {
    if (turn.error?.includes('poprawnego kontraktu rozmowy')) {
      return 'Nie udało się odczytać odpowiedzi modelu. Wstaw pytanie ponownie.';
    }
    return turn.error || 'Ta odpowiedź nie została ukończona.';
  }
  compact(value: number | null | undefined): string {
    return value == null ? '—' : new Intl.NumberFormat('pl-PL', {notation: 'compact', maximumFractionDigits: 1}).format(value);
  }
  markdown(value: string): SafeHtml {
    const rendered = marked.parse(value, {async: false}) as string;
    const clean = DOMPurify.sanitize(rendered, {USE_PROFILES: {html: true}});
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  private async load(): Promise<void> {
    try {
      const result = await this.api.sessionChatModels();
      this.models.set(result.models);
      if (!this.chat()) {
        this.selectedModel.set(result.models.find(model => model.id === result.defaultModel)?.id ?? result.models[0]?.id ?? '');
      }
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Nie udało się pobrać modeli Copilota.');
    } finally {
      this.loadingModels.set(false);
    }
  }

  private setQuestion(value: string): void {
    this.question.set(value);
    this.resizeComposer();
  }

  private resizeComposer(): void {
    queueMicrotask(() => this.textareaAutosize()?.resizeToFitContent(true));
  }
}

function statusLabel(status: SessionChatAnswerStatus | undefined): string {
  if (status === 'CLARIFICATION_NEEDED') return 'Potrzebne doprecyzowanie';
  if (status === 'INSUFFICIENT_EVIDENCE') return 'Za mało dowodów';
  if (status === 'OUT_OF_SCOPE') return 'Poza zakresem danych Scannera';
  return 'Odpowiedź';
}
