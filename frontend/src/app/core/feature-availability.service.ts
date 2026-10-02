import {Component, ChangeDetectionStrategy, inject, Injectable, Injector} from '@angular/core';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {APP_RUNTIME} from './app-runtime';

export type BackendFeature = 'ai' | 'standardization' | 'receiver';

@Component({
  selector: 'as-full-version-dialog', imports: [MatDialogModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h2 mat-dialog-title>Dostępne w pełnej wersji</h2>
    <mat-dialog-content>Ta funkcja jest dostępna w pełnej wersji Agent Scanner. W demo możesz importować sesje i przeglądać pliki repozytoriów lokalnie.</mat-dialog-content>
    <mat-dialog-actions align="end"><button class="ui-button ui-button--primary" mat-dialog-close type="button">Rozumiem</button></mat-dialog-actions>`
})
export class FullVersionDialogComponent {}

@Injectable({providedIn: 'root'})
export class FeatureAvailability {
  readonly demo = inject(APP_RUNTIME).demo;
  private readonly injector = inject(Injector);
  available(_feature: BackendFeature): boolean {return !this.demo;}
  require(feature: BackendFeature): boolean {
    if (this.available(feature)) return true;
    const dialog = this.injector.get(MatDialog);
    if (!dialog.getDialogById('full-version')) dialog.open(FullVersionDialogComponent, {
      id: 'full-version', width: 'min(480px, calc(100vw - 32px))', maxWidth: '480px', restoreFocus: true
    });
    return false;
  }
}
