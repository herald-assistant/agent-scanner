import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {OptimizationGuidanceService} from './optimization-guidance.service';

describe('OptimizationGuidanceService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({version: 'techniques-v1', techniques: []}), {
      status: 200,
      headers: {'Content-Type': 'application/json'}
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('loads and caches only the local catalog endpoint', async () => {
    const service = TestBed.inject(OptimizationGuidanceService);
    const [first, second] = await Promise.all([service.load(), service.load()]);
    const fetchMock = vi.mocked(fetch);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/optimization/techniques');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/api/ai/');
  });
});
