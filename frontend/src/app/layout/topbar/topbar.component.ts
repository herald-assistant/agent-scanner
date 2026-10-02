import {ChangeDetectionStrategy, Component, inject, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ScannerStatus} from '../../models/scanner.models';
import {FeatureAvailability} from '../../core/feature-availability.service';

@Component({
  selector: 'as-topbar',
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TopbarComponent {
  readonly features = inject(FeatureAvailability);
  readonly status = input.required<ScannerStatus>();
  readonly sidebarOpen = input.required<boolean>();
  readonly sidebarToggle = output<void>();
  readonly optimizationGuide = output<Event>();
  readonly pauseToggle = output<void>();

  time(value?: string | null): string {
    return value ? new Intl.DateTimeFormat('pl-PL', {hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(new Date(value)) : '—';
  }
}
