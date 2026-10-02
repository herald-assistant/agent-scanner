import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogModule, MatDialogRef} from '@angular/material/dialog';
import {SessionImportCandidate, SessionImportPreview} from '../../models/scanner.models';

export interface SessionImportDialogData {fileName: string; preview: SessionImportPreview; multiple?: boolean; local?: boolean;}

@Component({
  selector: 'as-session-import-dialog',
  imports: [MatDialogModule],
  templateUrl: './session-import-dialog.component.html',
  styleUrl: './session-import-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionImportDialogComponent {
  readonly data = inject<SessionImportDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SessionImportDialogComponent, string | string[]>);
  readonly selected = signal<string | undefined>(undefined);
  readonly selections = signal<ReadonlySet<string>>(new Set());
  isSelected(id: string): boolean {return this.data.multiple ? this.selections().has(id) : this.selected() === id;}
  selectionCount(): number {return this.data.multiple ? this.selections().size : this.selected() ? 1 : 0;}
  selectedSpans(): number {return this.data.preview.sessions.filter(session=>this.isSelected(session.conversationId)).reduce((sum,session)=>sum+session.spans,0);}
  private readonly dateFormat = new Intl.DateTimeFormat('pl-PL', {dateStyle: 'medium', timeStyle: 'medium'});

  title(session: SessionImportCandidate): string {
    return session.repository?.replace(/\.git$/, '').split(/[\\/]/).at(-1) || session.agentName || 'Sesja agenta';
  }
  date(value: string): string { return this.dateFormat.format(new Date(value)); }
  select(session: SessionImportCandidate): void {
    if (session.alreadyImported) return;
    if (this.data.multiple) {
      this.selections.update(current=>{
        const next=new Set(current); if (next.has(session.conversationId)) next.delete(session.conversationId); else next.add(session.conversationId); return next;
      });
    } else this.selected.set(session.conversationId);
  }
  confirm(): void {
    if (this.data.multiple) {
      const selected=this.data.preview.sessions.filter(session=>!session.alreadyImported && this.selections().has(session.conversationId));
      if (selected.length) this.dialogRef.close(selected.map(session=>session.conversationId));
      return;
    }
    const selected = this.data.preview.sessions.find(session => session.conversationId === this.selected());
    if (selected && !selected.alreadyImported) this.dialogRef.close(selected.conversationId);
  }
  close(): void { this.dialogRef.close(); }
}
