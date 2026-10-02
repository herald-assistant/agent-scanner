export type OperationErrorCode = 'invalid-file' | 'conflict' | 'quota' | 'storage' | 'schema' | 'cancelled' | 'unavailable' | 'limit';

/** Stable application errors; never carry captured payloads or native stack text into UI. */
export class ScannerOperationError extends Error {
  constructor(readonly code: OperationErrorCode, message: string, readonly line?: number) {super(message);}
}
