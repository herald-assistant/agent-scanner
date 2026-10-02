import {inject, Injectable} from '@angular/core';
import {IndexedDbRepositorySnapshots} from '../adapters/browser/indexeddb-repository-snapshots';
import {StandardRepositorySnapshot, StandardRepositorySummary, StandardSnapshotRequest} from '../models/standardization.models';
import {FeatureAvailability} from './feature-availability.service';
import {ScannerApiService} from './scanner-api.service';
import {categoryForPath, redactRepositoryText} from './standardization-files';
import {safeRepositoryRemote} from './repository-report-files';

@Injectable({providedIn: 'root'})
export class StandardizationRepositoryService {
  private readonly features = inject(FeatureAvailability);
  private readonly api = inject(ScannerApiService);
  private readonly local = inject(IndexedDbRepositorySnapshots);

  async repositories(): Promise<StandardRepositorySummary[]> {
    if (!this.features.demo) return this.api.standardizationRepositories();
    const repositories = new Map<string, StandardRepositorySummary>();
    for (const snapshot of await this.local.list()) {
      const repository = repositories.get(snapshot.repositoryId) ?? {id: snapshot.repositoryId,
        name: snapshot.repositoryName, createdAt: snapshot.savedAt, analyses: [], snapshots: []};
      repository.snapshots!.push({id: snapshot.id, savedAt: snapshot.savedAt, fileCount: snapshot.files.length});
      repositories.set(repository.id, repository);
    }
    return [...repositories.values()];
  }
  async get(repositoryId: string, snapshotId: string): Promise<StandardRepositorySnapshot> {
    if (!this.features.demo) return this.api.repositorySnapshot(repositoryId, snapshotId);
    const snapshot = await this.local.get(snapshotId);
    if (!snapshot || snapshot.repositoryId !== repositoryId) throw new Error('Nie znaleziono zapisanych plików repozytorium.');
    return snapshot;
  }
  async save(request: StandardSnapshotRequest): Promise<StandardRepositorySnapshot> {
    if (!this.features.demo) return this.api.saveRepositorySnapshot(request);
    const snapshot: StandardRepositorySnapshot = {
      id: request.snapshotId ?? crypto.randomUUID(), repositoryId: request.repositoryId ?? crypto.randomUUID(),
      repositoryName: request.repositoryName, savedAt: new Date().toISOString(),
      inventoryComplete: request.inventoryComplete, gitDetected: request.gitDetected,
      git: request.git ? {...request.git, origin: request.git.origin ? safeRepositoryRemote(request.git.origin) : null} : null,
      reportFiles: (request.reportFiles ?? []).map(file => {
        const content = redactRepositoryText(file.content);
        return {...file, content, bytes: new TextEncoder().encode(content).length, redacted: content.includes('[UKRYTO]')};
      }),
      files: request.files.map(file => {
        const content = redactRepositoryText(file.content);
        return {...file, content, category: categoryForPath(file.path), bytes: new TextEncoder().encode(content).length,
          redacted: content.includes('[UKRYTO]')};
      })
    };
    await this.local.save(snapshot);
    return snapshot;
  }
  async delete(repositoryId: string, snapshotId: string): Promise<void> {
    if (!this.features.demo) return this.api.deleteRepositorySnapshot(repositoryId, snapshotId);
    await this.get(repositoryId, snapshotId);
    await this.local.delete(snapshotId);
  }
}
