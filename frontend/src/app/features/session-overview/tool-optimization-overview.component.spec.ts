import {ComponentFixture, TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {MatDialog} from '@angular/material/dialog';
import {MatTooltip} from '@angular/material/tooltip';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {MATERIAL_SYMBOLS_PROVIDER} from '../../app.config';
import {ToolUsageOverview} from '../../core/tool-usage-analysis';
import {ToolOptimizationOverviewComponent} from './tool-optimization-overview.component';

describe('ToolOptimizationOverviewComponent', () => {
  let fixture: ComponentFixture<ToolOptimizationOverviewComponent>;
  let dialog: MatDialog;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MATERIAL_SYMBOLS_PROVIDER]
    });
    fixture = TestBed.createComponent(ToolOptimizationOverviewComponent);
    dialog = TestBed.inject(MatDialog);
  });

  afterEach(() => {
    dialog.closeAll();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('separates unused and used tools into tabs with contextual guidance', () => {
    fixture.componentRef.setInput('overview', overview());
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('.expand-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelector('[role="tablist"]')).toBeNull();

    toggle.click();
    fixture.detectChanges();

    const tabs = [...element.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    let rows = [...element.querySelectorAll<HTMLElement>('.tool-row')];

    expect(element.textContent).toContain('POTENCJALNE USPRAWNIENIA · BEZ AI');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(tabs.map(tab => tab.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Niewykorzystane 1', 'Wykorzystane 1']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(rows.map(row => row.querySelector('.tool-identity strong')?.textContent)).toEqual(['unused_tool']);
    expect(rows[0].querySelector('.tool-icon mat-icon')?.textContent?.trim()).toBe('build');
    expect(rows[0].textContent).toContain('Niewykorzystane');
    expect(rows[0].querySelector('.definition-tokens')?.textContent).toMatch(/≈\s*1\s*200/);
    const definitionTooltip = fixture.debugElement
      .query(By.css('[aria-label="Jak szacujemy tokeny definicji"]')).injector.get(MatTooltip);
    expect(definitionTooltip.message).toContain('udział jej znaków w przechwyconej treści requestu');
    expect(definitionTooltip.message).toContain('Każde zaobserwowane przesłanie definicji liczymy osobno');
    expect(definitionTooltip.message).toContain('sumą dla wszystkich rund, w których definicja była dostępna');
    expect(definitionTooltip.message).toContain('nie należy jej ponownie mnożyć przez liczbę rund');
    expect(definitionTooltip.message).not.toContain('Cyjan');
    rows[0].querySelector<HTMLButtonElement>('.tool-open')!.click();
    fixture.detectChanges();
    const definitionDialog = document.querySelector<HTMLElement>('as-tool-definition-dialog')!;
    const dialogIcons = [...definitionDialog.querySelectorAll('mat-icon')];
    expect(dialogIcons.length).toBeGreaterThan(0);
    expect(dialogIcons.every(icon => icon.classList.contains('material-symbols-outlined'))).toBe(true);
    expect(definitionDialog.textContent).toContain('Definicja testowego narzędzia');
    expect(definitionDialog.textContent).toContain('query');
    expect(definitionDialog.textContent).toContain('Wymagany');
    expect(definitionDialog.textContent).toContain('Zapytanie do wykonania');
    expect(definitionDialog.textContent).toContain('Pełna definicja JSON');
    dialog.closeAll();
    expect(element.textContent).toContain('Definicje narzędzi dostępnych w sesji są przekazywane do modelu jako część inputu');
    expect(element.textContent).toContain('GitHub Copilot AI credits');
    expect(element.textContent).toContain('konsoli pracy z agentem w VS Code');
    expect(element.textContent).toContain('listę tools i używanych toolsetów');

    tabs[1].click();
    fixture.detectChanges();

    rows = [...element.querySelectorAll<HTMLElement>('.tool-row')];
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(rows.map(row => row.querySelector('.tool-identity strong')?.textContent)).toEqual(['read_file']);
    expect(rows[0].querySelector('.tool-icon mat-icon')?.textContent?.trim()).toBe('build');
    expect(rows[0].querySelector('.invocation-tokens')?.textContent).toMatch(/≈\s*150/);
    expect(rows[0].querySelector('.result-tokens')?.textContent).toMatch(/≈\s*400/);
    expect(rows[0].querySelector('.cached-result-tokens')?.textContent).toMatch(/≈\s*320/);
    expect(rows[0].querySelector('.cached-result-tokens')?.textContent).toContain('3 ponownych obecności');
    const duplicates = rows[0].querySelector<HTMLElement>('.duplicate-invocations')!;
    expect(duplicates.textContent?.trim()).toBe('3');
    expect(duplicates.classList.contains('has-duplicates')).toBe(true);
    rows[0].querySelector<HTMLButtonElement>('.tool-open')!.click();
    fixture.detectChanges();
    const usedDialog = [...document.querySelectorAll<HTMLElement>('as-tool-definition-dialog')].at(-1)!;
    expect(usedDialog.textContent).toContain('między różnymi agentami');
    expect(usedDialog.textContent).toContain('po kompaktowaniu');
    expect(usedDialog.textContent).toContain('z identycznym rezultatem');
    expect(usedDialog.textContent).toContain('z innym rezultatem');
    expect(usedDialog.textContent).toContain('bez przechwyconego rezultatu');
    expect(usedDialog.textContent).toContain('Powtarzane zestawy parametrów');
    expect(usedDialog.querySelector('.duplicate-arguments pre')?.textContent).toContain('"path": "README.md"');
    expect(usedDialog.querySelector('.argument-rounds')?.textContent).toContain('Pierwsze wywołanieM1');
    expect(usedDialog.querySelector('.argument-rounds')?.textContent).toContain('PowtórzeniaM3, M4, S1:M3, S2:M4');
    expect([...usedDialog.querySelectorAll('.duplicate-rounds span')].map(item => item.textContent?.trim()))
      .toEqual(['M3', 'M4', 'S1:M3', 'S2:M4']);
    expect(element.textContent).not.toContain('Wywołania + wyniki');
    expect(element.textContent).toContain('tokeny inputu + 10 × ≈ tokeny outputu');
    expect(element.textContent).toContain('nie dalej niż do najbliższego kompaktowania');
    expect(element.textContent).toContain('nie dowodzą oszczędności');
  });
});

function overview(): ToolUsageOverview {
  return {
    modelCalls: 4,
    callsWithDefinitions: 4,
    callsWithOutput: 4,
    unusedTools: 1,
    unlinkedResultOccurrences: 0,
    rows: [
      {
        name: 'unused_tool', state: 'unused', agents: ['Agent główny'], definitionVersions: 1,
        definitions: [{version: 1, canonicalJson: JSON.stringify({
          name: 'unused_tool', description: 'Definicja testowego narzędzia',
          parameters: {type: 'object', properties: {query: {type: 'string', description: 'Zapytanie do wykonania'}}, required: ['query']}
        })}],
        availableCalls: 4, responseCoveredCalls: 4, invocations: 0, resultOccurrences: 0,
        duplicates: {total: 0, acrossAgents: 0, afterCompaction: 0, identicalResult: 0, differentResult: 0, missingResult: 0, roundLabels: [], argumentGroups: []},
        definitionTokens: 1200, invocationTokens: 0, resultTokens: 0,
        retainedResultOccurrences: 0, cachedResultTokens: 0, cacheEstimateCoverage: 0
      },
      {
        name: 'read_file', state: 'used', agents: ['Agent główny'], definitionVersions: 1,
        definitions: [{version: 1, canonicalJson: JSON.stringify({
          name: 'read_file', description: 'Czyta plik',
          parameters: {type: 'object', properties: {path: {type: 'string'}}, required: ['path']}
        })}],
        availableCalls: 4, responseCoveredCalls: 4, invocations: 3, resultOccurrences: 2,
        duplicates: {total: 3, acrossAgents: 2, afterCompaction: 1, identicalResult: 1, differentResult: 1, missingResult: 1, roundLabels: ['M3', 'M4', 'S1:M3', 'S2:M4'], argumentGroups: [{argumentsJson: '{\n  "path": "README.md"\n}', firstRoundLabel: 'M1', repeatedRoundLabels: ['M3', 'M4', 'S1:M3', 'S2:M4'], repetitions: 3}]},
        definitionTokens: 300, invocationTokens: 150, resultTokens: 400,
        retainedResultOccurrences: 3, cachedResultTokens: 320, cacheEstimateCoverage: 3
      }
    ]
  };
}
