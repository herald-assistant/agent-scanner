import {ChangeDetectionStrategy, Component, computed, input, output} from '@angular/core';
import {DatePipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {MatBadgeModule} from '@angular/material/badge';
import {MatTooltipModule} from '@angular/material/tooltip';
import {RepositoryReport, ReportEntry} from '../../core/repository-report';

const MECHANISM_DESCRIPTIONS: Record<string, string> = {
  INSTRUCTIONS: 'Zasady pracy i kontekst dla agenta.',
  SKILLS: 'Procedury dobierane do zadania.',
  AGENTS: 'Role agentów i zestawy narzędzi.',
  MCP: 'Połączenia z narzędziami i źródłami danych.',
  PROMPTS: 'Gotowe polecenia wywoływane ręcznie.',
  VSCODE: 'Ustawienia AI i zalecane rozszerzenia.',
  JETBRAINS: 'Reguły AI i ustawienia projektu.'
};

@Component({
  selector: 'as-repository-report', imports: [DatePipe, MatIconModule, MatBadgeModule, MatTooltipModule],
  templateUrl: './repository-report.component.html', styleUrl: './repository-report.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryReportComponent {
  readonly report = input.required<RepositoryReport>();
  readonly generatedAt = computed(() => { this.report(); return new Date(); });
  readonly groups = computed(() => this.report().groups.filter(group => group.id !== 'CONTEXT').map(group => {
    const count = new Set(group.entries.map(entry => entry.path)).size;
    const partial = !group.complete || group.entries.some(entry => !entry.readable);
    const tone = count ? partial ? 'attention' : 'positive' : group.complete ? 'gap' : 'unknown';
    const noun = count === 1 ? 'plik' : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14) ? 'pliki' : 'plików';
    return {...group, description: MECHANISM_DESCRIPTIONS[group.id] ?? 'Pliki konfiguracji repozytorium.', tone,
      statusLabel: count ? `Zidentyfikowano: ${count} ${noun}` : !group.complete ? 'Nie ustalono' : 'Brak konfiguracji',
      statusIcon: tone === 'positive' ? 'check_circle' : tone === 'attention' ? 'warning_amber' : tone === 'gap' ? 'error_outline' : 'info',
      statusHint: partial ? 'Odczyt częściowy. Raport obejmuje tylko zidentyfikowane pliki; brak plików nie potwierdza braku konfiguracji.'
        : count ? 'Zidentyfikowano pliki tego typu. Ich obecność nie potwierdza aktywacji ani użycia mechanizmu.'
        : 'Nie znaleziono plików tego typu w obsługiwanym zakresie repozytorium.'};
  }));
  readonly inspect = output<ReportEntry>();
}
