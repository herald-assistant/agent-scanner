import {ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ToolClassificationService} from '../../core/tool-classification.service';
import {NotificationService} from '../../core/notification.service';
import {ScannerApiService} from '../../core/scanner-api.service';
import {estimateClassificationTokens, flowToolCatalog} from '../../core/flow-tool-catalog';
import {buildAiQuickAnalysis, AiQuickCategory, quickInteractions} from '../../core/ai-quick-analysis';
import {ContextCompactionMeasurement} from '../../models/scanner.models';
import {SessionChatSummary, SessionChatView} from '../../models/session-chat.models';
import {WorkflowAnalysis} from '../../models/workflow.models';
import {ROUND_CATEGORIES} from '../workflow/tool-category-labels';
import {OptimizationGuidanceContext, OptimizationGuidanceEvidence, OptimizationGuidanceOpenRequest} from '../../models/optimization-guidance.models';
import {ToolClassificationStatus} from '../../models/tool-classification.models';

const HINTS: Record<string, string> = {
  ACQUIRE_DATA: 'Sprawdź rozmiar wyników narzędzi, możliwość zwracania krótszych wycinków oraz użycie narzędzia wyspecjalizowanego w zadaniu.',
  MODIFY: 'Sprawdź, czy zmiany można grupować w mniej żądań i precyzyjniej wskazywać zakres modyfikacji.',
  WRITE_INTERMEDIATE: 'Sprawdź, czy pełny rezultat pośredni musi wracać do rozmowy, czy wystarczy krótka referencja.',
  WRITE_FINAL: 'Sprawdź, czy końcowy zapis odbywa się jednym precyzyjnym żądaniem i nie powiela wcześniejszej treści.',
  VALIDATE: 'Sprawdź, czy walidację można ograniczyć do zmienionego obszaru.',
  DELEGATE: 'Sprawdź zakres zleceń subagentów oraz czy równoległe zadania nie powielają pracy.',
  MANAGE_CONTEXT: 'Sprawdź, które dane są zachowywane po kompaktowaniu i czy długie wyniki można zastąpić referencją.',
  RESPOND: 'Sprawdź wymaganą długość i format odpowiedzi oraz czy agent nie tworzy podobnych podsumowań.',
  OTHER: 'Otwórz przypisane rundy i doprecyzuj znaczenie działania przed sformułowaniem rekomendacji.',
  UNKNOWN: 'Brakuje wystarczających danych do rekomendacji. Najpierw sprawdź treść odpowiedzi modelu i definicje narzędzi.',
  CONTEXT_COMPACTION: 'Sprawdź koszt wejścia kompaktora, rozmiar streszczenia oraz czy wynik został użyty później.'
};

@Component({
  selector: 'as-ai-hub',
  imports: [MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './ai-hub.component.html',
  styleUrl: './ai-hub.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiHubComponent {
  readonly analysis = input.required<WorkflowAnalysis>();
  readonly contextCompactions = input<ContextCompactionMeasurement[]>([]);
  readonly optimizationGuide = output<OptimizationGuidanceOpenRequest>();
  readonly evidenceSelected = output<string>();
  private readonly classification = inject(ToolClassificationService);
  private readonly notifications = inject(NotificationService);
  private readonly api = inject(ScannerApiService);
  private readonly dialog = inject(MatDialog);
  private readonly selectedInteraction = signal<{sessionId: number; traceId: string} | undefined>(undefined);
  readonly restoring = signal(false);
  readonly historyLoading = signal(false);
  readonly chatOpening = signal(false);
  readonly conversations = signal<SessionChatSummary[]>([]);
  readonly runtime = signal<ToolClassificationStatus | undefined>(undefined);
  private loadedScope = '';
  readonly catalog = computed(() => flowToolCatalog(this.analysis()));
  readonly interactions = computed(() => quickInteractions(this.analysis()));
  readonly interaction = computed(() => this.interactions().find(item =>
    this.selectedInteraction()?.sessionId === this.analysis().source.session.id
      && item.traceId === this.selectedInteraction()?.traceId) ?? this.interactions()[0]);
  readonly classificationEstimate = computed(() => estimateClassificationTokens(this.catalog().request));
  readonly result = computed(() => this.classification.result(this.analysis().source.session.id, this.catalog()));
  readonly hasResult = computed(() => this.classification.hasResult(this.analysis().source.session.id, this.catalog()));
  readonly classifying = computed(() => !!this.classification.pending());
  readonly quickAnalysis = computed(() => {
    const result = this.result(), interaction = this.interaction();
    return result && interaction
      ? buildAiQuickAnalysis(this.analysis(), this.catalog(), result, this.contextCompactions(), interaction.traceId)
      : undefined;
  });
  readonly lastConversation = computed(() => this.conversations()[0]);
  readonly modelLabel = computed(() => this.result()?.model ?? this.runtime()?.model ?? 'model skonfigurowany w Scannerze');
  private readonly numberFormat = new Intl.NumberFormat('pl-PL', {maximumFractionDigits: 2});
  private readonly creditFormat = new Intl.NumberFormat('pl-PL', {maximumFractionDigits: 3});
  private readonly compactFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact', maximumFractionDigits: 1});
  private readonly dateFormat = new Intl.DateTimeFormat('pl-PL', {dateStyle: 'medium', timeStyle: 'short'});

  constructor() {
    effect(() => {
      const sessionId = this.analysis().source.session.id;
      const catalog = this.catalog();
      const scope = `${sessionId}:${catalog.key}`;
      if (scope === this.loadedScope) return;
      this.loadedScope = scope;
      this.selectedInteraction.set(undefined);
      this.restoring.set(true);
      void Promise.all([
        this.classification.restore(sessionId, catalog),
        this.loadHistory(sessionId),
        this.api.toolClassificationStatus().then(status => this.runtime.set(status)).catch(() => this.runtime.set(undefined))
      ]).catch(error => this.notifications.error(error instanceof Error ? error.message : 'Nie udało się odczytać danych AI Hub.'))
        .finally(() => { if (scope === this.loadedScope) this.restoring.set(false); });
    });
  }

  selectInteraction(traceId: string): void {
    this.selectedInteraction.set({sessionId: this.analysis().source.session.id, traceId});
  }

  async classify(): Promise<void> {
    const sessionId = this.analysis().source.session.id;
    try { await this.classification.classify(sessionId, this.catalog()); }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'Nie udało się wykonać Quick Analysis.'); }
  }

  async newChat(): Promise<void> { await this.openChat(); }

  async continueLast(): Promise<void> {
    const last = this.lastConversation();
    if (!last) return;
    this.chatOpening.set(true);
    try { await this.openChat(await this.api.sessionChat(last.sessionId, last.id)); }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'Nie udało się otworzyć ostatniej rozmowy.'); }
    finally { this.chatOpening.set(false); }
  }

  async openHistory(): Promise<void> {
    this.chatOpening.set(true);
    try {
      const {SessionChatHistoryDialogComponent} = await import('../session-chat/session-chat-history-dialog.component');
      const history = this.dialog.open(SessionChatHistoryDialogComponent, {
        data: {sessionId: this.analysis().source.session.id}, width: 'min(780px, calc(100vw - 40px))', maxWidth: '780px',
        height: 'min(70vh, 680px)', maxHeight: '680px', panelClass: 'session-chat-history-dialog-panel',
        autoFocus: 'dialog', restoreFocus: true
      });
      history.afterClosed().subscribe((chat: SessionChatView | undefined) => {
        if (chat) void this.openChat(chat);
        void this.loadHistory(this.analysis().source.session.id);
      });
    } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'Nie udało się otworzyć historii rozmów.'); }
    finally { this.chatOpening.set(false); }
  }

  openCategoryGuidance(item: AiQuickCategory, origin?: EventTarget | null): void {
    const label = this.categoryLabel(item), interaction = this.quickAnalysis();
    const evidence: OptimizationGuidanceEvidence[] = item.roundRefs.map(ref => ({kind: 'ROUND', id: ref,
      label: this.roundEvidenceLabel(ref), description: 'Otwórz faktyczny cykl M → A → M powiązany z kategorią.'}));
    evidence.push(...item.compactionRefs.map(ref => ({kind: 'COMPACTION' as const, id: ref,
      label: `K${this.compactionNumber(ref)}`, description: 'Otwórz zmierzone wywołanie kompaktowania i jego rezultat.'})));
    const context: OptimizationGuidanceContext = {
      kind: item.action ? 'CATEGORY' : 'COMPACTION', title: label,
      scopeLabel: `interakcja ${interaction?.interactionIndex ?? '—'}`,
      explanation: item.estimated
        ? 'Kategoria pochodzi z zapisanej analizy AI. Podział credits jest lokalną estymacją; otwarcie poradnika nie uruchamia modelu.'
        : 'Kompaktowanie jest osobnym wywołaniem rozpoznanym w telemetrii i nie zostało sklasyfikowane przez AI.',
      topics: item.action ? [item.action] : ['CONTEXT_COMPACTION'],
      measurement: {credits: item.totalCredits, shareOfKnown: item.shareOfKnown, creditEstimated: item.estimated,
        coveredCalls: item.coveredCalls, totalCalls: item.totalCalls},
      evidenceLabels: [HINTS[item.id], item.estimated ? '≈ oznacza estymację udziału, nie cenę.' : 'Credits pochodzą z telemetrii.'],
      evidence
    };
    this.optimizationGuide.emit({context, origin: origin ?? null});
  }

  categoryLabel(item: AiQuickCategory): string {
    return item.action ? ROUND_CATEGORIES[item.action].label : 'Kompaktowanie kontekstu';
  }
  categoryIcon(item: AiQuickCategory): string { return item.action ? ROUND_CATEGORIES[item.action].icon : 'compress'; }
  categoryHint(item: AiQuickCategory): string { return HINTS[item.id]; }
  percent(value: number | null): string { return value == null ? '—' : `${this.numberFormat.format(value)}%`; }
  credits(value: number | null): string {
    if (value == null) return '—';
    if (value !== 0 && Math.abs(value) < 0.001) return value > 0 ? '< 0,001' : '> -0,001';
    return this.creditFormat.format(value);
  }
  compact(value: number): string { return this.compactFormat.format(value); }
  date(value: string): string { return this.dateFormat.format(new Date(value)); }
  turnLabel(count: number | null | undefined): string {
    if (count == null || !Number.isFinite(count)) return 'liczba tur niedostępna';
    return count === 1 ? '1 tura' : count > 1 && count < 5 ? `${count} tury` : `${count} tur`;
  }
  assignedShare(): string {
    const view = this.quickAnalysis();
    return !view || view.assignedCredits == null || view.knownCredits == null || view.knownCredits <= 0
      ? '—' : `≈ ${this.percent(view.assignedCredits / view.knownCredits * 100)}`;
  }
  unattributedShare(): string {
    const view = this.quickAnalysis();
    return !view || view.unattributedCredits == null || view.knownCredits == null || view.knownCredits <= 0
      ? '—' : `≈ ${this.percent(view.unattributedCredits / view.knownCredits * 100)}`;
  }

  private async loadHistory(sessionId: number): Promise<void> {
    this.historyLoading.set(true);
    try { this.conversations.set(await this.api.sessionChats(sessionId)); }
    catch (error) {
      this.conversations.set([]);
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się pobrać historii rozmów.');
    } finally { this.historyLoading.set(false); }
  }

  private async openChat(initialChat?: SessionChatView): Promise<void> {
    this.chatOpening.set(true);
    try {
      const {SessionChatDialogComponent} = await import('../session-chat/session-chat-dialog.component');
      const ref = this.dialog.open(SessionChatDialogComponent, {data: {
        sessionId: this.analysis().source.session.id, initialChat,
        openEvidence: (evidenceRef: string) => this.evidenceSelected.emit(evidenceRef)
      }, width: 'calc(100vw - 48px)', maxWidth: 'none', height: 'calc(100vh - 48px)', maxHeight: 'none',
        panelClass: 'session-chat-dialog-panel', autoFocus: 'dialog', restoreFocus: true});
      ref.afterClosed().subscribe(() => void this.loadHistory(this.analysis().source.session.id));
    } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'Nie udało się otworzyć rozmowy.'); }
    finally { this.chatOpening.set(false); }
  }

  private roundEvidenceLabel(ref: string): string {
    const round = this.quickAnalysis()?.rounds.find(item => item.ref === ref);
    return round ? `M${round.turn.interactionTurnIndex}` : ref;
  }
  private compactionNumber(ref: string): number {
    return [...this.contextCompactions()].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
      .findIndex(item => item.id === ref) + 1;
  }
}
