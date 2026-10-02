import {DestroyRef, inject, Injectable} from '@angular/core';
import {StandardRepositorySnapshot} from '../../models/standardization.models';

export const REPOSITORY_DATABASE = 'agent-scanner-demo-repositories';

@Injectable({providedIn: 'root'})
export class IndexedDbRepositorySnapshots {
  private opening?: Promise<IDBDatabase>;
  constructor() { inject(DestroyRef).onDestroy(() => { void this.close(); }); }

  private open(): Promise<IDBDatabase> {
    if (!this.opening) this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('IndexedDB jest niedostępne. Podgląd wymaga lokalnego zapisu w przeglądarce.')); return; }
      const request = indexedDB.open(REPOSITORY_DATABASE, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots', {keyPath: 'id'});
      request.onblocked = () => { blocked = true; reject(new Error('Zamknij inne karty Agent Scanner, aby otworzyć lokalny magazyn repozytoriów.')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.opening = undefined; };
        resolve(db);
      };
    }).catch(failure => { this.opening = undefined; throw storageError(failure); });
    return this.opening;
  }
  private async close(): Promise<void> {
    if (this.opening) { try { (await this.opening).close(); } catch { /* Opening already reported its error. */ } }
    this.opening = undefined;
  }
  private async operation<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    try {
      const db = await this.open();
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction('snapshots', mode);
        const request = action(transaction.objectStore('snapshots'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error ?? request.error);
        transaction.onerror = () => { /* Wait for abort to report the final outcome. */ };
      });
    } catch (failure) { throw storageError(failure); }
  }
  list(): Promise<StandardRepositorySnapshot[]> { return this.operation('readonly', store => store.getAll()); }
  get(id: string): Promise<StandardRepositorySnapshot | undefined> { return this.operation('readonly', store => store.get(id)); }
  async save(snapshot: StandardRepositorySnapshot): Promise<void> { await this.operation('readwrite', store => store.put(snapshot)); }
  async delete(id: string): Promise<void> { await this.operation('readwrite', store => store.delete(id)); }
}
function storageError(failure: unknown): Error {
  if (failure instanceof DOMException && failure.name === 'QuotaExceededError') return new Error('Brak miejsca w przeglądarce. Usuń nieużywane podglądy repozytoriów i spróbuj ponownie.');
  return failure instanceof Error && !(failure instanceof DOMException) ? failure
    : new Error('Nie udało się zapisać lub odczytać plików repozytorium w IndexedDB. Sprawdź ustawienia przeglądarki i spróbuj ponownie.');
}
