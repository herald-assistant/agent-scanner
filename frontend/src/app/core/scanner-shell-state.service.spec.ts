import {TestBed} from '@angular/core/testing';
import {MatDialog} from '@angular/material/dialog';
import {Subject} from 'rxjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScannerApiService} from './scanner-api.service';
import {ScannerShellStateService} from './scanner-shell-state.service';
import {NotificationService} from './notification.service';

describe('JSONL import flow', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const selection = new Subject<string | undefined>();
    const open = vi.fn(() => ({afterClosed: () => selection}));
    const preview = {sessions: [{conversationId: 'a'}, {conversationId: 'b'}], ignoredRecords: 0, duplicateRecords: 0, unassignedSpans: 0};
    const api = {status: vi.fn(async () => ({})), sessions: vi.fn(async () => []),
      previewSessionImport: vi.fn(async () => preview), importSession: vi.fn(async () => ({sessionId: 42}))};
    const notifications = {success: vi.fn(), error: vi.fn()};
    TestBed.configureTestingModule({providers: [ScannerShellStateService,
      {provide: ScannerApiService, useValue: api}, {provide: MatDialog, useValue: {open}},
      {provide: NotificationService, useValue: notifications}]});
    return {state: TestBed.inject(ScannerShellStateService), api, notifications, selection, open, preview};
  }

  it('saves only after choosing one session in the dedicated modal', async () => {
    const {state, api, notifications, selection, open, preview} = setup();
    const file = new File(['synthetic'], 'copilot-otel.jsonl');
    const result = state.importSession(file);
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(open.mock.calls[0]).toEqual([expect.any(Function), expect.objectContaining({data: {fileName: file.name, preview}})]);
    expect(api.importSession).not.toHaveBeenCalled();
    expect(state.importing()).toBe(true);
    selection.next('b');
    selection.complete();
    expect(await result).toBe(42);
    expect(api.importSession).toHaveBeenCalledExactlyOnceWith(file, 'b');
    expect(notifications.success).toHaveBeenCalledOnce();
    expect(state.importing()).toBe(false);
  });

  it('cancels without persisting or showing a success message', async () => {
    const {state, api, notifications, selection, open} = setup();
    const result = state.importSession(new File(['synthetic'], 'fixture.jsonl'));
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    selection.next(undefined);
    selection.complete();
    expect(await result).toBeUndefined();
    expect(api.importSession).not.toHaveBeenCalled();
    expect(notifications.success).not.toHaveBeenCalled();
    expect(state.importing()).toBe(false);
  });

  it('reports a broken file before opening the selector', async () => {
    const {state, api, notifications, open} = setup();
    api.previewSessionImport.mockRejectedValueOnce(new Error('Niepoprawny rekord JSONL w wierszu 2.'));
    expect(await state.importSession(new File(['broken'], 'fixture.jsonl'))).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(api.importSession).not.toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledWith('Niepoprawny rekord JSONL w wierszu 2.');
  });
});
