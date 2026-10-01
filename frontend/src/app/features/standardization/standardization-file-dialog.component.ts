import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {RepositoryFile} from '../../core/standardization-files';
import {StandardFile, StandardPreview, StandardResult, StandardVerdict} from '../../models/standardization.models';

export interface StandardizationFileDialogData {
  file: RepositoryFile; packetFile?: StandardFile; preview: StandardPreview | null; result: StandardResult | null;
}
@Component({
  selector: 'as-standardization-file-dialog',
  imports: [MatDialogModule, MatIconModule],
  templateUrl: './standardization-file-dialog.component.html',
  styleUrl: './standardization-file-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StandardizationFileDialogComponent {
  readonly data = inject<StandardizationFileDialogData>(MAT_DIALOG_DATA);
  readonly tab = signal<'AI' | 'CONTENT' | 'LOCAL'>(this.data.result && this.data.packetFile ? 'AI' : 'CONTENT');
  readonly content = this.data.packetFile?.content ?? this.data.file.content;
  readonly lines = this.content.split('\n').map((text, index) => ({number: index + 1, text}));
  readonly targets = this.data.preview?.packet.targets.filter(target => target.fileId === this.data.packetFile?.id) ?? [];
  readonly targetIds = new Set(this.targets.map(target => target.id));
  readonly assessments = this.data.result?.assessments.filter(value => this.targetIds.has(value.assessmentId)
    || value.evidence.some(evidence => evidence.fileId === this.data.packetFile?.id)) ?? [];
  readonly missing = this.data.result?.unreviewedTargetIds.filter(id => this.targetIds.has(id)).length ?? 0;
  readonly checks = this.data.preview?.packet.localChecks.filter(check => check.fileId === this.data.packetFile?.id) ?? [];
  readonly rules = new Map(this.data.preview?.packet.rules.map(rule => [rule.id, rule]) ?? []);
  readonly sources = new Map(this.data.preview?.packet.sources.map(source => [source.id, source]) ?? []);
  readonly packetTargets = new Map(this.data.preview?.packet.targets.map(target => [target.id, target]) ?? []);
  readonly files = new Map(this.data.preview?.packet.files.map(file => [file.id, file]) ?? []);
  readonly groups: {label: string; verdicts: StandardVerdict[]; icon: string; tone: string}[] = [
    {label: 'Zgodne w dostarczonym materiale', verdicts: ['SUPPORTED'], icon: 'check_circle', tone: 'positive'},
    {label: 'Do dopracowania', verdicts: ['CONCERN'], icon: 'edit_note', tone: 'warning'},
    {label: 'Brak danych lub rozstrzygnięcia', verdicts: ['INSUFFICIENT_EVIDENCE', 'UNRESOLVED'], icon: 'help_outline', tone: 'neutral'},
    {label: 'Nie dotyczy', verdicts: ['NOT_APPLICABLE'], icon: 'remove_circle_outline', tone: 'neutral'}
  ];
  readonly grouped = this.groups.map(group => ({...group, assessments: this.assessments.filter(value => group.verdicts.includes(value.verdict))}));
}
