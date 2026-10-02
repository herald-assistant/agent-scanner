import type {Session, SessionDetail, SignalRecord, SpanRecord, MessageRecord} from '../../models/scanner.models';
import type {PreparedImport} from '../../../scanner-core/copilot-file';
import {ScannerOperationError} from '../../../scanner-core/operation-error';
import type {SessionImportResult} from '../../core/scanner-data-gateway';

export const DEMO_DATABASE = 'agent-scanner-demo';
export const DEMO_DATABASE_VERSION = 2;
const STORES = ['sessions','spans','messages','signals','scopes','metadata'] as const;
interface StoredSpan {id: number; sessionId: number; otelKey: string; span: SpanRecord; rawLine: string;}
interface StoredMessage {id: number; sessionId: number; message: MessageRecord;}
interface StoredSignal {id: number; sessionId: number; signal: SignalRecord; rawPayload: string;}
interface StoredScope {rootId: number; sessionIds: number[]; parserVersion: string; coreVersion: string;}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject) => {operation.onsuccess=()=>resolve(operation.result); operation.onerror=()=>reject(operation.error);});
}
function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve,reject) => {
    transaction.oncomplete=()=>resolve(); transaction.onabort=()=>reject(transaction.error ?? new DOMException('Transaction aborted','AbortError'));
    transaction.onerror=()=>{ /* request error leads to abort; wait for the final outcome */ };
  });
}
function indexKeys(index: IDBIndex): Promise<string[]> {
  return new Promise((resolve,reject) => {
    const keys: string[] = [], operation = index.openKeyCursor();
    operation.onerror = () => reject(operation.error);
    operation.onsuccess = () => {
      const cursor = operation.result;
      if (!cursor) {resolve(keys); return;}
      keys.push(String(cursor.key)); cursor.continue();
    };
  });
}
function storageError(error: unknown): ScannerOperationError {
  if (error instanceof ScannerOperationError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return new ScannerOperationError('quota','Brak miejsca w przeglądarce. Wyeksportuj potrzebne dane i usuń nieużywane sesje.');
  if (error instanceof DOMException && error.name === 'ConstraintError') return new ScannerOperationError('conflict','Ta sesja, jej subagent lub jeden z jej spanów jest już zapisany w tej przeglądarce.');
  if (error instanceof DOMException && error.name === 'VersionError') return new ScannerOperationError('schema','Baza pochodzi z nowszej wersji demo. Otwórz aktualną wersję aplikacji; dane nie zostały usunięte.');
  return new ScannerOperationError('storage','Nie udało się zapisać lub odczytać danych w IndexedDB. Sprawdź ustawienia przeglądarki i spróbuj ponownie.');
}

/** Browser persistence only. Domain interpretation and preparation occur before a write transaction. */
export class IndexedDbSessionRepository {
  private opening?: Promise<IDBDatabase>;
  constructor(readonly databaseName = DEMO_DATABASE) {}

  async open(): Promise<IDBDatabase> {
    if (!this.opening) this.opening = new Promise<IDBDatabase>((resolve,reject) => {
      if (!globalThis.indexedDB) {reject(new ScannerOperationError('storage','IndexedDB jest niedostępne. Demo wymaga lokalnego zapisu w przeglądarce.')); return;}
      const operation=indexedDB.open(this.databaseName,DEMO_DATABASE_VERSION);
      let rejected=false;
      operation.onblocked=()=>{
        rejected=true; reject(new ScannerOperationError('schema','Zamknij inne karty Agent Scanner, aby zaktualizować lokalną bazę. Dane pozostają zachowane.'));
      };
      operation.onupgradeneeded=event=>{
        const db=operation.result,transaction=operation.transaction!;
        if (event.oldVersion > DEMO_DATABASE_VERSION) {transaction.abort(); return;}
        // v1 -> v2 adds query indexes without deleting or rewriting telemetry.
        for (const name of STORES) {
          const store=db.objectStoreNames.contains(name) ? transaction.objectStore(name) : db.createObjectStore(name,{keyPath: name==='metadata' ? 'key' : name==='scopes' ? 'rootId' : 'id'});
          const indices: [string,string,boolean][] = name==='sessions' ? [['conversationId','conversationId',true]] :
            name==='spans' ? [['sessionId','sessionId',false],['otelKey','otelKey',true]] :
              name==='messages' || name==='signals' ? [['sessionId','sessionId',false]] : [];
          for (const [index,keyPath,unique] of indices) if (!store.indexNames.contains(index)) store.createIndex(index,keyPath,{unique});
        }
      };
      operation.onerror=()=>reject(storageError(operation.error));
      operation.onsuccess=()=>{
        const db=operation.result;
        db.onversionchange=()=>{db.close(); this.opening=undefined;};
        if (rejected) {db.close(); this.opening=undefined; return;}
        resolve(db);
      };
    }).catch(error=>{this.opening=undefined; throw storageError(error);});
    return this.opening;
  }
  async close(): Promise<void> {if (this.opening) (await this.opening).close(); this.opening=undefined;}

  private async transaction<T>(mode: IDBTransactionMode, body: (transaction: IDBTransaction)=>Promise<T>): Promise<T> {
    const db=await this.open(),transaction=db.transaction([...STORES],mode);
    const completion=finished(transaction);
    // Observe rejection immediately so a failed request cannot leave an unhandled abort promise.
    void completion.catch(()=>{});
    try {const result=await body(transaction); await completion; return result;}
    catch (error) {try {transaction.abort();} catch { /* already aborted/completed */ } await completion.catch(()=>{}); throw storageError(error);}
  }
  identities(): Promise<{conversations: string[]; spanKeys: string[]}> {
    return this.transaction('readonly',async tx=>{
      const [conversations,spanKeys]=await Promise.all([
        indexKeys(tx.objectStore('sessions').index('conversationId')),indexKeys(tx.objectStore('spans').index('otelKey'))
      ]);
      return {conversations,spanKeys};
    });
  }
  sessions(): Promise<Session[]> {
    return this.transaction('readonly',async tx=>{
      const [sessions,scopes]=await Promise.all([request<Session[]>(tx.objectStore('sessions').getAll()),request<StoredScope[]>(tx.objectStore('scopes').getAll())]);
      const roots=new Set(scopes.map(scope=>scope.rootId));
      return sessions.filter(session=>roots.has(session.id)).sort((a,b)=>b.lastSeenAt.localeCompare(a.lastSeenAt)||b.id-a.id);
    });
  }
  private async detailIn(tx: IDBTransaction,id: number): Promise<SessionDetail> {
    const [session,spans,messages,signals]=await Promise.all([
      request<Session | undefined>(tx.objectStore('sessions').get(id)),request<StoredSpan[]>(tx.objectStore('spans').index('sessionId').getAll(id)),
      request<StoredMessage[]>(tx.objectStore('messages').index('sessionId').getAll(id)),request<StoredSignal[]>(tx.objectStore('signals').index('sessionId').getAll(id))
    ]);
    if (!session) throw new ScannerOperationError('storage','Nie znaleziono sesji w lokalnej bazie.');
    return {session,spans: spans.map(item=>item.span),messages: messages.map(item=>item.message),signals: signals.map(item=>item.signal)};
  }
  detail(id: number): Promise<SessionDetail> {return this.transaction('readonly',tx=>this.detailIn(tx,id));}
  scope(id: number): Promise<SessionDetail[]> {
    return this.transaction('readonly',async tx=>{
      const scope=await request<StoredScope | undefined>(tx.objectStore('scopes').get(id));
      return Promise.all((scope?.sessionIds ?? [id]).map(sessionId=>this.detailIn(tx,sessionId)));
    });
  }
  statistics(): Promise<{signals: number; contentCaptured: boolean; lastSignalAt: string | null}> {
    return this.transaction('readonly',async tx=>{
      const [sessions,signals]=await Promise.all([request<Session[]>(tx.objectStore('sessions').getAll()),request(tx.objectStore('signals').count())]);
      return {signals,contentCaptured: sessions.some(item=>item.contentCaptured),lastSignalAt: sessions.map(item=>item.lastSeenAt).sort().at(-1) ?? null};
    });
  }
  save(prepared: PreparedImport): Promise<SessionImportResult> {
    return this.transaction('readwrite',async tx=>{
      const sessions=tx.objectStore('sessions'),spans=tx.objectStore('spans'),messages=tx.objectStore('messages'),signals=tx.objectStore('signals');
      const meta=tx.objectStore('metadata');
      const current=await request<{key: string; value: number} | undefined>(meta.get('nextId'));
      let nextId=current?.value ?? 1;
      if (!current) {
        const last=await Promise.all(['sessions','spans','messages','signals'].map(name=>request(tx.objectStore(name).openKeyCursor(null,'prev'))));
        for (const cursor of last) if (cursor && typeof cursor.primaryKey==='number') nextId=Math.max(nextId,cursor.primaryKey+1);
      }
      const next=(): number=>{
        if (!Number.isSafeInteger(nextId) || nextId <= 0 || nextId >= Number.MAX_SAFE_INTEGER) throw new ScannerOperationError('schema','Lokalna baza ma niepoprawny licznik identyfikatorów.');
        return nextId++;
      };
      const sessionIds=new Map<string,number>();
      for (const item of prepared.sessions) {
        const sessionId=next(),signalId=next(); sessionIds.set(item.detail.session.conversationId,sessionId);
        await request(sessions.add({...item.detail.session,id: sessionId}));
        const signal={...item.detail.signals[0],id: signalId};
        await request(signals.add({id: signalId,sessionId,signal,rawPayload: item.lines.join('\n')+'\n'} satisfies StoredSignal));
        const spanIds=new Map<number,number>();
        for (let i=0;i<item.detail.spans.length;i++) {
          const original=item.detail.spans[i],id=next(); spanIds.set(original.id,id);
          const span={...original,id,signalId};
          await request(spans.add({id,sessionId,span,otelKey: item.spanKeys[i],rawLine: item.lines[i]} satisfies StoredSpan));
        }
        for (const original of item.detail.messages) {
          const id=next(),spanId=spanIds.get(original.spanId);
          if (spanId === undefined) throw new ScannerOperationError('invalid-file','Niepoprawne powiązanie wiadomości i spanu.');
          await request(messages.add({id,sessionId,message: {...original,id,spanId}} satisfies StoredMessage));
        }
      }
      const rootIds: number[]=[];
      for (const scope of prepared.scopes) {
        const rootId=sessionIds.get(scope.conversationId)!; rootIds.push(rootId);
        const ids=scope.included.map(key=>sessionIds.get(key)!);
        if (!rootId || ids.some(id=>!id)) throw new ScannerOperationError('invalid-file','Niepoprawny zakres zapisu sesji.');
        await request(tx.objectStore('scopes').add({rootId,sessionIds: ids,parserVersion: prepared.parserVersion,coreVersion: prepared.coreVersion} satisfies StoredScope));
      }
      await request(meta.put({key: 'nextId',value: nextId}));
      return {sessionId: rootIds[0],sessionIds: rootIds,signals: prepared.sessions.length,spans: prepared.sessions.reduce((sum,item)=>sum+item.spanKeys.length,0)};
    });
  }
  deleteSession(id: number): Promise<void> {
    return this.transaction('readwrite',async tx=>{
      const scopes=tx.objectStore('scopes'),target=await request<StoredScope | undefined>(scopes.get(id));
      if (!target) throw new ScannerOperationError('storage','Nie znaleziono sesji do usunięcia.');
      await request(scopes.delete(id));
      const remaining=await request<StoredScope[]>(scopes.getAll()),retained=new Set(remaining.flatMap(scope=>scope.sessionIds));
      for (const sessionId of target.sessionIds.filter(key=>!retained.has(key))) {
        for (const name of ['spans','messages','signals']) {
          const store=tx.objectStore(name),keys=await request(store.index('sessionId').getAllKeys(sessionId));
          await Promise.all(keys.map(key=>request(store.delete(key))));
        }
        await request(tx.objectStore('sessions').delete(sessionId));
      }
    });
  }
  deleteAll(): Promise<void> {return this.transaction('readwrite',async tx=>{await Promise.all(STORES.map(name=>request(tx.objectStore(name).clear())));});}
}
