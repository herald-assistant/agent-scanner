import {ComponentFixture, TestBed} from '@angular/core/testing';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SpanRecord} from '../../models/scanner.models';
import {RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {RoundDetailsAsideComponent} from './round-details-aside.component';

describe('RoundDetailsAsideComponent', () => {
  let fixture: ComponentFixture<RoundDetailsAsideComponent>;
  let panel: RoundDetailsPanelService;

  afterEach(() => {
    panel?.close();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('slides in with round content and closes from its header', () => {
    fixture = TestBed.createComponent(RoundDetailsAsideComponent);
    panel = TestBed.inject(RoundDetailsPanelService);
    const model = span();
    panel.openRound({turn: {index: 1, model, tools: []}, messages: [], calibrationSpans: [model], headingContext: 'INTERAKCJA 1 · RUNDA 1'}, 'Szczegóły rundy');
    fixture.detectChanges();

    const aside = fixture.nativeElement.querySelector('aside') as HTMLElement;
    expect(aside).toBeTruthy();
    expect(aside.getAttribute('aria-modal')).toBe('true');
    expect(aside.textContent).toContain('Interakcja → pierwszy model');

    aside.querySelector<HTMLButtonElement>('.dialog-title button')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
  });

  it('shows previous and next controls and invokes available navigation', () => {
    fixture = TestBed.createComponent(RoundDetailsAsideComponent);
    panel = TestBed.inject(RoundDetailsPanelService);
    const model = span();
    const next = vi.fn();
    panel.openRound({turn: {index: 1, model, tools: []}, messages: [], calibrationSpans: [model], headingContext: 'RUNDA 1'},
      'Szczegóły rundy', null, {next});
    fixture.detectChanges();

    const previousButton = fixture.nativeElement.querySelector('[aria-label="Poprzednia runda"]') as HTMLButtonElement;
    const nextButton = fixture.nativeElement.querySelector('[aria-label="Następna runda"]') as HTMLButtonElement;
    expect(previousButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(false);
    nextButton.click();
    expect(next).toHaveBeenCalledOnce();
  });
});

function span(): SpanRecord {
  return {
    id: 1, signalId: 1, traceId: 'trace', spanId: 'span', spanName: 'chat', operationName: 'chat',
    statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, attributesJson: '{}', eventsJson: '[]'
  };
}
