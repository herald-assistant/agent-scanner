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
