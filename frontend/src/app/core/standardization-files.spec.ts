import {describe, expect, it, vi} from 'vitest';
import {categoryForPath, discoverRepository, redactRepositoryText, RepositorySelection, selectionFromFiles} from './standardization-files';

function selected(entries: Record<string, string>): RepositorySelection {
  return {name: 'synthetic-repo', complete: true, gitDetected: true, refreshable: true,
    entries: Object.entries(entries).map(([path, text]) => ({path, read: async () => new File([text], path)}))};
}
describe('repository files for standardization', () => {
  it('recognizes all five mechanisms and alternate skill directories', () => {
    expect(categoryForPath('.github/copilot-instructions.md')).toBe('INSTRUCTIONS');
    expect(categoryForPath('backend/AGENTS.md')).toBe('INSTRUCTIONS');
    expect(categoryForPath('.agents/skills/review/SKILL.md')).toBe('SKILLS');
    expect(categoryForPath('.github/agents/review.agent.md')).toBe('AGENTS');
    expect(categoryForPath('.vscode/mcp.json')).toBe('MCP');
    expect(categoryForPath('.github/prompts/review.prompt.md')).toBe('PROMPTS');
    expect(categoryForPath('frontend/package.json')).toBe('CONTEXT');
    expect(categoryForPath('src/app.ts')).toBe('CONTEXT');
  });
  it('selects configuration and directly linked configuration materials without following further links', async () => {
    const materials = [
      '.github/instructions/reference.md', '.github/skills/review/references/checklist.md',
      '.github/agents/references/review.txt', '.github/prompts/references/naming.md',
      '.claude/skills/review/reference.txt', '.claude/agents/references/review.md', '.agents/skills/review/reference.md'
    ];
    const selection = selected({
      'AGENTS.md': materials.map(path => '[materiał](' + path + ')').join('\n'),
      ...Object.fromEntries(materials.map(path => [path, 'Opis odpowiedzialności. [Dalszy szczegół](unused.md)'])),
      '.github/instructions/unused.md': 'Materiał nie jest podlinkowany bezpośrednio z konfiguracji.',
      '.github/skills/review/unused.md': 'Materiał nie jest podlinkowany.',
      'src/not-referenced.ts': 'Nie czytaj.'
    });
    const unused = selection.entries.filter(entry => entry.path.includes('unused') || entry.path.startsWith('src/'))
      .map(entry => vi.spyOn(entry, 'read'));
    const result = await discoverRepository(selection);
    expect(result.files.map(file => file.path)).toEqual(['AGENTS.md', ...materials]);
    expect(result.files.slice(1).every(file => file.category === 'CONTEXT')).toBe(true);
    expect(result.files.every(file => file.selected)).toBe(true);
    for (const read of unused) expect(read).not.toHaveBeenCalled();
  });
  it('does not read technology manifests, workflows, source code or project documentation even when linked', async () => {
    const excluded = [
      'package.json', 'frontend/package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'Cargo.toml',
      'README.md', 'docs/architecture.md', '.github/workflows/check.yml', '.github/workflows/check.yaml',
      'src/app.ts', '.github/skills/review/scripts/check.py', '.github/skills/review/scripts/check.sh',
      '.github/skills/review/package.json', '.github/skills/review/settings.yaml', '.github/README.md'
    ];
    const instructions = excluded.map(path => '[materiał](' + path + ')').join('\n');
    const selection = selected({'AGENTS.md': instructions, ...Object.fromEntries(excluded.map(path => [path, 'Nie czytaj.']))});
    const excludedReads = selection.entries.slice(1).map(entry => vi.spyOn(entry, 'read'));
    const result = await discoverRepository(selection);
    expect(result.files.map(file => file.path)).toEqual(['AGENTS.md']);
    expect(result.files[0].content).toBe(instructions);
    for (const read of excludedReads) expect(read).not.toHaveBeenCalled();
    expect(result.complete).toBe(true);
  });
  it('does not follow external links, env files or references outside the folder', async () => {
    const result = await discoverRepository(selected({
      'AGENTS.md': '[env](.env) [escape](../outside.md) [remote](https://example.invalid/a.md)',
      '.env': 'DO_NOT_SEND=test-value'
    }));
    expect(result.files.map(file => file.path)).toEqual(['AGENTS.md']);
  });
  it('makes unreadable and oversized files explicit instead of selecting empty content', async () => {
    const selection = selected({'AGENTS.md': 'x'.repeat(131_073)});
    selection.entries.push({path: '.mcp.json', read: async () => { throw new Error('private path'); }});
    const result = await discoverRepository(selection);
    expect(result.files.every(file => !file.selected && file.error)).toBe(true);
    expect(result.files.find(file => file.path === 'AGENTS.md')?.omissionReason).toBe('TOO_LARGE');
    expect(JSON.stringify(result)).not.toContain('private path');
  });
  it('keeps line mapping while masking recognized credentials and preserving variable references', () => {
    const fake = 'ghp_' + 'x'.repeat(32);
    const raw = 'token: ' + fake + '\napi_key: $COPILOT_MCP_KEY\npassword: "synthetic-password"\n';
    const result = redactRepositoryText(raw);
    expect(result).not.toContain(fake);
    expect(result).not.toContain('synthetic-password');
    expect(result).toContain('$COPILOT_MCP_KEY');
    expect(result.split('\n')).toHaveLength(4);
  });
  it('uses relative browser paths and excludes nested repositories and dependency content', () => {
    const file = (path: string) => {
      const value = new File(['test'], path.split('/').at(-1)!);
      Object.defineProperty(value, 'webkitRelativePath', {value: 'repo/' + path});
      return value;
    };
    const result = selectionFromFiles(['.git/config', 'AGENTS.md', 'node_modules/pkg/AGENTS.md', 'nested/.git/config', 'nested/AGENTS.md'].map(file));
    expect(result.gitDetected).toBe(true);
    expect(result.entries.map(entry => entry.path)).toEqual(['AGENTS.md']);
  });
});
