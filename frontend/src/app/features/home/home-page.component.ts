import {ChangeDetectionStrategy, Component, DestroyRef, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatIconModule} from '@angular/material/icon';
import {ActivatedRoute, Router} from '@angular/router';

@Component({
  selector: 'as-home-page',
  imports: [MatIconModule],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly copied = signal(false);
  readonly showConfig = signal(false);

  readonly configText = `{
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
}
