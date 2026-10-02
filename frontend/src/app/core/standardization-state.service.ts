import {computed, inject, Injectable, signal} from '@angular/core';
import {ScannerApiService} from './scanner-api.service';
import {discoverRepository, RepositoryFile, RepositorySelection} from './standardization-files';
import {RepositoryGitMetadata, RepositoryReportFile, SavedStandardAnalysis, StandardCatalog, StandardPreview, StandardRepositorySnapshot, StandardResult, StandardSnapshotRequest} from '../models/standardization.models';
import {readGitMetadata, readReportFiles} from './repository-report-files';
import {SessionChatModel} from '../models/session-chat.models';
import {FeatureAvailability} from './feature-availability.service';
import {StandardizationRepositoryService} from './standardization-repository.service';
import {StandardizationHistoryService} from './standardization-history.service';

@Injectable({providedIn: 'root'})
export class StandardizationStateService {
  private readonly api = inject(ScannerApiService);
  private readonly features = inject(FeatureAvailability);
  private readonly repositories = inject(StandardizationRepositoryService);
  private readonly history = inject(StandardizationHistoryService);
  private saving: Promise<void> = Promise.resolve();
  private generation = 0;
  readonly snapshot = signal<StandardRepositorySnapshot | null>(null);
  readonly git = signal<RepositoryGitMetadata | null>(null);
  readonly reportFiles = signal<RepositoryReportFile[]>([]);
  readonly savingFiles = signal(false);
  readonly filesSaved = signal(false);
  readonly catalog = signal<StandardCatalog | null>(null);
  readonly models = signal<SessionChatModel[]>([]);
  readonly model = signal('');
  readonly folder = signal<RepositorySelection | null>(null);
  readonly files = signal<RepositoryFile[]>([]);
  readonly inventoryComplete = signal(true);
  readonly reading = signal(false);
  readonly choosingFolder = signal(false);
  readonly preparing = signal(false);
  readonly sending = signal(false);
  readonly cancelRequested = signal(false);
  readonly loadingModels = signal(false);
  readonly error = signal('');
  readonly modelError = signal('');
  readonly catalogError = signal('');
  readonly preview = signal<StandardPreview | null>(null);
  readonly result = signal<StandardResult | null>(null);
  readonly usedPreview = signal(false);
  readonly saved = signal(false);
  readonly repositoryId = signal<string | null>(null);
  readonly expectedRepositoryName = signal('');
  readonly selected = computed(() => this.files().filter(file => file.selected && !file.error));
  readonly bytes = computed(() => this.selected().reduce((sum, file) => sum + file.bytes, 0));
  readonly busy = computed(() => this.choosingFolder() || this.reading() || this.savingFiles() || this.preparing() || this.sending());
  readonly limits = computed(() => this.catalog()?.limits ?? {maxFiles: 80, maxFileBytes: 131072, maxTotalBytes: 1048576});
  readonly canRun = computed(() => !this.saved() && this.filesSaved() && !!this.snapshot() && !this.busy()
    && this.selected().some(file => file.category !== 'CONTEXT')
    && this.selected().length <= this.limits().maxFiles && this.bytes() <= this.limits().maxTotalBytes);
  readonly canPrepare = computed(() => !this.features.demo && this.canRun() && !!this.catalog()
    && !this.modelError() && !this.catalogError() && this.models().some(model => model.id === this.model()));

  async initialize(refresh = false): Promise<void> {
    if (this.features.demo) return;
    if (this.loadingModels()) return;
    this.loadingModels.set(true);
    const results = await Promise.allSettled([
      this.catalog() && !refresh ? Promise.resolve(this.catalog()!) : this.api.standardizationCatalog(),
      this.api.sessionChatModels(refresh)
    ]);
    const [catalog, models] = results;
    if (catalog.status === 'fulfilled') { this.catalog.set(catalog.value); this.catalogError.set(''); }
    else this.catalogError.set(message(catalog.reason, 'Nie udało się pobrać wymagań.'));
    if (models.status === 'fulfilled') {
      this.models.set(models.value.models);
      if (!models.value.models.some(item => item.id === this.model())) {
        const next = models.value.models.find(item => item.id === models.value.defaultModel)?.id ?? models.value.models[0]?.id ?? '';
        if (!this.saved()) { this.model.set(next); this.invalidate(); }
      }
      this.modelError.set(models.value.models.length ? '' : 'Konto nie udostępnia żadnego modelu.');
    } else this.modelError.set(message(models.reason, 'Nie udało się pobrać modeli.'));
    this.loadingModels.set(false);
  }

  async loadFolder(selection: RepositorySelection): Promise<void> {
    if (this.busy() || this.saved()) return;
    if (this.repositoryId() && selection.name !== this.expectedRepositoryName()) {
      this.error.set(`Wybierz folder repozytorium „${this.expectedRepositoryName()}” albo rozpocznij analizę nowego repozytorium.`);
      return;
    }
    this.invalidate();
    this.snapshot.set(null);
    this.filesSaved.set(false);
    this.saved.set(false);
    this.folder.set(selection);
    this.files.set([]);
    this.reportFiles.set([]);
    this.git.set(null);
    this.error.set('');
    this.reading.set(true);
    try {
      const [result, reportFiles, git] = await Promise.all([discoverRepository(selection), readReportFiles(selection), readGitMetadata(selection)]);
      this.files.set(result.files);
      this.reportFiles.set(reportFiles.files);
      this.git.set(git);
      this.inventoryComplete.set(result.complete && reportFiles.complete);
      await this.persistFiles();
    } catch (failure) {
      this.inventoryComplete.set(false);
      this.error.set(message(failure, 'Nie udało się odczytać katalogu.'));
    } finally { this.reading.set(false); }
  }
  async toggle(path: string, selected: boolean): Promise<void> {
    if (this.busy() || this.saved()) return;
    this.files.update(files => files.map(file => file.path === path && !file.error ? {...file, selected} : file));
    this.invalidate();
    await this.persistFiles().catch(() => undefined);
  }
  async selectAll(selected: boolean): Promise<void> {
    if (this.busy() || this.saved()) return;
    this.files.update(files => files.map(file => file.error ? file : {...file, selected}));
    this.invalidate();
    await this.persistFiles().catch(() => undefined);
  }
  setModel(value: string): void { if (!this.busy() && !this.saved() && this.model() !== value) { this.model.set(value); this.invalidate(); } }

  async prepare(): Promise<void> {
    if (!this.canPrepare()) return;
    this.invalidate();
    this.preparing.set(true);
    this.error.set('');
    try {
      const snapshot = this.snapshot()!;
      const preview = await this.api.prepareRepositorySnapshot(snapshot.repositoryId, snapshot.id, this.model());
      this.preview.set(preview);
    } catch (failure) { this.error.set(message(failure, 'Nie udało się przygotować podglądu.')); }
    finally { this.preparing.set(false); }
  }

  async send(): Promise<SavedStandardAnalysis | undefined> {
    if (this.features.demo) return;
    const preview = this.preview();
    if (!preview || this.busy() || this.usedPreview()) return;
    if (Date.parse(preview.expiresAt) <= Date.now()) { this.error.set('Podgląd wygasł. Przygotuj go ponownie.'); return; }
    this.sending.set(true);
    this.error.set('');
    this.cancelRequested.set(false);
    try {
      this.usedPreview.set(true);
      const saved = await this.api.analyzeAndSaveStandardization(preview.id, this.repositoryId(), this.folder()?.name ?? '');
      this.result.set(saved.result);
      this.repositoryId.set(saved.repositoryId);
      this.saved.set(true);
      return saved;
    } catch (failure) {
      this.usedPreview.set(false);
      this.error.set(message(failure, 'Nie udało się zakończyć i zapisać analizy AI.'));
      return undefined;
    }
    finally { this.sending.set(false); }
  }
  beginNew(repositoryId: string | null = null, repositoryName = ''): void {
    this.generation++;
    this.snapshot.set(null);
    this.git.set(null);
    this.reportFiles.set([]);
    this.savingFiles.set(false);
    this.filesSaved.set(false);
    this.invalidate();
    this.saved.set(false);
    this.repositoryId.set(repositoryId);
    this.expectedRepositoryName.set(repositoryName);
    this.folder.set(null);
    this.files.set([]);
    this.error.set('');
  }
  loadSaved(saved: SavedStandardAnalysis, repositoryName: string, snapshot?: StandardRepositorySnapshot): void {
    this.generation++;
    this.snapshot.set(snapshot ?? null);
    this.git.set(snapshot?.git ?? null);
    this.reportFiles.set(snapshot?.reportFiles ?? []);
    this.savingFiles.set(false);
    this.filesSaved.set(true);
    this.invalidate();
    this.repositoryId.set(saved.repositoryId);
    this.expectedRepositoryName.set(repositoryName);
    this.folder.set({name: repositoryName, entries: [], complete: saved.preview.packet.inventoryComplete,
      gitDetected: snapshot?.gitDetected ?? false, refreshable: false});
    this.files.set(snapshot ? snapshot.files.map(file => ({...file, omissionReason: file.omissionReason ?? undefined,
      error: file.omissionReason && file.omissionReason !== 'EXCLUDED' ? 'Plik pominięty: ' + file.omissionReason : undefined,
      read: async () => new File([file.content], file.path)})) : saved.preview.packet.files.map(file => ({
      path: file.path, category: file.category, content: file.content,
      bytes: new TextEncoder().encode(file.content).length, redacted: file.redacted,
      selected: true, read: async () => new File([file.content], file.path)
    })));
    this.inventoryComplete.set(saved.preview.packet.inventoryComplete);
    this.preview.set(saved.preview);
    this.result.set(saved.result);
    this.model.set(saved.result.model);
    this.usedPreview.set(true);
    this.saved.set(true);
    this.error.set('');
  }
  async cancel(): Promise<void> {
    if (this.features.demo) return;
    const preview = this.preview();
    if (!preview || !this.sending() || this.cancelRequested()) return;
    this.cancelRequested.set(true);
    try { await this.api.cancelStandardization(preview.id); }
    catch (failure) { this.cancelRequested.set(false); this.error.set(message(failure, 'Nie udało się anulować analizy.')); }
  }
  private invalidate(): void {
    const previous = this.preview();
    this.preview.set(null);
    this.result.set(null);
    this.usedPreview.set(false);
    if (previous && !this.features.demo) void this.api.discardStandardization(previous.id).catch(() => undefined);
  }

  loadSnapshot(snapshot: StandardRepositorySnapshot): void {
    this.beginNew(snapshot.repositoryId, snapshot.repositoryName);
    this.snapshot.set(snapshot);
    this.git.set(snapshot.git ?? null);
    this.reportFiles.set(snapshot.reportFiles ?? []);
    this.filesSaved.set(true);
    this.folder.set({name: snapshot.repositoryName, entries: [], complete: snapshot.inventoryComplete,
      gitDetected: snapshot.gitDetected, refreshable: false});
    this.inventoryComplete.set(snapshot.inventoryComplete);
    this.files.set(snapshot.files.map(file => ({...file, omissionReason: file.omissionReason ?? undefined,
      error: file.omissionReason && file.omissionReason !== 'EXCLUDED' ? 'Plik pominięty: ' + file.omissionReason : undefined,
      read: async () => new File([file.content], file.path)})));
  }

  async persistFiles(): Promise<void> {
    const folder = this.folder();
    if (!folder || this.saved()) return;
    const generation = this.generation;
    const request: StandardSnapshotRequest = {
      snapshotId: this.snapshot()?.id ?? null, repositoryId: this.repositoryId(), repositoryName: folder.name,
      inventoryComplete: this.inventoryComplete(), gitDetected: folder.gitDetected,
      git: this.git(), reportFiles: this.reportFiles().map(file => ({path: file.path, content: file.content, omissionReason: file.omissionReason})),
      files: this.files().map(file => ({path: file.path, content: file.content, selected: file.selected,
        omissionReason: file.omissionReason ?? null}))
    };
    this.savingFiles.set(true);
    this.filesSaved.set(false);
    const save = this.saving.catch(() => undefined).then(async () => {
      if (generation !== this.generation) return;
      const snapshot = await this.repositories.save(request);
      if (generation !== this.generation) return;
      this.snapshot.set(snapshot);
      this.filesSaved.set(true);
      this.repositoryId.set(snapshot.repositoryId);
      this.expectedRepositoryName.set(snapshot.repositoryName);
      this.error.set('');
      await this.history.refresh();
    }).catch(failure => {
      if (generation === this.generation) {
        this.error.set(message(failure, 'Nie udało się zapisać plików repozytorium.'));
      }
      throw failure;
    }).finally(() => { if (generation === this.generation) this.savingFiles.set(false); });
    this.saving = save;
    return save;
  }
}

function message(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}
