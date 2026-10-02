import {ChangeDetectionStrategy, Component, DestroyRef, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatIconModule} from '@angular/material/icon';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {FeatureAvailability} from '../../core/feature-availability.service';
import {ScannerShellStateService} from '../../core/scanner-shell-state.service';

@Component({
  selector: 'as-home-page',
  imports: [MatIconModule, RouterLink],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent {
  readonly features = inject(FeatureAvailability);
  readonly shell = inject(ScannerShellStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly copied = signal(false);
  readonly showConfig = signal(false);

  readonly configText = this.features.demo ? `{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": "C:/Users/<użytkownik>/copilot-otel.jsonl",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}` : `{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.protocol": "http/protobuf",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:8081",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}`;

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => this.showConfig.set(params.get('configuration') === 'open'));
  }

  async setConfigVisible(visible: boolean): Promise<void> {
    await this.router.navigate(['/'], {queryParams: visible ? {configuration: 'open'} : {}});
  }

  async copyConfig(): Promise<void> {
    await navigator.clipboard.writeText(this.configText);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1800);
  }

  importFile(event: Event): void {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (file) void this.shell.importSession(file).then(id => id == null ? undefined : this.router.navigate(['/sessions',id,'overview']));
  }
}
