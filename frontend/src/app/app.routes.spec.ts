import {TestBed} from '@angular/core/testing';
import {provideRouter, Router} from '@angular/router';
import {RouterTestingHarness} from '@angular/router/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {appRoutes} from './app.routes';
import {workflowFixture} from './core/workflow/workflow.fixtures';

const status = {
  paused: false,
  connected: true,
  lastSignalAt: null,
  traces: 0,
  metrics: 0,
  logs: 0,
  contentCaptured: false,
  retentionDays: 30
};

describe('application routes', () => {
  beforeEach(() => {
    const source = workflowFixture()[0];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith('/api/status') ? status : url.endsWith('/api/sessions') ? [source.session] : source;
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    }));
    TestBed.configureTestingModule({providers: [provideRouter(appRoutes)]});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('starts on the home screen, opens a session route and returns home when it closes', async () => {
    const harness = await RouterTestingHarness.create('/');
    const router = TestBed.inject(Router);
    await vi.waitFor(() => expect(harness.routeNativeElement?.querySelector('.session-card')).not.toBeNull());
    harness.detectChanges();

    expect(router.url).toBe('/');
    expect(harness.routeNativeElement?.querySelector('.onboarding h1')?.textContent).toContain('Podłącz sesję agenta');
    const shellIcons = harness.routeNativeElement?.querySelectorAll('as-topbar mat-icon, as-session-sidebar mat-icon') ?? [];
    expect(shellIcons.length).toBeGreaterThan(0);
    expect([...shellIcons].every(icon => icon.classList.contains('material-symbols-outlined'))).toBe(true);
    (harness.routeNativeElement?.querySelector('.session-card') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(router.url).toMatch(/^\/sessions\/\d+$/));
    await vi.waitFor(() => expect(harness.routeNativeElement?.querySelector('.session-title')).not.toBeNull());
    harness.detectChanges();
    const sessionActions = [...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('.session-actions button')];
    expect(sessionActions.map(button => button.getAttribute('aria-label'))).toEqual([
      'Eksportuj sesję do JSON',
      'Usuń sesję',
      'Zamknij sesję'
    ]);
    const closeButton = sessionActions.find(button => button.getAttribute('aria-label') === 'Zamknij sesję');
    expect(closeButton).toBeDefined();
    closeButton!.click();

    await vi.waitFor(() => expect(router.url).toBe('/'));
    await vi.waitFor(() => expect(harness.routeNativeElement?.querySelector('.onboarding h1')?.textContent)
      .toContain('Podłącz sesję agenta'));
  });
});
