import {describe, expect, it} from 'vitest';
import {buildRepositoryReport} from './repository-report';
import {aiIdeaComponents, readGitMetadata, readReportFiles} from './repository-report-files';
import {categoryForPath, redactRepositoryText, RepositoryFile} from './standardization-files';

const file = (path: string, content: string, selected = true): RepositoryFile => ({path, content, selected,
  category: categoryForPath(path), bytes: new TextEncoder().encode(content).length, redacted: false,
  read: async () => new File([content], path)});
const base = {name: 'synthetic-repo', complete: true, gitDetected: false};

describe('repository configuration inventory', () => {
  it('does not turn missing IDE capture in an old snapshot into confirmed absence', () => {
    const report = buildRepositoryReport({...base, files: [file('AGENTS.md', 'Rules')]});
    expect(report.ideFileCount).toBeNull();
    expect(report.groups.find(group => group.id === 'VSCODE')!.complete).toBe(false);
    expect(report.groups.find(group => group.id === 'INSTRUCTIONS')!.complete).toBe(true);
  });
  it('reports all found mechanisms independently from AI selection and counts MCP servers without duplicating files', () => {
    const report = buildRepositoryReport({...base, files: [file('AGENTS.md', 'Shared rules', false),
      file('.github/skills/review/SKILL.md', '---\nname: review\ndescription: Przegląd zmian\ndisable-model-invocation: true\nunknown: preserved\n---\nProcedure'),
      file('.vscode/mcp.json', '{"servers":{"first":{"command":"node","args":[]},"second":{"url":"https://example.invalid/mcp"}}}')]});
    expect(report.configurationCount).toBe(3);
    expect(report.groups.find(group => group.id === 'INSTRUCTIONS')!.entries).toHaveLength(1);
    expect(report.groups.find(group => group.id === 'MCP')!.entries).toHaveLength(2);
    const skill = report.groups.find(group => group.id === 'SKILLS')!.entries[0];
    expect(skill.description).toBe('Przegląd zmian');
    expect(skill.details).toContainEqual({label: 'disable-model-invocation', value: 'true'});
    expect(skill.content).toContain('unknown: preserved');
  });

  it('keeps malformed metadata unresolved, preserves raw and does not claim absence after a partial scan', () => {
    const report = buildRepositoryReport({...base, complete: false, files: [file('.mcp.json', '{"mcpServers":{},"mcpServers":{}}'),
      file('.github/skills/broken/SKILL.md', '---\nname: broken\nname: duplicate\n---\nBody')]});
    expect(report.groups.find(group => group.id === 'MCP')!.entries[0].notes.join(' ')).toContain('powtórzone klucze');
    expect(report.groups.find(group => group.id === 'SKILLS')!.entries[0].notes.join(' ')).toContain('Nie odczytano');
    expect(report.notes.join(' ')).toContain('nie potwierdza jego nieobecności');
  });

  it('presents structured metadata compactly while preserving source, quoted whitespace and numeric precision', () => {
    const source = '{"mcpServers":{"review":{"options":[\n {"limit": 9007199254740993, "label": "a : b,  c", "enabled": false}\n]}}}';
    const report = buildRepositoryReport({...base, files: [file('.mcp.json', source),
      file('.github/agents/review.agent.md', '---\nagents: [Evidence Researcher]\nhandoffs:\n  - label: Review evidence\n    agent: Evidence Researcher\n    prompt: Review the collected evidence and separate availability from actual use.\n    send: false\n---\nReview instructions.')]});
    const server = report.groups.find(group => group.id === 'MCP')!.entries[0];
    expect(server.details).toContainEqual({label: 'options', value: '[{"limit": 9007199254740993, "label": "a : b,  c", "enabled": false}]'});
    expect(server.content).toBe(source);
    const agent = report.groups.find(group => group.id === 'AGENTS')!.entries[0];
    expect(agent.details).toContainEqual({label: 'agents', value: '["Evidence Researcher"]'});
    expect(agent.details).toContainEqual({label: 'handoffs', value: '[{"label": "Review evidence", "agent": "Evidence Researcher", "prompt": "Review the collected evidence and separate availability from actual use.", "send": false}]'});
    expect(agent.content).toContain('handoffs:\n  - label: Review evidence');
  });

  it('distinguishes recommended extensions and declared IDE settings from installation; preserves exact numeric source', () => {
    const report = buildRepositoryReport({...base, files: [], reportFiles: [
      {path: '.vscode/settings.json', content: '{// configuration\n"chat.sample":9007199254740993,"editor.fontSize":13,"[typescript]":{"github.copilot.enable":false},}', bytes: 100, redacted: false, omissionReason: null},
      {path: '.vscode/extensions.json', content: '{"recommendations":["GitHub.copilot","unrelated.extension"]}', bytes: 90, redacted: false, omissionReason: null},
      {path: '.noai', content: '', bytes: 0, redacted: false, omissionReason: null}
    ]});
    const vs = report.groups.find(group => group.id === 'VSCODE')!;
    expect(vs.entries[0].details).toContainEqual({label: 'chat.sample', value: '9007199254740993'});
    expect(vs.entries[0].details).toContainEqual({label: '[typescript] · github.copilot.enable', value: 'false'});
    expect(vs.entries[0].details.some(detail => detail.label === 'editor.fontSize')).toBe(false);
    expect(vs.entries[1].details).toEqual([{label: 'Zalecane rozszerzenie AI', value: 'GitHub.copilot'}]);
    expect(report.groups.find(group => group.id === 'JETBRAINS')!.entries[0].details[0].value).toContain('JetBrains AI Assistant');
    expect(report.notes[0]).toContain('Nie potwierdza instalacji');
  });

  it('reads only report paths and explicitly named AI XML components, redacts secrets and retains unknown AI attributes', async () => {
    const xml = '<project><component name="Unrelated"><option name="private" value="unrelated-private-data"/></component><component name="GitHubCopilotSettings"><option name="apiKey" value="synthetic-secret-value"/><option name="unknown" value="preserved"/></component></project>';
    expect(aiIdeaComponents(xml)).not.toContain('unrelated-private-data');
    const {files: result, complete} = await readReportFiles({...base, refreshable: false,
      entries: [file('.IDEA/workspace.xml', xml), file('package.json', '{}'), file('.vscode/settings.json', '{"github.copilot.token":"synthetic-secret-value"}')].map(item => ({path: item.path, read: item.read}))});
    expect(result.map(item => item.path)).toEqual(['.IDEA/workspace.xml', '.vscode/settings.json']);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-secret-value|unrelated-private-data/);
    expect(result[0].content).toContain('preserved');
    expect(complete).toBe(true);
    expect(redactRepositoryText('https://user:synthetic-password@example.invalid/repo')).not.toContain('synthetic-password');
    expect(redactRepositoryText('<option value="synthetic-secret-value" name="apiKey"/>')).not.toContain('synthetic-secret-value');
  });

  it('marks unreadable generic IDE XML as incomplete without claiming an AI configuration exists', async () => {
    const result = await readReportFiles({...base, refreshable: false, entries: [{path: '.idea/workspace.xml',
      read: async () => { throw new Error('UNREADABLE'); }}]});
    expect(result).toEqual({files: [], complete: false});
  });

  it('reads a packed branch ref and strips credentials/query from origin without needing Git objects', async () => {
    const commit = 'a'.repeat(40);
    const entries = [file('.git/HEAD', 'ref: refs/heads/main\n'), file('.git/packed-refs', commit + ' refs/heads/main\n'),
      file('.git/config', '[remote "origin"]\n url = https://user:synthetic-password@example.invalid/repo.git?token=synthetic-secret-value')];
    const metadata = await readGitMetadata({...base, refreshable: false, entries: [], gitEntries: entries.map(item => ({path: item.path, read: item.read}))});
    expect(metadata).toEqual({origin: 'https://example.invalid/repo.git', branch: 'main', commit, availability: 'AVAILABLE'});
    expect(await readGitMetadata({...base, refreshable: false, entries: []})).toEqual({origin: null, branch: null, commit: null, availability: 'UNAVAILABLE'});
  });
});
