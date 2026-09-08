import {DestroyRef, inject, Injectable, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {timer} from 'rxjs';
import {ScannerStatus, Session} from '../models/scanner.models';
import {NotificationService} from './notification.service';
import {ScannerApiService} from './scanner-api.service';

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
  private readonly notifications = inject(NotificationService);
  private readonly statusState = signal<ScannerStatus>(INITIAL_STATUS);
  private readonly sessionsState = signal<Session[]>([]);
  private readonly loadingState = signal(true);
  private readonly importingState = signal(false);
  private readonly refreshRevisionState = signal(0);
  private readonly selectedTurnCountState = signal(0);
  private polling = false;
  private pollingStarted = false;

  readonly status = this.statusState.asReadonly();
  readonly sessions = this.sessionsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly importing = this.importingState.asReadonly();
  readonly refreshRevision = this.refreshRevisionState.asReadonly();
  readonly selectedTurnCount = this.selectedTurnCountState.asReadonly();

  constructor() {
    void this.refresh();
  }

  startPolling(): void {
    if (this.pollingStarted) return;
    this.pollingStarted = true;
    timer(2000, 2000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.pollStatus());
  }

  async refresh(): Promise<void> {
    try {
      const [status, sessions] = await Promise.all([this.api.status(), this.api.sessions()]);
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
    await this.api.deleteAll();
    this.selectedTurnCountState.set(0);
    return true;
  }

  async importSession(file: File): Promise<number | undefined> {
    this.importingState.set(true);
    try {
      const result = await this.api.importSession(file);
      await this.refresh();
      this.notifications.success('Sesja została zaimportowana.');
      return result.sessionId;
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'Nie udało się zaimportować sesji');
      return undefined;
    } finally {
      this.importingState.set(false);
    }
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
