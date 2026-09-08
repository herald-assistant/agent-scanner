import {ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, TemplateRef} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatButtonModule} from '@angular/material/button';
import {MAT_ICON_DEFAULT_OPTIONS, MatIconModule} from '@angular/material/icon';
import {MatSidenavModule} from '@angular/material/sidenav';
import {MatTooltipModule} from '@angular/material/tooltip';
import {NavigationEnd, Router, RouterOutlet} from '@angular/router';
import {filter} from 'rxjs';
import {RoundDetailsPanelService} from './core/round-details-panel.service';
import {ScannerShellStateService} from './core/scanner-shell-state.service';
import {SessionAnalysisService} from './core/session-analysis.service';
import {OptimizationGuidanceComponent} from './features/optimization/optimization-guidance.component';
import {RoundDetailsAsideComponent} from './features/round-details/round-details-aside.component';
import {SessionSidebarComponent} from './features/sessions/session-sidebar.component';
import {TopbarComponent} from './layout/topbar/topbar.component';
import {Session} from './models/scanner.models';

@Component({
  selector: 'as-scanner-shell',
  imports: [MatButtonModule, MatIconModule, MatSidenavModule, MatTooltipModule, RouterOutlet, TopbarComponent,
    SessionSidebarComponent, RoundDetailsAsideComponent, OptimizationGuidanceComponent],
  providers: [
    ScannerShellStateService,
    {provide: MAT_ICON_DEFAULT_OPTIONS, useValue: {fontSet: 'material-symbols-outlined'}}
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly analysis = inject(SessionAnalysisService);
  private readonly detailsPanel = inject(RoundDetailsPanelService);
  readonly state = inject(ScannerShellStateService);
  private readonly sidebarOpenState = signal(true);
  private readonly selectedSessionIdState = signal<number | undefined>(undefined);

  readonly visibleSessions = computed(() => this.state.sessions().filter(session => !this.analysis.isAuxiliarySession(session)));
  readonly sidebarOpen = this.sidebarOpenState.asReadonly();
  readonly selectedSessionId = this.selectedSessionIdState.asReadonly();

  constructor() {
    this.state.startPolling();
    this.updateSelectedSessionId();
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateSelectedSessionId());
  }

  toggleSidebar(): void {
    this.sidebarOpenState.update(open => !open);
  }

  async selectSession(session: Session): Promise<void> {
    this.detailsPanel.close();
    await this.router.navigate(['/sessions', session.id]);
  }

  async importSessionFile(file: File): Promise<void> {
    const sessionId = await this.state.importSession(file);
    if (sessionId != null) await this.router.navigate(['/sessions', sessionId]);
  }

  async deleteAll(): Promise<void> {
    if (!(await this.state.deleteAll())) return;
    await this.router.navigate(['/']);
    await this.state.refresh();
  }

  async openConfiguration(): Promise<void> {
    this.detailsPanel.close();
    await this.router.navigate(['/'], {queryParams: {configuration: 'open'}});
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
    const match = this.router.url.split(/[?#]/, 1)[0].match(/^\/sessions\/(\d+)$/);
    this.selectedSessionIdState.set(match ? Number(match[1]) : undefined);
    if (!match) this.state.setSelectedTurnCount(0);
  }
}
