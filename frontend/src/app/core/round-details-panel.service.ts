import {Injectable, TemplateRef, signal} from '@angular/core';
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

export type RoundDetailsPanelState =
  | {kind: 'round'; ariaLabel: string; data: RoundDetailsPanelData; navigation?: RoundDetailsPanelNavigation}
  | {kind: 'template'; ariaLabel: string; eyebrow: string; title: string; template: TemplateRef<unknown>; context: object | null; navigation?: RoundDetailsPanelNavigation};

@Injectable({providedIn: 'root'})
export class RoundDetailsPanelService {
  private readonly panelState = signal<RoundDetailsPanelState | null>(null);
  private returnFocus: HTMLElement | null = null;
  readonly panel = this.panelState.asReadonly();

  openRound(data: Omit<RoundDetailsPanelData, 'subagent' | 'mode'> & {subagent?: boolean; mode?: RoundDetailsPanelData['mode']}, ariaLabel: string, origin?: EventTarget | null,
            navigation?: RoundDetailsPanelNavigation): void {
    this.rememberOrigin(origin);
    this.panelState.set({kind: 'round', ariaLabel, data: {...data, subagent: data.subagent ?? false, mode: data.mode ?? 'request'}, navigation});
  }

  openTemplate(template: TemplateRef<unknown>, context: object | null, eyebrow: string, title: string, ariaLabel: string, origin?: EventTarget | null,
               navigation?: RoundDetailsPanelNavigation): void {
    this.rememberOrigin(origin);
    this.panelState.set({kind: 'template', ariaLabel, eyebrow, title, template, context, navigation});
  }

  previous(): void { this.panelState()?.navigation?.previous?.(); }
  next(): void { this.panelState()?.navigation?.next?.(); }

  close(): void {
    if (!this.panelState()) return;
    this.panelState.set(null);
    const target = this.returnFocus;
    this.returnFocus = null;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }

  private rememberOrigin(origin?: EventTarget | null): void {
    if (origin instanceof HTMLElement && !origin.closest('[data-round-details-aside]')) this.returnFocus = origin;
  }
}
