import {ComponentFixture, TestBed} from '@angular/core/testing';
import {describe, expect, it, vi} from 'vitest';
import {OptimizationAdvicePreview} from '../../models/optimization-guidance.models';
import {AdvicePreviewComponent} from './advice-preview.component';

describe('AdvicePreviewComponent', () => {
  it('shows that the package remains local and exposes its exact content on demand', () => {
    TestBed.configureTestingModule({imports: [AdvicePreviewComponent]});
    const fixture: ComponentFixture<AdvicePreviewComponent> = TestBed.createComponent(AdvicePreviewComponent);
    fixture.componentRef.setInput('preview', preview());
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.textContent).toContain('NIE WYSŁANO');
    expect(element.textContent).toContain('≈ 1200 tokenów');
    expect(element.textContent).toContain('Brakujące wartości: 1');
    expect(element.textContent).toContain('Pakiet pozostaje lokalny');
    expect(element.textContent).toContain('o pojemności decyduje okno kontekstowe wybranego modelu');
    expect(element.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(element.querySelector('pre')?.textContent).toContain('optimization-advice-v1');
  });

  it('requests a new frozen snapshot explicitly', () => {
    TestBed.configureTestingModule({imports: [AdvicePreviewComponent]});
    const fixture = TestBed.createComponent(AdvicePreviewComponent);
    fixture.componentRef.setInput('preview', preview());
    fixture.detectChanges();
    const refreshed = vi.fn();
    fixture.componentInstance.refreshed.subscribe(refreshed);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('header button')!.click();
    expect(refreshed).toHaveBeenCalledOnce();
  });

  it('distinguishes backend validation from sending data to the model', () => {
    TestBed.configureTestingModule({imports: [AdvicePreviewComponent]});
    const fixture = TestBed.createComponent(AdvicePreviewComponent);
    fixture.componentRef.setInput('preview', {
      ...preview(),
      preparation: {previewId: 'preview-1', preparedAt: '2026-09-08T10:00:00Z', expiresAt: '2026-09-08T10:30:00Z',
        requestHash: 'a'.repeat(64), sourceValidation: 'RAW_AND_NORMALIZED'}
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ZWERYFIKOWANO LOKALNIE · NIE WYSŁANO DO AI');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Źródła potwierdzone w raw telemetry');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('nie uruchomił modelu');
  });

  it('requires an explicit click before emitting the frozen snapshot for AI', () => {
    TestBed.configureTestingModule({imports: [AdvicePreviewComponent]});
    const fixture = TestBed.createComponent(AdvicePreviewComponent);
    fixture.componentRef.setInput('preview', {
      ...preview(),
      preparation: {previewId: 'preview-1', preparedAt: '2099-01-01T10:00:00Z', expiresAt: '2099-01-01T10:30:00Z',
        requestHash: 'a'.repeat(64), sourceValidation: 'RAW_AND_NORMALIZED'}
    });
    fixture.detectChanges();
    const sent = vi.fn();
    fixture.componentInstance.adviceRequested.subscribe(sent);

    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find(item => item.textContent?.includes('Wyślij do AI'))!;
    button.click();

    expect(sent).toHaveBeenCalledOnce();
    expect((sent.mock.calls[0][0] as OptimizationAdvicePreview).preparation?.previewId).toBe('preview-1');
  });

  it('does not disable a valid frozen snapshot because of a legacy local size flag', () => {
    TestBed.configureTestingModule({imports: [AdvicePreviewComponent]});
    const fixture = TestBed.createComponent(AdvicePreviewComponent);
    fixture.componentRef.setInput('preview', {
      ...preview(),
      preparation: {previewId: 'preview-1', preparedAt: '2099-01-01T10:00:00Z', expiresAt: '2099-01-01T10:30:00Z',
        requestHash: 'a'.repeat(64), sourceValidation: 'RAW_AND_NORMALIZED'},
      summary: {...preview().summary, payloadCharacters: 120_000, sendBlocked: true}
    });
    fixture.detectChanges();

    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find(item => item.textContent?.includes('Wyślij do AI'))!;
    expect(button.disabled).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Przed wysłaniem trzeba zawęzić pakiet');
  });
});

function preview(): OptimizationAdvicePreview {
  return {
    request: {
      version: 'optimization-advice-v1', catalogVersion: 'techniques-v1',
      scope: {kind: 'phase', rootSessionId: 1, interactionTraceId: 'trace-1', roundRefs: ['r1'], actions: ['ACQUIRE_DATA']},
      manifest: {capturedAt: '2026-09-08T09:00:00Z', dataFingerprint: '1234567890abcdef1234567890abcdef', selectedRefs: ['r1'],
        supportingRefs: [], omitted: [{ref: 'r2', reason: 'CONTENT_FRAGMENT_LIMIT'}], classificationFingerprint: null,
        evidenceVersion: 'guidance-evidence-v2', redactionVersion: 'guidance-redaction-v1', upstreamCompleteness: 'UNVERIFIED'},
      observations: [
        {id: 'o1', kind: 'INPUT_TOKENS', provenance: 'EMITTED', sources: [], ruleVersion: null,
          metric: {value: 100, unit: 'token', population: 'r1', covered: 1, total: 1, formulaId: null}, excerpt: null, limitationCodes: []},
        {id: 'o2', kind: 'FRESH_INPUT_TOKENS', provenance: 'DERIVED', sources: [], ruleVersion: 'guidance-evidence-v2',
          metric: {value: 80, unit: 'token', population: 'r1', covered: 1, total: 1, formulaId: 'fresh'}, excerpt: null, limitationCodes: []},
        {id: 'o3', kind: 'CACHE_WRITE_TOKENS', provenance: 'MISSING', sources: [], ruleVersion: null,
          metric: {value: null, unit: 'token', population: 'r1', covered: 0, total: 1, formulaId: null}, excerpt: null, limitationCodes: ['MISSING_VALUE']}
      ],
      candidateTechniqueIds: ['T03'], userContext: {goal: 'Znajdź endpoint', frequency: 'UNKNOWN', effort: 'UNKNOWN', constraints: []}
    },
    summary: {selectedRounds: 1, supportingRounds: 0, observations: 3, contentFragments: 0,
      payloadCharacters: 5100, estimatedInputTokens: 1200, sendBlocked: false},
    warnings: ['Referencje oczekują walidacji.']
  };
}
