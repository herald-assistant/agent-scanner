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

Import accepts only version 1, only trace signals, enforces the configured maximum
size and rejects duplicate `conversationId` with HTTP 409. A breaking export
change requires a new version and tests for both rejection and migration/import.

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
