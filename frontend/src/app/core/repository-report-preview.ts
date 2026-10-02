import {Lexer, type MarkedToken, type Token} from 'marked';
import {parseDocument} from 'yaml';
import type {ReportEntry} from './repository-report';
import type {RepositoryGitMetadata} from '../models/standardization.models';
import {redactRepositoryText} from './standardization-files';
import {safeRepositoryRemote} from './repository-report-files';

export interface PreviewSpan { text: string; bold?: boolean; italics?: boolean; code?: boolean; strike?: boolean; }
export interface PreviewBlock { kind: 'text' | 'heading' | 'code'; spans: PreviewSpan[]; indent: number; listItem?: number; }
export interface FilePreview { blocks: PreviewBlock[]; truncated: boolean; omittedMarkup: boolean; }

/** A presentation-only extract. The stored, redacted source is never rewritten. */
export function repositoryFilePreview(entry: ReportEntry): FilePreview {
  if (!entry.readable) return {blocks: [], truncated: false, omittedMarkup: false};
  const source = redactRepositoryText(entry.content).replace(/\r\n?/g, '\n');
  const markdown = /\.(?:md|markdown|mdown|mkdn?)$/i.test(entry.path);
  const body = markdown ? withoutFrontmatter(source) : source;
  const blocks: PreviewBlock[] = [];
  let listItemNumber = 0;
  let omittedMarkup = false;
  const inline = (tokens: Token[], style: Omit<PreviewSpan, 'text'> = {}, depth = 0): PreviewSpan[] => tokens.flatMap(value => {
    const token = value as MarkedToken;
    if (token.type === 'image' || token.type === 'html') { omittedMarkup = true; return []; }
    if (depth > 12) return [{...style, text: token.raw}];
    switch (token.type) {
      case 'strong': return inline(token.tokens, {...style, bold: true}, depth + 1);
      case 'em': return inline(token.tokens, {...style, italics: true}, depth + 1);
      case 'del': return inline(token.tokens, {...style, strike: true}, depth + 1);
      case 'link': return inline(token.tokens, style, depth + 1); // No navigation or remote assets inside excerpts.
      case 'codespan': return [{...style, code: true, text: token.text}];
      case 'br': return [{...style, text: '\n'}];
      case 'text': return token.tokens ? inline(token.tokens, style, depth + 1) : [{...style, text: entities(token.text)}];
      case 'escape': return [{...style, text: token.text}];
      default: return [{...style, text: token.raw}];
    }
  });
  const visit = (tokens: Token[], indent = 0, quote = false, listItem?: number): void => {
    for (const value of tokens) {
      const token = value as MarkedToken;
      const add = (kind: PreviewBlock['kind'], spans: PreviewSpan[]): void => {
        if (spans.some(span => span.text.trim())) blocks.push({kind, spans, indent: Math.min(indent, 3), listItem});
      };
      if (indent > 12) { add('text', [{text: token.raw}]); continue; }
      switch (token.type) {
        case 'heading': add('heading', inline(token.tokens)); break;
        case 'paragraph': case 'text': add('text', token.tokens ? inline(token.tokens, {italics: quote}) : [{text: token.text, italics: quote}]); break;
        case 'code': add('code', [{text: token.text, code: true}]); break;
        case 'blockquote': visit(token.tokens, indent + 1, true, listItem); break;
        case 'list':
          token.items.forEach((item, index) => {
            const first = blocks.length;
            visit(item.tokens, indent + 1, quote, listItem ?? ++listItemNumber);
            if (blocks[first]) blocks[first].spans.unshift({text: item.task ? (item.checked ? '[x] ' : '[ ] ')
              : token.ordered ? `${Number(token.start) + index}. ` : '• '});
          });
          break;
        case 'table':
          for (const row of [token.header, ...token.rows]) add('text', row.flatMap((cell, index) => [
            ...(index ? [{text: ' | '}] : []), ...inline(cell.tokens, {bold: cell.header})
          ]));
          break;
        case 'html': omittedMarkup = true; break;
        case 'space': case 'hr': case 'def': break;
        default: add('text', inline([token]));
      }
    }
  };
  if (body.trim()) {
    if (markdown) {
      try { visit(Lexer.lex(body, {gfm: true})); }
      catch { blocks.push({kind: 'code', spans: [{text: body, code: true}], indent: 0}); }
    } else blocks.push({kind: 'code', spans: [{text: body, code: true}], indent: 0});
  }
  return {...limitPreview(blocks), omittedMarkup};
}

function withoutFrontmatter(source: string): string {
  const header = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source);
  if (!header) return source;
  try {
    const doc = parseDocument(header[1], {uniqueKeys: true, strict: true});
    if (doc.errors.length) return source;
    const data: unknown = doc.toJS({maxAliasCount: 0});
    return data && typeof data === 'object' && !Array.isArray(data) ? source.slice(header[0].length) : source;
  } catch { return source; }
}

function limitPreview(blocks: PreviewBlock[]): Pick<FilePreview, 'blocks' | 'truncated'> {
  const result: PreviewBlock[] = [];
  let remaining = 500, lines = 12, truncated = false;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const unit = [block];
    // An item may contain multiple paragraphs or a nested list. Keep that complete unit.
    while (block.listItem !== undefined && blocks[index + 1]?.listItem === block.listItem) unit.push(blocks[++index]);
    const text = unit.map(blockText).join('\n');
    const length = Array.from(text).length, lineCount = text.split('\n').length;
    if (length <= remaining && lineCount <= lines) {
      result.push(...unit);
      remaining -= length + 1; lines -= lineCount;
      continue;
    }
    truncated = true;
    const hasBody = result.some(item => item.kind !== 'heading');
    if (remaining <= 0 || lines <= 0 || (block.kind === 'heading' && hasBody)) break;
    if (block.listItem !== undefined && hasBody) break;
    const points = Array.from(blockText(block));
    let end = Math.min(points.length, remaining), breaks = 0;
    for (let i = 0; i < end; i++) if (points[i] === '\n' && ++breaks >= lines) { end = i; break; }
    const prefix = points.slice(0, end).join('');
    let boundary = 0;
    if (block.kind === 'code') {
      boundary = prefix.lastIndexOf('\n');
    } else {
      // Segment the complete paragraph so a cut-off final word is never treated as a sentence.
      for (const sentence of new Intl.Segmenter('pl', {granularity: 'sentence'}).segment(blockText(block))) {
        const sentenceEnd = sentence.index + sentence.segment.trimEnd().length;
        if (sentenceEnd <= prefix.length) boundary = sentenceEnd;
        else break;
      }
    }
    if (boundary <= 0 && !hasBody) {
      // One overlong sentence/code line still gets a clearly marked excerpt.
      boundary = /\s+\S*$/.exec(prefix)?.index || prefix.length;
    }
    if (boundary > 0) result.push({...sliceBlock(block, Array.from(prefix.slice(0, boundary).trimEnd()).length),
      kind: block.kind === 'heading' ? 'text' : block.kind});
    break;
  }
  if (truncated) while (result.at(-1)?.kind === 'heading') result.pop();
  return {blocks: result, truncated};
}

function blockText(block: PreviewBlock): string { return block.spans.map(span => span.text).join(''); }
function sliceBlock(block: PreviewBlock, length: number): PreviewBlock {
  const spans: PreviewSpan[] = [];
  for (const span of block.spans) {
    const points = Array.from(span.text);
    if (length > 0) spans.push({...span, text: points.slice(0, length).join('')});
    length -= points.length;
  }
  return {...block, spans};
}

function entities(text: string): string {
  const named: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, name: string) => {
    if (!name.startsWith('#')) return named[name.toLowerCase()] ?? raw;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : raw;
  });
}

/** Only known hosting URL schemes; origin alone cannot identify a self-hosted forge. */
export function repositoryFileLink(git: RepositoryGitMetadata | null, path: string): string | null {
  if (!git?.origin || !path || path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\u0000-\u001f]/.test(path)) return null;
  const normalizedOrigin = /^(?:github\.com|gitlab\.com):/i.test(git.origin)
    ? 'ssh://' + git.origin.replace(':', '/') : git.origin;
  const remote = safeRepositoryRemote(normalizedOrigin);
  if (!remote || remote.includes('[UKRYTO]')) return null;
  let url: URL;
  try { url = new URL(remote.includes('://') ? remote : 'ssh://' + remote.replace(':', '/')); } catch { return null; }
  if (url.port || !['github.com', 'gitlab.com'].includes(url.hostname)) return null;
  const repo = url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const segments = repo.split('/').filter(Boolean);
  if (segments.length < 2 || (url.hostname === 'github.com' && segments.length !== 2)) return null;
  const commit = git.commit && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(git.commit) ? git.commit : null;
  // A local commit may not exist on origin. Prefer the named branch for repository navigation.
  const ref = git.branch || commit;
  if (!ref || /[\u0000-\u001f]/.test(ref)) return null;
  return `https://${url.hostname}${repo}/${url.hostname === 'gitlab.com' ? '-/blob' : 'blob'}/${encodeURIComponent(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
