import {ChangeDetectionStrategy, Component, computed, input, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {
  InstructionCapability,
  NamedCapability,
  SessionCapabilityAnalysis
} from '../../core/session-capability-analysis';

interface CapabilityRow {
  key: MechanismKey;
  label: string;
  icon: string;
  available: string;
  used: string;
  tone: 'positive' | 'attention' | 'gap' | 'neutral' | 'unknown';
}

type MechanismKey = 'instructions' | 'skills' | 'agents' | 'mcp' | 'tools' | 'subagents' | 'compaction';

interface AttentionArea {
  id: string;
  kind: 'missing' | 'unused';
  title: string;
  detail: string;
  suggestion: string;
}

@Component({
  selector: 'as-session-capability-overview',
  imports: [MatIconModule],
  templateUrl: './session-capability-overview.component.html',
  styleUrl: './session-capability-overview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionCapabilityOverviewComponent {
  readonly analysis = input.required<SessionCapabilityAnalysis>();
  private readonly expandedMechanisms = signal<ReadonlySet<MechanismKey>>(new Set());

  readonly appliedInstructions = computed(() => this.analysis().instructions.filter(item => item.applied));
  readonly usedSkills = computed(() => this.analysis().skills.filter(item => item.useCount > 0));
  readonly usedAgents = computed(() => this.analysis().customAgents.filter(item => item.useCount > 0));
  readonly workspaceSkills = computed(() => this.analysis().skills.filter(item => item.scope === 'workspace'));
  readonly usedWorkspaceSkills = computed(() => this.workspaceSkills().filter(item => item.useCount > 0));
  readonly profileSkills = computed(() => this.analysis().skills.filter(item => item.scope === 'profile'));
  readonly otherSkills = computed(() => this.analysis().skills.filter(item => item.scope !== 'workspace'));
  readonly missingConfigurationCount = computed(() => this.attentionAreas().filter(item => item.kind === 'missing').length);
  readonly unusedCategoryCount = computed(() => this.attentionAreas().filter(item => item.kind === 'unused').length);
  readonly attentionAreas = computed<AttentionArea[]>(() => {
    const value = this.analysis();
    const areas: AttentionArea[] = [];
    const customizationKnown = value.contentCaptured && value.systemInstructionsObserved;

    if (customizationKnown && value.instructions.length === 0) areas.push({
      id: 'instructions-missing', kind: 'missing',
      title: 'Nie wykryto instrukcji repozytorium',
      detail: 'W przechwyconym kontekście nie znaleziono Copilot instructions, AGENTS.md ani instrukcji zakresowych.',
      suggestion: 'Dodaj stałe reguły projektu, aby agent nie musiał odtwarzać ich z promptów w każdej sesji.'
    });
    else if (value.instructions.length > 0 && this.appliedInstructions().length === 0) areas.push({
      id: 'instructions-unused', kind: 'unused',
      title: 'Instrukcje były dostępne, ale żadnej nie zastosowano',
      detail: `${value.instructions.length} ${value.instructions.length === 1 ? 'instrukcja była' : 'instrukcje były'} widoczne w kontekście sesji.`,
      suggestion: 'Sprawdź zakresy applyTo i czy główne instrukcje zostały prawidłowo dołączone.'
    });

    if (customizationKnown && this.workspaceSkills().length === 0) areas.push({
      id: 'skills-missing', kind: 'missing',
      title: 'Nie wykryto skilli repozytorium',
      detail: 'Sesja nie otrzymała żadnego skilla z bieżącego repozytorium.',
      suggestion: 'Zacznij od powtarzalnej procedury właściwej dla tego projektu, zamiast tworzyć wiele ogólnych skilli.'
    });
    else if (this.workspaceSkills().length > 0 && this.usedWorkspaceSkills().length === 0) areas.push({
      id: 'skills-unused', kind: 'unused',
      title: 'Skille repozytorium były dostępne, ale żadnego nie użyto',
      detail: `${this.workspaceSkills().length} ${this.workspaceSkills().length === 1 ? 'skill był dostępny' : 'skille były dostępne'} w kontekście sesji.`,
      suggestion: 'Sprawdź, czy ich opisy trafnie wskazują zadania, przy których model powinien je wybierać.'
    });

    if (customizationKnown && value.customAgents.length === 0) areas.push({
      id: 'agents-missing', kind: 'missing',
      title: 'Nie wykryto custom agentów',
      detail: 'Kontekst sesji nie zawierał żadnego agenta wyspecjalizowanego dla tego środowiska.',
      suggestion: 'Jeżeli w projekcie występują stałe role lub niezależne etapy pracy, rozważ opisanie dedykowanego agenta.'
    });
    else if (value.customAgents.length > 0 && this.usedAgents().length === 0) areas.push({
      id: 'agents-unused', kind: 'unused',
      title: 'Custom agents byli dostępni, ale żadnego nie uruchomiono',
      detail: `${value.customAgents.length} ${value.customAgents.length === 1 ? 'agent był dostępny' : 'agentów było dostępnych'} w kontekście sesji.`,
      suggestion: 'Sprawdź, czy ich role są czytelne i czy zadanie zawierało etap, który warto delegować.'
    });

    if (value.contentCaptured && value.mcp.availableTools.length === 0) areas.push({
      id: 'mcp-missing', kind: 'missing',
      title: 'Nie wykryto narzędzi MCP',
      detail: 'W katalogu narzędzi sesji nie było żadnej integracji MCP.',
      suggestion: 'Jeżeli agent regularnie potrzebuje danych lub operacji z systemów zewnętrznych, rozważ właściwy serwer MCP.'
    });
    else if (value.mcp.availableTools.length > 0 && value.mcp.executionCount === 0) areas.push({
      id: 'mcp-unused', kind: 'unused',
      title: 'MCP było dostępne, ale nie zostało użyte',
      detail: `${value.mcp.availableTools.length} ${value.mcp.availableTools.length === 1 ? 'narzędzie było' : 'narzędzia były'} w katalogu sesji, wykonania: 0.`,
      suggestion: value.mcp.exposedTools.length
        ? 'Sprawdź trafność opisów narzędzi i czy prompt wskazywał potrzebę użycia zewnętrznych danych.'
        : 'Model nie otrzymał definicji MCP — sprawdź konfigurację narzędzi aktywnego agenta.'
    });
    return areas;
  });
  readonly rows = computed<CapabilityRow[]>(() => {
    const value = this.analysis();
    const known = value.systemInstructionsObserved;
    return [
      {
        key: 'instructions', label: 'Instrukcje', icon: 'description',
        available: known ? `${value.instructions.length} rozpoznane w kontekście` : 'Brak danych o kontekście',
        used: !known ? 'Nie można ustalić'
          : !value.instructions.length ? 'brak konfiguracji'
          : this.appliedInstructions().length ? `aktywna adopcja · zastosowano ${this.appliedInstructions().length}`
          : 'dostępne, ale żadnej nie zastosowano',
        tone: !known ? 'unknown' : !value.instructions.length ? 'gap' : this.appliedInstructions().length ? 'positive' : 'attention'
      },
      {
        key: 'skills', label: 'Skille', icon: 'school',
        available: known
          ? `${this.workspaceSkills().length} z repozytorium · ${this.profileSkills().length} z profilu`
          : 'Katalog niedostępny',
        used: !known ? 'Nie można ustalić'
          : !this.workspaceSkills().length ? 'brak skilli repozytorium'
          : this.usedWorkspaceSkills().length
            ? `aktywna adopcja · użyto ${this.usedWorkspaceSkills().length} · wywołania: ${this.totalUses(this.workspaceSkills())}`
            : 'dostępne, ale żadnego nie użyto',
        tone: !known ? 'unknown' : !this.workspaceSkills().length ? 'gap' : this.usedWorkspaceSkills().length ? 'positive' : 'attention'
      },
      {
        key: 'agents', label: 'Custom agents', icon: 'smart_toy',
        available: known ? `${value.customAgents.length} dostępne` : 'Katalog niedostępny',
        used: !known ? 'Nie można ustalić'
          : !value.customAgents.length ? 'brak konfiguracji'
          : this.usedAgents().length
            ? `aktywna adopcja · użyto ${this.usedAgents().length} · uruchomienia: ${this.totalUses(value.customAgents)}`
            : 'dostępni, ale żadnego nie użyto',
        tone: !known ? 'unknown' : !value.customAgents.length ? 'gap' : this.usedAgents().length ? 'positive' : 'attention'
      },
      {
        key: 'mcp', label: 'MCP', icon: 'hub',
        available: `${value.mcp.availableTools.length} w sesji · ${value.mcp.exposedTools.length} przekazane modelowi`,
        used: !value.mcp.availableTools.length ? 'brak konfiguracji'
          : value.mcp.executionCount
            ? `aktywna adopcja · użyto ${value.mcp.usedTools.length} · wywołania: ${value.mcp.executionCount}`
            : 'dostępne, ale nieużyte',
        tone: !value.mcp.availableTools.length ? 'gap' : value.mcp.executionCount ? 'positive' : 'attention'
      },
      {
        key: 'tools', label: 'Narzędzia', icon: 'build',
        available: `${value.tools.availableNames.length} w sesji · ${value.tools.exposedNames.length} przekazane modelowi`,
        used: `rodzaje: ${value.tools.usedNames.length} · wywołania: ${value.tools.executionCount}`,
        tone: value.tools.executionCount ? 'positive' : 'neutral'
      },
      {
        key: 'subagents', label: 'Subagenci', icon: 'account_tree',
        available: 'Telemetria nie emituje osobnego katalogu',
        used: `uruchomienia: ${value.subagentInvocations}`,
        tone: value.subagentInvocations ? 'positive' : 'neutral'
      },
      {
        key: 'compaction', label: 'Kompaktowanie', icon: 'compress',
        available: 'Mechanizm sesji',
        used: `wywołania: ${value.compactions}`,
        tone: value.compactions ? 'positive' : 'neutral'
      }
    ];
  });

  isExpanded(key: MechanismKey): boolean {
    return this.expandedMechanisms().has(key);
  }

  toggleMechanism(key: MechanismKey): void {
    const next = new Set(this.expandedMechanisms());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expandedMechanisms.set(next);
  }

  instructionLabel(item: InstructionCapability): string {
    if (item.kind === 'copilot-instructions') return 'Copilot instructions';
    if (item.kind === 'agents-md') return 'Główny AGENTS.md';
    return 'Instrukcja zakresowa';
  }

  scopeLabel(item: NamedCapability): string {
    if (item.scope === 'workspace') return 'repozytorium';
    if (item.scope === 'profile') return 'profil użytkownika';
    return 'źródło nieustalone';
  }

  displayPath(path: string | undefined): string {
    if (!path) return 'ścieżka nie została wyemitowana';
    const normalized = path.replace(/\\/g, '/');
    const github = normalized.toLowerCase().lastIndexOf('/.github/');
    if (github >= 0) return normalized.slice(github + 1);
    if (normalized.toLowerCase().endsWith('/agents.md')) return 'AGENTS.md';
    return normalized.split('/').at(-1) ?? normalized;
  }

  useLabel(count: number): string {
    return count ? `Użycie: ${count}` : 'Dostępny';
  }

  instructionNeedsAttention(item: InstructionCapability): boolean {
    return !item.applied && this.appliedInstructions().length === 0;
  }

  skillNeedsAttention(item: NamedCapability): boolean {
    return item.scope === 'workspace' && item.useCount === 0 && this.usedWorkspaceSkills().length === 0;
  }

  agentNeedsAttention(item: NamedCapability): boolean {
    return item.useCount === 0 && this.usedAgents().length === 0;
  }

  unusedLabel(count: number, attention: boolean): string {
    if (count) return `Użycie: ${count}`;
    return attention ? 'Niewykorzystany' : 'Dostępny';
  }

  private totalUses(capabilities: NamedCapability[]): number {
    return capabilities.reduce((sum, item) => sum + item.useCount, 0);
  }
}
