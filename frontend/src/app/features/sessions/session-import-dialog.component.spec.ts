import {TestBed} from '@angular/core/testing';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SessionImportCandidate} from '../../models/scanner.models';
import {SessionImportDialogComponent} from './session-import-dialog.component';

describe('session JSONL selection dialog', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('selects multiple local roots in preview order, supports deselection and disables conflicts', () => {
    const close = vi.fn();
    TestBed.configureTestingModule({providers: [
      {provide: MatDialogRef, useValue: {close}},
      {provide: MAT_DIALOG_DATA, useValue: {fileName: 'fixture.jsonl', multiple: true, local: true, preview: {
        sessions: [candidate('a'), candidate('b'), candidate('saved', true)], ignoredRecords: 0, duplicateRecords: 0, unassignedSpans: 0
      }}}
    ]});
    const fixture = TestBed.createComponent(SessionImportDialogComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const checks = [...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks).toHaveLength(3);
    expect(checks[2].disabled).toBe(true);
    checks[1].click(); checks[0].click(); fixture.detectChanges();
    expect(element.textContent).toContain('Wybrano: 2 · spany: 6');
    checks[1].click(); fixture.detectChanges();
    expect(element.textContent).toContain('Wybrano: 1 · spany: 3');
    checks[1].click(); fixture.detectChanges();
    (element.querySelectorAll('mat-dialog-actions button')[1] as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(element.textContent).toContain('IndexedDB');
    fixture.destroy();
  });

  it('requires an explicit single selection and prevents importing existing data', () => {
    const close = vi.fn();
    TestBed.configureTestingModule({providers: [
      {provide: MatDialogRef, useValue: {close}},
      {provide: MAT_DIALOG_DATA, useValue: {fileName: 'copilot-otel.jsonl', preview: {
        sessions: [candidate('a'), candidate('b'), candidate('saved', true)], ignoredRecords: 2, duplicateRecords: 1, unassignedSpans: 0
      }}}
    ]});
    const fixture = TestBed.createComponent(SessionImportDialogComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const radios = [...element.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')];
    const confirm = buttons[1];
    expect(radios).toHaveLength(3);
    expect(radios.every(radio => !radio.checked)).toBe(true);
    expect(confirm.disabled).toBe(true);
    expect(radios[2].disabled).toBe(true);
    expect(element.textContent).toContain('copilot-otel.jsonl');
    radios[0].click();
    fixture.detectChanges();
    radios[1].click();
    fixture.detectChanges();
    expect(radios.filter(radio => radio.checked)).toHaveLength(1);
    confirm.click();
    expect(close).toHaveBeenCalledExactlyOnceWith('b');
    fixture.destroy();
  });

  it('cancels without returning a session', () => {
    const close = vi.fn();
    TestBed.configureTestingModule({providers: [
      {provide: MatDialogRef, useValue: {close}},
      {provide: MAT_DIALOG_DATA, useValue: {fileName: 'fixture.jsonl', preview: {
        sessions: [candidate('a')], ignoredRecords: 0, duplicateRecords: 0, unassignedSpans: 0
      }}}
    ]});
    const fixture = TestBed.createComponent(SessionImportDialogComponent);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('mat-dialog-actions button') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledExactlyOnceWith();
    fixture.destroy();
  });

  it('shows one conversation with separate main, child and auxiliary counts and second precision', () => {
    TestBed.configureTestingModule({providers: [
      {provide: MatDialogRef, useValue: {close: vi.fn()}},
      {provide: MAT_DIALOG_DATA, useValue: {fileName: 'copilot-otel.jsonl', preview: {
        sessions: [{...candidate('main'), turns: 2, relatedSessions: 1, relatedTurns: 2, auxiliaryCalls: 1, spans: 10,
          startedAt: '2026-01-01T10:00:05Z', endedAt: '2026-01-01T10:00:15Z'}],
        ignoredRecords: 217, duplicateRecords: 0, unassignedSpans: 6
      }}}
    ]});
    const fixture = TestBed.createComponent(SessionImportDialogComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('input[type="radio"]')).toHaveLength(1);
    expect(element.textContent).toContain('znalezione sesje: 1');
    expect(element.textContent).toContain('rundy głównego agenta: 2');
    expect(element.textContent).toContain('rundy subagentów: 2');
    expect(element.textContent).toContain('Wywołania pomocnicze modelu: 1');
    expect(element.textContent).toContain('Spany w wybranym zakresie importu: 10');
    expect(element.textContent).toContain('Spany bez jednoznacznego powiązania z rozmową: 6');
    expect(element.textContent).toMatch(/:05.*—.*:15/);
    fixture.destroy();
  });
});

function candidate(conversationId: string, alreadyImported = false): SessionImportCandidate {
  return {conversationId, agentName: 'Synthetic agent', repository: null, model: 'fixture-model',
    startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T10:01:00Z', spans: 3, turns: 1,
    relatedSessions: 0, relatedTurns: 0, auxiliaryCalls: 0, contentCaptured: true, alreadyImported};
}
