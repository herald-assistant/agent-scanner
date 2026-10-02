import {afterEach, describe, expect, it, vi} from 'vitest';
import {OptimizationAdvicePreview} from '../models/optimization-guidance.models';
import {ScannerApiService} from './scanner-api.service';

describe('ScannerApiService Copilot JSONL import', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('previews the file without a selected session, then commits only the chosen identifier', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({sessions: [], ignoredRecords: 0, duplicateRecords: 0, unassignedSpans: 0}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ScannerApiService();
    const file = new File(['synthetic'], 'copilot-otel.jsonl');
    await service.previewSessionImport(file);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sessions/import/preview', {
      method: 'POST', headers: {'Content-Type': 'application/x-ndjson'}, body: file
    });
    await service.importSession(file, 'conversation/with ?&characters');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sessions/import?conversationId=conversation%2Fwith%20%3F%26characters', {
      method: 'POST', headers: {'Content-Type': 'application/x-ndjson'}, body: file
    });
  });

  it('keeps a duplicate-session error actionable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({error: 'Sesja jest już zapisana.'}), {status: 409})));
    await expect(new ScannerApiService().importSession(new File(['synthetic'], 'fixture.jsonl'), 'a'))
      .rejects.toThrow('Sesja jest już zapisana.');
  });
});

describe('ScannerApiService saved repository analyses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deletes the selected analysis within its repository', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {status: 204}));
    vi.stubGlobal('fetch', fetchMock);

    await new ScannerApiService().deleteStandardization('repo-a', 'analysis-a');

    expect(fetchMock).toHaveBeenCalledWith('/api/standardization/repositories/repo-a/analyses/analysis-a', {method: 'DELETE'});
  });

  it('rejects unsuccessful deletion so the screen can keep the saved result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status: 500})));

    await expect(new ScannerApiService().deleteStandardization('repo-a', 'analysis-a'))
      .rejects.toThrow('Nie udało się usunąć analizy repozytorium');
  });
});

describe('ScannerApiService tool classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deletes only the classification matching the current request', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response(null, {status: 204}));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ScannerApiService();
    const request = {tools: [], agents: [], contexts: []};

    await service.deleteToolClassification(42, request);

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/tool-classification?sessionId=42', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify(request)
    }));
  });
});

describe('ScannerApiService optimization advice preparation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the exact frozen request to the local preparation endpoint', async () => {
    const request = adviceRequest();
    const prepared: OptimizationAdvicePreview = {
      preparation: {previewId: 'preview-1', preparedAt: '2026-09-08T10:00:00Z', expiresAt: '2026-09-08T10:30:00Z',
        requestHash: 'a'.repeat(64), sourceValidation: 'RAW_AND_NORMALIZED'},
      request,
      summary: {selectedRounds: 1, supportingRounds: 0, observations: 1, contentFragments: 0,
        payloadCharacters: 1000, estimatedInputTokens: 236, sendBlocked: false},
      warnings: ['Model AI nie został uruchomiony.']
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(prepared), {
      status: 200, headers: {'Content-Type': 'application/json'}
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ScannerApiService().prepareOptimizationAdvice(42, request);

    expect(result.preparation?.previewId).toBe('preview-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/optimization-advice/prepare?sessionId=42', expect.objectContaining({
      method: 'POST', body: JSON.stringify(request)
    }));
  });

  it('preserves the actionable Polish backend error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({error: 'Źródło zmieniło się. Odśwież migawkę.'}), {
      status: 409, headers: {'Content-Type': 'application/json'}
    })));

    await expect(new ScannerApiService().prepareOptimizationAdvice(42, adviceRequest()))
      .rejects.toThrow('Źródło zmieniło się. Odśwież migawkę.');
  });

  it('sends only the verified preview id when the user starts AI advice', async () => {
    const result = adviceResult();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), {
      status: 200, headers: {'Content-Type': 'application/json'}
    }));
    vi.stubGlobal('fetch', fetchMock);

    const received = await new ScannerApiService().requestOptimizationAdvice(42, 'preview-1');

    expect(received.status).toBe('SUGGESTIONS');
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/optimization-advice?sessionId=42', expect.objectContaining({
      method: 'POST', body: JSON.stringify({previewId: 'preview-1'})
    }));
  });

  it('reads an exact cached result without invoking the advice endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {status: 204}));
    vi.stubGlobal('fetch', fetchMock);

    expect(await new ScannerApiService().cachedOptimizationAdvice(42, 'preview-1')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/ai/optimization-advice/cached?sessionId=42', expect.objectContaining({
      body: JSON.stringify({previewId: 'preview-1'})
    }));
  });
});

describe('ScannerApiService session chat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shares one in-flight model catalogue request between dialog instances', async () => {
    const response = {configured: true, defaultModel: 'gpt-test', running: false,
      models: [{id: 'gpt-test', name: 'GPT Test', maxPromptTokens: 1000, maxContextWindowTokens: 2000, reasoningEfforts: []}]};
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200, headers: {'Content-Type': 'application/json'}
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ScannerApiService();

    const [first, second] = await Promise.all([service.sessionChatModels(), service.sessionChatModels()]);

    expect(first.defaultModel).toBe('gpt-test');
    expect(second.defaultModel).toBe('gpt-test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the actionable error returned by a read endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({error: 'Trwa inne działanie AI.'}), {
      status: 409, headers: {'Content-Type': 'application/json'}
    })));

    await expect(new ScannerApiService().sessionChatModels()).rejects.toThrow('Trwa inne działanie AI.');
  });

  it('creates a whole-session chat with only the selected model', async () => {
    const response = {id: 'chat-1', sessionId: 42, model: 'gpt-test', cutoffSignalId: 7, contextHash: 'hash',
      bootstrap: {}, revision: 0, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
      newerTelemetryAvailable: false, turns: []};
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200, headers: {'Content-Type': 'application/json'}
    }));
    vi.stubGlobal('fetch', fetchMock);

    await new ScannerApiService().createSessionChat(42, 'gpt-test');

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/session-chats?sessionId=42', expect.objectContaining({
      method: 'POST', body: JSON.stringify({model: 'gpt-test'})
    }));
  });
});

function adviceResult() {
  return {
    version: 'optimization-advice-v1', catalogVersion: 'techniques-v1', promptVersion: 'optimization-advice-prompt-v1',
    model: 'test-model', analyzedAt: '2026-09-08T10:10:00Z', previewId: 'preview-1', requestHash: 'a'.repeat(64),
    dataFingerprint: 'b'.repeat(64), sourceValidation: 'RAW_AND_NORMALIZED', status: 'SUGGESTIONS',
    proposals: [], missingInformation: [], aiCallMetricsAvailable: false
  };
}

function adviceRequest(): OptimizationAdvicePreview['request'] {
  return {
    version: 'optimization-advice-v1', catalogVersion: 'techniques-v1',
    scope: {kind: 'phase', rootSessionId: 42, interactionTraceId: 'trace-1', roundRefs: ['trace-1/span-1'], actions: ['ACQUIRE_DATA']},
    manifest: {capturedAt: '2026-09-08T10:00:00Z', dataFingerprint: 'b'.repeat(64), selectedRefs: ['trace-1/span-1'],
      supportingRefs: [], omitted: [], classificationFingerprint: null, evidenceVersion: 'guidance-evidence-v2',
      redactionVersion: 'guidance-redaction-v1', upstreamCompleteness: 'UNVERIFIED'},
    observations: [{id: 'o1', kind: 'INPUT_TOKENS', provenance: 'EMITTED', sources: [{sessionId: 42, spanId: 1,
      signalId: 1, traceId: 'trace-1', rawSpanId: 'span-1', sourcePointer: 'normalized:span:1#gen_ai.usage.input_tokens',
      sourceContentHash: 'c'.repeat(64), roundRef: 'trace-1/span-1', callId: null, messageId: null,
      attribute: 'gen_ai.usage.input_tokens'}], ruleVersion: null,
      metric: {value: 100, unit: 'token', population: 'trace-1/span-1', covered: 1, total: 1, formulaId: null},
      excerpt: null, limitationCodes: []}],
    candidateTechniqueIds: ['T03'], userContext: {goal: null, frequency: 'UNKNOWN', effort: 'UNKNOWN', constraints: []}
  };
}
