import {ChangeDetectionStrategy, Component, computed, inject, input, output, signal} from '@angular/core';
import {DatePipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {RepositoryReport, ReportEntry} from '../../core/repository-report';
import {createRepositoryReportPdf} from '../../core/repository-report-pdf';
import {NotificationService} from '../../core/notification.service';

@Component({
  selector: 'as-repository-report', imports: [DatePipe, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './repository-report.component.html', styleUrl: './repository-report.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryReportComponent {
  readonly report = input.required<RepositoryReport>();
  readonly generatedAt = computed(() => { this.report(); return new Date(); });
  readonly exportDisabled = input(false);
  readonly inspect = output<ReportEntry>();
  readonly exporting = signal(false);
  private readonly notifications = inject(NotificationService);

  async downloadPdf(): Promise<void> {
    if (this.exporting() || this.exportDisabled()) return;
    // Freeze the report at the user's click, even if navigation changes during generation.
    const report = this.report();
    this.exporting.set(true);
    try {
      const blob = await createRepositoryReportPdf(report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agent-scanner-raport-${report.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.notifications.error('Nie udało się wygenerować PDF. Spróbuj ponownie; zapisane pliki pozostają dostępne.');
    } finally { this.exporting.set(false); }
  }
}
