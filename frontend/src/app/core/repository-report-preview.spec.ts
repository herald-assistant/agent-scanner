import {describe, expect, it} from 'vitest';
import {repositoryFileLink, repositoryFilePreview} from './repository-report-preview';
import type {ReportEntry} from './repository-report';
import {buildRepositoryReport} from './repository-report';
import {paginatedRepositoryReportDefinition, repositoryReportDefinition} from './repository-report-pdf';
import type {Node} from 'pdfmake/interfaces';
import {categoryForPath, type RepositoryFile} from './standardization-files';

const entry = (content: string, path = 'AGENTS.md'): ReportEntry => ({path, content, name: path, description: '',
  readable: true, redacted: false, bytes: content.length, details: [], notes: [], linkedFiles: []});
const text = (preview: ReturnType<typeof repositoryFilePreview>): string => preview.blocks.map(block => block.spans.map(span => span.text).join('')).join('\n');
const git = {origin: 'git@github.com:example/repository.git', commit: 'a'.repeat(40), branch: 'main', availability: 'AVAILABLE' as const};
const configuration = (path: string, content: string): RepositoryFile => ({...entry(content, path),
  category: categoryForPath(path), selected: true, read: async () => new File([content], path)});
function contentNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(contentNodes);
  if (!value || typeof value !== 'object') return [];
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(contentNodes)];
}

describe('repository PDF source excerpts', () => {
  it('removes valid frontmatter from the preview only and retains Markdown structure and inline styles', () => {
    const source = '---\nname: Reviewer\ndescription: Review changes\n---\n# Procedure\nRead **changes** and *tests* with `git diff`.\n\n1. Review\n2. Verify\n\n> Keep evidence.\n\n```ts\nconst nazwa = "zażółć";\n```';
    const file = entry(source);
    const preview = repositoryFilePreview(file);
    expect(file.content).toBe(source);
    expect(text(preview)).not.toContain('description:');
    expect(preview.blocks[0].kind).toBe('heading');
    expect(preview.blocks[1].spans).toEqual(expect.arrayContaining([
      expect.objectContaining({text: 'changes', bold: true}), expect.objectContaining({text: 'tests', italics: true}),
      expect.objectContaining({text: 'git diff', code: true})
    ]));
    expect(text(preview)).toContain('1. Review\n2. Verify');
    expect(preview.blocks.at(-1)).toMatchObject({kind: 'code', spans: [{text: 'const nazwa = "zażółć";', code: true}]});
    expect(preview.truncated).toBe(false);
  });

  it('keeps malformed or duplicate frontmatter visible instead of silently discarding it', () => {
    for (const yaml of ['name: [invalid', 'name: first\nname: duplicate', '- not a mapping']) {
      expect(text(repositoryFilePreview(entry(`---\n${yaml}\n---\nBody`)))).toContain(yaml.split('\n')[0].replace(/^- /, ''));
    }
  });

  it('limits visible text without breaking styles, Unicode code points or raw source', () => {
    const file = entry('# Title\n**' + 'Zażółć 😀 gęślą. '.repeat(60).trimEnd() + '**\nEND-OMITTED');
    const preview = repositoryFilePreview(file);
    expect(Array.from(text(preview)).length).toBeLessThanOrEqual(500);
    expect(preview.truncated).toBe(true);
    expect(text(preview)).not.toMatch(/\*\*|END-OMITTED|\uFFFD/);
    expect(preview.blocks[1].spans[0].bold).toBe(true);
    expect(file.content).toContain('END-OMITTED');
  });

  it('bounds many short lines and preserves numeric and XML source instead of interpreting it as Markdown', () => {
    const preview = repositoryFilePreview(entry(Array.from({length: 100}, (_, i) => `- ${i}`).join('\n')));
    expect(preview.blocks).toHaveLength(12);
    expect(preview.truncated).toBe(true);
    const json = '{"limit":9007199254740993,"apiKey":"synthetic-secret-value"}';
    expect(text(repositoryFilePreview(entry(json, '.vscode/mcp.json')))).toBe('{"limit":9007199254740993,"apiKey":"[UKRYTO]"}');
    expect(text(repositoryFilePreview(entry('<component name="AI"/>', '.idea/workspace.xml')))).toBe('<component name="AI"/>');
  });

  it('never includes active links, images or HTML, but retains readable link labels and entities', () => {
    const preview = repositoryFilePreview(entry('A &amp; B **[opis](javascript:alert)** ![image](https://example.invalid/image.png)\n\n<script>secret-script</script>'));
    expect(text(preview).trim()).toBe('A & B opis');
    expect(preview.omittedMarkup).toBe(true);
    expect(JSON.stringify(preview)).not.toMatch(/javascript:|example.invalid|secret-script/);
  });

  it('does not preview content of unreadable entries', () => {
    expect(repositoryFilePreview({...entry('not readable'), readable: false}).blocks).toEqual([]);
    expect(repositoryFilePreview(entry('')).truncated).toBe(false);
  });

  it('omits a dangling partial paragraph and caps fenced code without leaking its fences', () => {
    const prefix = 'x'.repeat(487);
    expect(text(repositoryFilePreview(entry(prefix + '\n\nDalsze instrukcje i zakończenie.')))).toBe(prefix);
    const preview = repositoryFilePreview(entry('```js\n' + 'const x = 1;\n'.repeat(30) + '```'));
    expect(preview.blocks[0].kind).toBe('code');
    expect(preview.truncated).toBe(true);
    expect(text(preview)).not.toContain('```');
  });

  it('ends at a complete sentence across inline styles and does not leave a heading without its paragraph', () => {
    const intro = 'Wprowadzenie. '.repeat(28).trimEnd();
    const preview = repositoryFilePreview(entry(intro + '\n\nSprawdź **zmiany** i *testy*. ' + 'Dalsze instrukcje '.repeat(30)));
    expect(text(preview)).toBe(intro + '\nSprawdź zmiany i testy.');
    expect(preview.blocks.at(-1)?.spans).toContainEqual(expect.objectContaining({text: 'zmiany', bold: true}));
    const heading = repositoryFilePreview(entry('W'.repeat(470) + '\n\n## Kolejny krok\n' + 'Długa instrukcja '.repeat(40)));
    expect(text(heading)).not.toContain('Kolejny krok');
    expect(heading.truncated).toBe(true);
  });

  it('keeps complete list items, including their nested paragraphs and child bullets', () => {
    const intro = 'Wprowadzenie. '.repeat(28).trimEnd();
    const preview = repositoryFilePreview(entry(intro + '\n\n- Sprawdź zmiany.\n- Drugi punkt\n  - ' + 'instrukcja '.repeat(35)));
    expect(text(preview)).toBe(intro + '\n• Sprawdź zmiany.');
    expect(preview.truncated).toBe(true);
  });

  it('still provides a marked excerpt when the first sentence alone exceeds the limit', () => {
    const preview = repositoryFilePreview(entry('# Instrukcja\n' + 'bardzo długa instrukcja '.repeat(40)));
    expect(preview.truncated).toBe(true);
    expect(preview.blocks).toHaveLength(2);
    expect(Array.from(text(preview)).length).toBeLessThanOrEqual(500);
    expect(text(preview)).toContain('bardzo długa instrukcja');
    const heading = repositoryFilePreview(entry('# ' + 'bardzo długi tytuł '.repeat(50)));
    expect(heading.truncated).toBe(true);
    expect(heading.blocks[0].kind).toBe('text');
    expect(text(heading)).toContain('bardzo długi tytuł');
  });

  it('shows one source excerpt per MCP file even with multiple server declarations', () => {
    const report = buildRepositoryReport({name: 'synthetic', complete: true, gitDetected: true, git, files: [{
      ...entry('{"servers":{"first":{"command":"node"},"second":{"command":"python"}}}', '.vscode/mcp.json'),
      category: 'MCP', selected: true, read: async () => new File([], 'mcp.json')
    }]});
    const output = JSON.stringify(repositoryReportDefinition(report).content);
    expect(output.match(/"text":"TREŚĆ"/g)).toHaveLength(1);
    expect(output).not.toContain('Szczegóły w repozytorium');
    expect(output.match(/"text":" ↗"/g)).toHaveLength(2);
    expect(output).toContain('/blob/main/.vscode/mcp.json');
    expect(output).not.toContain('/blob/' + git.commit + '/');
    expect(output).toContain(git.commit); // The checkout commit remains report metadata.
  });

  it('puts linked paths below the source excerpt, removes the material category and links only the arrow beside the name', () => {
    const report = buildRepositoryReport({name: 'synthetic', complete: true, gitDetected: true, git, files: [
      configuration('.github/skills/review/SKILL.md', '---\nname: review\n---\nReview changes.\n[Checklist](references/checklist.md)\n[Again](references/checklist.md#tests)\n[Guide](../../../docs/guide.md)'),
      configuration('.github/skills/review/references/checklist.md', 'UNIQUE-MATERIAL-CONTENT')
    ]});
    const definition = repositoryReportDefinition(report);
    const output = JSON.stringify(definition.content);
    expect(output).not.toMatch(/Materiały konfiguracji|group-CONTEXT|section-CONTEXT|UNIQUE-MATERIAL-CONTENT|Szczegóły w repozytorium/);
    expect(output.indexOf('PODLINKOWANE PLIKI')).toBeGreaterThan(output.indexOf('TREŚĆ'));
    const nodes = contentNodes(definition.content);
    const header = nodes.find(node => node['style'] === 'entry')!;
    expect(header['text']).toEqual([{text: 'review'}, expect.objectContaining({
      text: ' ↗', link: 'https://github.com/example/repository/blob/main/.github/skills/review/SKILL.md'
    })]);
    expect(header['link']).toBeUndefined();
    const list = nodes.find(node => typeof node['fontSize'] === 'number' && Array.isArray(node['stack'])
      && JSON.stringify(node['stack']).includes('PODLINKOWANE PLIKI'))!;
    const rows = contentNodes(list).filter(node => Array.isArray(node['ul']));
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows[0])).toContain('/blob/main/.github/skills/review/references/checklist.md');
    expect(JSON.stringify(rows[1])).toContain('treść poza migawką');
    expect(list['fillColor']).toBeUndefined();
  });

  it('keeps many linked files breakable and omits navigation when no repository URL can be resolved', () => {
    const references = Array.from({length: 40}, (_, index) => `[Reference ${index}](references/check-${index}.md)`).join('\n');
    const report = buildRepositoryReport({name: 'synthetic', complete: true, gitDetected: false,
      files: [configuration('.github/skills/review/SKILL.md', 'Review changes.\n' + references)]});
    const definition = repositoryReportDefinition(report);
    const nodes = contentNodes(definition.content);
    expect(nodes.filter(node => Array.isArray(node['ul']))).toHaveLength(40);
    expect(nodes.some(node => node['link'])).toBe(false);
    expect(nodes.some(node => node['unbreakable'] === true && Array.isArray(node['stack'])
      && contentNodes(node['stack']).filter(child => Array.isArray(child['ul'])).length > 1)).toBe(false);
    expect(JSON.stringify(definition.content)).not.toContain(' ↗');
  });

  it('does not bypass the excerpt limit through duplicated XML or ignore-file source fields', () => {
    const report = buildRepositoryReport({name: 'synthetic', complete: true, gitDetected: false, files: [], reportFiles: [
      {path: '.idea/workspace.xml', content: '<component name="GitHubCopilotSettings">' + 'x'.repeat(800) + 'END-XML</component>', bytes: 900, redacted: false, omissionReason: null},
      {path: '.aiignore', content: 'folder/\n'.repeat(30) + 'END-IGNORE', bytes: 250, redacted: false, omissionReason: null}
    ]});
    const output = JSON.stringify(repositoryReportDefinition(report).content);
    expect(output).not.toMatch(/END-XML|END-IGNORE/);
    expect(output.match(/"text":"TREŚĆ"/g)).toHaveLength(2);
  });
});

describe('repository PDF pagination', () => {
  it('preserves long paths and values without inserting whitespace or invisible separators', () => {
    const path = '.github/skills/repository-report-showcase/SKILL.md';
    const linked = '.github/skills/repository-report-showcase/references/checklist.md';
    const value = 'folder/' + 'x'.repeat(240) + '/configuration.json';
    const report = buildRepositoryReport({name: 'synthetic', complete: true, gitDetected: true, git,
      files: [configuration(path, '---\nname: repository-report-showcase\ndescription: Example\ncompatibility: ' + value
        + '\n---\n[Checklist](references/checklist.md)')]});
    const texts = contentNodes(repositoryReportDefinition(report).content).map(node => node['text']);
    expect(texts).toContain('/' + path);
    expect(texts).toContain('/' + linked);
    expect(texts).toContain(value);
    expect(JSON.stringify(texts)).not.toContain('\u200b');
  });

  it('renders headings with their first content and identifies every continued file, including source boxes', async () => {
    const [{default: pdfMake}, {default: vfs}, {default: mono}] = await Promise.all([
      import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts'), import('./fonts/report-mono')]);
    pdfMake.addVirtualFileSystem(vfs);
    pdfMake.addVirtualFileSystem(mono);
    pdfMake.addFonts({ReportMono: {normal: 'ReportMono.ttf', bold: 'ReportMono.ttf', italics: 'ReportMono.ttf', bolditalics: 'ReportMono.ttf'}});
    const report = buildRepositoryReport({name: 'synthetic-pagination', complete: true, gitDetected: false,
      files: [configuration('AGENTS.md', '# Rules\n' + 'Complete source paragraph. '.repeat(16)),
        configuration('.github/skills/review/SKILL.md', '---\nname: review\ndescription: Example\n---\n' + 'Source paragraph. '.repeat(24))]});
    const instructions = report.groups.find(group => group.id === 'INSTRUCTIONS')!;
    instructions.entries[0].details = [{label: 'Long declaration', value: Array.from({length: 70}, (_, index) => 'Line ' + index).join('\n')}];
    const skills = report.groups.find(group => group.id === 'SKILLS')!;
    skills.entries = Array.from({length: 8}, (_, index) => ({...skills.entries[0], name: 'Review ' + index,
      path: '.github/skills/review-' + index + '/SKILL.md'}));
    let passes = 0;
    const definition = await paginatedRepositoryReportDefinition(report, draft => {
      expect(++passes).toBeLessThan(35);
      return pdfMake.createPdf(draft).getBuffer();
    });
    const nodes = new Map<string, Node>();
    definition.pageBreakBefore = node => { if (node.id) nodes.set(node.id, node); return false; };
    await pdfMake.createPdf(definition).getBuffer();
    const continuationPages = new Set<number>();
    for (const [id, node] of nodes) {
      if (id.endsWith('-keep')) {
        const following = nodes.get(id.slice(0, -5) + '-next');
        if (following) expect(following.startPosition.pageNumber, id).toBe(node.startPosition.pageNumber);
      }
      if (/^preview-\d+$/u.test(id)) expect(node.pageNumbers, id).toHaveLength(1);
    }
    const size = {width: 595.28, height: 841.89, orientation: 'portrait' as const};
    for (const group of report.groups) for (const [index, entry] of group.entries.entries()) {
      const node = nodes.get('entry-' + group.id + '-' + index)!;
      for (const page of node.pageNumbers.filter(page => page > node.startPosition.pageNumber)) {
        continuationPages.add(page);
        if (typeof definition.header !== 'function') throw new Error('Expected dynamic header');
        const header = JSON.stringify(definition.header(page, node.pages, size));
        expect(header).toContain('ciąg dalszy');
        expect(header).toContain(entry.path);
        expect(header).toContain(entry.name);
      }
    }
    expect(continuationPages.size).toBeGreaterThan(0);
  }, 30_000);
});

describe('repository source links', () => {
  it('prefers the known GitHub branch over a potentially unpublished local commit and encodes each path segment', () => {
    expect(repositoryFileLink(git, '.github/agents/Przegląd #1.agent.md')).toBe('https://github.com/example/repository/blob/main/.github/agents/Przegl%C4%85d%20%231.agent.md');
    expect(repositoryFileLink({...git, branch: 'master'}, 'frontend/AGENTS.md')).toBe('https://github.com/example/repository/blob/master/frontend/AGENTS.md');
    expect(repositoryFileLink({...git, origin: 'github.com:example/repository.git'}, 'AGENTS.md')).toBe(repositoryFileLink(git, 'AGENTS.md'));
  });
  it('supports nested GitLab groups and encodes branch names even when a commit is also known', () => {
    expect(repositoryFileLink({...git, origin: 'ssh://git@gitlab.com/team/sub/repo.git'}, 'AGENTS.md')).toBe('https://gitlab.com/team/sub/repo/-/blob/main/AGENTS.md');
    expect(repositoryFileLink({...git, branch: 'feature/review', origin: 'https://github.com/example/repository.git'}, 'AGENTS.md')).toContain('/blob/feature%2Freview/AGENTS.md');
    expect(repositoryFileLink({...git, branch: 'feature/review', origin: 'https://gitlab.com/team/sub/repo.git'}, 'AGENTS.md')).toBe('https://gitlab.com/team/sub/repo/-/blob/feature%2Freview/AGENTS.md');
  });
  it('falls back to a valid commit only when the branch is missing, without guessing a default branch', () => {
    for (const branch of [null, '']) {
      expect(repositoryFileLink({...git, branch}, 'AGENTS.md')).toBe(`https://github.com/example/repository/blob/${git.commit}/AGENTS.md`);
    }
    expect(repositoryFileLink({...git, branch: null, origin: 'https://gitlab.com/team/repo.git'}, 'AGENTS.md')).toBe(`https://gitlab.com/team/repo/-/blob/${git.commit}/AGENTS.md`);
    expect(repositoryFileLink({...git, branch: null, commit: 'b'.repeat(64)}, 'AGENTS.md')).toContain('/blob/' + 'b'.repeat(64) + '/');
    expect(repositoryFileLink({...git, branch: null, commit: 'invalid'}, 'AGENTS.md')).toBeNull();
  });
  it('strips credentials and never guesses unsupported hosting, missing refs or unsafe paths', () => {
    expect(repositoryFileLink({...git, origin: 'https://user:synthetic-password@github.com/example/repository.git?token=secret'}, 'AGENTS.md')).toBe(repositoryFileLink(git, 'AGENTS.md'));
    for (const origin of ['https://example.invalid/repo.git', 'javascript:alert(1)', 'file:///repo', 'https://github.com:8443/team/repo.git']) {
      expect(repositoryFileLink({...git, origin}, 'AGENTS.md')).toBeNull();
    }
    for (const path of ['../secret', '/absolute', 'folder/../file', 'C:\\repo\\file']) expect(repositoryFileLink(git, path)).toBeNull();
    expect(repositoryFileLink({...git, commit: null, branch: null}, 'AGENTS.md')).toBeNull();
  });
});
