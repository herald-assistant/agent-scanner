import {SessionView, SpanRecord} from '../app/models/scanner.models';

export type CapabilityScope = 'workspace' | 'profile' | 'unknown';
export type InstructionKind = 'copilot-instructions' | 'agents-md' | 'scoped-instructions';

export interface CapabilityEvidenceReference {
  spanId: number;
  field: 'gen_ai.system_instructions' | 'gen_ai.tool.definitions' | 'execute_tool';
}

export interface InstructionCapability {
  path: string;
  name: string;
  kind: InstructionKind;
  description?: string;
  applyTo?: string;
  applied: boolean;
  evidence: CapabilityEvidenceReference[];
}

export interface NamedCapability {
  name: string;
  description?: string;
  path?: string;
  scope: CapabilityScope;
  exposed: boolean;
  useCount: number;
  evidence: CapabilityEvidenceReference[];
}

export interface ToolCapabilitySummary {
  availableNames: string[];
  exposedNames: string[];
  usedNames: string[];
  executionCount: number;
}

export interface McpCapabilitySummary {
  availableTools: string[];
  exposedTools: string[];
  usedTools: string[];
  servers: string[];
  executionCount: number;
}

export interface SessionCapabilityAnalysis {
  contentCaptured: boolean;
  systemInstructionsObserved: boolean;
  instructions: InstructionCapability[];
  skills: NamedCapability[];
  customAgents: NamedCapability[];
  tools: ToolCapabilitySummary;
  mcp: McpCapabilitySummary;
  subagentInvocations: number;
  compactions: number;
}

interface CatalogEntry {
  name: string;
  description?: string;
  path?: string;
  evidence: CapabilityEvidenceReference;
}

interface ToolDefinition {
  name: string;
  description?: string;
}

const SUBAGENT_TOOL_NAMES = new Set(['runSubagent', 'execution_subagent']);

export function analyzeSessionCapabilities(view: SessionView): SessionCapabilityAnalysis {
  const details = [view.source, ...view.relatedSource];
  const spans = details.flatMap(detail => detail.spans);
  const modelSpans = spans.filter(span => span.operationName === 'chat');
  const rootSpans = spans.filter(span => span.operationName === 'invoke_agent');
  const toolSpans = spans.filter(span => span.operationName === 'execute_tool');
  const systemSources = modelSpans.flatMap(span => attributeTexts(span, 'gen_ai.system_instructions')
    .map(text => ({span, text})));
  const systemInstructionsObserved = systemSources.some(source => source.text.trim().length > 0);
  const workspaceRoots = workspaceRootCandidates(systemSources.map(source => source.text));

  const instructions = instructionCapabilities(systemSources, toolSpans);
  const skillCatalog = catalogEntries(systemSources, 'skill');
  const agentCatalog = catalogEntries(systemSources, 'agent');
  const skillUse = countBy(toolSpans
    .map(span => stringAttribute(span, 'github.copilot.tool.parameters.skill_name'))
    .filter((name): name is string => Boolean(name)));
  const customAgentUse = customAgentUsage(rootSpans, toolSpans);
  const rootDefinitions = definitions(rootSpans);
  const chatDefinitions = definitions(modelSpans);
  const availableDefinitions = mergeDefinitions(rootDefinitions, chatDefinitions);
  const usedToolNames = toolSpans.map(span => stringAttribute(span, 'gen_ai.tool.name'))
    .filter((name): name is string => Boolean(name));

  const availableMcp = availableDefinitions.filter(definition => isMcpTool(definition.name));
  const exposedMcp = chatDefinitions.filter(definition => isMcpTool(definition.name));
  const usedMcp = toolSpans.filter(isMcpExecution);
  const usedMcpNames = usedMcp.map(span => stringAttribute(span, 'github.copilot.tool.parameters.mcp_tool_name')
    ?? stringAttribute(span, 'gen_ai.tool.name')).filter((name): name is string => Boolean(name));
  const mcpServers = usedMcp.map(span => stringAttribute(span, 'github.copilot.tool.parameters.mcp_server_name')
    ?? stringAttribute(span, 'github.copilot.tool.parameters.mcp_server_name_hash'))
    .filter((name): name is string => Boolean(name));

  return {
    contentCaptured: view.source.session.contentCaptured,
    systemInstructionsObserved,
    instructions,
    skills: mergeNamedCapabilities(skillCatalog, skillUse, workspaceRoots),
    customAgents: mergeNamedCapabilities(agentCatalog, customAgentUse, workspaceRoots),
    tools: {
      availableNames: sortedUnique(availableDefinitions.map(definition => definition.name)),
      exposedNames: sortedUnique(chatDefinitions.map(definition => definition.name)),
      usedNames: sortedUnique(usedToolNames),
      executionCount: toolSpans.length
    },
    mcp: {
      availableTools: sortedUnique(availableMcp.map(definition => definition.name)),
      exposedTools: sortedUnique(exposedMcp.map(definition => definition.name)),
      usedTools: sortedUnique(usedMcpNames),
      servers: sortedUnique(mcpServers),
      executionCount: usedMcp.length
    },
    subagentInvocations: toolSpans.filter(span => SUBAGENT_TOOL_NAMES.has(stringAttribute(span, 'gen_ai.tool.name') ?? '')).length,
    compactions: view.contextCompactions.length
  };
}

function instructionCapabilities(
  systemSources: Array<{span: SpanRecord; text: string}>,
  toolSpans: SpanRecord[]
): InstructionCapability[] {
  const instructions = new Map<string, InstructionCapability>();
  const record = (path: string, kind: InstructionKind, span: SpanRecord, applied: boolean, description?: string, applyTo?: string) => {
    const normalized = normalizePath(path);
    if (!normalized) return;
    const existing = instructions.get(normalized);
    const reference: CapabilityEvidenceReference = {spanId: span.id, field: 'gen_ai.system_instructions'};
    if (existing) {
      existing.applied ||= applied;
      existing.description ??= description;
      existing.applyTo ??= applyTo;
      if (!existing.evidence.some(item => item.spanId === reference.spanId && item.field === reference.field)) existing.evidence.push(reference);
      return;
    }
    instructions.set(normalized, {
      path: normalized,
      name: basename(normalized),
      kind,
      description,
      applyTo,
      applied,
      evidence: [reference]
    });
  };

  for (const {span, text} of systemSources) {
    for (const attachment of tagBlocks(text, 'attachment')) {
      const path = tagAttribute(attachment.openingTag, 'filePath');
      const kind = path ? instructionKind(path) : undefined;
      if (path && kind) record(path, kind, span, true);
    }
    for (const block of tagBlocks(text, 'instruction')) {
      const path = tagValue(block.body, 'file');
      if (!path) continue;
      record(path, 'scoped-instructions', span, false, tagValue(block.body, 'description'), tagValue(block.body, 'applyTo'));
    }
  }

  for (const span of toolSpans) {
    if (stringAttribute(span, 'gen_ai.tool.name') !== 'read_file') continue;
    const argumentsValue = objectAttribute(span, 'gen_ai.tool.call.arguments');
    const path = typeof argumentsValue?.['filePath'] === 'string' ? normalizePath(argumentsValue['filePath']) : undefined;
    if (!path) continue;
    const instruction = instructions.get(path);
    if (!instruction) continue;
    instruction.applied = true;
    instruction.evidence.push({spanId: span.id, field: 'execute_tool'});
  }

  return [...instructions.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));
}

function catalogEntries(systemSources: Array<{span: SpanRecord; text: string}>, tag: 'skill' | 'agent'): CatalogEntry[] {
  const entries = new Map<string, CatalogEntry>();
  for (const {span, text} of systemSources) {
    for (const block of tagBlocks(text, tag)) {
      const name = tagValue(block.body, 'name')?.trim();
      if (!name || entries.has(name)) continue;
      entries.set(name, {
        name,
        description: tagValue(block.body, 'description')?.trim(),
        path: tagValue(block.body, 'file')?.trim(),
        evidence: {spanId: span.id, field: 'gen_ai.system_instructions'}
      });
    }
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function mergeNamedCapabilities(
  catalog: CatalogEntry[],
  usage: Map<string, number>,
  workspaceRoots: string[]
): NamedCapability[] {
  const entries = new Map<string, NamedCapability>();
  for (const item of catalog) {
    entries.set(item.name, {
      name: item.name,
      description: item.description,
      path: item.path ? normalizePath(item.path) : undefined,
      scope: capabilityScope(item.path, workspaceRoots),
      exposed: true,
      useCount: usage.get(item.name) ?? 0,
      evidence: [item.evidence]
    });
  }
  for (const [name, useCount] of usage) {
    const existing = entries.get(name);
    if (existing) {
      existing.useCount = useCount;
    } else {
      entries.set(name, {name, scope: 'unknown', exposed: false, useCount, evidence: []});
    }
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function customAgentUsage(rootSpans: SpanRecord[], toolSpans: SpanRecord[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const root of rootSpans) {
    if (stringAttribute(root, 'github.copilot.agent.type') !== 'custom') continue;
    const name = stringAttribute(root, 'github.copilot.custom_agent.name') ?? 'Custom agent główny';
    usage.set(name, (usage.get(name) ?? 0) + 1);
  }
  for (const span of toolSpans) {
    if (!SUBAGENT_TOOL_NAMES.has(stringAttribute(span, 'gen_ai.tool.name') ?? '')) continue;
    const args = objectAttribute(span, 'gen_ai.tool.call.arguments');
    const name = ['agentName', 'agent', 'name'].map(key => args?.[key]).find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (name) usage.set(name, (usage.get(name) ?? 0) + 1);
  }
  return usage;
}

function definitions(spans: SpanRecord[]): ToolDefinition[] {
  const result = new Map<string, ToolDefinition>();
  for (const span of spans) {
    const raw = attributes(span)['gen_ai.tool.definitions'];
    const parsed = parseJson(raw);
    if (!Array.isArray(parsed)) continue;
    for (const value of parsed) {
      if (!isRecord(value) || typeof value['name'] !== 'string') continue;
      const name = value['name'];
      if (!result.has(name)) result.set(name, {name, description: typeof value['description'] === 'string' ? value['description'] : undefined});
    }
  }
  return [...result.values()];
}

function mergeDefinitions(...groups: ToolDefinition[][]): ToolDefinition[] {
  const result = new Map<string, ToolDefinition>();
  for (const definition of groups.flat()) {
    const existing = result.get(definition.name);
    if (!existing || (!existing.description && definition.description)) result.set(definition.name, definition);
  }
  return [...result.values()];
}

function isMcpExecution(span: SpanRecord): boolean {
  const attrs = attributes(span);
  return typeof attrs['github.copilot.tool.parameters.mcp_tool_name'] === 'string'
    || typeof attrs['github.copilot.tool.parameters.mcp_server_name'] === 'string'
    || typeof attrs['github.copilot.tool.parameters.mcp_server_name_hash'] === 'string'
    || isMcpTool(String(attrs['gen_ai.tool.name'] ?? ''));
}

function isMcpTool(name: string): boolean {
  return name.startsWith('mcp_');
}

function workspaceRootCandidates(texts: string[]): string[] {
  const roots = new Set<string>();
  for (const text of texts) {
    for (const attachment of tagBlocks(text, 'attachment')) {
      const path = normalizePath(tagAttribute(attachment.openingTag, 'filePath') ?? '');
      const suffix = '/.github/copilot-instructions.md';
      if (path.toLowerCase().endsWith(suffix)) roots.add(path.slice(0, -suffix.length));
    }
  }
  return [...roots];
}

function capabilityScope(path: string | undefined, workspaceRoots: string[]): CapabilityScope {
  if (!path) return 'unknown';
  const normalized = normalizePath(path).toLowerCase();
  if (workspaceRoots.some(root => normalized.startsWith(`${root.toLowerCase()}/`))) return 'workspace';
  return 'profile';
}

function instructionKind(path: string): InstructionKind | undefined {
  const normalized = normalizePath(path).toLowerCase();
  if (normalized.endsWith('/.github/copilot-instructions.md')) return 'copilot-instructions';
  if (normalized.endsWith('/agents.md')) return 'agents-md';
  if (normalized.endsWith('.instructions.md')) return 'scoped-instructions';
  return undefined;
}

function attributeTexts(span: SpanRecord, key: string): string[] {
  const parsed = parseJson(attributes(span)[key]);
  return collectText(parsed).filter(text => text.trim().length > 0);
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') {
    const nested = parseJson(value);
    return nested === value ? [value] : collectText(nested);
  }
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (!isRecord(value)) return [];
  const direct = [value['content'], value['text']].filter((item): item is string => typeof item === 'string');
  return [...direct, ...collectText(value['parts'])];
}

function stringAttribute(span: SpanRecord, key: string): string | undefined {
  const value = attributes(span)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function objectAttribute(span: SpanRecord, key: string): Record<string, unknown> | undefined {
  const value = parseJson(attributes(span)[key]);
  return isRecord(value) ? value : undefined;
}

function attributes(span: SpanRecord): Record<string, unknown> {
  const parsed = parseJson(span.attributesJson);
  return isRecord(parsed) ? parsed : {};
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function tagBlocks(text: string, tag: string): Array<{openingTag: string; body: string}> {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi'));
  return [...matches].map(match => ({openingTag: match[0].slice(0, match[0].indexOf('>') + 1), body: match[1]}));
}

function tagValue(text: string, tag: string): string | undefined {
  return tagBlocks(text, tag)[0]?.body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

function tagAttribute(openingTag: string, attribute: string): string | undefined {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}="([^"]+)"`, 'i').exec(openingTag)?.[1]
    ?.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function normalizePath(path: string): string {
  return path.replace(/\\+/g, '/').replace(/\/{2,}/g, '/').trim();
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function countBy(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
