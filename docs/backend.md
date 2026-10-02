# Backend — kontrakt implementacji

Status: obowiązujący kontrakt.

[Dokumentacja](README.md)

## Backend development rules

### OTLP receiver

The receiver supports:

- `/v1/traces`, `/v1/metrics`, `/v1/logs`;
- `application/x-protobuf`, `application/protobuf`,
  `application/octet-stream`, and `application/json`;
- identity/no encoding and gzip;
- a limit on the decompressed payload.

Maintain protocol-compatible empty responses. Paused ingestion acknowledges valid
requests but does not persist them. Imported traces intentionally bypass pause.

When adding a new content type or encoding, test success and invalid input. Never
decompress into an unbounded buffer.

### Normalization

Normalize only stable fields needed for listing, grouping and common metrics. Keep
all other attributes in `attributes_json` and all events in `events_json`.

If a provider emits JSON values as strings, parse defensively and preserve the
original textual value when parsing fails. A malformed optional attribute must not
cause the entire OTLP batch to be lost.

Messages are extracted from:

- `gen_ai.input.messages` → direction `input`;
- `gen_ai.output.messages` → direction `output`;
- `gen_ai.tool.definitions` → direction `definition`.

Do not duplicate a user prompt beside request parts when it is already represented
inside messages.

### Persistence

H2 foreign keys use cascading deletes from signal/session to normalized records.
Deletion is destructive and is followed by `CHECKPOINT`. Retention deletes signal
batches older than the configured cutoff, cleans orphan sessions, checkpoints only
after actual deletion, starts after five minutes and runs daily.

Schema changes must be backward compatible with an existing local H2 database or
must include an explicit migration strategy. `schema.sql` with `IF NOT EXISTS` is
not a general migration tool.

Use parameterized SQL. Never interpolate telemetry values into queries.

### REST API

Current public endpoints are documented in [API HTTP](api.md). Keep frontend models in
`frontend/src/app/models/scanner.models.ts` synchronized with response fields.

Session export format is:

- `format: "agent-scanner-session"`;
- `version: 1`;
- normalized session view plus raw signals.

Import accepts Copilot's file exporter JSONL (public ReadableSpan records), not the
Scanner export. Preview is read-only; commit requires one `conversationId` from
the preview. Both operations enforce the configured payload limit. The selected
session and uniquely linked descendants are normalized together through the
existing trace ingestion, bypassing pause. Session ownership uses the same
explicit identities, ancestors and unambiguous trace fallback as OTLP ingestion.
Descendants require exact tool call ID joins; ambiguous and cyclic joins are excluded.
Only groups with an agent invocation or explicit conversation evidence are selectable;
detached auxiliary chats, tools and UI traces are not conversation candidates.
Detached technical groups with one explicit `copilot_chat.parent_chat_session_id`
matching a conversation are included as supporting data, separately from descendants.
Shared runtime `session.id` or timestamps never establish this import relationship.
Unassigned spans are counted in preview and omitted from the selected payload.
An existing selected conversation, descendant or trace/span ID returns HTTP 409.
Identical duplicate records are counted once; conflicting duplicates and malformed
lines reject the file before any writes. Non-span records are counted but not saved.
`raw_json` contains converted OTLP plus `sourceFormat: "copilot-otel-jsonl"` and
original selected objects in `fileRecords`, including unknown fields. `raw_payload`
contains their original JSONL lines joined with LF. No unrelated session is saved.
The file parser contract fixtures are `copilot-file-v1.jsonl` and
`copilot-file-detached-v1.jsonl`; a breaking export
change still requires a new export version and tests.

Return Polish, actionable errors from user-facing API operations. Do not expose a
stack trace or raw exception message by default.

## Adding support for another telemetry shape

1. Export one representative session from the technical view.
2. Remove prompt/code contents, repository URL, username paths, IDs, secrets and
   unique timestamps while preserving tree and attribute structure.
3. Record IDE/plugin version and the meaningful semantic differences.
4. Add a versioned fixture.
5. Extend backend normalization only for stable provider fields.
6. Verify session, interaction, round, tool and subagent correlation.
7. Verify token, cache, reasoning, TTFT, credit and error behavior.
8. Keep unknown fields available in raw telemetry.
9. Update operator setup instructions and known limitations.

Do not add provider-name conditionals when a semantic attribute or tree relation
can solve the problem generically.
