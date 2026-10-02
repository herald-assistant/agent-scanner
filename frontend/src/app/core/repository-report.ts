import {parseTree, getNodeValue, createScanner, SyntaxKind, Node as JsonNode, ParseError} from 'jsonc-parser';
import {parseDocument} from 'yaml';
import {RepositoryGitMetadata, RepositoryReportFile, StandardCategory} from '../models/standardization.models';
import {RepositoryFile} from './standardization-files';

export interface ReportDetail { label: string; value: string; }
export interface ReportEntry {
  path: string; name: string; description: string; details: ReportDetail[]; notes: string[];
  readable: boolean; bytes: number; redacted: boolean; content: string;
}
export interface ReportGroup { id: string; title: string; icon: string; summary: string; complete: boolean; entries: ReportEntry[]; }
export interface RepositoryReport {
  name: string; savedAt: string | null; complete: boolean; gitDetected: boolean; git: RepositoryGitMetadata | null;
  fileCount: number; configurationCount: number; materialCount: number; unreadableCount: number;
  ideFileCount: number | null;
  groups: ReportGroup[]; notes: string[];
}
export interface RepositoryReportInput {
  name: string; savedAt?: string | null; complete: boolean; gitDetected: boolean;
  git?: RepositoryGitMetadata | null; files: readonly RepositoryFile[]; reportFiles?: readonly RepositoryReportFile[];
  ideComplete?: boolean;
}

const mechanisms: {id: StandardCategory; title: string; icon: string}[] = [
  {id: 'INSTRUCTIONS', title: 'Instrukcje', icon: 'description'}, {id: 'SKILLS', title: 'Skills', icon: 'school'},
  {id: 'AGENTS', title: 'Agenci', icon: 'smart_toy'}, {id: 'MCP', title: 'MCP', icon: 'hub'},
  {id: 'PROMPTS', title: 'Prompty', icon: 'chat'}, {id: 'CONTEXT', title: 'Materiały konfiguracji', icon: 'library_books'}
];
const aiSetting = /^(?:github\.copilot(?:\.|$)|chat\.|inlineChat\.|continue\.|codeium\.|tabnine\.|cline\.|roo-cline\.|amazonQ\.)/i;
const aiExtension = /^(?:github\.copilot(?:-chat)?|continue\.continue|codeium\.codeium|tabnine\.tabnine-vscode|saoudrizwan\.claude-dev|rooveterinaryinc\.roo-cline|amazonwebservices\.amazon-q-vscode)$/i;

export function buildRepositoryReport(input: RepositoryReportInput): RepositoryReport {
  const groups: ReportGroup[] = mechanisms.map(group => {
    const files = input.files.filter(file => file.category === group.id);
    const entries = files.flatMap(file => group.id === 'MCP' && !file.error ? mcpEntries(file) : [configurationEntry(file)]);
    const servers = entries.filter(entry => entry.details.some(item => item.label === 'Serwer')).length;
    const unknownServers = entries.some(entry => !entry.readable || entry.notes.some(note => !note.includes('jest pusta')));
    return {...group, complete: input.complete, entries, summary: group.id === 'MCP'
      ? `${fileCountLabel(files.length)} · ${declarationCountLabel(servers)}${unknownServers ? ' · odczyt serwerów niepełny' : ''}`
      : fileCountLabel(files.length)};
  });
  const extras = input.reportFiles ?? [];
  const vscode = extras.filter(file => file.path.toLowerCase().startsWith('.vscode/') || file.path.toLowerCase().endsWith('.code-workspace'));
  const jetbrains = extras.filter(file => !vscode.includes(file));
  const ideComplete = input.complete && (input.ideComplete ?? input.reportFiles !== undefined);
  groups.push({id: 'VSCODE', title: 'VS Code · konfiguracje AI', icon: 'code',
    complete: ideComplete, entries: vscode.map(vscodeEntry), summary: `${fileCountLabel(vscode.length)} projektu`});
  groups.push({id: 'JETBRAINS', title: 'IntelliJ / JetBrains · konfiguracje AI', icon: 'settings',
    complete: ideComplete, entries: jetbrains.map(jetbrainsEntry), summary: `${fileCountLabel(jetbrains.length)} projektu`});
  const materialCount = input.files.filter(file => file.category === 'CONTEXT').length;
  const notes = ['Raport opisuje znalezione pliki i zadeklarowane ustawienia. Nie potwierdza instalacji rozszerzeń, aktywacji ani użycia mechanizmów.',
    'Ustawienia osobiste IDE poza wybranym katalogiem nie są objęte odczytem.'];
  if (!input.complete) notes.push('Odczyt częściowy: brak znalezionego pliku nie potwierdza jego nieobecności w repozytorium.');
  if (input.git?.commit) notes.push('Commit identyfikuje checkout. Raport zawiera odczytane pliki, które mogą mieć lokalne zmiany.');
  return {name: input.name, savedAt: input.savedAt ?? null, complete: input.complete, gitDetected: input.gitDetected,
    git: input.git ?? null, fileCount: input.files.length + extras.length,
    configurationCount: input.files.length - materialCount, materialCount,
    ideFileCount: extras.length || ideComplete ? extras.length : null,
    unreadableCount: input.files.filter(file => !!file.error).length + extras.filter(file => !!file.omissionReason).length,
    groups, notes};
}

function baseEntry(file: {path: string; content: string; bytes: number; redacted: boolean; omissionReason?: string | null; error?: string}): ReportEntry {
  const readable = !file.error && (!file.omissionReason || file.omissionReason === 'EXCLUDED');
  return {path: file.path, name: file.path.split('/').at(-1)!, description: '', details: [], content: file.content,
    notes: readable ? [] : ['Nie odczytano treści: ' + (file.omissionReason ?? file.error)], readable,
    bytes: file.bytes, redacted: file.redacted};
}

function frontmatter(entry: ReportEntry): Record<string, unknown> {
  if (!entry.readable || !entry.content.startsWith('---\n')) return {};
  const closing = /^---[ \t]*$/m.exec(entry.content.slice(4));
  if (!closing) { entry.notes.push('Nagłówek YAML nie ma zamknięcia.'); return {}; }
  try {
    const doc = parseDocument(entry.content.slice(4, 4 + closing.index), {uniqueKeys: true, strict: true});
    if (doc.errors.length) throw new Error('Invalid YAML');
    const data: unknown = doc.toJS({maxAliasCount: 0});
    if (!record(data)) throw new Error('Not a mapping');
    return data;
  } catch { entry.notes.push('Nie odczytano metadanych YAML. Sprawdź składnię, typ nagłówka i powtórzone klucze.'); return {}; }
}

function configurationEntry(file: RepositoryFile): ReportEntry {
  const entry = baseEntry(file);
  const fields = frontmatter(entry);
  if (typeof fields['name'] === 'string') entry.name = fields['name'];
  if (typeof fields['description'] === 'string') entry.description = fields['description'];
  for (const field of ['applyTo', 'agent', 'mode', 'model', 'tools', 'allowed-tools', 'agents', 'handoffs', 'target', 'user-invocable', 'disable-model-invocation', 'infer', 'excludeAgent', 'argument-hint', 'compatibility']) {
    if (Object.hasOwn(fields, field)) entry.details.push({label: field, value: display(fields[field])});
  }
  if (file.category === 'INSTRUCTIONS') entry.details.unshift({label: 'Lokalizacja', value: file.path.includes('/instructions/') ? 'Instrukcje ścieżkowe'
    : file.path.includes('/') && /(?:AGENTS|CLAUDE|GEMINI)\.md$/i.test(file.path) ? 'Instrukcje w podkatalogu' : 'Instrukcje ogólne'});
  if (file.category === 'SKILLS') entry.details.unshift({label: 'Katalog', value: file.path.split('/').slice(0, -1).join('/')});
  return entry;
}

function json(entry: ReportEntry): JsonNode | undefined {
  if (!entry.readable) return undefined;
  const errors: ParseError[] = [];
  const root = parseTree(entry.content, errors, {allowTrailingComma: true, disallowComments: false});
  if (errors.length || root?.type !== 'object' || duplicateKeys(root)) {
    entry.notes.push('Nie odczytano struktury JSON/JSONC. Sprawdź składnię, typ obiektu i powtórzone klucze.');
    return undefined;
  }
  return root;
}
function duplicateKeys(node: JsonNode): boolean {
  if (node.type === 'object') {
    const keys = node.children?.map(child => child.children?.[0].value as string) ?? [];
    if (keys.length !== new Set(keys).size) return true;
  }
  return node.children?.some(duplicateKeys) ?? false;
}
function properties(node: JsonNode | undefined): {key: string; value: JsonNode}[] {
  return node?.type === 'object' ? (node.children ?? []).map(child => ({key: child.children![0].value as string, value: child.children![1]})) : [];
}
function child(node: JsonNode | undefined, key: string): JsonNode | undefined { return properties(node).find(item => item.key === key)?.value; }
function rawValue(entry: ReportEntry, node: JsonNode): string {
  return node.type === 'string' ? String(node.value) : compactJson(entry.content.slice(node.offset, node.offset + node.length));
}

function mcpEntries(file: RepositoryFile): ReportEntry[] {
  const entry = baseEntry(file);
  const root = json(entry);
  if (!root) return [entry];
  const servers = child(root, file.path.toLowerCase() === '.vscode/mcp.json' ? 'servers' : 'mcpServers');
  if (!servers || servers.type !== 'object') { entry.notes.push('Nie znaleziono rozpoznanej mapy serwerów.'); return [entry]; }
  const result = properties(servers).map(server => {
    const item = {...entry, name: server.key, details: [{label: 'Serwer', value: server.key}], notes: [...entry.notes]};
    if (server.value.type !== 'object') item.notes.push('Deklaracja serwera nie jest obiektem.');
    for (const field of properties(server.value)) {
      item.details.push({label: field.key, value: rawValue(entry, field.value)});
    }
    return item;
  });
  if (!result.length) entry.notes.push('Mapa serwerów jest pusta.');
  return result.length ? result : [entry];
}

function vscodeEntry(file: RepositoryReportFile): ReportEntry {
  const entry = baseEntry(file);
  const root = json(entry);
  if (!root) return entry;
  const path = file.path.toLowerCase();
  const workspace = path.endsWith('.code-workspace');
  const settings = workspace ? child(root, 'settings') : path.endsWith('/settings.json') ? root : undefined;
  for (const field of properties(settings)) {
    if (aiSetting.test(field.key)) entry.details.push({label: field.key, value: rawValue(entry, field.value)});
    else if (field.key.startsWith('[')) for (const scoped of properties(field.value)) {
      if (aiSetting.test(scoped.key)) entry.details.push({label: field.key + ' · ' + scoped.key, value: rawValue(entry, scoped.value)});
    }
  }
  const extensions = workspace ? child(root, 'extensions') : path.endsWith('/extensions.json') ? root : undefined;
  for (const key of ['recommendations', 'unwantedRecommendations']) {
    const values: unknown = child(extensions, key) ? getNodeValue(child(extensions, key)!) : undefined;
    if (Array.isArray(values)) for (const value of values) if (typeof value === 'string' && aiExtension.test(value)) {
      entry.details.push({label: key === 'recommendations' ? 'Zalecane rozszerzenie AI' : 'Niezalecane rozszerzenie AI', value});
    }
  }
  if (!entry.details.length) entry.notes.push('Nie znaleziono rozpoznanych ustawień ani rekomendacji AI w tym pliku. Pozostałe pola zachowano w źródle.');
  return entry;
}

function jetbrainsEntry(file: RepositoryReportFile): ReportEntry {
  const entry = baseEntry(file);
  if (!entry.readable) return entry;
  const path = file.path.toLowerCase();
  if (path === '.noai') entry.details.push({label: 'Deklaracja', value: 'Wyłączenie JetBrains AI Assistant w projekcie'});
  else if (path === '.aiignore') entry.details.push({label: 'Wzorce ograniczeń', value: file.content.trim() || '(plik pusty)'});
  else if (path.startsWith('.idea/')) {
    entry.notes.push('Rozpoznano nazwę komponentu AI. Nie potwierdzono schematu pól ani aktywacji wtyczki.');
    entry.details.push({label: 'Deklaracja XML', value: file.content});
  } else {
    const fields = frontmatter(entry);
    if (typeof fields['name'] === 'string') entry.name = fields['name'];
    if (typeof fields['description'] === 'string') entry.description = fields['description'];
    for (const key of Object.keys(fields)) entry.details.push({label: key, value: display(fields[key])});
    if (!entry.details.length) entry.notes.push('Znaleziono plik reguły AI Assistant; tryb stosowania nie został ustalony z odczytanych danych.');
  }
  return entry;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function display(value: unknown): string { return typeof value === 'string' ? value : compactJson(JSON.stringify(value) ?? String(value)); }
/** Compact presentation without parsing numeric tokens or changing quoted whitespace. Raw stays in the source entry. */
function compactJson(source: string): string {
  const scanner = createScanner(source, true);
  const parts: string[] = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    parts.push(source.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()));
    if (token === SyntaxKind.CommaToken || token === SyntaxKind.ColonToken) parts.push(' ');
  }
  return parts.join('');
}
function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'plik' : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14) ? 'pliki' : 'plików'}`;
}
function declarationCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'rozpoznana deklaracja' : count % 10 >= 2 && count % 10 <= 4 && !(count % 100 >= 12 && count % 100 <= 14)
    ? 'rozpoznane deklaracje' : 'rozpoznanych deklaracji'}`;
}
