import {Injectable, inject} from '@angular/core';
import {MatSnackBar} from '@angular/material/snack-bar';

@Injectable({providedIn: 'root'})
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  error(message: string, retry?: () => void | Promise<void>): void {
    const reference = this.snackBar.open(message, retry ? 'Spróbuj ponownie' : 'Zamknij', {
      duration: 9000,
      horizontalPosition: 'right',
      verticalPosition: 'bottom',
      panelClass: 'scanner-error-snackbar'
    });
    if (retry) reference.onAction().subscribe(() => void retry());
  }

  success(message: string): void {
    this.snackBar.open(message, 'Zamknij', {
      duration: 5000,
      horizontalPosition: 'right',
      verticalPosition: 'bottom',
      panelClass: 'scanner-success-snackbar'
    });
  }
}
