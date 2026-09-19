import {describe, expect, it} from 'vitest';
import {SessionView, SpanRecord} from '../models/scanner.models';
import {analyzeSessionCapabilities} from './session-capability-analysis';

describe('analyzeSessionCapabilities', () => {
  it('separates catalogued, exposed and used capabilities using the S0 telemetry shape', () => {
    const rootPath = 'c:\\work\\playground';
    const system = `
      <instructions>
        <instruction>
          <file>${rootPath}\\.github\\instructions\\javascript.instructions.md</file>
          <description>JavaScript rules</description>
          <applyTo>**/*.mjs</applyTo>
        </instruction>
      </instructions>
      <skills>
        <skill><name>order-calculation</name><description>Order totals</description><file>${rootPath}\\.github\\skills\\order-calculation\\SKILL.md</file></skill>
        <skill><name>profile-skill</name><description>Personal</description><file>c:\\users\\me\\.agents\\skills\\profile-skill\\SKILL.md</file></skill>
      </skills>
      <agents>
        <agent><name>Adoption Coordinator</name><description>Coordinates</description></agent>
        <agent><name>Evidence Researcher</name><description>Researches</description></agent>
      </agents>
      <attachment filePath="${rootPath}\\.github\\copilot-instructions.md">root instructions</attachment>
      <attachment filePath="${rootPath}\\AGENTS.md">agent instructions</attachment>`;
    const root = span(1, 'invoke_agent', {
      'github.copilot.agent.type': 'builtin',
      'gen_ai.tool.definitions': JSON.stringify([
        {name: 'read_file'},
        {name: 'skill'},
        {name: 'mcp_agent-scanner_echo_adoption_marker'}
      ])
    });
    const chat = span(2, 'chat', {
      'gen_ai.system_instructions': JSON.stringify([{type: 'text', content: system}]),
      'gen_ai.tool.definitions': JSON.stringify([{name: 'read_file'}, {name: 'skill'}])
    });
    const skill = span(3, 'execute_tool', {
      'gen_ai.tool.name': 'skill',
      'github.copilot.tool.parameters.skill_name': 'order-calculation'
    });
    const scopedInstruction = span(4, 'execute_tool', {
      'gen_ai.tool.name': 'read_file',
      'gen_ai.tool.call.arguments': JSON.stringify({filePath: `${rootPath}\\.github\\instructions\\javascript.instructions.md`})
    });
    const source = detail([root, chat, skill, scopedInstruction]);
    const analysis = analyzeSessionCapabilities(view(source));

    expect(analysis.instructions.map(item => [item.kind, item.applied])).toEqual([
      ['agents-md', true],
      ['copilot-instructions', true],
      ['scoped-instructions', true]
    ]);
    expect(analysis.skills).toEqual([
      expect.objectContaining({name: 'order-calculation', scope: 'workspace', useCount: 1}),
      expect.objectContaining({name: 'profile-skill', scope: 'profile', useCount: 0})
    ]);
    expect(analysis.customAgents.map(agent => agent.name)).toEqual(['Adoption Coordinator', 'Evidence Researcher']);
    expect(analysis.customAgents.every(agent => agent.useCount === 0)).toBe(true);
    expect(analysis.tools).toEqual({
      availableNames: ['mcp_agent-scanner_echo_adoption_marker', 'read_file', 'skill'],
      exposedNames: ['read_file', 'skill'],
      usedNames: ['read_file', 'skill'],
      executionCount: 2
    });
    expect(analysis.mcp).toEqual({
      availableTools: ['mcp_agent-scanner_echo_adoption_marker'],
      exposedTools: [],
      usedTools: [],
      servers: [],
      executionCount: 0
    });
  });

  it('keeps missing content unknown while retaining structural use evidence', () => {
    const source = detail([
      span(1, 'invoke_agent', {'github.copilot.agent.type': 'custom'}),
      span(2, 'execute_tool', {
        'gen_ai.tool.name': 'skill',
        'github.copilot.tool.parameters.skill_name': 'known-only-from-use'
      }),
      span(3, 'execute_tool', {
        'gen_ai.tool.name': 'mcp_weather_forecast',
        'github.copilot.tool.parameters.mcp_server_name_hash': 'hash-1',
        'github.copilot.tool.parameters.mcp_tool_name': 'forecast'
      }),
      span(4, 'execute_tool', {
        'gen_ai.tool.name': 'runSubagent',
        'gen_ai.tool.call.arguments': JSON.stringify({agentName: 'Evidence Researcher'})
      })
    ], false);
    const analysis = analyzeSessionCapabilities(view(source));

    expect(analysis.contentCaptured).toBe(false);
    expect(analysis.systemInstructionsObserved).toBe(false);
    expect(analysis.skills).toEqual([expect.objectContaining({name: 'known-only-from-use', scope: 'unknown', useCount: 1})]);
    expect(analysis.customAgents).toEqual([
      expect.objectContaining({name: 'Custom agent główny', useCount: 1}),
      expect.objectContaining({name: 'Evidence Researcher', useCount: 1})
    ]);
    expect(analysis.mcp).toMatchObject({usedTools: ['forecast'], servers: ['hash-1'], executionCount: 1});
    expect(analysis.subagentInvocations).toBe(1);
  });
});

function span(id: number, operationName: string, attributes: Record<string, unknown>): SpanRecord {
  return {
    id, signalId: 1, traceId: 'trace', spanId: `span-${id}`, spanName: operationName,
    operationName, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    cacheCreationTokens: 0, reasoningTokens: 0, attributesJson: JSON.stringify(attributes), eventsJson: '[]'
  };
}

function detail(spans: SpanRecord[], contentCaptured = true) {
  return {
    session: {
      id: 1, conversationId: 'session', lastSeenAt: '2026-09-19T10:00:00Z', inputTokens: 0,
      outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
      turnCount: 1, toolCount: 0, errorCount: 0, contentCaptured
    },
    spans,
    messages: [],
    signals: []
  };
}

function view(source: ReturnType<typeof detail>): SessionView {
  return {
    source,
    relatedSource: [],
    tools: source.spans.filter(item => item.operationName === 'execute_tool'),
    primaryModelSpans: source.spans.filter(item => item.operationName === 'chat'),
    billingModelSpans: source.spans.filter(item => item.operationName === 'chat'),
    costGroups: [],
    modelTurns: [],
    interactions: [],
    contextCompactions: [],
    relatedModelCalls: [],
    assistantAnswer: '',
    toolDefinitionNames: [],
    contextualMessageCount: 0,
    madeFileChanges: false
  };
}
