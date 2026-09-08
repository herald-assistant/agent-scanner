import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatButtonModule} from '@angular/material/button';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSelectModule} from '@angular/material/select';
import {ScannerApiService} from '../../core/scanner-api.service';
import {
  RoundDiscussionEvidenceSnapshot,
  RoundDiscussionAnswerStatus,
  RoundDiscussionModel,
  RoundDiscussionTurn,
  RoundDiscussionView
} from '../../models/round-discussion.models';

export interface RoundDiscussionDialogData {
  snapshot: RoundDiscussionEvidenceSnapshot;
}

@Component({
  selector: 'as-round-discussion-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressSpinnerModule, MatSelectModule],
  templateUrl: './round-discussion-dialog.component.html',
  styleUrl: './round-discussion-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoundDiscussionDialogComponent {
  readonly data = inject<RoundDiscussionDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<RoundDiscussionDialogComponent>);
  private readonly api = inject(ScannerApiService);
  readonly models = signal<RoundDiscussionModel[]>([]);
  readonly selectedModel = signal('');
  readonly saved = signal<RoundDiscussionView[]>([]);
  readonly discussion = signal<RoundDiscussionView | null>(null);
  readonly question = signal('');
  readonly loadingModels = signal(true);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly initialPayloadCharacters = JSON.stringify(this.data.snapshot).length;
  readonly estimatedInputTokens = Math.ceil(this.initialPayloadCharacters / 4.25);
  readonly selectedModelInfo = computed(() => this.models().find(model => model.id === this.selectedModel()));
  readonly canSend = computed(() => !this.sending() && this.selectedModel().length > 0
    && this.question().trim().length > 0 && this.question().trim().length <= 4_000);
  readonly starters = [
    'Wyjaśnij, co wydarzyło się w tym zakresie i które rundy są najważniejsze.',
    'Gdzie w tym ciągu widać największą presję na kontekst lub credits?',
    'Jakie techniki optymalizacji warto tutaj przetestować i jak porównać wynik?',
    'Czego brakuje w telemetrii, żeby wyciągnąć mocniejszy wniosek?'
  ];

  constructor() {
    void this.load();
  }

  close(): void {
    this.dialogRef.close();
  }

  chooseStarter(value: string): void {
    this.question.set(value);
  }

  resume(item: RoundDiscussionView): void {
    this.discussion.set(item);
    this.selectedModel.set(item.model);
    this.error.set('');
  }

  startNew(): void {
    this.discussion.set(null);
    this.question.set('');
    this.error.set('');
  }

  async send(): Promise<void> {
    const question = this.question().trim();
    if (!this.canSend()) return;
    this.sending.set(true);
    this.error.set('');
    try {
      let discussion = this.discussion();
      if (!discussion) {
        discussion = await this.api.createRoundDiscussion(this.data.snapshot.selection.rootSessionId, {
          version: 'round-discussion-v1', model: this.selectedModel(), snapshot: this.data.snapshot
        });
        this.discussion.set(discussion);
      }
      const turn = await this.api.askRoundDiscussion(discussion.sessionId, discussion.id, question, crypto.randomUUID());
      this.discussion.set({...discussion, revision: discussion.revision + (turn.status === 'COMPLETED' ? 1 : 0),
        updatedAt: turn.completedAt ?? turn.createdAt, turns: [...discussion.turns, turn]});
      this.question.set('');
      await this.refreshSaved();
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Nie udało się zakończyć tury rozmowy.');
    } finally {
      this.sending.set(false);
    }
  }

  answerLabel(turn: RoundDiscussionTurn): string {
    return switchLabel(turn.answer?.status);
  }

  blockLabel(kind: string): string {
    if (kind === 'HYPOTHESIS') return 'Hipoteza';
    if (kind === 'GENERAL_GUIDANCE') return 'Wiedza ogólna';
    return 'Wyjaśnienie z dowodów';
  }

  roundRange(item = this.discussion()): string {
    const refs = item?.snapshot.selection.roundRefs ?? this.data.snapshot.selection.roundRefs;
    const numbers = item?.snapshot.rounds.map(round => round.interactionTurnIndex)
      ?? this.data.snapshot.rounds.map(round => round.interactionTurnIndex);
    return refs.length === 1 ? `M${numbers[0]}` : `M${numbers[0]}–M${numbers.at(-1)}`;
  }

  compact(value: number | null | undefined): string {
    return value == null ? '—' : new Intl.NumberFormat('pl-PL', {notation: 'compact', maximumFractionDigits: 1}).format(value);
  }

  private async load(): Promise<void> {
    const models = this.api.roundDiscussionModels();
    const saved = this.refreshSaved();
    try {
      const result = await models;
      this.models.set(result.models);
      const preferred = result.models.find(model => model.id === result.defaultModel)?.id ?? result.models[0]?.id ?? '';
      this.selectedModel.set(preferred);
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Nie udało się pobrać modeli Copilota.');
    } finally {
      this.loadingModels.set(false);
    }
    await saved;
  }

  private async refreshSaved(): Promise<void> {
    try {
      const items = await this.api.roundDiscussions(this.data.snapshot.selection.rootSessionId);
      this.saved.set(items.filter(item => item.evidenceHash === this.data.snapshot.contentHash));
    } catch {
      // Lista historycznych rozmów nie blokuje rozpoczęcia nowej rozmowy.
    }
  }
}

function switchLabel(status: RoundDiscussionAnswerStatus | undefined): string {
  if (status === 'CLARIFICATION_NEEDED') return 'Potrzebne doprecyzowanie';
  if (status === 'INSUFFICIENT_EVIDENCE') return 'Za mało dowodów';
  if (status === 'OUT_OF_SCOPE') return 'Poza wybranym zakresem';
  return 'Odpowiedź';
}
