import {TestBed} from '@angular/core/testing';
import {describe, expect, it, vi} from 'vitest';
import {OptimizationAdvicePreview, OptimizationAdviceResult} from '../../models/optimization-guidance.models';
import {AdviceResultComponent} from './advice-result.component';

describe('AdviceResultComponent', () => {
  it('presents a cautious experiment and opens the exact evidence', () => {
    TestBed.configureTestingModule({imports: [AdviceResultComponent]});
    const fixture = TestBed.createComponent(AdviceResultComponent);
    fixture.componentRef.setInput('result', result());
    fixture.componentRef.setInput('preview', preview());
    fixture.componentRef.setInput('context', {
      kind: 'PHASE', title: 'Faza', scopeLabel: 'M1', explanation: 'Opis', topics: ['ACQUIRE_DATA'],
      measurement: {credits: .2, creditEstimated: true, coveredCalls: 1, totalCalls: 1}, evidenceLabels: [],
      evidence: [{kind: 'ROUND', id: 'trace-1/span-1', label: 'Główny agent · M1', description: 'Otwórz rundę'}]
    });
    fixture.componentRef.setInput('techniques', [{id: 'T03', title: 'Najpierw mapa'}]);
    fixture.detectChanges();
    const selected = vi.fn();
    fixture.componentInstance.evidenceSelected.subscribe(selected);
    const element: HTMLElement = fixture.nativeElement;

    expect(element.textContent).toContain('hipotezy do przetestowania');
    expect(element.textContent).toContain('Najpierw mapa');
    expect(element.textContent).toContain('brak pomiaru');
    element.querySelector<HTMLButtonElement>('.proposal-evidence button')!.click();
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({evidence: expect.objectContaining({id: 'trace-1/span-1'})}));
  });
});

function result(): OptimizationAdviceResult {
  return {
    version: 'optimization-advice-v1', catalogVersion: 'techniques-v1', promptVersion: 'optimization-advice-prompt-v1',
    model: 'test-model', analyzedAt: '2026-09-08T10:10:00Z', previewId: 'preview-1', requestHash: 'a'.repeat(64),
    dataFingerprint: 'b'.repeat(64), sourceValidation: 'RAW_AND_NORMALIZED', status: 'SUGGESTIONS',
    proposals: [{techniqueId: 'T03', observationIds: ['o1'], rationale: 'Warto wykonać próbę.',
      conditionsToCheck: ['Sprawdź powtarzalność.'], experimentSteps: ['Wybierz jedną rundę.'], setupWork: ['Przygotuj mapę.'],
      maintenanceWork: ['Aktualizuj po zmianach.'], qualityChecks: ['Porównaj poprawność.'], comparisonPlan: ['Porównaj credits.'],
      limitations: ['Jedna obserwacja.'], alternativeTechniqueId: null}], missingInformation: [], aiCallMetricsAvailable: false
  };
}

function preview(): OptimizationAdvicePreview {
  return {
    preparation: {previewId: 'preview-1', preparedAt: '2026-09-08T10:00:00Z', expiresAt: '2026-09-08T10:30:00Z',
      requestHash: 'a'.repeat(64), sourceValidation: 'RAW_AND_NORMALIZED'},
    request: {version: 'optimization-advice-v1', catalogVersion: 'techniques-v1',
      scope: {kind: 'phase', rootSessionId: 1, interactionTraceId: 'trace-1', roundRefs: ['trace-1/span-1'], actions: ['ACQUIRE_DATA']},
      manifest: {capturedAt: '2026-09-08T10:00:00Z', dataFingerprint: 'b'.repeat(64), selectedRefs: ['trace-1/span-1'],
        supportingRefs: [], omitted: [], classificationFingerprint: null, evidenceVersion: 'guidance-evidence-v2',
        redactionVersion: 'guidance-redaction-v1', upstreamCompleteness: 'UNVERIFIED'},
      observations: [{id: 'o1', kind: 'INPUT_TOKENS', provenance: 'EMITTED', sources: [{sessionId: 1, spanId: 1,
        signalId: 1, traceId: 'trace-1', rawSpanId: 'span-1', sourcePointer: 'normalized:span:1',
        sourceContentHash: 'c'.repeat(64), roundRef: 'trace-1/span-1', callId: null, messageId: null, attribute: null}],
        ruleVersion: null, metric: {value: 100, unit: 'token', population: 'M1', covered: 1, total: 1, formulaId: null},
        excerpt: null, limitationCodes: []}], candidateTechniqueIds: ['T03'],
      userContext: {goal: null, frequency: 'UNKNOWN', effort: 'UNKNOWN', constraints: []}},
    summary: {selectedRounds: 1, supportingRounds: 0, observations: 1, contentFragments: 0,
      payloadCharacters: 1000, estimatedInputTokens: 236, sendBlocked: false}, warnings: []
  };
}
