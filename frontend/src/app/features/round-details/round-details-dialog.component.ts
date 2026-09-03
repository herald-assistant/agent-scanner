import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import {MatDialogModule} from '@angular/material/dialog';
import {MatIconModule} from '@angular/material/icon';
import {MatTooltipModule} from '@angular/material/tooltip';
import {MessageRecord, ModelTurn, SpanRecord} from '../../models/scanner.models';

interface RequestParameter { label: string; value: string; }
interface ResponseToolCall { id: string; name: string; arguments: string; }
interface SystemInstructionBlock { type: string; content: string; }

@Component({
  selector: 'as-round-details-dialog',
  imports: [MatDialogModule, MatIconModule, MatTooltipModule],
  templateUrl: './round-details-dialog.component.html',
  styleUrl: './round-details-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoundDetailsDialogComponent {
  readonly turn = input.required<ModelTurn>();
  readonly messages = input.required<MessageRecord[]>();
  readonly calibrationSpans = input.required<SpanRecord[]>();
  readonly headingContext = input.required<string>();
  readonly subagent = input(false);

  readonly expandedSections = new Set<string>();
  private readonly attributeCache = new WeakMap<SpanRecord, Record<string, unknown>>();
  private readonly jsonAttributeCache = new WeakMap<SpanRecord, Map<string, unknown>>();
  private readonly standardNumberFormat = new Intl.NumberFormat('pl-PL');
  private readonly compactNumberFormat = new Intl.NumberFormat('pl-PL', {notation: 'compact'});
  private readonly percentFormat = new Intl.NumberFormat('pl-PL', {minimumFractionDigits: 1, maximumFractionDigits: 1});

  turnNumber(): number { return this.turn().interactionTurnIndex ?? this.turn().index; }
  freshInputTokens(): number { return Math.max(0, this.turn().model.inputTokens - this.turn().model.cacheReadTokens); }
  messagesFor(direction?: string): MessageRecord[] {
    return this.messages().filter(message => message.spanId === this.turn().model.id && (!direction || message.direction === direction));
  }
  requestInputMessages(): MessageRecord[] { return this.messagesFor('input'); }
  requestToolDefinitions(): MessageRecord[] { return this.messagesFor('definition'); }

  systemInstructionBlocks(): SystemInstructionBlock[] {
    const value = this.jsonAttribute(this.turn().model, 'gen_ai.system_instructions');
    if (!value) return [];
    return (Array.isArray(value) ? value : [value]).map((item, index) => {
      if (typeof item === 'string') return {type: 'text', content: item};
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const content = record['content'] ?? record['text'] ?? record['value'] ?? item;
        return {type: String(record['type'] ?? `block-${index + 1}`), content: typeof content === 'string' ? content : JSON.stringify(content, null, 2)};
      }
      return {type: `block-${index + 1}`, content: String(item)};
    });
  }

  requestParameters(): RequestParameter[] {
    const span = this.turn().model;
    const shape = this.requestShape(span);
    return [
      {label: 'API', value: String(shape?.['api'] ?? 'nie podano')},
      {label: 'Provider', value: this.attributeOrFallback(span, 'gen_ai.provider.name')},
      {label: 'Model żądany', value: this.attributeOrFallback(span, 'gen_ai.request.model')},
      {label: 'Model odpowiedzi', value: this.attributeOrFallback(span, 'gen_ai.response.model')},
      {label: 'Elementy inputu', value: String(shape?.['inputItemCount'] ?? this.requestInputMessages().length)},
      {label: 'Max output', value: this.attributeOrFallback(span, 'gen_ai.request.max_tokens')},
      {label: 'Max prompt', value: this.attributeOrFallback(span, 'copilot_chat.request.max_prompt_tokens')},
      {label: 'Temperature', value: this.attributeOrFallback(span, 'gen_ai.request.temperature')},
      {label: 'Top P', value: this.attributeOrFallback(span, 'gen_ai.request.top_p')},
      {label: 'Stream', value: this.attributeOrFallback(span, 'gen_ai.request.stream')},
      {label: 'Stan poprzedniej odpowiedzi', value: this.usesPreviousResponseState() ? 'tak' : 'nie'},
      {label: 'Finish reason', value: this.attributeOrFallback(span, 'gen_ai.response.finish_reasons')},
      {label: 'Response ID', value: this.attributeOrFallback(span, 'gen_ai.response.id')},
      {label: 'Server request ID', value: this.attributeOrFallback(span, 'copilot_chat.server_request_id')}
    ];
  }

  usesPreviousResponseState(): boolean { return this.requestShape(this.turn().model)?.['hasPreviousResponseId'] === true; }
  requestInputChars(): number { return this.requestInputMessages().reduce((sum, message) => sum + message.content.length, 0); }
  systemInstructionChars(): number { return this.systemInstructionBlocks().reduce((sum, block) => sum + block.content.length, 0); }
  requestToolDefinitionChars(): number { return this.requestToolDefinitions().reduce((sum, message) => sum + message.content.length, 0); }
  requestCapturedChars(): number { return this.systemInstructionChars() + this.requestInputChars() + this.requestToolDefinitionChars(); }

  estimatedTokens(value: string | number): number {
    const characters = typeof value === 'number' ? value : value.length;
    if (characters <= 0) return 0;
    const span = this.turn().model;
    const captured = this.requestCapturedChars();
    if (!this.usesPreviousResponseState() && span.inputTokens > 0 && captured > 0) return Math.round(span.inputTokens * characters / captured);
    const ratios = this.calibrationSpans()
      .filter(candidate => candidate.model === span.model && this.requestShape(candidate)?.['hasPreviousResponseId'] !== true && candidate.inputTokens > 0)
      .map(candidate => this.capturedChars(candidate) / candidate.inputTokens)
      .filter(ratio => Number.isFinite(ratio) && ratio >= 1 && ratio <= 12)
      .sort((left, right) => left - right);
    const middle = Math.floor(ratios.length / 2);
    const ratio = !ratios.length ? 4.25 : ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2;
    return Math.round(characters / ratio);
  }

  toggleSection(section: string, event: Event): void {
    if ((event.currentTarget as HTMLDetailsElement).open) this.expandedSections.add(section);
    else this.expandedSections.delete(section);
  }
  sectionOpen(section: string): boolean { return this.expandedSections.has(section); }

  requestMessageLabel(message: MessageRecord): string {
    if (message.roleName) return message.roleName;
    try {
      const parsed = JSON.parse(message.content) as {type?: string};
      return parsed.type === 'function_call_output' ? 'tool result' : parsed.type === 'function_call' ? 'tool call' : parsed.type || 'message';
    } catch { return 'message'; }
  }
  toolDefinitionName(message: MessageRecord): string {
    try {
      const parsed = JSON.parse(message.content) as {name?: string; function?: {name?: string}};
      return parsed.name ?? parsed.function?.name ?? `tool ${message.sequenceNo + 1}`;
    } catch { return `tool ${message.sequenceNo + 1}`; }
  }

  responseText(): string {
    const output = this.messagesFor('output').filter(message => message.roleName === 'assistant')
      .map(message => this.messageText(message.content)).filter(Boolean).join('\n');
    return output || 'Model zakończył tę rundę bez tekstu widocznego dla użytkownika.';
  }

  responseToolCalls(): ResponseToolCall[] {
    const calls: ResponseToolCall[] = [];
    for (const message of this.messagesFor('output')) {
      try {
        const parsed = JSON.parse(message.content) as Record<string, unknown>;
        const parts = Array.isArray(parsed['parts']) ? parsed['parts'] : Array.isArray(parsed['output']) ? parsed['output'] : [parsed];
        for (const candidate of parts) {
          if (!candidate || typeof candidate !== 'object') continue;
          const part = candidate as Record<string, unknown>;
          if (!['tool_call', 'function_call'].includes(String(part['type'] ?? ''))) continue;
          const fn = part['function'] && typeof part['function'] === 'object' ? part['function'] as Record<string, unknown> : undefined;
          const name = String(part['name'] ?? fn?.['name'] ?? 'narzędzie');
          const rawArguments = part['arguments'] ?? fn?.['arguments'] ?? {};
          calls.push({id: String(part['id'] ?? `${message.id}:${calls.length}`), name, arguments: typeof rawArguments === 'string' ? this.pretty(rawArguments) : JSON.stringify(rawArguments, null, 2)});
        }
      } catch { /* Surowa odpowiedź pozostaje w danych technicznych. */ }
    }
    return [...new Map(calls.map(call => [call.id, call])).values()];
  }

  responseToolTitle(name: string): string {
    const labels: Record<string, string> = {read_file: 'Odczytaj plik', list_dir: 'Sprawdź zawartość katalogu', file_search: 'Wyszukaj pliki', semantic_search: 'Przeszukaj projekt', grep_search: 'Wyszukaj tekst w projekcie', memory: 'Sprawdź pamięć agenta', run_in_terminal: 'Uruchom polecenie w terminalu', apply_patch: 'Zmień plik', create_file: 'Utwórz plik', execution_subagent: 'Uruchom subagenta wykonawczego', runSubagent: 'Uruchom pomocniczego agenta', manage_todo_list: 'Zaktualizuj pomocniczą listę kroków'};
    return labels[name] ?? `Uruchom narzędzie ${name}`;
  }
  responseToolIcon(name: string): string {
    const icons: Record<string, string> = {read_file: 'description', list_dir: 'folder_open', file_search: 'find_in_page', semantic_search: 'manage_search', grep_search: 'search', memory: 'memory', run_in_terminal: 'terminal', apply_patch: 'edit_document', create_file: 'note_add', execution_subagent: 'account_tree', runSubagent: 'account_tree', manage_todo_list: 'checklist'};
    return icons[name] ?? 'build';
  }

  inputDescription(): string {
    const shape = this.requestShape(this.turn().model) as {inputItemCount?: number; inputItemTypes?: string[]; hasPreviousResponseId?: boolean} | undefined;
    const results = shape?.inputItemTypes?.filter(type => type === 'function_call_output').length ?? 0;
    if (shape?.hasPreviousResponseId && results) return `${results === 1 ? 'Wynik narzędzia' : results + ' wyniki narzędzi'} z poprzedniej rundy oraz zachowany kontekst rozmowy.`;
    if (this.turnNumber() === 1) return this.subagent() ? 'Zlecenie agenta głównego, instrukcje subagenta, przekazany kontekst i definicje narzędzi.' : 'Prompt użytkownika, instrukcje agenta, kontekst projektu i definicje narzędzi.';
    return `${shape?.inputItemCount ?? 'Kolejne'} elementy historii rozmowy i kontekstu agenta.`;
  }

  contextPromptLimit(): number | null { return this.numericAttribute('copilot_chat.request.max_prompt_tokens'); }
  contextResponseReserve(): number | null { return this.numericAttribute('gen_ai.request.max_tokens'); }
  contextLimit(): number | null {
    const prompt = this.contextPromptLimit();
    const response = this.contextResponseReserve();
    return prompt != null && response != null ? prompt + response : null;
  }
  contextPercent(): number { const limit = this.contextLimit(); return limit ? this.turn().model.inputTokens / limit * 100 : 0; }
  freshPercent(): number { const limit = this.contextLimit(); return limit ? this.freshInputTokens() / limit * 100 : 0; }
  cachePercent(): number { const limit = this.contextLimit(); return limit ? this.turn().model.cacheReadTokens / limit * 100 : 0; }
  reservePercent(): number { const limit = this.contextLimit(); const reserve = this.contextResponseReserve(); return limit && reserve != null ? reserve / limit * 100 : 0; }

  toolRequestsLabel(count: number): string { return `${count} ${count === 1 ? 'żądanie narzędzia' : 'żądania narzędzi'}`; }
  compact(value?: number): string { return (value && value >= 10000 ? this.compactNumberFormat : this.standardNumberFormat).format(value ?? 0); }
  exact(value?: number): string { return this.standardNumberFormat.format(value ?? 0); }
  percent(value: number): string { return this.percentFormat.format(value); }
  duration(value?: number): string { if (value == null) return '—'; return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${Math.round(value)} ms`; }
  excerpt(value: string, size = 4000): string { const normalized = value.replace(/\s+/g, ' ').trim(); return normalized.length > size ? normalized.slice(0, size).trimEnd() + '…' : normalized; }
  pretty(json?: string): string { if (!json) return '—'; try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; } }

  private capturedChars(span: SpanRecord): number {
    const messages = this.messages().filter(message => message.spanId === span.id);
    const system = this.systemBlocksFor(span).reduce((sum, block) => sum + block.content.length, 0);
    return system + messages.filter(message => message.direction === 'input' || message.direction === 'definition').reduce((sum, message) => sum + message.content.length, 0);
  }
  private systemBlocksFor(span: SpanRecord): SystemInstructionBlock[] {
    const current = this.turn().model;
    if (span === current) return this.systemInstructionBlocks();
    const value = this.jsonAttribute(span, 'gen_ai.system_instructions');
    if (!value) return [];
    return (Array.isArray(value) ? value : [value]).map(item => ({type: 'text', content: typeof item === 'string' ? item : JSON.stringify(item)}));
  }
  private messageText(content: string): string { try { const parsed = JSON.parse(content) as {content?: unknown; parts?: Array<{content?: string; text?: string}>}; if (Array.isArray(parsed.parts)) return parsed.parts.map(part => part.content ?? part.text ?? '').filter(Boolean).join('\n'); return typeof parsed.content === 'string' ? parsed.content : content; } catch { return content; } }
  private requestShape(span: SpanRecord): Record<string, unknown> | undefined { const value = this.jsonAttribute(span, 'copilot_chat.request.shape'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
  private attributeOrFallback(span: SpanRecord, key: string): string { const value = this.attributes(span)[key]; return value == null || value === '' ? 'nie podano' : String(value); }
  private numericAttribute(key: string): number | null { const value = this.attributes(this.turn().model)[key]; if (value == null || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  private attributes(span: SpanRecord): Record<string, unknown> { const cached = this.attributeCache.get(span); if (cached) return cached; let value: Record<string, unknown> = {}; try { value = JSON.parse(span.attributesJson) as Record<string, unknown>; } catch { /* Niepoprawna telemetria. */ } this.attributeCache.set(span, value); return value; }
  private jsonAttribute(span: SpanRecord, key: string): unknown { let cache = this.jsonAttributeCache.get(span); if (!cache) { cache = new Map(); this.jsonAttributeCache.set(span, cache); } if (cache.has(key)) return cache.get(key); const raw = this.attributes(span)[key]; let value: unknown = raw; if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { /* Wartość tekstowa. */ } } cache.set(key, value); return value; }
}
