import {ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, TemplateRef} from '@angular/core';
import {takeUntilDestroyed, toSignal} from '@angular/core/rxjs-interop';
import {BreakpointObserver} from '@angular/cdk/layout';
import {MatSidenavModule} from '@angular/material/sidenav';
import {NavigationEnd, Router, RouterOutlet} from '@angular/router';
import {filter, map} from 'rxjs';
import {RoundDetailsPanelService} from './core/round-details-panel.service';
import {ScannerShellStateService} from './core/scanner-shell-state.service';
import {SessionAnalysisService} from './core/session-analysis.service';
import {StandardizationHistoryService} from './core/standardization-history.service';
import {OptimizationGuidanceComponent} from './features/optimization/optimization-guidance.component';
import {RoundDetailsAsideComponent} from './features/round-details/round-details-aside.component';
import {SessionSidebarComponent} from './features/sessions/session-sidebar.component';
import {TopbarComponent} from './layout/topbar/topbar.component';
import {Session} from './models/scanner.models';
import {FeatureAvailability} from './core/feature-availability.service';

@Component({
  selector: 'as-scanner-shell',
  imports: [MatSidenavModule, RouterOutlet, TopbarComponent,
    SessionSidebarComponent, RoundDetailsAsideComponent, OptimizationGuidanceComponent],
  providers: [
    ScannerShellStateService
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  readonly features = inject(FeatureAvailability);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly analysis = inject(SessionAnalysisService);
  readonly standardizationHistory = inject(StandardizationHistoryService);
  private readonly detailsPanel = inject(RoundDetailsPanelService);
  private readonly viewport = inject(BreakpointObserver);
  readonly state = inject(ScannerShellStateService);
  readonly compactLayout = toSignal(
    this.viewport.observe('(max-width: 900px)').pipe(map(state => state.matches)),
    {initialValue: this.viewport.isMatched('(max-width: 900px)')}
  );
  private readonly sidebarOpenState = signal(!this.compactLayout());
  private readonly selectedSessionIdState = signal<number | undefined>(undefined);
  private readonly selectedRepositoryIdState = signal<string | null>(null);
  private readonly selectedAnalysisIdState = signal<string | null>(null);

  readonly visibleSessions = computed(() => this.features.demo ? this.state.sessions() : this.state.sessions().filter(session => !this.analysis.isAuxiliarySession(session)));
  readonly sidebarOpen = this.sidebarOpenState.asReadonly();
  readonly selectedSessionId = this.selectedSessionIdState.asReadonly();
  readonly selectedRepositoryId = this.selectedRepositoryIdState.asReadonly();
  readonly selectedAnalysisId = this.selectedAnalysisIdState.asReadonly();

  constructor() {
    this.state.startPolling();
    void this.standardizationHistory.refresh();
    this.updateSelectedSessionId();
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateSelectedSessionId());
  }

  toggleSidebar(): void {
    this.sidebarOpenState.update(open => !open);
  }

  closeSidebar(): void {
    this.sidebarOpenState.set(false);
  }

  async selectSession(session: Session): Promise<void> {
    this.detailsPanel.close();
    const navigated = await this.router.navigate(['/sessions', session.id, 'overview']);
    if (navigated && this.compactLayout()) this.closeSidebar();
  }

  async openNewRepositoryAnalysis(): Promise<void> {
    this.detailsPanel.close();
    if (await this.router.navigate(['/repositories', 'new']) && this.compactLayout()) this.closeSidebar();
  }

  async openSavedAnalysis(selection: {repositoryId: string; analysisId: string}): Promise<void> {
    this.detailsPanel.close();
    const repository = this.standardizationHistory.repositories().find(item => item.id === selection.repositoryId);
    const kind = repository?.snapshots?.some(item => item.id === selection.analysisId) ? 'inputs' : 'analyses';
    if (await this.router.navigate(['/repositories', selection.repositoryId, kind, selection.analysisId]) && this.compactLayout()) this.closeSidebar();
  }

  async importSessionFile(file: File): Promise<void> {
    const sessionId = await this.state.importSession(file);
    if (sessionId != null) {
      const navigated = await this.router.navigate(['/sessions', sessionId, 'overview']);
      if (navigated && this.compactLayout()) this.closeSidebar();
    }
  }

  async deleteAll(): Promise<void> {
    if (!(await this.state.deleteAll())) return;
    await this.router.navigate(['/']);
    await this.state.refresh();
  }

  openOptimizationGuide(template: TemplateRef<unknown>, origin: EventTarget | null): void {
    this.detailsPanel.openTemplate(
      template,
      {},
      'OPTYMALIZACJA',
      'Techniki i doradztwo',
      'Techniki optymalizacji i doradztwo na żądanie',
      origin
    );
  }

  private updateSelectedSessionId(): void {
    const path = this.router.url.split(/[?#]/, 1)[0];
    const match = path.match(/^\/sessions\/(\d+)(?:\/[^/]+)?$/);
    this.selectedSessionIdState.set(match ? Number(match[1]) : undefined);
    const repository = path.match(/^\/repositories\/([a-f0-9-]{36})(?:\/(?:analyses|inputs)\/([a-f0-9-]{36})|\/new)?$/);
    this.selectedRepositoryIdState.set(path.endsWith('/new') ? null : repository?.[1] ?? null);
    this.selectedAnalysisIdState.set(repository?.[2] ?? null);
    if (!match) this.state.setSelectedTurnCount(0);
  }
}
