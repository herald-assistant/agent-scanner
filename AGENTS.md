# AGENTS.md — Agent Scanner development guide

## Scope and precedence

This file applies to the entire repository. Its purpose is to let another coding
agent continue development without rediscovering the product assumptions and the
telemetry semantics from scratch.

Follow, in order:

1. the current user request;
2. this file;
3. conventions already present in the closest source files.

Do not silently broaden a UI request into a change of telemetry semantics, data
retention, import format, or public API. Those boundaries require explicit intent
and proportionate tests.

## Product goal

Agent Scanner is a local observability tool for GitHub Copilot agent sessions. It
receives OTLP/HTTP from VS Code and JetBrains IDEs, stores raw telemetry, creates a
small normalized read model, and explains session cost and execution in Polish.

The core promise is **evidence before inference**:

- show values emitted by telemetry;
- derive only values with a deterministic formula;
- label missing data as missing, never as zero unless zero was actually emitted;
- preserve raw telemetry so derived UI can be audited;
- do not pretend to know provider behavior that the payload does not prove.

The application is not a model proxy, repository scanner, live IDE connection,
billing authority, or exact tokenizer.

## Technology baseline

- Java 17
- Spring Boot 3.4.x
- Spring MVC, JDBC and H2
- OpenTelemetry protobuf 1.7.0-alpha
- Angular 22 standalone application
- Angular Material and Material Symbols
- strict TypeScript and strict Angular templates
- Vitest through Angular's unit-test builder
- Maven as the full application build orchestrator

When upgrading dependencies, update the manifest and lockfile together and verify
both the standalone frontend build and the full Maven build. Do not describe a
version as “latest” in durable documentation; record the actual major/version in
the repository.

## Repository map

```text
.
├── AGENTS.md                         development contract (this file)
├── README.md                         operator and contributor documentation
├── pom.xml                           backend and full frontend build
├── src/main/java/dev/agentscanner
│   ├── AgentScannerApplication.java  Spring Boot entry point
│   ├── config/                       validated application properties
│   ├── otel/                         OTLP transport, decoding and normalization
│   ├── store/                        JDBC persistence and retention
│   └── api/                          REST read model plus import/export
├── src/main/resources
│   ├── application.yml               runtime defaults
│   └── schema.sql                    append/merge persistence schema
├── src/test                          integration tests and synthetic OTLP fixture
└── frontend
    ├── angular.json                  Angular build to target/classes/static
    ├── proxy.conf.json               /api and /v1 proxy to port 8080
    └── src/app
        ├── app.component.*            composition and application state
        ├── core/                       API, analysis and notification services
        ├── models/                     frontend REST/domain contracts
        ├── layout/                     application chrome
        └── features/                   feature-owned presentational components
```

## Runtime data flow

```text
GitHub Copilot exporter
  → POST /v1/{traces|metrics|logs}
  → OtlpController: content encoding, decompression and payload limit
  → OtlpIngestionService: protobuf/JSON parse, raw preservation, normalization
  → ScannerStore: H2 batches, sessions, spans, messages, metrics/events
  → ScannerApiController: stable JSON view under /api
  → ScannerApiService: transport boundary
  → SessionAnalysisService: UI-oriented deterministic grouping
  → feature components: dashboard, interaction timeline, round modal, raw view
```

Keep these layers distinct:

- transport concerns belong in `OtlpController`;
- normalization of OTel belongs in `OtlpIngestionService`;
- SQL belongs in `ScannerStore`;
- HTTP DTO shaping belongs in `ApiView`/`ScannerApiController`;
- cross-component session interpretation belongs in `SessionAnalysisService`;
- presentation-only formatting belongs in the owning feature component.

Do not move provider-specific parsing into Angular templates. Do not make the
backend emit Polish presentation strings.

## Domain model and telemetry semantics

### Signal batch

One request to an OTLP endpoint becomes a `telemetry_signal`. Store:

- signal type;
- receive time;
- content type and encoding;
- resource attributes;
- canonical full JSON;
- original decoded payload bytes;
- item count.

Raw storage is intentional. Never discard unknown attributes just because the UI
does not currently use them.

### Session

A session is primarily keyed by `gen_ai.conversation.id`. If unavailable, the
ingestion fallback is `trace:<traceId>`. `ScannerStore.upsertSession` merges later
batches and uses maxima for cumulative values. Before changing this behavior,
verify whether the provider sends cumulative or per-request metrics and add a
fixture demonstrating the desired result.

The session “connected” flag currently means `lastSignalAt != null`: telemetry has
been received and remains in the database. It is not a heartbeat and must not be
presented as a live IDE connection. The UI label is “Ostatnio odebrano telemetrię”.

### Interaction

An interaction is one user prompt and the work it triggers. On the frontend it is
grouped by trace ID. An `invoke_agent` span is the preferred root. Prompt lookup is:

1. `copilot_chat.user_request` on the root span;
2. a user input message attached to the root, excluding environment/context blobs;
3. an explicit “not emitted” fallback.

Multiple interactions may belong to one conversation/session. Never renumber all
rounds as if a new prompt did not establish a new interaction.

### Round

A round is one primary `chat` span within an interaction:

```text
agent request (A → M)
  → model text and zero or more tool calls (M → A)
  → tool execution by the agent
  → results may enter the next chat span
```

Tool executions following a model response are associated with that round using
their timestamps up to the start of the next `chat` span. The round modal must
show the exact request on the left and the exact model response/tool requests on
the right. Do not mix execution results into “what the model returned”.

### Subagents and auxiliary model calls

Subagents work like the primary agent and should receive equivalent round detail.
The launching tool is currently recognized by names `execution_subagent` and
`runSubagent`. Link a subagent only when `gen_ai.tool.call.id` matches a related
conversation/session ID. Do not correlate solely by temporal proximity.

Known technical/auxiliary agent names are centralized in
`SessionAnalysisService.isAuxiliarySession`. Keep them hidden from the primary
session list but available under the owning session. Auxiliary requests below the
interaction list start collapsed.

### Token and cost formulas

Use these definitions consistently across dashboard, interaction bars, round bars
and modal:

- total input: `gen_ai.usage.input_tokens`;
- cache read: `gen_ai.usage.cache_read.input_tokens`;
- fresh/new input: `max(0, inputTokens - cacheReadTokens)`;
- cache write: `gen_ai.usage.cache_creation.input_tokens`, only if emitted;
- output: `gen_ai.usage.output_tokens`;
- reasoning: maximum of `gen_ai.usage.reasoning.output_tokens` and
  `gen_ai.usage.reasoning_tokens` during ingestion;
- TTFT: `copilot_chat.time_to_first_token`;
- credits: `copilot_chat.copilot_usage_nano_aiu / 1_000_000_000`;
- context limit: `copilot_chat.request.max_prompt_tokens + gen_ai.request.max_tokens`;
- context usage at send time: the current round's `inputTokens`, not the next
  round's post-tool state.

Credits are GitHub Copilot AI credits, not currency. Never label them `cost`, `cr`
or a monetary amount. The UI labels are `CREDITS` and `Suma credits`.

Do not:

- estimate missing cache write from price or token deltas;
- compare a sum across rounds with a single current context window;
- add reasoning to output without provider evidence that it is excluded;
- claim exact per-request-part token counts;
- assign request parts to cache/fresh buckets from position or content similarity;
- infer model price from color or from the relative size of counters.

Per-request-part token values prefixed by `≈` are calibrated estimates for
navigation only. The full-request telemetry count remains authoritative.

### Deterministic error detection

Show a red round alert only when at least one of these is present:

- span status `STATUS_CODE_ERROR`;
- non-empty `error.type`;
- an `exception`, `error`, `*.error`, abort or failed-compaction event;
- a structured tool result with `isError=true`, `success=false`, `ok=false`, a
  failure status or non-zero exit code;
- a known tool-specific, unambiguous failure format already covered by tests.

Do not infer an error from latency, repeated instructions, cache misses, unusually
large input, missing telemetry or surprising model behavior.

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

Current public endpoints are documented in `README.md`. Keep frontend models in
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

## Frontend development rules

### Angular architecture

Use modern standalone Angular patterns:

- `ChangeDetectionStrategy.OnPush` for components;
- signal `input()` and `output()` APIs;
- `signal()`/`computed()` for local and derived state;
- `inject()` for services;
- built-in `@if`/`@for` control flow;
- strict types; avoid `any` and unsafe template casts.

Signal inputs are read-only signals. Bind with `[messages]="messages()"` and read
inside the child with `this.messages()`. Never assign to an input or use two-way
binding unless the component exposes a matching output.

`AppComponent` is the composition root. It may own polling, selected session/tab,
configuration visibility and orchestration. Do not move feature rendering or new
domain interpretation back into it. Prefer:

- pure/session-wide interpretation in `SessionAnalysisService`;
- network calls in `ScannerApiService`;
- snackbars in `NotificationService`;
- feature-specific formatting and expansion state in the feature component;
- dumb components with typed inputs and outputs for reusable presentation.

If a component grows beyond one coherent responsibility, split by feature rather
than by arbitrary template size. Keep its `.ts`, `.html`, `.css` and `.spec.ts`
together.

### Existing component ownership

- `TopbarComponent`: receiver status, configuration trigger and pause action.
- `SessionSidebarComponent`: primary session selection, import and destructive
  cleanup entry points.
- `CostDashboardComponent`: session totals and per-round records.
- `InteractionTimelineComponent`: interaction/round ordering, subagent and
  auxiliary call presentation, confirmed alerts, opening dialogs.
- `RoundDetailsDialogComponent`: exact A → M and M → A detail for one round.
- `TechnicalViewComponent`: filterable span tree and raw signal/span inspection.

Do not create pass-through components that add no semantic boundary. Do extract a
component when it owns behavior, state, a repeated visual contract or a testable
piece of domain presentation.

### Angular Material conventions

Use Angular Material for:

- `MatDialog` for detailed overlays;
- `MatTooltip` for every tooltip;
- `MatSnackBar` for transient success/error messages;
- `MatIcon` with Material Symbols;
- `MatSidenav` for the collapsible session panel.

Round/subagent details use a 95vw × 95vh dialog. Keep scrollbar space stable
(`scrollbar-gutter`) so expanding content does not shift the two columns.

Interaction controls follow these semantics:

- an eye opens a modal/new inspection surface;
- a chevron expands or collapses inline content;
- expansion controls do not carry redundant “Pokaż” text;
- all icon-only buttons require an accessible `aria-label` and, where useful, a
  Material tooltip;
- standardize information icon sizing through the shared `.info-tip` contract.

### UI language and hierarchy

The product UI is Polish. Use short, plain labels and preserve these terms:

- `Nowy input`
- `Input z cache` / `Cache read` according to the established location
- `Input łącznie`
- `Output`
- `Credits`
- `Okno przy wysłaniu`
- `Co dokładnie Agent przekazał modelowi`
- `Co zwrócił model`

Avoid duplicated headings or explanatory labels when structure already carries the
meaning. The modal should prioritize actual request parts and actual response data,
not implementation metadata.

Current semantic colors are part of the information design:

- fresh input: lime;
- cache read: cyan;
- output: its dedicated output color, distinct from fresh input;
- credits: warm/amber;
- cache write: violet;
- confirmed error: red;
- unavailable/estimated supporting data: neutral gray.

Reuse existing CSS variables/classes. Do not introduce a new color for the same
metric in one isolated component.

### Data visibility decisions

Preserve these product decisions unless the user explicitly changes them:

- the main view contains only `Koszt i przebieg` and `Dane techniczne` tabs;
- session KPI dashboard is shown in the cost/execution view, not duplicated in the
  technical view;
- request details and round token facts are not duplicated when already visible on
  the round bar;
- request params and incremental metadata start collapsed;
- request parts not resent because previous response state is retained are omitted
  from the initial request-part list;
- separate “previous round tool results” lists are omitted when the same content is
  available in messages;
- auxiliary requests are visible below interactions but initially collapsed;
- subagent modal shows the same round-level detail as the primary agent;
- transient errors and import results use snackbars, never banners at page top;
- all tooltips are Angular Material tooltips.

### Performance

Use `WeakMap` caches for repeatedly parsed span attributes and per-span parsed JSON,
as existing feature components do. Sort once at the analysis boundary when
possible. Avoid repeatedly parsing `attributesJson` from a template expression.

Large telemetry values must remain in constrained scroll containers. Do not render
all raw payloads expanded by default.

## Configuration UI

The configuration panel and onboarding offer a VS Code/IntelliJ IDEA switch.

VS Code shows a complete valid JSON object. IntelliJ shows form values, not JSON:

- OpenTelemetry export: enabled;
- collector endpoint: `http://localhost:8080`;
- protocol: `http/protobuf`;
- capture content: enabled when detailed content is desired.

If adding another IDE/provider, do not imply compatibility based only on the shared
OTLP transport. Add instructions, capture an anonymized fixture, verify grouping
and document semantic differences.

## Testing strategy

### Backend

`OtlpFlowIntegrationTest` is the primary end-to-end contract. It covers protobuf,
JSON, gzip, pause, malformed input, metrics/logs and export/delete/import.

For ingestion changes, add or extend a fixture that proves:

- exact attributes and tree shape;
- expected normalized session/span/message values;
- raw signal preservation;
- behavior across multiple batches if aggregation changes.

Use synthetic values by default. Provider regressions should use versioned,
anonymized fixtures with a short provenance/shape note in
`src/test/resources/fixtures/README.md`.

### Frontend

Add focused unit tests for:

- grouping interactions and rounds;
- subagent correlation;
- token/credit calculations;
- confirmed error detection;
- configuration switches and critical conditional content;
- expansion state where regressions are likely.

Prefer testing public component behavior and rendered output over private helper
implementation.

### Required verification

Run the smallest relevant checks during development, then the appropriate final
set:

```powershell
# frontend
cd frontend
npm test -- --watch=false
npm run build

# backend only
cd ..
mvn "-Dskip.frontend=true" test

# full integration/package when build wiring or dependencies changed
mvn clean package
```

On PowerShell quote Maven `-D...` arguments as shown. The Angular production build
writes to `target/classes/static`; do not commit generated output.

## Local development workflow

1. Inspect `git status` and preserve unrelated user changes.
2. Locate the owning layer/component before editing.
3. Inspect raw telemetry or fixture evidence before changing semantics.
4. Make the smallest coherent change.
5. Update TypeScript interfaces when the REST contract changes.
6. Add regression tests for formulas, grouping or ingestion behavior.
7. Run formatting/type/build checks through the normal project commands.
8. Review the final diff for accidental generated files, secrets and line-ending
   churn.
9. Update `README.md` and this file when commands, architecture or durable product
   rules change.

Use `rg`/`rg --files` for discovery. Use patch-based edits. Avoid destructive git
commands and never reset unrelated work.

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

## Privacy and destructive operations

Treat every raw payload, message, tool argument and tool result as potentially
sensitive. Never print real telemetry in test output or commit it unredacted.

Session deletion and full cleanup are intentionally explicit UI actions. Preserve
confirmation before destructive cleanup. Import and export may contain the same
sensitive content as the database; keep warnings visible and accurate.

Do not add outbound analytics, cloud upload or remote storage without explicit user
authorization and a documented privacy model.

## Definition of done

A change is complete when:

- it preserves evidence-first semantics;
- it lives in the correct architecture layer;
- missing telemetry is represented honestly;
- the UI is accessible, Polish and visually consistent;
- relevant tests pass;
- the production frontend builds when frontend code changed;
- backend tests pass when ingestion, storage or API code changed;
- docs reflect new setup, contracts or durable behavior;
- no generated output, real telemetry or secrets were added.
