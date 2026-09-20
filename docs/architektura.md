# Architektura

Status: aktualna dokumentacja.

[Dokumentacja](README.md)

## Spis treści

- [Przepływ danych](#przepływ-danych)
- [Backend](#backend)
- [Dane trwałe](#dane-trwałe)
- [Frontend](#frontend)
- [Wersje i źródła](#wersje-i-źródła)

## Przepływ danych

```text
GitHub Copilot w VS Code
  → OTLP/HTTP → OtlpController → OtlpIngestionService
  → ScannerStore / H2: raw telemetry + model znormalizowany
  → SessionReconstructionService: sesja, epizody i źródła
  → REST /api → ScannerApiService → analizy i widoki Angular

Jawne funkcje AI:
AI Hub / poradnik → kontroler AI → AiExecutionCoordinator
  → CopilotCompletion / Copilot CLI → walidacja → zapis H2
Rozmowa → SessionAnalysisQueryService → tylko odczytowe narzędzia scanner_*
```

Normalizacja stabilnych pól odbywa się przy odbiorze. Pełny raw payload pozostaje
dostępny do audytu. Backend współdzieli deterministyczną rekonstrukcję i celowane
odczyty pomiędzy REST i narzędzia analityka. Angular buduje prezentację sesji,
diagramy oraz lokalne estymacje na podstawie danych i ich jawnej obecności.

## Backend

| Warstwa | Właściciel | Odpowiedzialność |
|---|---|---|
| Transport | `otel/OtlpController` | Content type, gzip, limit rozpakowanego payloadu i odpowiedzi OTLP. |
| Normalizacja | `otel/OtlpIngestionService` | JSON/protobuf, tożsamość per span, stabilne pola, messages i zachowanie raw. |
| Persystencja | `store/ScannerStore`, `schema.sql` | Parametryzowany SQL, scalanie sesji, retencja, import/export i zapis audytu. |
| Rekonstrukcja | `analysis/SessionReconstructionService` | Wersjonowany model epizodów, interakcji, rund, narzędzi i źródeł workflow. |
| Odczyty analityczne | `analysis/SessionAnalysisQueryService` | Wspólna logika REST i odczytów rozmowy w zamrożonym zakresie. |
| HTTP | `api/ApiView`, kontrolery | DTO, parametry, odpowiedzi i błędy operacji. |
| AI | `ai/`, `ai/advisory/`, `ai/sessionchat/` | Prompt, izolowany runtime, walidacja, cache i lifecycle rozmowy. |

Kod backendu znajduje się w [src/main/java/dev/agentscanner](../src/main/java/dev/agentscanner).
Parsowanie zależne od emitera nie należy do szablonów Angulara. SQL należy do
store, a formatowanie prezentacyjne do właściciela funkcji. Backend nie generuje
polskich etykiet prezentacyjnych; błędy operacji użytkownika są po polsku.

## Dane trwałe

| Tabele | Zawartość |
|---|---|
| `telemetry_signal` | Oryginalny payload, pełny JSON i metadane requestu. |
| `agent_session`, `span_record`, `message_record`, `metric_or_event` | Mały model odczytowy powiązany z raw sygnałami. |
| `tool_classification_result` | Zwalidowane klasyfikacje dla dokładnego request hash. |
| `optimization_advice_preview`, `optimization_advice_result` | Zweryfikowane migawki i wyniki doradztwa. |
| `session_chat`, `session_chat_turn`, `session_chat_tool_call`, `session_chat_evidence` | Zakres rozmowy, historia, audyt i referencje udostępnione modelowi. |

[Schema SQL](../src/main/resources/schema.sql) zachowuje kaskadowe usuwanie.
`IF NOT EXISTS` nie zastępuje migracji istniejących kolumn. Wygasłe podglądy
doradztwa są sprzątane przy zapisaniu następnej migawki.
[Kontrakt persystencji i transportu](backend.md).

## Frontend

`AppComponent` i `ScannerShellStateService` odpowiadają za shell, polling,
wybór sesji i wspólny panel. `SessionPageComponent` ładuje dane sesji i koordynuje
zakładki. Routing jest lazy-loaded: `/sessions/:sessionId/:tab` obejmuje
`overview`, `cost`, `workflow`, `ai-hub` i `technical`.
Źródła workflow są pobierane dopiero dla Mapy pracy lub AI Hub.

| Moduł w `frontend/src/app/core` | Odpowiedzialność |
|---|---|
| `session-analysis.service.ts` | Fasada interpretacji dla widoków. |
| `workflow-analysis.service.ts`, `workflow/` | Model mapy, obserwacje, obecność metryk i relacje. |
| `session-episodes.ts` | Rekonstrukcja epizodów ponad historycznymi rekordami sesji. |
| `auxiliary-model-calls.ts` | Oddzielenie wywołań technicznych od głównej pracy. |
| `context-compaction.ts` | Powiązanie kompaktowania, koszt i potwierdzony odbiór wyniku. |
| `model-response.ts` | Wspólny parser przechwyconych kopert odpowiedzi modelu. |
| `flow-tool-catalog.ts` | Kanoniczny zakres klasyfikacji żądań i definicji. |
| `model-action-evidence.ts` | Dokładne powiązania żądania, wykonania, odbioru i dziecka. |
| `action-credit-attribution.ts`, `ai-quick-analysis.ts` | Lokalny podział credits w AI Hub. |
| `tool-usage-analysis.ts` | Globalne zestawienie definicji, użycia, wyników i powtórzeń. |
| `optimization/guidance-evidence.ts` | Pakiet dowodowy, redakcja i fingerprint doradztwa. |
| `optimization-technique-matcher.ts` | Deterministyczny wybór technik i deduplikacja. |
| `round-details-panel.service.ts` | Stan, fokus i nawigacja wspólnego panelu. |

Interpretacja nie należy do template ani rosnącego komponentu głównego.
Właścicieli ekranów i reguły UI opisuje [frontend](frontend.md).

## Wersje i źródła

Rekonstrukcja REST używa `session-reconstruction-v1`, relacje epizodów
`copilot-episode-v1`, a model workflow `workflow-mvp-0.2`.
Cache rekonstrukcji uwzględnia sesję, cutoff i wersję. Eksport ma osobny format
`agent-scanner-session` v1. [Wersje funkcji AI](ai.md#wersje-i-cache).

Formuły i reguły identyfikacji są w [telemetrii](telemetria.md),
endpointy w [API](api.md), a ustawienia w [konfiguracji](konfiguracja.md).
Manifesty [Maven](../pom.xml) i [Angular](../frontend/package.json)
oraz [lockfile](../frontend/package-lock.json) określają zależności.
