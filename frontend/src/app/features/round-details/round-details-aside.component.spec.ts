import {ComponentFixture, TestBed} from '@angular/core/testing';
import {Component, TemplateRef, viewChild} from '@angular/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SpanRecord} from '../../models/scanner.models';
import {RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {RoundDetailsAsideComponent} from './round-details-aside.component';

@Component({template: '<ng-template #guide><details open><summary>Technika</summary><input value="stan"><button class="evidence">Dowód</button></details></ng-template>'})
class TemplateHostComponent {
  readonly guide = viewChild.required<TemplateRef<unknown>>('guide');
}

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

  it('keeps the underlying panel and returns to it after inspecting evidence', () => {
    fixture = TestBed.createComponent(RoundDetailsAsideComponent);
    panel = TestBed.inject(RoundDetailsPanelService);
    const model = span();
    const base = {turn: {index: 1, model, tools: []}, messages: [], calibrationSpans: [model]};
    panel.openRound({...base, headingContext: 'PORADNIK'}, 'Poradnik');
    panel.openRound({...base, headingContext: 'DOWÓD'}, 'Dowód', null, undefined, 'push');
    fixture.detectChanges();

    expect(panel.panels()).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.aside-panel')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.return-to-guide')?.textContent).toContain('Wróć do techniki');
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.return-to-guide')!.click();
    fixture.detectChanges();

    expect(panel.panels()).toHaveLength(1);
    const active = panel.panel();
    expect(active?.kind === 'round' ? active.data.headingContext : '').toBe('PORADNIK');
  });

  it('preserves guide DOM state while factual evidence is displayed above it', async () => {
    const host = TestBed.createComponent(TemplateHostComponent);
    fixture = TestBed.createComponent(RoundDetailsAsideComponent);
    panel = TestBed.inject(RoundDetailsPanelService);
    host.detectChanges();
    panel.openTemplate(host.componentInstance.guide(), {}, 'PORADNIK', 'Techniki', 'Poradnik');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input')!;
    input.value = 'zachowany stan';
    const evidenceButton = element.querySelector<HTMLButtonElement>('.evidence')!;
    const model = span();

    panel.openRound({turn: {index: 1, model, tools: []}, messages: [], calibrationSpans: [model], headingContext: 'DOWÓD'},
      'Dowód', evidenceButton, undefined, 'push');
    fixture.detectChanges();
    expect(element.querySelector('.aside-panel-hidden input')).toBe(input);
    expect(element.querySelector<HTMLDetailsElement>('.aside-panel-hidden details')?.open).toBe(true);

    element.querySelector<HTMLButtonElement>('.return-to-guide')!.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(element.querySelector<HTMLInputElement>('input')?.value).toBe('zachowany stan');
    expect(document.activeElement).toBe(evidenceButton);
    host.destroy();
  });
});

function span(): SpanRecord {
  return {
    id: 1, signalId: 1, traceId: 'trace', spanId: 'span', spanName: 'chat', operationName: 'chat',
    statusCode: 'STATUS_CODE_OK', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, attributesJson: '{}', eventsJson: '[]'
  };
}
