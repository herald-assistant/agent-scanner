import {ChangeDetectionStrategy, Component, computed, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {OptimizationAdvicePreview} from '../../models/optimization-guidance.models';

@Component({
  selector: 'as-advice-preview',
  imports: [MatIconModule],
  templateUrl: './advice-preview.component.html',
  styleUrl: './advice-preview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdvicePreviewComponent {
  readonly preview = input.required<OptimizationAdvicePreview>();
  readonly adviceLoading = input(false);
  readonly adviceSent = input(false);
  readonly refreshed = output<void>();
  readonly adviceRequested = output<OptimizationAdvicePreview>();
  readonly emittedCount = computed(() => this.preview().request.observations.filter(item => item.provenance === 'EMITTED').length);
  readonly derivedCount = computed(() => this.preview().request.observations.filter(item => item.provenance === 'DERIVED').length);
  readonly estimatedCount = computed(() => this.preview().request.observations.filter(item => item.provenance === 'ESTIMATED').length);
  readonly classifiedCount = computed(() => this.preview().request.observations.filter(item =>
    item.provenance === 'AI_CLASSIFICATION' || this.hasNestedClassification(item)).length);
  readonly missingCount = computed(() => this.preview().request.observations.filter(item => item.provenance === 'MISSING').length);
  readonly packageJson = computed(() => JSON.stringify(this.preview().request, null, 2));
  readonly shortFingerprint = computed(() => this.preview().request.manifest.dataFingerprint.slice(0, 16));
  readonly sendAvailable = computed(() => !!this.preview().preparation
    && new Date(this.preview().preparation!.expiresAt).getTime() > Date.now());

  private readonly numberFormat = new Intl.NumberFormat('pl-PL');
  number(value: number): string { return this.numberFormat.format(value); }

  private hasNestedClassification(observation: OptimizationAdvicePreview['request']['observations'][number]): boolean {
    if (observation.kind !== 'ROUND_COST_SUMMARY' || !observation.excerpt) return false;
    try {
      const value = JSON.parse(observation.excerpt.text) as {classification?: {provenance?: string} | null};
      return value.classification?.provenance === 'AI_CLASSIFICATION';
    } catch {
      return false;
    }
  }
}
