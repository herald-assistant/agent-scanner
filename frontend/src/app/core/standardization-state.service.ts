import {computed, inject, Injectable, signal} from '@angular/core';
import {ScannerApiService} from './scanner-api.service';
import {discoverRepository, readRepositoryText, redactRepositoryText, RepositoryFile, RepositorySelection} from './standardization-files';
import {SavedStandardAnalysis, StandardCatalog, StandardOmission, StandardPreview, StandardResult} from '../models/standardization.models';
import {SessionChatModel} from '../models/session-chat.models';

@Injectable({providedIn: 'root'})
export class StandardizationStateService {
  private readonly api = inject(ScannerApiService);
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
  readonly busy = computed(() => this.choosingFolder() || this.reading() || this.preparing() || this.sending());
  readonly canPrepare = computed(() => !this.saved() && !!this.catalog() && !!this.model() && !this.busy()
    && this.selected().some(file => file.category !== 'CONTEXT')
    && this.selected().length <= this.catalog()!.limits.maxFiles && this.bytes() <= this.catalog()!.limits.maxTotalBytes);

  async initialize(refresh = false): Promise<void> {
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
    this.saved.set(false);
    this.folder.set(selection);
    this.files.set([]);
    this.error.set('');
    this.reading.set(true);
    try {
      const result = await discoverRepository(selection);
      this.files.set(result.files);
      this.inventoryComplete.set(result.complete);
    } catch (failure) {
      this.inventoryComplete.set(false);
      this.error.set(message(failure, 'Nie udało się odczytać katalogu.'));
    } finally { this.reading.set(false); }
  }
  toggle(path: string, selected: boolean): void {
    if (this.busy() || this.saved()) return;
    this.files.update(files => files.map(file => file.path === path && !file.error ? {...file, selected} : file));
    this.invalidate();
  }
  selectAll(selected: boolean): void {
    if (this.busy() || this.saved()) return;
    this.files.update(files => files.map(file => file.error ? file : {...file, selected}));
    this.invalidate();
  }
  setModel(value: string): void { if (!this.busy() && !this.saved() && this.model() !== value) { this.model.set(value); this.invalidate(); } }

  async prepare(): Promise<void> {
    if (!this.canPrepare()) return;
    this.invalidate();
    this.preparing.set(true);
    this.error.set('');
    try {
      const selected = this.selected();
      const fresh = await Promise.all(selected.map(async file => {
        const text = await readRepositoryText(await file.read());
        return {...file, content: redactRepositoryText(text)};
      }));
      if (fresh.some((file, index) => file.content !== selected[index].content)) {
        const updated = new Map(fresh.map(file => [file.path, {...file, bytes: new TextEncoder().encode(file.content).length,
          redacted: file.content.includes('[UKRYTO]')}]));
        this.files.update(files => files.map(file => updated.get(file.path) ?? file));
        throw new Error('Pliki zmieniły się od odczytu. Lista została odświeżona; sprawdź ją i przygotuj podgląd ponownie.');
      }
      const omissions: StandardOmission[] = this.files().filter(file => !file.selected || !!file.error)
        .map(file => ({path: file.path, reason: file.omissionReason ?? 'EXCLUDED'}));
      const preview = await this.api.prepareStandardization({
        profile: 'AUTO', clientVersion: '', model: this.model(),
        files: fresh.map(file => ({path: file.path, content: file.content})), omissions, inventoryComplete: this.inventoryComplete()
      });
      this.preview.set(preview);
    } catch (failure) { this.error.set(message(failure, 'Nie udało się przygotować podglądu.')); }
    finally { this.preparing.set(false); }
  }

  async send(): Promise<SavedStandardAnalysis | undefined> {
    const preview = this.preview();
    if (!preview || this.busy() || this.usedPreview()) return;
    if (Date.parse(preview.expiresAt) <= Date.now()) { this.error.set('Podgląd wygasł. Przygotuj go ponownie.'); return; }
    this.sending.set(true);
    this.error.set('');
    this.cancelRequested.set(false);
    try {
      const current = await Promise.all(this.selected().map(async file => ({
        path: file.path, content: redactRepositoryText(await readRepositoryText(await file.read()))
      })));
      if (current.some(file => preview.packet.files.find(item => item.path === file.path)?.content !== file.content)) {
        this.invalidate();
        throw new Error('Plik zmienił się po przygotowaniu podglądu. Wybierz folder ponownie, aby odświeżyć treść.');
      }
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
    this.invalidate();
    this.saved.set(false);
    this.repositoryId.set(repositoryId);
    this.expectedRepositoryName.set(repositoryName);
    this.folder.set(null);
    this.files.set([]);
    this.error.set('');
  }
  loadSaved(saved: SavedStandardAnalysis, repositoryName: string): void {
    this.invalidate();
    this.repositoryId.set(saved.repositoryId);
    this.expectedRepositoryName.set(repositoryName);
    this.folder.set({name: repositoryName, entries: [], complete: saved.preview.packet.inventoryComplete,
      gitDetected: true, refreshable: false});
    this.files.set(saved.preview.packet.files.map(file => ({
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
    if (previous) void this.api.discardStandardization(previous.id).catch(() => undefined);
  }
}

function message(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}
