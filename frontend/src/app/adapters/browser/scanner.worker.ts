/// <reference lib="webworker" />
import {parseCopilotFile,ParsedCopilotFile,prepareCopilotImport,previewCopilotFile} from '../../../scanner-core/copilot-file';
import {SessionEngine} from '../../../scanner-core/session-engine';
import {ScannerOperationError} from '../../../scanner-core/operation-error';
import {WORKER_PROTOCOL,WorkerOperations,WorkerRequest,WorkerResponse} from './worker-protocol';

const previews=new Map<string,ParsedCopilotFile>();
const engine=new SessionEngine();
addEventListener('message',async ({data}: MessageEvent<WorkerRequest>)=>{
  const respond=(response: Omit<WorkerResponse,'id'|'version'>): void=>postMessage({id: data.id,version: WORKER_PROTOCOL,...response} satisfies WorkerResponse);
  try {
    if (data.version!==WORKER_PROTOCOL) throw new ScannerOperationError('schema','Nieobsługiwana wersja silnika demo. Odśwież aplikację.');
    let result: unknown;
    switch (data.command) {
      case 'preview': {
        const input=data.input as WorkerOperations['preview']['input'];
        if (input.file.size>input.maxBytes) throw new ScannerOperationError('limit',`Plik przekracza limit ${input.maxBytes/1024/1024} MB.`);
        respond({phase: 'Odczyt pliku UTF-8…'});
        let source: string;
        try {source=new TextDecoder('utf-8',{fatal: true}).decode(await input.file.arrayBuffer());}
        catch {throw new ScannerOperationError('invalid-file','Plik JSONL musi mieć kodowanie UTF-8.');}
        respond({phase: 'Grupowanie rozmów i spanów…'});
        const parsed=parseCopilotFile(source),handle=crypto.randomUUID();
        previews.clear(); previews.set(handle,parsed);
        result={handle,preview: previewCopilotFile(parsed,new Set(input.conversations),new Set(input.spanKeys))}; break;
      }
      case 'prepare': {
        const input=data.input as WorkerOperations['prepare']['input'],parsed=previews.get(input.handle);
        if (!parsed) throw new ScannerOperationError('cancelled','Podgląd pliku wygasł. Wczytaj plik ponownie.');
        respond({phase: 'Przygotowanie wybranego zakresu…'});
        result=prepareCopilotImport(parsed,input.selection,input.receivedAt); break;
      }
      case 'analysis': {
        const input=data.input as WorkerOperations['analysis']['input']; result=engine.build(input.source,input.related); break;
      }
      case 'workflow': {
        const input=data.input as WorkerOperations['workflow']['input']; result=await engine.buildWorkflow(input.source,input.related); break;
      }
      case 'release': previews.delete((data.input as WorkerOperations['release']['input']).handle); result=null; break;
      default: throw new ScannerOperationError('schema','Nieobsługiwana operacja silnika demo.');
    }
    respond({result});
  } catch (failure) {
    const error=failure instanceof ScannerOperationError ? failure : new ScannerOperationError('invalid-file','Nie udało się odtworzyć danych wybranej sesji.');
    respond({error: {code: error.code,message: error.message,line: error.line}});
  }
});
