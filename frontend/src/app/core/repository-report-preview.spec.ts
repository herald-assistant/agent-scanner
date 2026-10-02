import {describe, expect, it} from 'vitest';
import {repositoryFileLink, repositoryFilePreview} from './repository-report-preview';
import type {ReportEntry} from './repository-report';
import {buildRepositoryReport} from './repository-report';
import {paginatedRepositoryReportDefinition, repositoryReportDefinition} from './repository-report-pdf';
import type {Node, NodeQueries} from 'pdfmake/interfaces';

const entry = (content: string, path = 'AGENTS.md'): ReportEntry => ({path, content, name: path, description: '',
  readable: true, redacted: false, bytes: content.length, details: [], notes: []});
const text = (preview: ReturnType<typeof repositoryFilePreview>): string => preview.blocks.map(block => block.spans.map(span => span.text).join('')).join('\n');
const git = {origin: 'git@github.com:example/repository.git', commit: 'a'.repeat(40), branch: 'main', availability: 'AVAILABLE' as const};

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
    expect(output.match(/FRAGMENT TREŚCI/g)).toHaveLength(1);
    expect(output.match(/Szczegóły w repozytorium/g)).toHaveLength(1);
    expect(output).toContain('/blob/' + git.commit + '/.vscode/mcp.json');
  });

  it('does not bypass the excerpt limit through duplicated XML or ignore-file source fields', () => {
    const report = buildRepositoryReport({name: 'synthetic', complete: true, gitDetected: false, files: [], reportFiles: [
      {path: '.idea/workspace.xml', content: '<component name="GitHubCopilotSettings">' + 'x'.repeat(800) + 'END-XML</component>', bytes: 900, redacted: false, omissionReason: null},
      {path: '.aiignore', content: 'folder/\n'.repeat(30) + 'END-IGNORE', bytes: 250, redacted: false, omissionReason: null}
    ]});
    const output = JSON.stringify(repositoryReportDefinition(report).content);
    expect(output).not.toMatch(/END-XML|END-IGNORE/);
    expect(output.match(/FRAGMENT TREŚCI/g)).toHaveLength(2);
  });
});

describe('repository PDF pagination', () => {
  it('moves a category that starts late and continues, then labels only its actual continuation pages', async () => {
    const report = buildRepositoryReport({name: 'synthetic', complete: true, gitDetected: false, files: [], reportFiles: []});
    const queries: NodeQueries = {getFollowingNodesOnPage: () => [], getPreviousNodesOnPage: () => [], getNodesOnNextPage: () => []};
    let passes = 0;
    const definition = await paginatedRepositoryReportDefinition(report, async draft => {
      const moved = ++passes > 1;
      const node = (id: string, pages: number[], top: number): Node => ({id, pageNumbers: pages, pages: 4, stack: true,
        startPosition: {pageNumber: pages[0], pageOrientation: 'portrait', top, left: 42,
          verticalRatio: 0, horizontalRatio: 0, pageInnerHeight: 710, pageInnerWidth: 511}});
      draft.pageBreakBefore!(node('section-JETBRAINS', moved ? [2, 3, 4] : [2, 3], 72), queries);
      draft.pageBreakBefore!(node('group-JETBRAINS', moved ? [3] : [2], moved ? 97 : 610), queries);
    });
    expect(passes).toBe(2);
    if (typeof definition.header !== 'function') throw new Error('Expected dynamic header');
    const size = {width: 595.28, height: 841.89, orientation: 'portrait' as const};
    expect(JSON.stringify(definition.header(3, 4, size))).not.toContain('ciąg dalszy');
    expect(JSON.stringify(definition.header(4, 4, size))).toContain('IntelliJ / JetBrains · ciąg dalszy');
  });
});

describe('repository source links', () => {
  it('pins GitHub links to the known commit and encodes each path segment', () => {
    expect(repositoryFileLink(git, '.github/agents/Przegląd #1.agent.md')).toBe(`https://github.com/example/repository/blob/${git.commit}/.github/agents/Przegl%C4%85d%20%231.agent.md`);
    expect(repositoryFileLink({...git, origin: 'github.com:example/repository.git'}, 'AGENTS.md')).toBe(repositoryFileLink(git, 'AGENTS.md'));
  });
  it('supports HTTPS and SSH GitLab origins with nested groups, and uses a branch only without a commit', () => {
    expect(repositoryFileLink({...git, origin: 'ssh://git@gitlab.com/team/sub/repo.git'}, 'AGENTS.md')).toBe(`https://gitlab.com/team/sub/repo/-/blob/${git.commit}/AGENTS.md`);
    expect(repositoryFileLink({...git, commit: null, branch: 'feature/review', origin: 'https://github.com/example/repository.git'}, 'AGENTS.md')).toContain('/blob/feature%2Freview/AGENTS.md');
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
