import {computed, DestroyRef, inject, Injectable, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatDialog} from '@angular/material/dialog';
import {firstValueFrom, timer} from 'rxjs';
import {ScannerStatus, Session} from '../models/scanner.models';
import {NotificationService} from './notification.service';
import {ScannerApiService} from './scanner-api.service';
import {SCANNER_DATA} from './scanner-data-gateway';
import {FeatureAvailability} from './feature-availability.service';
import {ScannerOperationError} from '../../scanner-core/operation-error';
import type {SessionImportDialogComponent as SessionImportDialog, SessionImportDialogData} from '../features/sessions/session-import-dialog.component';

const INITIAL_STATUS: ScannerStatus = {
  paused: false,
  connected: false,
  lastSignalAt: null,
  traces: 0,
  metrics: 0,
  logs: 0,
  contentCaptured: false,
  retentionDays: 30
};

@Injectable()
export class ScannerShellStateService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ScannerApiService);
  private readonly data = inject(SCANNER_DATA);
  private readonly features = inject(FeatureAvailability);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly statusState = signal<ScannerStatus>(INITIAL_STATUS);
  private readonly sessionsState = signal<Session[]>([]);
  private readonly loadingState = signal(true);
  private readonly importingState = signal(false);
  private readonly refreshRevisionState = signal(0);
  private readonly selectedTurnCountState = signal(0);
  private polling = false;
  private pollingStarted = false;
  private importFile?: File;
  private readonly committingImport = signal(false);

  readonly status = this.statusState.asReadonly();
  readonly sessions = this.sessionsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly importing = this.importingState.asReadonly();
  readonly canCancelImport = computed(() => this.importing() && !this.committingImport() && this.features.demo);
  readonly importPhase = computed(() => this.committingImport() ? 'Zapisywanie wybranych sesji…' : this.data.importPhase?.() || 'Odczyt pliku…');
  readonly refreshRevision = this.refreshRevisionState.asReadonly();
  readonly selectedTurnCount = this.selectedTurnCountState.asReadonly();

  constructor() {
    void this.refresh();
  }

  startPolling(): void {
    if (this.features.demo) return;
    if (this.pollingStarted) return;
    this.pollingStarted = true;
    timer(2000, 2000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.pollStatus());
  }

  async refresh(): Promise<void> {
    try {
      const [status, sessions] = await Promise.all([this.data.status(), this.data.sessions()]);
      this.statusState.set(status);
      this.sessionsState.set(sessions);
      this.refreshRevisionState.update(revision => revision + 1);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się pobrać danych', () => this.refresh());
    } finally {
      this.loadingState.set(false);
    }
  }

  async togglePause(): Promise<void> {
    if (!this.features.require('receiver')) return;
    try {
      const paused = !this.status().paused;
      await this.api.setPaused(paused);
      this.statusState.update(status => ({...status, paused}));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się zmienić nasłuchiwania');
    }
  }

  async deleteAll(): Promise<boolean> {
    if (!confirm('Usunąć bezpowrotnie wszystkie sesje, prompty, wyniki narzędzi i surowe payloady?')) return false;
    try {
      await this.data.deleteAll();
      this.selectedTurnCountState.set(0);
      return true;
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się usunąć danych.');
      return false;
    }
  }

  async importSession(file: File): Promise<number | undefined> {
    if (this.importing()) return undefined;
    this.importingState.set(true);
    this.importFile = file;
    try {
      const preview = await this.data.previewSessionImport(file);
      const {SessionImportDialogComponent} = await import('../features/sessions/session-import-dialog.component');
      const selection = await firstValueFrom(this.dialog.open<SessionImportDialog, SessionImportDialogData, string | string[]>(SessionImportDialogComponent, {
        data: {fileName: file.name, preview, ...(this.data.multipleSelection ? {multiple: true, local: true} : {})},
        width: 'min(760px, calc(100vw - 32px))',
        maxWidth: '760px',
        maxHeight: '90dvh',
        autoFocus: 'dialog',
        restoreFocus: true
      }).afterClosed());
      if (!selection || Array.isArray(selection) && !selection.length) return undefined;
      this.committingImport.set(true);
      const result = await this.data.importSessions(file, Array.isArray(selection) ? selection : [selection]);
      await this.refresh();
      this.notifications.success(result.sessionIds.length === 1 ? 'Sesja została zaimportowana.' : `Zaimportowano sesje: ${result.sessionIds.length}.`);
      return result.sessionId;
    } catch (error) {
      if (error instanceof ScannerOperationError && error.code === 'cancelled') return undefined;
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się zaimportować sesji');
      return undefined;
    } finally {
      this.data.releaseImport(file);
      this.importFile = undefined;
      this.committingImport.set(false);
      this.importingState.set(false);
    }
  }

  cancelImport(): void {
    if (this.canCancelImport() && this.importFile) this.data.releaseImport(this.importFile);
  }

  setSelectedTurnCount(count: number): void {
    this.selectedTurnCountState.set(count);
  }

  private async pollStatus(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const status = await this.api.status();
      const tracesChanged = status.traces !== this.status().traces;
      const statusChanged = JSON.stringify(status) !== JSON.stringify(this.status());
      if (tracesChanged) await this.refresh();
      else if (statusChanged) this.statusState.set(status);
    } catch {
      // A temporary receiver failure is retried by the next polling cycle.
    } finally {
      this.polling = false;
    }
  }
}
