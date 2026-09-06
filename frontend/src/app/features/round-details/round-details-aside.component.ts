import {DOCUMENT, NgTemplateOutlet} from '@angular/common';
import {A11yModule} from '@angular/cdk/a11y';
import {ChangeDetectionStrategy, Component, effect, HostListener, inject} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {RoundDetailsPanelService} from '../../core/round-details-panel.service';
import {RoundDetailsDialogComponent} from './round-details-dialog.component';

@Component({
  selector: 'as-round-details-aside',
  imports: [A11yModule, MatIconModule, MatTooltipModule, NgTemplateOutlet, RoundDetailsDialogComponent],
  templateUrl: './round-details-aside.component.html',
  styleUrl: './round-details-aside.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoundDetailsAsideComponent {
  readonly detailsPanel = inject(RoundDetailsPanelService);
  private readonly document = inject(DOCUMENT);

  constructor() {
    effect(onCleanup => {
      if (!this.detailsPanel.panel()) return;
      const previousOverflow = this.document.body.style.overflow;
      this.document.body.style.overflow = 'hidden';
      onCleanup(() => this.document.body.style.overflow = previousOverflow);
    });
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    this.detailsPanel.close();
  }
}
