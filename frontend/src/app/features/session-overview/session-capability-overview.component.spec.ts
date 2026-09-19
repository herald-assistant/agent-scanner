import {ComponentFixture, TestBed} from '@angular/core/testing';
import {describe, expect, it} from 'vitest';
import {SessionCapabilityAnalysis} from '../../core/session-capability-analysis';
import {SessionCapabilityOverviewComponent} from './session-capability-overview.component';

describe('SessionCapabilityOverviewComponent', () => {
  it('shows available and used capabilities without producing a score', () => {
    const fixture = createFixture({
      contentCaptured: true,
      systemInstructionsObserved: true,
      instructions: [
        {path: 'c:/repo/.github/copilot-instructions.md', name: 'copilot-instructions.md', kind: 'copilot-instructions', applied: true, evidence: []},
        {path: 'c:/repo/.github/instructions/js.instructions.md', name: 'js.instructions.md', kind: 'scoped-instructions', applyTo: '**/*.js', applied: false, evidence: []}
      ],
      skills: [
        {name: 'adoption-summary', path: 'c:/repo/.github/skills/adoption-summary/SKILL.md', scope: 'workspace', exposed: true, useCount: 0, evidence: []},
        {name: 'order-calculation', path: 'c:/repo/.github/skills/order-calculation/SKILL.md', scope: 'workspace', exposed: true, useCount: 1, evidence: []}
      ],
      customAgents: [{name: 'Evidence Researcher', scope: 'unknown', exposed: true, useCount: 0, evidence: []}],
      tools: {availableNames: ['read_file', 'skill'], exposedNames: ['read_file', 'skill'], usedNames: ['read_file', 'skill'], executionCount: 3},
      mcp: {availableTools: ['mcp_agent-scanner_echo'], exposedTools: [], usedTools: [], servers: [], executionCount: 0},
      subagentInvocations: 0,
      compactions: 0
    });

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).not.toContain('order-calculation');
    const skillsRow = [...element.querySelectorAll<HTMLButtonElement>('.capability-row')]
      .find(button => button.textContent?.includes('Skille'));
    expect(skillsRow).toBeDefined();
    skillsRow!.click();
    fixture.detectChanges();
    const text = element.textContent ?? '';
    expect(text).toContain('Poziom adopcji agenta AI w tej sesji');
    expect(text).toContain('gdzie pozostają luki adopcji');
    expect(text).not.toContain('Treść dostępna');
    expect(text).not.toContain('Można porównać kontekst sesji z wykonaniami');
    expect(text).toContain('1 / 2');
    expect(text).toContain('1 w sesji · 0 przekazane modelowi');
    expect(text).toContain('order-calculation');
    expect(text).toContain('Narzędzia2użyte rodzaje · wykonania: 3');
    expect(text).toContain('Konfiguracja i użycie wymagające uwagi');
    expect(text).toContain('aktywna adopcja · użyto 1');
    expect(text).not.toContain('Skille repozytorium były dostępne, ale żadnego nie użyto');
    expect(text).not.toContain('instrukcje były dostępne, ale żadnej nie zastosowano');
    expect(text).toContain('MCP było dostępne, ale nie zostało użyte');
    expect(text).toContain('Dostępne bez użycia: 2');
    expect(text).not.toMatch(/wynik|ocena:\s*\d/i);
    expect(skillsRow!.getAttribute('aria-expanded')).toBe('true');
    skillsRow!.click();
    fixture.detectChanges();
    expect(element.textContent).not.toContain('order-calculation');
  });

  it('labels missing system instructions as incomplete data, not as zero availability', () => {
    const fixture = createFixture({
      contentCaptured: false, systemInstructionsObserved: false, instructions: [], skills: [], customAgents: [],
      tools: {availableNames: [], exposedNames: [], usedNames: ['read_file'], executionCount: 1},
      mcp: {availableTools: [], exposedTools: [], usedTools: [], servers: [], executionCount: 0},
      subagentInvocations: 0, compactions: 0
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Niepełne dane');
    expect(text).toContain('Brak danych o kontekście');
    expect(text).toContain('Katalog niedostępny');
  });

  it('treats an absent category as an adoption gap when captured context is complete', () => {
    const fixture = createFixture({
      contentCaptured: true, systemInstructionsObserved: true, instructions: [], skills: [], customAgents: [],
      tools: {availableNames: ['read_file'], exposedNames: ['read_file'], usedNames: ['read_file'], executionCount: 1},
      mcp: {availableTools: [], exposedTools: [], usedTools: [], servers: [], executionCount: 0},
      subagentInvocations: 0, compactions: 0
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Brak konfiguracji: 4');
    expect(text).toContain('Nie wykryto instrukcji repozytorium');
    expect(text).toContain('Nie wykryto skilli repozytorium');
    expect(text).toContain('Nie wykryto custom agentów');
    expect(text).toContain('Nie wykryto narzędzi MCP');
  });
});

function createFixture(analysis: SessionCapabilityAnalysis): ComponentFixture<SessionCapabilityOverviewComponent> {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(SessionCapabilityOverviewComponent);
  fixture.componentRef.setInput('analysis', analysis);
  fixture.detectChanges();
  return fixture;
}
