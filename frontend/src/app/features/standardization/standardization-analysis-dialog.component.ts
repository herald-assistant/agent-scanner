import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatSelectModule} from '@angular/material/select';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {StandardizationStateService} from '../../core/standardization-state.service';

@Component({
  selector: 'as-standardization-analysis-dialog',
  imports: [MatDialogModule, MatFormFieldModule, MatSelectModule, MatProgressSpinnerModule],
  templateUrl: './standardization-analysis-dialog.component.html',
  styleUrl: './standardization-analysis-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StandardizationAnalysisDialogComponent {
  readonly state = inject(StandardizationStateService);
  private readonly dialog = inject(MatDialogRef<StandardizationAnalysisDialogComponent, boolean>);
  constructor() { void this.state.initialize(); }
  confirm(): void { if (this.state.canPrepare() && !this.state.loadingModels()) this.dialog.close(true); }
}
