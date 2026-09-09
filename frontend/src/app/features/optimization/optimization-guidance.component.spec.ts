import {ComponentFixture, TestBed} from '@angular/core/testing';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NotificationService} from '../../core/notification.service';
import {OptimizationGuidanceService} from '../../core/optimization-guidance.service';
import {OptimizationTechniqueCatalog} from '../../models/optimization-guidance.models';
import {OptimizationGuidanceComponent} from './optimization-guidance.component';

const catalog: OptimizationTechniqueCatalog = {
  version: 'techniques-v1',
  techniques: [
    {
      id: 'T03', revision: 1, title: 'Najpierw mapa', explanation: 'Opis mapy.', mechanism: 'Mapa kieruje research.',
      firstExperimentGoal: 'Porównaj liczbę odczytów.', simplerAlternative: 'Wskaż jeden katalog.', topics: ['ACQUIRE_DATA', 'MANAGE_CONTEXT'],
      whenUseful: ['Duży projekt.'], whenNotUseful: ['Mały projekt.'], prerequisites: ['Spis modułów.'],
      applyAt: ['PROJECT_MAP'], firstExperiment: ['Utwórz małą mapę.', 'Porównaj podobne zadanie.'],
      example: {before: 'Szukaj wszędzie.', after: 'Najpierw sprawdź mapę.'},
      setup: {level: 'MEDIUM', tasks: ['Ustal format.']},
      maintenance: {tasks: ['Aktualizuj mapę.'], triggers: ['Zmiana modułu.']},
      qualityChecks: ['Potwierdź fakt w kodzie.'], compare: ['Liczba odczytów.'], relatedTechniqueIds: ['T14']
    },
    {
      id: 'T14', revision: 1, title: 'Waliduj wcześnie', explanation: 'Opis walidacji.', mechanism: 'Szybciej wykrywa błąd.',
      firstExperimentGoal: 'Porównaj moment wykrycia.', simplerAlternative: 'Sprawdź jedną rzecz.', topics: ['VALIDATE'], whenUseful: ['Jest wąski test.'],
      whenNotUseful: ['Brak wiarygodnego testu.'], prerequisites: ['Test.'], applyAt: ['SKILL'],
      firstExperiment: ['Uruchom test.'], example: {before: 'Pełny test.', after: 'Wąski test.'},
      setup: {level: 'SMALL', tasks: ['Wskaż test.']}, maintenance: {tasks: ['Aktualizuj.'], triggers: ['Zmiana testu.']},
      qualityChecks: ['Test pokrywa zmianę.'], compare: ['Moment wykrycia.'], relatedTechniqueIds: []
    }
  ]
};

describe('OptimizationGuidanceComponent', () => {
  let fixture: ComponentFixture<OptimizationGuidanceComponent>;
  const success = vi.fn();
  const error = vi.fn();

  beforeEach(() => {
    success.mockReset();
    error.mockReset();
    TestBed.configureTestingModule({
      imports: [OptimizationGuidanceComponent],
      providers: [
        {provide: OptimizationGuidanceService, useValue: {load: vi.fn().mockResolvedValue(catalog)}},
        {provide: NotificationService, useValue: {success, error}}
      ]
    });
    fixture = TestBed.createComponent(OptimizationGuidanceComponent);
  });

  it('shows the local catalog and filters it by an understandable topic', async () => {
    await fixture.componentInstance.load();
    fixture.detectChanges();

    const pageText: string = fixture.nativeElement.textContent;
    expect(pageText).toContain('bez danych sesji i bez wywołania AI');
    expect(pageText).toContain('Najpierw mapa');
    expect(pageText).toContain('PROBLEM DO ROZWIĄZANIA');
    expect(pageText).toContain('Jakiego rezultatu oczekiwać');
    expect(pageText).toContain('Jak sprawdzić, czy zadziałało');
    expect(pageText.indexOf('PROBLEM DO ROZWIĄZANIA')).toBeLessThan(pageText.indexOf('Jakiego rezultatu oczekiwać'));
    expect(pageText.indexOf('Jakiego rezultatu oczekiwać')).toBeLessThan(pageText.indexOf('Jak sprawdzić, czy zadziałało'));
    expect(pageText.indexOf('Jak sprawdzić, czy zadziałało')).toBeLessThan(pageText.indexOf('Kiedy warto sprawdzić'));
    fixture.componentInstance.selectTopic('QUALITY');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Waliduj wcześnie');
    expect(fixture.nativeElement.textContent).not.toContain('Najpierw mapa');
  });

  it('shows and orders the complete T01–T16 catalog without a six-item presentation limit', async () => {
    await fixture.componentInstance.load();
    const completeCatalog = Array.from({length: 16}, (_, index) => `T${String(index + 1).padStart(2, '0')}`)
      .reverse()
      .map((id): OptimizationTechniqueCatalog['techniques'][number] => ({
        ...catalog.techniques[0],
        id,
        title: id,
        relatedTechniqueIds: []
      }));
    fixture.componentInstance.catalogState.set({version: 'techniques-v1', techniques: completeCatalog});
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredTechniques().map(technique => technique.id))
      .toEqual(Array.from({length: 16}, (_, index) => `T${String(index + 1).padStart(2, '0')}`));
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.technique-list > button')).toHaveLength(16);
  });

  it('copies a complete trial plan and confirms the action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
    await fixture.componentInstance.copyTrialPlan(catalog.techniques[0]);

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Cel i kryterium próby'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Problem do rozwiązania'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Oczekiwany rezultat'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Przykład — wariant do przetestowania'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Jak sprawdzić rezultat'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Utrzymanie'));
    expect(success).toHaveBeenCalledWith('Plan próby skopiowany do schowka.');
  });

  it('starts with deterministic contextual recommendations and explains measurement provenance', async () => {
    fixture.componentRef.setInput('context', {
      kind: 'CATEGORY', title: 'Pozyskanie danych', scopeLabel: 'interakcja 2',
      explanation: 'Kategoria pochodzi z zapisanej analizy AI.', topics: ['ACQUIRE_DATA'],
      measurement: {credits: .42, shareOfKnown: 38, creditEstimated: true, coveredCalls: 3, totalCalls: 4},
      evidenceLabels: ['≈ oznacza lokalną estymację.'],
      evidence: [{kind: 'ROUND', id: 'round-2', label: 'Główny agent · runda 2', description: 'Otwórz cykl.'}]
    });
    await fixture.componentInstance.load();
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.guidance-context')?.textContent).toContain('Pozyskanie danych');
    expect(element.querySelector('.guidance-context')?.textContent).toContain('≈ 0,42');
    expect(element.querySelector('.guidance-context')?.textContent).toContain('3/4');
    expect(element.querySelector('.context-topic')?.getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelector('.technique-list')?.textContent).toContain('Najpierw mapa');
    expect(element.querySelector('.technique-list')?.textContent).not.toContain('Waliduj wcześnie');
    expect(element.textContent).toContain('sam dobór technik nie wysyła danych sesji');
    const selected = vi.fn();
    fixture.componentInstance.evidenceSelected.subscribe(selected);
    element.querySelector<HTMLButtonElement>('.evidence-links button')!.click();
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({evidence: expect.objectContaining({id: 'round-2'})}));
  });

  it('offers a local evidence preview only for an exact phase and emits bounded candidate techniques', async () => {
    fixture.componentRef.setInput('context', {
      kind: 'PHASE', title: 'Pozyskanie danych', scopeLabel: 'interakcja 1 · M1', explanation: 'Konkretna faza.',
      topics: ['ACQUIRE_DATA'], measurement: {credits: .2, creditEstimated: false, coveredCalls: 1, totalCalls: 1},
      evidenceLabels: [], evidence: [{kind: 'ROUND', id: 'round-1', label: 'M1', description: 'Otwórz rundę'}]
    });
    await fixture.componentInstance.load();
    fixture.detectChanges();
    const requested = vi.fn();
    fixture.componentInstance.advicePreviewRequested.subscribe(requested);

    const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.advice-entry button')]
      .find(candidate => candidate.textContent?.includes('Przygotuj podgląd dla AI'));
    button!.click();

    expect(fixture.nativeElement.textContent).toContain('NADAL BEZ WYWOŁANIA AI');
    expect(requested).toHaveBeenCalledWith(expect.objectContaining({
      catalogVersion: 'techniques-v1', candidateTechniqueIds: ['T03'], context: expect.objectContaining({kind: 'PHASE'})
    }));
  });
});
