# Fixtures

`CopilotTraceFixture` generates an anonymized OTLP/HTTP protobuf request with the documented
`invoke_agent`, `chat`, and `execute_tool` hierarchy. It deliberately contains no real source code,
credentials, repository URL, or user prompt.

This is a contract fixture, not evidence of the exact payload emitted by every VS Code or Copilot
version. When validating another runtime, export a real trace,
anonymize it, and add it here as a separate versioned fixture so regressions against that telemetry
shape can be tested. Preserve the span tree and semantic attribute names, but remove source code,
prompts, repository data, user paths, credentials, stable identifiers, and unique timestamps.

## copilot-episode-v1

`MixedEpisodeTraceFixture` and the frontend `mixed-episode.fixture.ts` reconstruct
the identifier/tree shape observed during a local VS Code Copilot audit. All IDs,
timestamps, model labels, prompts and payloads are synthetic. The exact extension
version was not captured, so this is evidence for the shape, not a version-wide
compatibility claim.

In one trace, an execution's call ID equals the child's `copilot_chat.chat_session_id`.
The child declares `copilot_chat.parent_chat_session_id`, its invoke span is a child
of that execution, and its chats point to that invoke span. Child chats retain the
parent's `gen_ai.conversation.id`, while child tools emit their own conversation ID.
The backend fixture tests both batch orders and separate deliveries. The frontend
fixture additionally reconstructs historical mixed session rows, includes a second
child in a separate trace, and verifies 14 + 2 + 16 rounds without double counting.

## copilot-file-v1

`copilot-file-v1.jsonl` is a synthetic contract fixture for the public
ReadableSpan JSON emitted by Microsoft's Copilot FileSpanExporter, checked against
[the exporter source](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/platform/otel/node/fileExporters.ts)
on 2026-10-02. It is not captured user telemetry or a claim about every extension
version. It contains two independent sessions, one exact-call-ID child using the
mixed episode identity shape, a span inheriting its ancestor's identity,
nanosecond timestamps, captured synthetic messages, unknown attributes and fields,
and non-span records. Tests cover read-only preview, reordered/mixed traces,
selected-tree persistence, raw preservation, duplicates, malformed files, conflicts,
payload limits and pause bypass.

## copilot-file-detached-v1

`copilot-file-detached-v1.jsonl` is synthetic and reproduces the structural evidence
observed in a local Copilot 0.68.0 file export on 2026-10-02. No captured identifiers,
timestamps, prompts, code or paths are retained. It contains one main conversation
(five spans, two rounds), an exact-call-ID child in another trace with no parent span
on its invocation (four spans, two rounds), and a detached title call with an explicit
parent chat ID. Two progress calls, one background call, two detached tools and one
UI event share the runtime window but have no conversation relationship. Tests verify
one selectable conversation, separate main/child/auxiliary counts, six unassigned spans,
ten selected spans, raw preservation and rejection of direct technical-trace selection.
A derived test rejects ambiguous parent references and technical-only candidates.

## Shared browser contract

`copilot-file-expectations-v1.json` contains preview expectations for both JSONL
fixtures. Java integration tests and TypeScript tests read the same preview and normalized-session expectations;
the frontend generates an ignored test module from these files before its tests.
The detached fixture also verifies browser reconstruction of the child in a
separate trace through its exact call ID and explicit chat/parent chat IDs, without
requiring a structural parent span across traces. Captured child rounds remain
primary child work even when the emitted agent name is `executionSubagentTool`.
