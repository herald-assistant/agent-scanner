import {ComponentFixture, TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {MatBadge} from '@angular/material/badge';
import {MatTooltip} from '@angular/material/tooltip';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {buildRepositoryReport, RepositoryReportInput} from '../../core/repository-report';
import {categoryForPath, RepositoryFile} from '../../core/standardization-files';
import {RepositoryReportComponent} from './repository-report.component';

function file(path: string, content = 'Synthetic configuration'): RepositoryFile {
  return {path, content, category: categoryForPath(path), selected: true,
    bytes: new TextEncoder().encode(content).length, redacted: false, read: async () => new File([content], path)};
}

describe('Repository report mechanism summaries', () => {
  let fixture: ComponentFixture<RepositoryReportComponent>;
  beforeEach(() => TestBed.configureTestingModule({imports: [RepositoryReportComponent]}));
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  function render(input: Partial<RepositoryReportInput> = {}): void {
    fixture = TestBed.createComponent(RepositoryReportComponent);
    fixture.componentRef.setInput('report', buildRepositoryReport({name: 'synthetic-repo', complete: true,
      gitDetected: false, files: [], reportFiles: [], ...input}));
    fixture.detectChanges();
  }
  function summary(id: string): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-report-mechanism="${id}"] > summary`);
  }
  function status(id: string): HTMLElement { return summary(id).querySelector<HTMLElement>('.mechanism-status')!; }

  it('describes each type under its name and puts file counts and confirmed absence in separate status pills', () => {
    render({files: [file('AGENTS.md'), file('.github/copilot-instructions.md')]});
    expect(summary('INSTRUCTIONS').querySelector('strong')?.textContent).toBe('Instrukcje');
    expect(summary('INSTRUCTIONS').querySelector('small')?.textContent).toBe('Zasady pracy i kontekst dla agenta.');
    expect(status('INSTRUCTIONS').textContent).toContain('Zidentyfikowano: 2 pliki');
    expect(status('INSTRUCTIONS').classList.contains('positive')).toBe(true);
    expect(status('SKILLS').textContent).toContain('Brak konfiguracji');
    expect(status('SKILLS').classList.contains('gap')).toBe(true);
    expect(summary('CONTEXT')).toBeNull();
    expect(fixture.nativeElement.querySelector('.entry-links-count')).toBeNull();
  });

  it('shows linked files beside their configuration with a Material badge and an accessible tooltip', () => {
    const path = '.github/skills/review/references/checklist.md';
    render({files: [file('.github/skills/review/SKILL.md', '[Checklist](references/checklist.md)\n[Again](references/checklist.md#tests)\n[Guide](../../../docs/guide.md)'),
      file(path, 'Synthetic checklist')]});
    expect(summary('CONTEXT')).toBeNull();
    const count = fixture.debugElement.query(By.css('.entry-links-count'));
    expect(count.injector.get(MatBadge).content).toBe('2');
    expect(count.injector.get(MatTooltip).message).toBe('Podlinkowane pliki: 2. Rozwiń wpis, aby zobaczyć listę.');
    expect(count.nativeElement.getAttribute('aria-label')).toBe('Podlinkowane pliki: 2');
    expect(count.nativeElement.querySelector('mat-icon').textContent).toBe('link');
    const list = fixture.nativeElement.querySelector('.entry-links');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.textContent).toContain('/docs/guide.md');
    expect(list.textContent).toContain('Treść poza migawką');
    const inspect = vi.fn();
    fixture.componentInstance.inspect.subscribe(inspect);
    list.querySelector('button').click();
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({path, content: 'Synthetic checklist'}));
    expect(list.querySelectorAll('button')).toHaveLength(1);
  });

  it('counts a file containing two MCP servers once while retaining both declarations', () => {
    render({files: [file('.mcp.json', '{"mcpServers":{"first":{"command":"node"},"second":{"command":"node"}}}')]});
    expect(status('MCP').textContent).toContain('Zidentyfikowano: 1 plik');
    expect(fixture.nativeElement.querySelectorAll('[data-report-mechanism="MCP"] .report-entry')).toHaveLength(2);
    expect(fixture.componentInstance.report().groups.find(group => group.id === 'MCP')!.summary).toContain('2 rozpoznane deklaracje');
  });

  it('keeps absent mechanisms unresolved after a partial read', () => {
    render({complete: false});
    expect(status('AGENTS').textContent).toContain('Nie ustalono');
    expect(status('AGENTS').classList.contains('gap')).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Brak konfiguracji');
  });

  it('marks identified unreadable files as a partial read and does not infer missing IDE configuration from old snapshots', () => {
    render({reportFiles: undefined, files: [{...file('AGENTS.md'), error: 'Treść nieodczytana'}]});
    expect(status('INSTRUCTIONS').textContent).toContain('Zidentyfikowano: 1 plik');
    expect(status('INSTRUCTIONS').classList.contains('attention')).toBe(true);
    expect(status('VSCODE').textContent).toContain('Nie ustalono');
    expect(status('VSCODE').classList.contains('gap')).toBe(false);
  });
});
