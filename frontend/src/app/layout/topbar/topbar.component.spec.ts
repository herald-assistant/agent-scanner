import {TestBed} from '@angular/core/testing';
import {describe, expect, it, vi} from 'vitest';
import {TopbarComponent} from './topbar.component';

describe('TopbarComponent', () => {
  it('exposes the session-independent optimization guide entry point', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.componentRef.setInput('status', {
      paused: false,
      connected: false,
      lastSignalAt: null,
      traces: 0,
      metrics: 0,
      logs: 0,
      contentCaptured: false,
      retentionDays: 30
    });
    const emitted = vi.fn();
    fixture.componentInstance.optimizationGuide.subscribe(emitted);
    fixture.detectChanges();

    const button = [...fixture.nativeElement.querySelectorAll('button')]
      .find((candidate: HTMLButtonElement) => candidate.textContent?.includes('Techniki optymalizacji'));
    expect(button).toBeDefined();
    button!.click();
    expect(emitted).toHaveBeenCalledOnce();
    fixture.destroy();
  });
});
