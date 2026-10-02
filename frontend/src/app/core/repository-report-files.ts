import {RepositoryGitMetadata, RepositoryReportFile} from '../models/standardization.models';
import {readRepositoryText, redactRepositoryText, RepositorySelection} from './standardization-files';

export function reportFilePath(path: string): boolean {
  return /^\.vscode\/(settings|extensions)\.json$/i.test(path) || /^[^/]+\.code-workspace$/i.test(path)
    || /^\.aiassistant\/rules\/.+\.md$/i.test(path) || ['.aiignore', '.noai'].includes(path)
    || /^\.idea\/[^/]+\.xml$/i.test(path);
}

/** Retain only explicitly AI-named components, never the rest of workspace.xml. */
export function aiIdeaComponents(content: string): string {
  return [...content.matchAll(/<component\b[^>]*\bname=["'][^"']*(?:aiassistant|github[-_.]?copilot|junie)[^"']*["'][^>]*(?:\/>|>[\s\S]*?<\/component>)/gi)]
    .map(match => match[0]).join('\n');
}

export async function readReportFiles(selection: RepositorySelection): Promise<{files: RepositoryReportFile[]; complete: boolean}> {
  const result: RepositoryReportFile[] = [];
  const candidates = selection.entries.filter(entry => reportFilePath(entry.path));
  let complete = candidates.length <= 300;
  for (const entry of candidates.slice(0, 300)) {
    try {
      let raw = await readRepositoryText(await entry.read());
      if (entry.path.toLowerCase().startsWith('.idea/')) { raw = aiIdeaComponents(raw); if (!raw) continue; }
      const content = redactRepositoryText(raw);
      result.push({path: entry.path, content, bytes: new TextEncoder().encode(content).length,
        redacted: content !== raw, omissionReason: null});
    } catch (failure) {
      // A failure inspecting generic IDE XML does not establish an AI configuration.
      if (entry.path.toLowerCase().startsWith('.idea/')) { complete = false; continue; }
      const code = failure instanceof Error ? failure.message : '';
      result.push({path: entry.path, content: '', bytes: 0, redacted: false,
        omissionReason: code === 'TOO_LARGE' || code === 'UNSUPPORTED_ENCODING' ? code : 'UNREADABLE'});
    }
  }
  return {files: result, complete};
}

export function safeRepositoryRemote(value: string): string | null {
  const text = value.trim().replace(/^"|"$/g, '');
  if (!text || text.length > 2000 || /[\u0000-\u001f]/.test(text)) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return null;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return redactRepositoryText(url.href);
  } catch {
    const scp = text.match(/^(?:[^@/\s]+@)?([a-z\d.-]+):([^?#\s]+)$/i);
    return scp ? redactRepositoryText(scp[1] + ':' + scp[2]) : null;
  }
}

export async function readGitMetadata(selection: RepositorySelection): Promise<RepositoryGitMetadata> {
  const contents = new Map<string, string>();
  for (const entry of selection.gitEntries ?? []) {
    try { contents.set(entry.path, await readRepositoryText(await entry.read())); } catch { /* Missing is not zero. */ }
  }
  const head = contents.get('.git/HEAD')?.trim();
  const ref = head?.match(/^ref:\s*(refs\/heads\/[^\s\\]+)$/)?.[1];
  const packed = ref ? contents.get('.git/packed-refs')?.split('\n').find(line => line.trim().split(/\s+/)[1] === ref)?.split(/\s+/)[0] : undefined;
  const hash = ref ? contents.get('.git/' + ref)?.trim() ?? packed : head;
  const commit = hash && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(hash) ? hash : null;
  let origin: string | null = null;
  let originSection = false;
  for (const line of (contents.get('.git/config') ?? '').split('\n')) {
    const section = line.trim().match(/^\[([^\]]+)\]/);
    if (section) originSection = /^remote\s+"origin"$/i.test(section[1]);
    else if (originSection) {
      const remote = line.match(/^\s*url\s*=\s*(.+)$/i);
      if (remote) origin = safeRepositoryRemote(remote[1]);
    }
  }
  return {origin, branch: ref?.slice('refs/heads/'.length) ?? null, commit,
    availability: contents.size === 0 ? 'UNAVAILABLE' : commit && origin ? 'AVAILABLE' : 'PARTIAL'};
}
