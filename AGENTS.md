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

For a new continuation task, start with
[`docs/kontynuacja/README.md`](docs/kontynuacja/README.md). It links the current
business goal, architecture, telemetry semantics, implemented workflow UI and
prioritized roadmap. This file remains the binding development contract.

## Product goal

Agent Scanner is a local observability tool for GitHub Copilot agent sessions. It
receives OTLP/HTTP from VS Code, stores raw telemetry, creates a
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
- Maven frontend toolchain: Node.js 22.22.3 (Angular 22 requirement)
- Optional text-only classification: GitHub Copilot Java SDK 1.0.11
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
├── docs/                             product and analysis specifications
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
    ├── proxy.conf.json               /api and /v1 proxy to port 8081
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
ingestion fallback is `trace:<traceId>`. Resolve ownership per span, not by the last
conversation ID in an OTLP batch. For the tested `copilot-episode-v1` shape, when
`copilot_chat.parent_chat_session_id` equals the raw conversation ID and a distinct
nonempty `copilot_chat.chat_session_id` is present, that chat ID identifies the
child's normalized session. Missing IDs may inherit a known ancestor in the same
batch, or the sole unambiguous identity in the trace batch; conflicting identities
must not be assigned by iteration order. Preserve all raw attributes unchanged.
`ScannerStore.upsertSession` merges later
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
their timestamps up to the start of the next `chat` span. User-facing flow is
presented as the initial interaction, then `M → A → M` cycles, then the final
response. A cycle detail shows the exact source model response/tool requests and
the exact receiving model request; keep execution results between those boundaries.
Do not mix execution results into “what the model returned”.

### Subagents and auxiliary model calls

Subagents work like the primary agent and should receive equivalent round detail.
The cost/execution timeline recognizes launching tools by names `execution_subagent`
and `runSubagent`. The dedicated `Mapa pracy` view uses generic joins between an
execution's `gen_ai.tool.call.id` and a child's raw `gen_ai.conversation.id`, without
tool-name inference. It rejects ambiguous joins and cycle-closing edges and counts
nested subtrees once. Do not correlate solely by temporal proximity.

Both execution and workflow views use `session-episodes.ts` to reconstruct episodes
across historical session rows. A nested invoke span may use the parent's raw
conversation ID: `copilot-episode-v1` requires its explicit chat/parent chat IDs to
match the launching execution and its structural parent before attributing its
descendant chats/tools to the child. This does not replace timestamp-based tool
assignment within an episode. No database rewrite is required for old sessions.
Cost totals include the main episode and uniquely linked descendants once;
auxiliary requests remain separate. Never use a cumulative session error counter
as proof of the session's final outcome; label emitted cancellation separately.
An exact child episode linked from `execution_subagent` remains a subagent even
when its chat spans use the technical agent name `executionSubagentTool`; do not
strip those spans as auxiliary calls before building workflow or cost totals.

A manually triggered context compaction may be emitted as a detached
`summarizeConversationHistory-full` chat without trace linkage to the primary
session. Treat the actual compaction call as the UI entity: prefer an exact primary
conversation ID present in the compactor input or explicit span IDs. A later
summary-shaped request is only evidence that the result was consumed, never the
identity or display gate for the compaction. The conservative fallback requires a
matching VS Code resource `session.id` and one uniquely matching later receipt.
Keep measured tokens, duration and credits in a separate compaction row rather than
adding them silently to primary round totals. Show calls without a later request at
the end of the timeline. Show the normalized span model on the row and in the
aside, with an explicit unknown fallback when it was not emitted. Clicking the row
opens the shared right-side aside with
the emitted system instructions as the rules and result format, the per-call
compaction instruction, optional manual user instruction, emitted messages and tool
definitions, result, and before/after context only when receipt is confirmed. Keep
those three instruction layers together under the user-facing “Co zlecono
modelowi” section instead of presenting system instructions as incidental raw data.

Known technical/auxiliary agent names are centralized in
`frontend/src/app/core/auxiliary-model-calls.ts`. Apply the same separation to
standalone auxiliary sessions and inline calls embedded in a primary trace. Keep
them out of primary round numbering and workflow totals, but available under the
owning session. A tool execution may move with an inline auxiliary call only when
an exact call ID proves the link, or when complete captured responses prove that
the tool name occurs exclusively in auxiliary output. Auxiliary requests below
the interaction list start collapsed.

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

The reasoning tooltip may show exact `copilot_chat.reasoning_content` from the
response span. Treat absent, blank, encrypted or redacted values as unavailable;
never reconstruct or infer hidden reasoning from token counts or model output.

Credits are GitHub Copilot AI credits, not currency. Never label them `cost`, `cr`
or a monetary amount. The UI labels are `CREDITS` and `Suma credits`.

Do not:

- estimate missing cache write from price or token deltas;
- compare a sum across rounds with a single current context window;
- add reasoning to output without provider evidence that it is excluded;
- claim exact per-request-part token counts;
- assign request parts to exact cache/fresh buckets from position or content
  similarity. The tool overview may show only its explicitly marked aggregate
  estimate for later exact-call-ID result occurrences, based on the receiving
  request's emitted cache-read ratio and bounded by the next compaction;
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

- `TopbarComponent`: receiver status, configuration trigger, local optimization
  guide entry point and pause action.
- `SessionSidebarComponent`: primary session selection, import and destructive
  cleanup entry points.
- `CostDashboardComponent`: session totals and per-round records.
- `ToolOptimizationOverviewComponent`: global, no-AI tool inventory below the
  session cost card. Its pure analysis lives in `core/tool-usage-analysis.ts` and
  compares directly captured definitions with captured model tool requests and
  exact-call-ID result occurrences. It separates unused and used tools into two
  tabs. The unused tab explains that definitions enter model input and therefore
  participate in Copilot AI credits usage, and points to the VS Code agent console
  plus agent `tools`/toolset configuration as places to test a narrower set.
  Definition estimates count every directly captured exposure. They use the
  definition's character share of captured request content multiplied by emitted
  input tokens; model-calibrated characters per token and finally 4.25 are
  fallbacks. Definitions use the cache-read cyan because repeated exposure is a
  likely cache optimization area, but copy must state that telemetry does not
  attribute a specific definition to cache. The definition tooltip explains that
  the displayed number already sums every round/request exposure and must not be
  multiplied by the round count again; it does not explain the color choice.
  Per-tool definition, invocation,
  first-result receipt and later-result cache values remain separate `≈` navigation
  estimates. Count an exact-call-ID result once on its first model receipt. For
  later captured occurrences before the next session compaction, estimate a
  separate cache-read share as `estimated result tokens × emitted cache read /
  emitted total input` for that receiving request and expose metric coverage.
  Missing cache metrics stay missing. Do not show a raw sum: order rows using the
  deliberately simplified `(definition + first result + estimated later cache)
  input tokens + 10 × invocation output tokens` priority. It is only a sorting
  aid; the card presents hypotheses to verify, never a command to disable a tool
  or a provider cost breakdown. For used tools, count every invocation after the
  first with the same tool name and canonical arguments across the whole linked
  session as a potential duplicate; agent and compaction boundaries do not reset
  this comparison. Calls without captured arguments are not comparable. Show only
  the count in the table and use red when it is greater than zero. The tool modal
  breaks this count down into repeats across agent streams, repeats after a
  compaction, and the mutually exclusive result states: identical, different
  or not captured. Compare results only through exact call-ID receipts. Normalize
  only the equivalent single-text-part transport wrapper before comparing content;
  do not normalize text, line order or substantive result structure. List the
  affected round labels (`M…`, `S…:M…`). For every duplicated signature, the modal
  also shows the full canonical input arguments, the first round, repeated rounds
  and repetition count; keep long JSON bounded and scrollable without silently
  truncating it. These are inspection signals, not proof of
  unnecessary work. The whole card starts collapsed and expands inline
  from an accessible chevron. Tool rows always use the same neutral white tool
  icon; state is not encoded by changing it to a power control. Only the
  `Niewykorzystane` status pill uses red emphasis.
- `ToolDefinitionDialogComponent`: factual modal opened by clicking a tool row's
  identity. It renders every captured canonical definition version as a readable
  description and top-level parameter contract, including required/optional state
  and enum values. The complete canonical JSON stays available in a collapsed
  disclosure so unsupported schema fields are never discarded or guessed. A tool
  observed only in a model request opens the same modal with an explicit missing
  definition state.
- `InteractionTimelineComponent`: interaction/round ordering, subagent and
  auxiliary call presentation, confirmed alerts, opening round details.
- `RoundDetailsDialogComponent`: exact initial request, `M → A → M` cycle or final
  model response, according to the selected flow boundary;
  `RoundDetailsAsideComponent` hosts that content in the shared right panel.
  Tool-result input messages correlate to earlier emitted tool requests by call ID
  and show the matched tool name, arguments and returned value without guessing
  missing links. Keep this as one flat card; the duplicate raw message starts
  collapsed under `Surowa wiadomość`.
- `TechnicalViewComponent`: filterable span tree and raw signal/span inspection.
- `OptimizationGuidanceComponent`: the no-AI technique
  catalog. It reads the validated `techniques-v1` resource through the local API,
  owns topic filtering, contextual measurement explanation, technique detail and
  the copyable trial plan, and opens in the shared right-side aside.
  `optimization-technique-matcher.ts` owns the deterministic category-to-technique
  mapping and deduplication. Keep editorial content in the versioned catalog, not
  duplicated in templates.
- `WorkflowViewComponent`: factual flow map, context pressure, exact delegation
  lanes, tool definitions and optional AI capability mapping. Its pure analysis lives
  in `WorkflowAnalysisService` and `core/workflow`, called through
  `SessionAnalysisService.buildWorkflow`. It reads raw attribute presence instead
  of normalized token defaults. `flow-tool-catalog.ts` collects captured M→A tool requests and
  canonical definition versions; `ToolClassificationService` keeps a small browser
  working cache, while the backend persists validated results per session and exact
  version/model/request hash. `ai/` owns the backend prompt,
  strict result validation, bounded worker and text-only Copilot lifecycle.
  `model-response.ts` parses model response envelopes for both classification and
  round detail; never reconstruct missing responses from executions.
  `model-action-evidence.ts` joins requests, executions, receiving inputs and child
  streams by exact call IDs within an episode/trace. Conflicting IDs/names stay
  unresolved. Credits stay on measured calls; linked recipients and subtrees are
  overlapping evidence, not additive components of an action's cost.
  Clicking a round node opens the same factual `M → A → M` round content used by
  the execution timeline in the shared right-side aside. AI classification remains
  on the map and is not included in this round-content panel.
  Do not duplicate selected-round measurements or generic interpretation/coverage
  cards below the map; round metrics belong in the shared round-content aside.
  The round-content aside provides previous/next round navigation in its header,
  scoped to the sequence represented by the opener.

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

The application-wide `MAT_ICON_DEFAULT_OPTIONS` provider belongs in
`app.config.ts`, with `material-symbols-outlined` as the font set. Do not scope it
only to routed components: dynamically created CDK overlays and `MatDialog`
components use the root environment injector and would otherwise render icon
ligature names as clipped text. Route and dialog tests should assert the resolved
font-set class.

Round, auxiliary-call and subagent details use the shared right-side aside. It
closes from its button, backdrop or Escape and restores focus to the trigger.
Keep scrollbar space stable (`scrollbar-gutter`) so expanding content does not
shift the two columns.

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

- the main view contains `Koszt i przebieg`, `Mapa pracy` and `Dane techniczne` tabs;
- below the `Koszt i przebieg` session card, a global no-AI tool overview should
  make otherwise hidden customization opportunities visible. It covers the main
  agent and uniquely linked subagents, separates `Niewykorzystane` and
  `Wykorzystane` into tabs, leads with tools whose definitions were captured but
  whose use was not observed, and ranks rows with the simplified input tokens plus
  ten times output tokens priority. For this purpose definitions, the first receipt
  of each exact-call-ID result and the separately estimated cache share of its later
  occurrences are input, while captured M→A tool requests are output. Do not
  display a combined invocation-plus-result column because it hides the weighting.
  A tool is
  labelled unused only when every model
  response in which its definition was directly observed has captured output;
  incomplete output stays unverified. Definition exposure, M→A invocation content,
  first exact-call-ID A→M result receipt and later retained-result cache are
  separate columns. Count the direct result once. Estimate cache only for later
  captured occurrences before the nearest following session compaction, using the
  receiving request's emitted `cache_read / input` ratio; show partial coverage and
  keep missing metrics as `—`. This is not proof that the provider cached a
  particular fragment. All per-part token totals use `≈`, do not convert to credits
  and remain hypotheses for a user experiment. The card starts collapsed; its
  neutral tool icon is identical for every state and the unused state is emphasized
  by a red pill. Clicking the tool identity opens its factual definition modal;
  multiple captured versions remain separate and full JSON stays inspectable. For
  used tools the table also shows a plain potential-duplicate count, red only above
  zero. The comparison is global across the linked session and uses exact tool name
  plus canonical captured arguments, without resetting at agent or compaction
  boundaries. The modal shows overlapping cross-agent and post-compaction counts,
  a disjoint identical/different/missing-result split based on exact call-ID
  receipts, and the affected `M…`/`S…:M…` round labels. Calls without captured
  arguments are excluded. For each duplicated argument signature the modal exposes
  readable canonical JSON together with its first and repeated rounds; no duplicate
  count proves inefficiency.
  The unused tab may explain
  that definitions are model input contributing to Copilot AI credits and where
  VS Code lets the user limit tools. Definition values use cache-read cyan to mark
  a repeated-input area worth checking. The tooltip stays calculation-focused:
  it says that the value already sums all rounds where the definition was exposed
  and omits any explanation of the color;
- the general `Techniki optymalizacji` guide is available from the topbar without
  a session or AI configuration. Opening, filtering and copying a trial plan must
  not invoke Copilot or send session data. Techniques are hypotheses to test and
  include quality checks, setup and maintenance costs rather than promised savings.
  The versioned local catalog contains the complete T01–T16 set; do not silently
  reduce it to the earlier six-technique pilot. Write every technique for a user
  who does not need to understand the agent–model loop: lead with the concrete
  cost problem, expected observable result and a before/after verification method.
  Examples must be practical, sufficiently detailed variants to try rather than
  short slogans;
- category and phase `Poznaj techniki` actions reuse that guide with an explicit
  scope, provenance, credits and coverage. They use only a saved classification
  and the static matcher; opening them never invokes AI. Category credit shares
  remain marked `≈`, phase credits are full emitted model-call credits, and
  compaction offers a separate telemetry-based entry even without classification;
- contextual optimization guidance links only to exact round or compaction
  evidence already present in the session. Evidence opens in the existing factual
  aside above the guide; `Wróć do techniki` must preserve the selected technique,
  disclosure state and guide scroll. Do not turn the phase card itself into an
  inspection control;
- a phase or exactly one compaction can prepare a local, frozen
  `optimization-advice-v1` preview without invoking AI. The frontend evidence
  builder keeps emitted, derived, prior-AI and missing values distinct; records
  truncation/omission, strips system/developer messages and explicit reasoning,
  redacts recognized secrets and hashes the canonical package. The current source
  pointers refer to normalized records and must be validated against retained raw
  signals on the backend before any send action is enabled. Preview, refresh and
  inspecting exact JSON never invoke Copilot. For a multi-round phase,
  `guidance-evidence-v2` represents every selected round with one compact,
  backend-validated cost summary and optional field-level AI classification.
  Raw content is a deterministic sample across the phase: first, last, highest
  known credits and the most tool-heavy or confirmed-error round; definitions are
  deduplicated and omissions are grouped by content kind. Never return to taking
  the first N fragments or counting repeated fields on one span as separate source
  references. Local counts of rounds, observations, references, fragments or
  characters are not analysis eligibility gates. They may drive deterministic
  sampling and remain visible in the preview, but only the configured model/provider's
  actual context-window enforcement may reject the complete advisory prompt as too
  large. Do not reintroduce character-count proxies for a tokenized context window;
- the workflow map can open `Rozmowa o sesji` directly or with one continuous
  range as an optional focus. Opening the modal and creating the local chat do not
  invoke inference. The backend freezes the whole reconstructed session at one
  `cutoffSignalId`, builds a small bootstrap and keeps selected rounds only as a
  point of attention. The first explicit question creates a persistent Copilot SDK
  session and later questions resume it. The assistant may call only the bounded,
  read-only `scanner_*` custom tools backed by `SessionAnalysisQueryService`; tools,
  MCP, skills, custom agents, repository access, host Git, filesystem, memory and
  discovery from the observed session remain disabled. REST and SDK adapters share
  the same query service. Store every tool call and the exact bounded result, and
  accept answer evidence only when its reference was present in the bootstrap or a
  result actually returned to the model. Newer telemetry never silently expands an
  existing chat. The removed round-only discussion contract has no compatibility
  or migration path;
- the workflow map leads with the emitted user request and a visual round/agent
  path; numeric tables and raw payloads start collapsed;
- workflow summary counters explicitly distinguish the whole linked agent session
  from the currently selected interaction. Compaction model calls are not agent
  rounds and remain outside the action-classification count; show their number
  separately and render exactly linked compactions as cyan event buttons at the
  relevant interaction boundary on the detailed map. The same primary lane starts
  with a lime user-interaction button, while its last `M…` node is styled orange
  and represents the final response without a duplicate end node. These nodes open
  the same factual request, compaction and response asides as the execution timeline;
- long workflow maps expose visible horizontal navigation in addition to drag and
  native scrolling. Subagent lanes use stable `Subagent N` labels with the emitted
  agent name as supporting text. Short maps keep fixed-width columns and must not
  stretch SVG points, text or paths to fill the viewport;
- the workflow `Tokeny` layer shows fresh input, cache read, output and emitted
  cache write as vertically stacked cumulative charts. Each metric has its own
  vertical scale and visible values at measured points; do not flatten smaller
  series by sharing the cache-dominated scale;
- no input/output heuristic profiles or bands are shown in the map; AI is invoked
  only by an explicit button. `model-actions-v5` classifies requested tool
  definitions into capabilities/specialization and each M→A request into fixed
  action sets. Search and read are one `ACQUIRE_DATA` action. Round actions must
  equal the union of their request actions.
  Goals inform fit only; later outcomes never determine response classification.
  Agent profiles count actions in their own rounds, not semantic roles or descendants.
  The classification summary leads with the category carrying the largest estimated
  credit attribution and a cautious category-specific direction to investigate,
  followed by a ranked list. Technical attribution details start collapsed.
  The classified overview orders primary and subagent calls together and groups
  adjacent rounds with identical action sets into noninteractive phases. Each phase
  lists its participating main/subagent round labels and sums their emitted credits;
  partial sums expose round coverage and fully missing values remain `—`. The
  detailed round/subagent map starts expanded.
  Counts/errors/links stay factual. The screen presents initial interaction,
  `M → A → M` cycles and final response.
  Credits remain on emitted model calls. Category credits are a UI estimate marked
  `≈`: split each known call by emitted input/output tokens, allocate the full
  output portion to classified requests and the full input portion to exact-call-ID
  result occurrences. Use characters/4.25 only as relative weights when multiple
  elements share a portion. Show request, first receipt and retained-result portions
  in collapsed details. Split a multi-action request equally, keep portions without
  category evidence as `Poza kategoriami`, expose call coverage and reconcile
  estimated categories plus remainder to known credits.
  Child calls are allocated to their own actions; delegation may show their exact
  known subtree total only as a non-additive roll-up. Exactly linked compaction
  calls remain outside the AI request and action classification, but the category
  view adds them locally as `Kompaktowanie kontekstu`: their emitted credits enter
  the common denominator without `≈`, and each call appears chronologically as a
  factual compaction card in the aggregated flow. AI-derived action shares remain
  marked `≈` and are rescaled against that same denominator;
- definitions/goals have an inspectable preview. Missing or conflicting definition
  versions leave specialization unknown, but visible request arguments can still
  support an action classification. Generic capability does not imply poor fit, and fit
  never proves execution quality or savings. See docs/klasyfikacja-narzedzi-ai.md;
- preparing optimization advice is a local, non-inference step. The frontend builds
  one `optimization-advice-v1` package for an exact phase or one compaction, and
  `POST /api/ai/optimization-advice/prepare` validates versions, limits, techniques,
  source metrics, raw-signal membership, the full normalized-source hash and the
  source-session relationship before freezing it for 30 minutes. The UI must say
  that this is locally verified and not sent to AI; preparation must never call
  `CopilotCompletion`;
- optimization advice runs only after the explicit `Wyślij do AI` action on a
  backend-verified, unexpired preview. The execution request contains only the
  `previewId`; the backend reloads the frozen package, revalidates source
  immutability before inference and before persistence, and validates the strict
  `optimization-advice-v1` result. Classification and advice share the single
  global `AiExecutionCoordinator`. Advice has no tools, skills, repository access,
  discovery, memory or automatic retry. Present proposals as experiments with
  conditions, setup, maintenance, quality checks, comparison and limitations;
  never promise savings. `INSUFFICIENT_EVIDENCE` and `NO_SUITABLE_TECHNIQUE` are
  valid outcomes. Status and cache lookup never invoke AI;
- successful compaction/rehydration classification remains gated on an anonymized
  emitter fixture; the map may show the emitted compaction event without claiming
  success or rehydration. A uniquely linked detached compaction call contributes
  its emitted input, cache, output, reasoning, duration and credits even when no
  later main request exists. The main row stays cost-focused; the shared aside
  leads with all emitted instruction layers, then shows the actual compaction
  request parts and result. Deterministic before/after
  measurements appear only when the result is observed in a later request. Do not
  present an input drop alone as proof or infer any missing cost component;
- session KPI dashboard is shown in the cost/execution view, not duplicated in the
  technical view;
- the dashboard's `Cała sesja` row is the disjoint sum of the main agent, uniquely
  linked subagents and compaction calls. Below it, an initially collapsed cost
  breakdown lists the main agent, then subagents chronologically, then compactions
  chronologically, using identical fresh input, cache read, cache write, output,
  model time and credits columns. Do not restore a separate compaction summary with
  redundant `Input + output` and `Input łącznie` cards. Wall-clock session duration
  stays in the header; the comparable time column sums emitted model-call durations;
- request details and round token facts are not duplicated when already visible on
  the round bar;
- round bars show `CACHE WRITE` beside output when at least one round in that
  displayed list explicitly emitted the metric; rounds without it show `—`;
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

The final value returned by a subagent must not be truncated. Keep the complete
`gen_ai.tool.call.result` in a bounded, independently scrollable container.

## Configuration UI

The configuration panel and onboarding support VS Code and show a complete valid
JSON object with OpenTelemetry export enabled, collector endpoint
`http://localhost:8081`, protocol `http/protobuf`, and content capture enabled.

If adding another provider, do not imply compatibility based only on the shared
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

The authorized optional workflow classification sends unique requested-tool
definitions, emitted agent goals, recursively shortened tool arguments and up to
1000 characters of captured model output per round to Copilot after the user clicks
its button. Do not send full requests, tool execution results or credentials in the
prompt. Execution outcomes, confirmed errors/compactions and recipient credits
remain local. Missing definitions do not drop requests; use a null tool ID.
The token is backend-only, read from application properties; local
config/application.properties is ignored by Git. Never run a paid prompt at startup
or in normal tests. No tools, skills, MCP or repository discovery are enabled for
the classification session. Keep model interpretations separate from raw telemetry.

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
