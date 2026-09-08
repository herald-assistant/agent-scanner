import {computed, Injectable, TemplateRef, signal} from '@angular/core';
import {MessageRecord, ModelTurn, SpanRecord} from '../models/scanner.models';

export interface RoundDetailsPanelData {
  turn: ModelTurn;
  sourceTurn?: ModelTurn;
  mode: 'request' | 'cycle' | 'final';
  messages: MessageRecord[];
  calibrationSpans: SpanRecord[];
  headingContext: string;
  subagent: boolean;
}

export interface RoundDetailsPanelNavigation {
  previous?: () => void;
  next?: () => void;
}

export type RoundDetailsPanelOpenMode = 'reset' | 'push' | 'replace';

export type RoundDetailsPanelState =
  | {id: number; kind: 'round'; ariaLabel: string; data: RoundDetailsPanelData; navigation?: RoundDetailsPanelNavigation}
  | {id: number; kind: 'template'; ariaLabel: string; eyebrow: string; title: string; template: TemplateRef<unknown>; context: object | null; navigation?: RoundDetailsPanelNavigation};

@Injectable({providedIn: 'root'})
export class RoundDetailsPanelService {
  private readonly panelStack = signal<RoundDetailsPanelState[]>([]);
  private returnFocus: HTMLElement | null = null;
  private backFocus: HTMLElement[] = [];
  private nextPanelId = 1;
  readonly panels = this.panelStack.asReadonly();
  readonly panel = computed(() => this.panelStack().at(-1) ?? null);
  readonly canGoBack = computed(() => this.panelStack().length > 1);

  openRound(data: Omit<RoundDetailsPanelData, 'subagent' | 'mode'> & {subagent?: boolean; mode?: RoundDetailsPanelData['mode']}, ariaLabel: string, origin?: EventTarget | null,
            navigation?: RoundDetailsPanelNavigation, mode: RoundDetailsPanelOpenMode = 'reset'): void {
    this.open({id: this.nextPanelId++, kind: 'round', ariaLabel,
      data: {...data, subagent: data.subagent ?? false, mode: data.mode ?? 'request'}, navigation}, origin, mode);
  }

  openTemplate(template: TemplateRef<unknown>, context: object | null, eyebrow: string, title: string, ariaLabel: string, origin?: EventTarget | null,
               navigation?: RoundDetailsPanelNavigation, mode: RoundDetailsPanelOpenMode = 'reset'): void {
    this.open({id: this.nextPanelId++, kind: 'template', ariaLabel, eyebrow, title, template, context, navigation}, origin, mode);
  }

  previous(): void { this.panel()?.navigation?.previous?.(); }
  next(): void { this.panel()?.navigation?.next?.(); }

  back(): void {
    if (!this.canGoBack()) return;
    this.panelStack.update(stack => stack.slice(0, -1));
    const target = this.backFocus.pop();
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }

  close(): void {
    if (!this.panel()) return;
    this.panelStack.set([]);
    const target = this.returnFocus;
    this.returnFocus = null;
    this.backFocus = [];
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }

  private open(state: RoundDetailsPanelState, origin: EventTarget | null | undefined, mode: RoundDetailsPanelOpenMode): void {
    if (mode === 'push' && this.panel()) {
      if (origin instanceof HTMLElement) this.backFocus.push(origin);
      this.panelStack.update(stack => [...stack, state]);
      return;
    }
    if (mode === 'replace' && this.panel()) {
      this.panelStack.update(stack => [...stack.slice(0, -1), state]);
      return;
    }
    this.rememberOrigin(origin);
    this.backFocus = [];
    this.panelStack.set([state]);
  }

  private rememberOrigin(origin?: EventTarget | null): void {
    if (origin instanceof HTMLElement && !origin.closest('[data-round-details-aside]')) this.returnFocus = origin;
  }
}
