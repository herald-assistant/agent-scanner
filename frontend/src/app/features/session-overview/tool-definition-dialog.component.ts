import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MAT_DIALOG_DATA, MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {ToolDefinitionVersion, ToolUsageRow} from '../../core/tool-usage-analysis';

export interface ToolDefinitionDialogData {
  tool: ToolUsageRow;
}

interface ToolParameterView {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  allowedValues?: string;
}

interface ToolDefinitionView {
  version: number;
  description?: string;
  schemaType: string;
  parameters: ToolParameterView[];
  rawJson: string;
}

@Component({
  selector: 'as-tool-definition-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatTooltipModule],
  templateUrl: './tool-definition-dialog.component.html',
  styleUrl: './tool-definition-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToolDefinitionDialogComponent {
  readonly data = inject<ToolDefinitionDialogData>(MAT_DIALOG_DATA);
  readonly definitions = this.data.tool.definitions.map(definitionView);
}

function definitionView(version: ToolDefinitionVersion): ToolDefinitionView {
  const parsed = parseJson(version.canonicalJson);
  const definition = record(parsed);
  const schema = record(definition['parameters'] ?? definition['inputSchema'] ?? definition['input_schema']);
  const properties = record(schema['properties']);
  const required = new Set(Array.isArray(schema['required'])
    ? schema['required'].filter((value): value is string => typeof value === 'string') : []);
  return {
    version: version.version,
    description: text(definition['description']),
    schemaType: schemaType(schema),
    parameters: Object.entries(properties).map(([name, value]) => {
      const property = record(value);
      return {
        name,
        type: schemaType(property),
        required: required.has(name),
        description: text(property['description']),
        allowedValues: Array.isArray(property['enum']) ? property['enum'].map(displayValue).join(' · ') : undefined
      };
    }),
    rawJson: JSON.stringify(parsed, null, 2) ?? version.canonicalJson
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function schemaType(schema: Record<string, unknown>): string {
  if (typeof schema['type'] === 'string') return schema['type'];
  if (Array.isArray(schema['type'])) return schema['type'].map(String).join(' | ');
  if (Array.isArray(schema['enum'])) return 'enum';
  if (Array.isArray(schema['oneOf']) || Array.isArray(schema['anyOf'])) return 'warianty';
  return 'nieokreślony';
}

function displayValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
}
