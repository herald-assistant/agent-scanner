import {TestBed} from '@angular/core/testing';
import {describe, expect, it, vi} from 'vitest';
import {ScannerApiService} from './scanner-api.service';
import {ToolClassificationService} from './tool-classification.service';
import {FlowToolCatalog, ToolClassificationResult} from '../models/tool-classification.models';

describe('ToolClassificationService', () => {
  it('restores a persisted result and does not invoke classification again', async () => {
    const result: ToolClassificationResult = {version: 'model-actions-v5', model: 'test-model', analyzedAt: '2026-01-01T00:00:00Z', tools: [], assessments: [], rounds: []};
    const cachedToolClassification = vi.fn().mockResolvedValue(result);
    const classifyTools = vi.fn();
    TestBed.configureTestingModule({providers: [{provide: ScannerApiService, useValue: {cachedToolClassification, classifyTools}}]});
    const service = TestBed.inject(ToolClassificationService);
    const catalog: FlowToolCatalog = {key: 'request-key', request: {tools: [], agents: [], contexts: []}, usages: [], rounds: [], agents: [], definitionsSeen: 0, missing: 0};
    expect(await service.restore(7, catalog)).toBe(true);
    expect(service.result(7, catalog)).toEqual(result);
    await service.classify(7, catalog);
    expect(cachedToolClassification).toHaveBeenCalledOnce();
    expect(classifyTools).not.toHaveBeenCalled();
  });
  it('does not expose a cached result from an incompatible classifier version', async () => {
    const cachedToolClassification = vi.fn().mockResolvedValue({version: 'model-actions-v4', model: 'old', analyzedAt: '', tools: [], assessments: [], rounds: []});
    TestBed.configureTestingModule({providers: [{provide: ScannerApiService, useValue: {cachedToolClassification, classifyTools: vi.fn()}}]});
    const service = TestBed.inject(ToolClassificationService);
    const catalog: FlowToolCatalog = {key: 'request-key', request: {tools: [], agents: [], contexts: []}, usages: [], rounds: [], agents: [], definitionsSeen: 0, missing: 0};
    expect(await service.restore(7, catalog)).toBe(false);
    expect(service.result(7, catalog)).toBeUndefined();
  });
  it('deletes an existing persisted and in-memory classification', async () => {
    const cached: ToolClassificationResult = {version: 'model-actions-v5', model: 'test-model', analyzedAt: '2026-01-01T00:00:00Z', tools: [], assessments: [], rounds: []};
    const cachedToolClassification = vi.fn().mockResolvedValue(cached);
    const deleteToolClassification = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({providers: [{provide: ScannerApiService, useValue: {cachedToolClassification, deleteToolClassification}}]});
    const service = TestBed.inject(ToolClassificationService);
    const catalog: FlowToolCatalog = {key: 'request-key', request: {tools: [], agents: [], contexts: []}, usages: [], rounds: [], agents: [], definitionsSeen: 0, missing: 0};

    await service.restore(7, catalog);
    await service.delete(7, catalog);

    expect(deleteToolClassification).toHaveBeenCalledWith(7, catalog.request);
    expect(service.result(7, catalog)).toBeUndefined();
  });
});
