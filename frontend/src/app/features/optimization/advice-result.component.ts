import {ChangeDetectionStrategy, Component, computed, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {
  OptimizationAdvicePreview,
  OptimizationAdviceProposal,
  OptimizationAdviceResult,
  OptimizationGuidanceContext,
  OptimizationGuidanceEvidence,
  OptimizationGuidanceEvidenceOpenRequest
} from '../../models/optimization-guidance.models';

@Component({
  selector: 'as-advice-result',
  imports: [MatIconModule],
  templateUrl: './advice-result.component.html',
  styleUrl: './advice-result.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdviceResultComponent {
  readonly result = input.required<OptimizationAdviceResult>();
  readonly preview = input.required<OptimizationAdvicePreview>();
  readonly context = input<OptimizationGuidanceContext | undefined>(undefined);
  readonly techniques = input<readonly {id: string; title: string}[]>([]);
  readonly evidenceSelected = output<OptimizationGuidanceEvidenceOpenRequest>();
  readonly analyzedAt = computed(() => new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short', timeStyle: 'medium'
  }).format(new Date(this.result().analyzedAt)));

  techniqueTitle(id: string): string {
    return this.techniques().find(item => item.id === id)?.title ?? id;
  }

  evidenceFor(proposal: OptimizationAdviceProposal): OptimizationGuidanceEvidence[] {
    const observations = new Map(this.preview().request.observations.map(item => [item.id, item]));
    const scope = this.preview().request.scope;
    const contextEvidence = this.context()?.evidence ?? [];
    const result = new Map<string, OptimizationGuidanceEvidence>();
    for (const id of proposal.observationIds) {
      for (const source of observations.get(id)?.sources ?? []) {
        if (source.roundRef) {
          const known = contextEvidence.find(item => item.kind === 'ROUND' && item.id === source.roundRef);
          result.set(`ROUND:${source.roundRef}`, known ?? {
            kind: 'ROUND', id: source.roundRef, label: source.roundRef,
            description: 'Otwórz dokładną rundę wskazaną jako dowód rekomendacji.'
          });
        } else if (scope.kind === 'compaction') {
          const ref = scope.compactionRef;
          const known = contextEvidence.find(item => item.kind === 'COMPACTION' && item.id === ref);
          result.set(`COMPACTION:${ref}`, known ?? {
            kind: 'COMPACTION', id: ref, label: 'Kompaktowanie',
            description: 'Otwórz dokładne wywołanie kompaktowania wskazane jako dowód rekomendacji.'
          });
        }
      }
    }
    return [...result.values()];
  }

  openEvidence(evidence: OptimizationGuidanceEvidence, origin: EventTarget | null): void {
    this.evidenceSelected.emit({evidence, origin});
  }
}
