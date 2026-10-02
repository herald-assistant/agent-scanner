# Semantyka telemetrii

Status: obowiązujący kontrakt.

[Dokumentacja](README.md)

## Spis treści

- [Sygnał](#sygnał)
- [Sesja](#sesja)
- [Interakcja](#interakcja)
- [Runda](#runda)
- [Subagenci, wywołania pomocnicze i kompaktowanie](#subagenci-wywołania-pomocnicze-i-kompaktowanie)
- [Tokeny i credits](#tokeny-i-credits)
- [Potwierdzone błędy](#potwierdzone-błędy)
- [Pokrycie agregatów i rozdział warstw](#pokrycie-agregatów-i-rozdział-warstw)

## Sygnał

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

## Sesja

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

## Interakcja

An interaction is one user prompt and the work it triggers. On the frontend it is
grouped by trace ID. An `invoke_agent` span is the preferred root. Prompt lookup is:

1. `copilot_chat.user_request` on the root span;
2. a user input message attached to the root, excluding environment/context blobs;
3. an explicit “not emitted” fallback.

Multiple interactions may belong to one conversation/session. Never renumber all
rounds as if a new prompt did not establish a new interaction.

## Runda

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

## Subagenci, wywołania pomocnicze i kompaktowanie

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
When the invoke is in a separate trace and its structural parent is absent, the
explicit child/parent chat IDs may identify it only through one exact launching
execution whose call ID equals the child chat ID and whose conversation equals
the parent chat ID. The synthetic `copilot-file-detached-v1.jsonl` fixture covers
this case. A missing parent never authorizes a join by time or resource window.
Span-tree parent lookup uses `(traceId, spanId)` and stops cycles; the same span ID
in a different trace is not a parent.
Cost totals include the main episode and uniquely linked descendants once;
auxiliary requests remain separate. Never use a cumulative session error counter
as proof of the session's final outcome; label emitted cancellation separately.
An exact child episode with an invoke linked from a launching execution remains a subagent even
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
`frontend/src/scanner-core/auxiliary-model-calls.ts` (the old `app/core` import is a facade). Apply the same separation to
standalone auxiliary sessions and inline calls embedded in a primary trace. Keep
them out of primary round numbering and workflow totals, but available under the
owning session. A tool execution may move with an inline auxiliary call only when
an exact call ID proves the link, or when complete captured responses prove that
the tool name occurs exclusively in auxiliary output. Auxiliary requests below
the interaction list start collapsed.

## Tokeny i credits

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

## Potwierdzone błędy

Show a red round alert only when at least one of these is present:

- span status `STATUS_CODE_ERROR`;
- non-empty `error.type`;
- an `exception`, `error`, `*.error`, abort or failed-compaction event;
- a structured tool result with `isError=true`, `success=false`, `ok=false`, a
  failure status or non-zero exit code;
- a known tool-specific, unambiguous failure format already covered by tests.

Do not infer an error from latency, repeated instructions, cache misses, unusually
large input, missing telemetry or surprising model behavior.

## Pokrycie agregatów i rozdział warstw

Każda suma credits ma jawny zakres i pokrycie: `covered` to liczba wywołań
z wyemitowaną metryką, a `total` obejmuje wszystkie wywołania w zakresie.
Suma istnieje, gdy co najmniej jedno wywołanie ma pomiar. Brak pomiaru nie jest
wyemitowanym zerem. Estymowane fragmenty requestu nie zastępują jego pełnego
licznika telemetrycznego.

| Warstwa | Źródło | Oznaczenie |
|---|---|---|
| Fakt | Pole, zdarzenie lub przechwycona treść OTLP. | Brak pozostaje brakiem. |
| Wyliczenie | Jawna deterministyczna formuła na faktach. | Formuła i pokrycie dostępne do audytu. |
| Estymacja | Przybliżenie fragmentu lub podziału credits. | `≈` i ograniczenia metody. |
| Interpretacja | Wynik AI lub hipoteza rekomendacyjna. | Jawne pochodzenie, ograniczenia i droga do dowodu. |

Kategorie działań, grupowanie faz i przypisanie credits są zdefiniowane tylko
w [kontrakcie klasyfikacji](ai.md#klasyfikacja-działań). Uwzględnia on osobną
`Inicjalną wiadomość`, kompaktowanie i część `Poza kategoriami`; nie zastępuje
wyemitowanych credits wywołania pomiarem kosztu konkretnego narzędzia.

Dla użytkownika: [jak czytać sesję](uzytkowanie.md).
Fixture'y: [pochodzenie i kształty danych](../src/test/resources/fixtures/README.md).
