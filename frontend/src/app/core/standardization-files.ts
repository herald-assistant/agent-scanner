import {StandardCategory, StandardOmission} from '../models/standardization.models';

export interface RepositoryEntry { path: string; read: () => Promise<File>; }
export interface RepositorySelection {
  name: string; entries: RepositoryEntry[]; complete: boolean; gitDetected: boolean;
  refreshable: boolean;
  gitEntries?: RepositoryEntry[];
}
export interface RepositoryFile {
  path: string; category: StandardCategory; content: string; bytes: number; redacted: boolean;
  selected: boolean; error?: string; omissionReason?: StandardOmission['reason']; read: () => Promise<File>;
}
interface DirectoryHandle {
  kind: 'directory'; name: string; values(): AsyncIterable<DirectoryHandle | RepoFileHandle>;
}
interface RepoFileHandle { kind: 'file'; name: string; getFile(): Promise<File>; }

const EXCLUDED = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next', '.angular', '.venv', 'venv', 'vendor', 'coverage']);
const CONFIGURATION_MATERIAL = /^\.(?:github\/(?:instructions|skills|agents|prompts)|claude\/(?:skills|agents)|agents\/skills)\/.+\.(?:md|txt)$/i;
const MAX_ENTRIES = 30_000;
const MAX_CANDIDATES = 300;
export const MAX_LOCAL_FILE_BYTES = 131_072;

export function categoryForPath(path: string): StandardCategory {
  const lower = path.toLowerCase();
  if (/(?:^|\/)(agents|claude|gemini)\.md$/.test(lower) || lower === '.github/copilot-instructions.md'
    || lower === '.claude/claude.md' || /^\.github\/instructions\/.+\.instructions\.md$/.test(lower)) return 'INSTRUCTIONS';
  if (/^\.(github|claude|agents)\/skills\/[^/]+\/skill\.md$/.test(lower)) return 'SKILLS';
  if (/^\.(github|claude)\/agents\/[^/]+\.md$/.test(lower)) return 'AGENTS';
  if (['.vscode/mcp.json', '.github/mcp.json', '.mcp.json'].includes(lower)) return 'MCP';
  if (/^\.github\/prompts\/.+\.prompt\.md$/.test(lower)) return 'PROMPTS';
  return 'CONTEXT';
}

function allowedPath(path: string): boolean {
  return path.length <= 500 && !/[\u0000-\u001f\\:]/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !EXCLUDED.has(part.toLowerCase()))
    && !/(?:^|\/)\.env(?:\.|$)/i.test(path);
}

export function selectionFromFiles(files: readonly File[]): RepositorySelection {
  const root = files[0]?.webkitRelativePath.split('/')[0];
  if (!root || files.some(file => !file.webkitRelativePath.startsWith(root + '/'))) {
    throw new Error('Wskaż jeden folder repozytorium w oknie wyboru katalogu.');
  }
  const paths = files.slice(0, MAX_ENTRIES).map(file => ({file, path: file.webkitRelativePath.slice(root.length + 1)}));
  const nested = [...new Set(paths.filter(entry => /\/\.git(?:\/|$)/.test(entry.path)).map(entry => entry.path.split('/.git')[0] + '/'))];
  return {
    name: root, complete: files.length <= MAX_ENTRIES, refreshable: false,
    gitDetected: paths.some(entry => entry.path === '.git' || entry.path.startsWith('.git/')),
    gitEntries: paths.filter(entry => gitMetadataPath(entry.path)).map(entry => ({path: entry.path, read: async () => entry.file})),
    entries: paths.filter(entry => allowedPath(entry.path) && !nested.some(prefix => entry.path.startsWith(prefix)))
      .map(entry => ({path: entry.path, read: async () => entry.file}))
  };
}

/** Returns undefined when the browser needs the directory-input fallback. */
export async function pickRepository(): Promise<RepositorySelection | undefined> {
  const browser = window as Window & {showDirectoryPicker?: (options: {mode: 'read'}) => Promise<DirectoryHandle>};
  if (!browser.showDirectoryPicker) return undefined;
  const root = await browser.showDirectoryPicker({mode: 'read'});
  const entries: RepositoryEntry[] = [];
  let count = 0;
  let complete = true;
  let gitDetected = false;
  const gitEntries: RepositoryEntry[] = [];
  let gitCount = 0;
  const visitGit = async (directory: DirectoryHandle, prefix = '.git/', depth = 0): Promise<void> => {
    if (depth > 20) return;
    for await (const child of directory.values()) {
      if (++gitCount > 1000) return;
      const path = prefix + child.name;
      if (child.kind === 'file' && gitMetadataPath(path)) gitEntries.push({path, read: () => child.getFile()});
      else if (child.kind === 'directory' && (path === '.git/refs' || path.startsWith('.git/refs/heads'))) {
        await visitGit(child, path + '/', depth + 1);
      }
    }
  };
  const visit = async (directory: DirectoryHandle, prefix: string, depth: number): Promise<void> => {
    if (depth > 20) { complete = false; return; }
    const children: (DirectoryHandle | RepoFileHandle)[] = [];
    for await (const child of directory.values()) {
      if (++count > MAX_ENTRIES) { complete = false; return; }
      children.push(child);
    }
    if (children.some(child => child.name === '.git')) {
      if (prefix) return;
      gitDetected = true;
    }
    for (const child of children) {
      const path = prefix + child.name;
      if (!prefix && child.name === '.git') {
        if (child.kind === 'directory') { try { await visitGit(child); } catch { /* Git metadata may be unavailable. */ } }
        continue;
      }
      if (!allowedPath(path)) continue;
      if (child.kind === 'directory') {
        try { await visit(child, path + '/', depth + 1); }
        catch { complete = false; }
      } else entries.push({path, read: () => child.getFile()});
      if (count > MAX_ENTRIES) return;
    }
  };
  await visit(root, '', 0);
  return {name: root.name, entries, complete, gitDetected, refreshable: true, gitEntries};
}

function gitMetadataPath(path: string): boolean {
  return ['.git/config', '.git/HEAD', '.git/packed-refs'].includes(path)
    || /^\.git\/refs\/heads\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f:]+$/.test(path);
}

export function redactRepositoryText(value: string): string {
  return value
    .replace(/([a-z]+:\/\/)[^/\s"'@]+@/gi, '$1[UKRYTO]@')
    .replace(/(\bname=["'][^"']*(?:token|password|secret|api[_-]?key|authorization)[^"']*["'][^>]*\bvalue=["'])([^"']+)(["'])/gi,
      '$1[UKRYTO]$3')
    .replace(/(\bvalue=["'])([^"']+)(["'][^>]*\bname=["'][^"']*(?:token|password|secret|api[_-]?key|authorization)[^"']*["'])/gi,
      '$1[UKRYTO]$3')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[UKRYTO]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [UKRYTO]')
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
      match => match.split('\n').map(() => '[UKRYTO]').join('\n'))
    .replace(/(["']?(?:[\w.-]*(?:token|password|secret|api[_-]?key|authorization))["']?\s*[:=]\s*["']?)([^\s,"';}]+)/gi,
      (match: string, prefix: string, secret: string) => /^[\[$]/.test(secret) || ['null', 'true', 'false'].includes(secret) || secret.length < 6
        ? match : prefix + '[UKRYTO]');
}

export async function readRepositoryText(file: File): Promise<string> {
  if (file.size > MAX_LOCAL_FILE_BYTES) throw new Error('TOO_LARGE');
  const buffer = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('UNREADABLE'));
    reader.onerror = () => reject(new Error('UNREADABLE'));
    reader.readAsArrayBuffer(file);
  });
  let text: string;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(buffer).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, ''); }
  catch { throw new Error('UNSUPPORTED_ENCODING'); }
  if (text.includes('\0')) throw new Error('UNSUPPORTED_ENCODING');
  return text;
}

export async function discoverRepository(selection: RepositorySelection): Promise<{files: RepositoryFile[]; complete: boolean}> {
  const candidates = new Map<string, RepositoryEntry>();
  const byPath = new Map(selection.entries.map(entry => [entry.path, entry]));
  for (const entry of selection.entries) {
    if (allowedPath(entry.path) && categoryForPath(entry.path) !== 'CONTEXT') candidates.set(entry.path, entry);
  }
  const files: RepositoryFile[] = [];
  const pending = [...candidates.values()].sort((a, b) =>
    Number(categoryForPath(a.path) === 'CONTEXT') - Number(categoryForPath(b.path) === 'CONTEXT') || a.path.localeCompare(b.path));
  const queued = new Set(pending.map(entry => entry.path));
  const seen = new Set<string>();
  for (let index = 0; index < pending.length && files.length < MAX_CANDIDATES; index++) {
    const entry = pending[index];
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    try {
      const file = await entry.read();
      const original = await readRepositoryText(file);
      const content = redactRepositoryText(original);
      files.push({...entry, category: categoryForPath(entry.path), content,
        bytes: new TextEncoder().encode(content).length, redacted: original !== content, selected: true});
      if (categoryForPath(entry.path) !== 'CONTEXT') {
        for (const match of original.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
          const target = resolveReference(entry.path, match[1]);
          const referenced = target ? byPath.get(target) : undefined;
          if (referenced && CONFIGURATION_MATERIAL.test(referenced.path) && allowedPath(referenced.path) && !queued.has(referenced.path)) {
            queued.add(referenced.path);
            pending.push(referenced);
          }
        }
      }
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      const reason = code === 'TOO_LARGE' || code === 'UNSUPPORTED_ENCODING' ? code : 'UNREADABLE';
      files.push({...entry, category: categoryForPath(entry.path), content: '', bytes: 0, redacted: false,
        selected: false, omissionReason: reason, error: reason === 'TOO_LARGE' ? 'Plik przekracza 128 KiB.'
          : reason === 'UNSUPPORTED_ENCODING' ? 'Plik nie jest tekstem UTF-8.' : 'Nie udało się odczytać pliku.'});
    }
  }
  return {files, complete: selection.complete && pending.every(entry => seen.has(entry.path))};
}

function resolveReference(source: string, reference: string): string | undefined {
  if (/^(?:\/|~|[a-z]+:)/i.test(reference) || reference.includes('$') || reference.includes('\\')) return undefined;
  const parts = source.split('/').slice(0, -1);
  for (const part of reference.split('/')) {
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
    else if (part !== '.' && part) parts.push(part);
  }
  return parts.join('/');
}
