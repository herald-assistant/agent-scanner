import {DestroyRef,inject,Injectable,signal} from '@angular/core';
import {ScannerOperationError} from '../../../scanner-core/operation-error';
import {WORKER_PROTOCOL,WorkerCommand,WorkerOperations,WorkerRequest,WorkerResponse} from './worker-protocol';

@Injectable({providedIn: 'root'})
export class BrowserWorkerClient {
  readonly phase=signal('');
  private worker?: Worker;
  private serial=0;
  private readonly pending=new Map<number,{resolve: (value: unknown)=>void; reject: (error: unknown)=>void}>();
  constructor() {inject(DestroyRef).onDestroy(()=>this.cancel());}
  execute<K extends WorkerCommand>(command: K,input: WorkerOperations[K]['input']): Promise<WorkerOperations[K]['result']> {
    if (!this.worker) {
      this.worker=new Worker(new URL('./scanner.worker',import.meta.url),{type: 'module'});
      this.worker.onmessage=({data}: MessageEvent<WorkerResponse>)=>{
        const task=this.pending.get(data.id); if (!task) return;
        if (data.version!==WORKER_PROTOCOL) {this.cancel(new ScannerOperationError('schema','Nieobsługiwana wersja silnika demo. Odśwież aplikację.')); return;}
        if (data.phase!==undefined) {this.phase.set(data.phase); return;}
        this.pending.delete(data.id);
        if (data.error) task.reject(new ScannerOperationError(data.error.code,data.error.message,data.error.line));
        else task.resolve(data.result);
      };
      this.worker.onerror=()=>this.cancel(new ScannerOperationError('storage','Nie udało się uruchomić silnika demo. Odśwież aplikację i spróbuj ponownie.'));
    }
    const id=++this.serial;
    return new Promise<WorkerOperations[K]['result']>((resolve,reject)=>{
      this.pending.set(id,{resolve: value=>resolve(value as WorkerOperations[K]['result']),reject});
      this.worker!.postMessage({id,version: WORKER_PROTOCOL,command,input} satisfies WorkerRequest);
    });
  }
  cancel(error=new ScannerOperationError('cancelled','Operacja została anulowana.')): void {
    this.worker?.terminate(); this.worker=undefined;
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear(); this.phase.set('');
  }
}
