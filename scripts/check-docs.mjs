import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function markdownFiles(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return markdownFiles(fullPath);
    return entry.name.endsWith('.md') ? [fullPath] : [];
  });
}

// Repository convention: ATX headings and inline Markdown links. No renderer dependency.
function parseMarkdown(content) {
  const anchors = new Set();
  const links = [];
  const headings = [];
  const problems = [];
  let fence;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = {marker: marker[1], line: index + 1};
      else if (marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) {
      headings.push({level: heading[1].length, title: heading[2], line: index + 1});
      const base = heading[2].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '').toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '').replace(/ /g, '-');
      let anchor = base;
      let suffix = 0;
      while (anchors.has(anchor)) anchor = `${base}-${++suffix}`;
      anchors.add(anchor);
    }
    // Inline code may contain example paths and links; it is not navigation.
    const prose = line.replace(/(`+).*?\1/g, '');
    for (const match of prose.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s()]*(?:\([^()]*\)[^\s()]*)*))(?:\s+"[^"]*")?\s*\)/g)) {
      if (match[1] || match[2]) links.push({target: match[1] ?? match[2], line: index + 1});
    }
  }
  if (fence) problems.push({line: fence.line, message: 'Niezamknięty blok kodu.'});
  return {anchors, links, headings, problems, lines};
}

export function checkDocs(root = defaultRoot) {
  const docsRoot = path.join(root, 'docs');
  const entries = ['README.md', 'AGENTS.md', 'docs/README.md'].map(file => path.join(root, file));
  const files = [...new Set([...entries, ...markdownFiles(docsRoot)])];
  const documents = new Map(files.map(file => [file, parseMarkdown(readFileSync(file, 'utf8'))]));
  const errors = [];
  const graph = new Map();
  let checkedLinks = 0;
  const report = (file, line, message) => errors.push(`${path.relative(root, file).replaceAll('\\', '/')}:${line}: ${message}`);
  for (const [file, document] of documents) {
    graph.set(file, new Set());
    for (const problem of document.problems) report(file, problem.line, problem.message);
    if (document.headings.filter(heading => heading.level === 1).length !== 1) {
      report(file, 1, 'Dokument musi mieć dokładnie jeden nagłówek H1 poza blokami kodu.');
    }
    if (file.startsWith(docsRoot + path.sep) && !document.lines.slice(0, 12).some(line => /^Status: .+/.test(line))) {
      report(file, 1, 'Brak jawnego Status: na początku dokumentu.');
    }
    for (const link of document.links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.target) || link.target.startsWith('//')) continue;
      checkedLinks++;
      const separator = link.target.indexOf('#');
      let targetPath = separator < 0 ? link.target : link.target.slice(0, separator);
      let fragment = separator < 0 ? '' : link.target.slice(separator + 1);
      try {
        targetPath = decodeURIComponent(targetPath);
        fragment = decodeURIComponent(fragment);
      } catch {
        report(file, link.line, `Niepoprawne kodowanie linku: ${link.target}`);
        continue;
      }
      const resolved = targetPath ? path.resolve(path.dirname(file), targetPath) : file;
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        report(file, link.line, `Lokalny link wychodzi poza repozytorium: ${link.target}`);
        continue;
      }
      if (!existsSync(resolved)) {
        report(file, link.line, `Brak celu: ${link.target}`);
        continue;
      }
      if (graph.has(resolved) || documents.has(resolved)) graph.get(file).add(resolved);
      if (fragment && resolved.endsWith('.md') && statSync(resolved).isFile()) {
        const targetDocument = documents.get(resolved) ?? parseMarkdown(readFileSync(resolved, 'utf8'));
        if (!targetDocument.anchors.has(fragment)) report(file, link.line, `Brak nagłówka: ${link.target}`);
      }
    }
  }
  const reachable = new Set();
  const pending = [...entries];
  while (pending.length) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    pending.push(...(graph.get(file) ?? []));
  }
  for (const file of files) {
    if (!reachable.has(file)) report(file, 1, 'Brak ścieżki nawigacji z README.md, AGENTS.md lub docs/README.md.');
  }
  return {errors, fileCount: files.length, checkedLinks};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDocs();
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    console.error(`Dokumentacja: ${result.errors.length} problemów w ${result.fileCount} plikach.`);
    process.exitCode = 1;
  } else {
    console.log(`Dokumentacja OK: ${result.fileCount} plików, ${result.checkedLinks} lokalnych linków; nagłówki, statusy i nawigacja poprawne.`);
  }
}
