import {Component} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {MAT_ICON_DEFAULT_OPTIONS} from '@angular/material/icon';
import {MatTooltip} from '@angular/material/tooltip';
import {By} from '@angular/platform-browser';
import {ActivatedRoute, convertToParamMap, Router} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ScannerApiService} from '../../core/scanner-api.service';
import {NotificationService} from '../../core/notification.service';
import {StandardizationHistoryService} from '../../core/standardization-history.service';
import {StandardizationStateService} from '../../core/standardization-state.service';
import {SavedStandardAnalysis, StandardRepositorySummary} from '../../models/standardization.models';
import {StandardizationComponent} from './standardization.component';
import {StandardizationPageComponent} from './standardization-page.component';

@Component({selector: 'as-standardization', template: ''})
class StandardizationContentStub {}

const saved: SavedStandardAnalysis = {
  repositoryId: 'repo-a', analysisId: 'analysis-a',
  preview: {id: 'analysis-a', expiresAt: '2026-09-22T12:00:00Z', hash: 'hash', systemMessage: 'system', prompt: 'prompt',
    packet: {version: 'standardization-evidence-v1', rulesetVersion: 'rules-v1', promptVersion: 'prompt-v1',
      profile: 'AUTO', clientVersion: 'nieznana', model: 'model-a', inventoryComplete: true,
      files: [{id: 'f1', path: 'AGENTS.md', category: 'INSTRUCTIONS', content: '[UKRYTO]', hash: 'hash', lines: 1, redacted: true}],
      omissions: [], localChecks: [], rules: [], sources: [], standards: [], targets: []}},
  result: {contract: 'standardization-answer-v1', previewId: 'analysis-a', hash: 'hash', model: 'model-a',
    analyzedAt: '2026-09-22T11:00:00Z', assessments: [], unreviewedTargetIds: [], rejectedRecords: 0}
};
const repository: StandardRepositorySummary = {
  id: 'repo-a', name: 'synthetic-project', createdAt: '2026-09-22T10:00:00Z',
  analyses: [{id: 'analysis-a', analyzedAt: saved.result.analyzedAt, model: 'model-a', fileCount: 1}]
};

describe('StandardizationPageComponent actions', () => {
  let fixture: ComponentFixture<StandardizationPageComponent>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const api = {
    standardizationRepositories: vi.fn<() => Promise<StandardRepositorySummary[]>>(),
    savedStandardization: vi.fn<() => Promise<SavedStandardAnalysis>>(),
    deleteStandardization: vi.fn<() => Promise<void>>(),
    discardStandardization: vi.fn(async () => undefined)
  };
  const navigate = vi.fn(async () => true);
  const notifications = {error: vi.fn(), success: vi.fn()};

  beforeEach(() => {
    vi.clearAllMocks();
    api.standardizationRepositories.mockResolvedValue([repository]);
    api.savedStandardization.mockResolvedValue(saved);
    api.deleteStandardization.mockResolvedValue(undefined);
    routeParams = new BehaviorSubject(convertToParamMap({repositoryId: 'repo-a', analysisId: 'analysis-a'}));
    vi.stubGlobal('confirm', vi.fn(() => true));
    TestBed.configureTestingModule({providers: [
      {provide: ScannerApiService, useValue: api},
      {provide: NotificationService, useValue: notifications},
      {provide: Router, useValue: {navigate}},
      {provide: MAT_ICON_DEFAULT_OPTIONS, useValue: {fontSet: 'material-symbols-outlined'}},
      {provide: ActivatedRoute, useValue: {paramMap: routeParams.asObservable(),
        snapshot: {routeConfig: {path: 'repositories/:repositoryId/analyses/:analysisId'}}}}
    ]});
    TestBed.overrideComponent(StandardizationPageComponent, {
      remove: {imports: [StandardizationComponent]}, add: {imports: [StandardizationContentStub]}
    });
    fixture = TestBed.createComponent(StandardizationPageComponent);
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function ready(): Promise<HTMLElement> {
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  function button(element: HTMLElement, label: string): HTMLButtonElement {
    return element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  }

  it('shows JSON and PDF export, delete and close with accessible labels, tooltips and Material icons', async () => {
    const element = await ready();
    const actions = [...element.querySelectorAll<HTMLButtonElement>('.analysis-actions button')];
    expect(actions.map(action => action.getAttribute('aria-label'))).toEqual([
      'Eksportuj analizę do JSON', 'Pobierz raport PDF', 'Usuń analizę', 'Zamknij analizę'
    ]);
    expect(actions.every(action => action.classList.contains('ui-icon-button'))).toBe(true);
    expect(button(element, 'Usuń analizę').classList.contains('ui-button--danger')).toBe(true);
    expect([...element.querySelectorAll('.analysis-actions mat-icon')]
      .every(icon => icon.classList.contains('material-symbols-outlined'))).toBe(true);
    const pdf = button(element, 'Pobierz raport PDF');
    expect(pdf.querySelector('mat-icon')?.textContent).toBe('picture_as_pdf');
    expect(pdf.textContent).not.toContain('Pobierz raport PDF');
    expect(pdf.disabled).toBe(false);
    const tooltip = fixture.debugElement.queryAll(By.directive(MatTooltip)).find(item => item.nativeElement === pdf)!;
    expect(tooltip.injector.get(MatTooltip).message).toBe('Pobierz raport PDF');
    expect(element.textContent).not.toContain('Nowa analiza');
    expect(element.textContent).not.toContain('Do sesji');
    TestBed.inject(StandardizationStateService).savingFiles.set(true);
    fixture.detectChanges();
    expect(pdf.disabled).toBe(true);
  });

  it('keeps the result when deletion is not confirmed', async () => {
    const element = await ready();
    vi.mocked(confirm).mockReturnValue(false);
    button(element, 'Usuń analizę').click();
    await fixture.whenStable();
    expect(api.deleteStandardization).not.toHaveBeenCalled();
    expect(fixture.componentInstance.savedAnalysis()).toEqual(saved);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('deletes the selected snapshot, refreshes history and returns home after confirmation', async () => {
    const element = await ready();
    api.standardizationRepositories.mockResolvedValue([]);
    button(element, 'Usuń analizę').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/']));
    expect(confirm).toHaveBeenCalledWith('Usunąć tę analizę repozytorium wraz z wynikiem AI i zapisanymi plikami?');
    expect(api.deleteStandardization).toHaveBeenCalledExactlyOnceWith('repo-a', 'analysis-a');
    expect(TestBed.inject(StandardizationHistoryService).repositories()).toEqual([]);
    expect(TestBed.inject(StandardizationStateService).files()).toEqual([]);
    expect(notifications.success).toHaveBeenCalledWith('Usunięto analizę repozytorium.');
  });

  it('keeps the result and history visible when deletion fails', async () => {
    const element = await ready();
    api.deleteStandardization.mockRejectedValueOnce(new Error('Nie udało się usunąć analizy repozytorium'));
    button(element, 'Usuń analizę').click();
    await vi.waitFor(() => expect(notifications.error).toHaveBeenCalled());
    expect(fixture.componentInstance.savedAnalysis()).toEqual(saved);
    expect(TestBed.inject(StandardizationHistoryService).repositories()).toEqual([repository]);
    expect(navigate).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(button(element, 'Usuń analizę').disabled).toBe(false);
  });

  it('blocks repeated deletion and closing while the deletion request is pending', async () => {
    const element = await ready();
    let finish!: () => void;
    api.deleteStandardization.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    button(element, 'Usuń analizę').click();
    fixture.detectChanges();
    expect([...element.querySelectorAll<HTMLButtonElement>('.analysis-actions button')].every(action => action.disabled)).toBe(true);
    button(element, 'Usuń analizę').click();
    expect(api.deleteStandardization).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/']));
  });

  it('closes the view without deleting the saved analysis', async () => {
    const element = await ready();
    button(element, 'Zamknij analizę').click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(['/']));
    expect(api.deleteStandardization).not.toHaveBeenCalled();
    expect(TestBed.inject(StandardizationHistoryService).repositories()).toEqual([repository]);
    expect(TestBed.inject(StandardizationStateService).files()).toEqual([]);
  });

  it('shows only close on a new analysis and blocks it during an active operation', async () => {
    await ready();
    routeParams.next(convertToParamMap({}));
    const element = await ready();
    expect([...element.querySelectorAll('.analysis-actions button')].map(action => action.getAttribute('aria-label')))
      .toEqual(['Zamknij analizę']);
    TestBed.inject(StandardizationStateService).sending.set(true);
    fixture.detectChanges();
    expect(button(element, 'Zamknij analizę').disabled).toBe(true);
  });

  it('uses the actual latest analysis when opened through the repository route', async () => {
    await ready();
    routeParams.next(convertToParamMap({repositoryId: 'repo-a'}));
    const element = await ready();
    button(element, 'Usuń analizę').click();
    await vi.waitFor(() => expect(api.deleteStandardization).toHaveBeenCalledWith('repo-a', 'analysis-a'));
    await fixture.whenStable();
  });
});
