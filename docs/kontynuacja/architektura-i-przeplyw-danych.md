# Architektura i przepływ danych

Stan dokumentu: 2026-09-06.

## Widok całości

```text
GitHub Copilot w VS Code / JetBrains
              │
              │ OTLP/HTTP: traces, metrics, logs
              ▼
        OtlpController
              │ dekodowanie, gzip, limit payloadu
              ▼
     OtlpIngestionService
              │ raw + normalizacja stabilnych pól
              ▼
          ScannerStore ───────────── H2
              │                       │
              │ REST /api             └─ zapis wyników analizy AI
              ▼
     ScannerApiController
              │
              ▼
       ScannerApiService
              │
              ├─ SessionAnalysisService
              ├─ WorkflowAnalysisService
              ├─ session-episodes.ts
              ├─ flow-tool-catalog.ts
              ├─ action-credit-attribution.ts
              └─ komponenty widoków Angular

Jawna analiza użytkownika:
Mapa pracy → ToolClassificationController → ToolClassificationService
           → CopilotCompletion → Copilot CLI / GitHub Copilot
           → ścisła walidacja JSON → H2 → kategorie w UI
```

Backend zachowuje telemetrię i udostępnia stabilny widok HTTP. Większość
interpretacji sesji i mapy pracy jest obecnie wykonywana po stronie Angulara.
AI klasyfikuje ograniczony katalog żądań, ale nie otrzymuje roli narzędzia do
samodzielnego przeglądania repozytorium ani danych użytkownika poza jawnym
zakresem promptu.

## Warstwy backendu

### Transport OTLP

Właściciel: `src/main/java/dev/agentscanner/otel/OtlpController.java`.

Odpowiedzialność:

- endpointy `/v1/traces`, `/v1/metrics`, `/v1/logs`;
- akceptacja protobufu, JSON-u i obsługiwanych content type;
- dekompresja gzip;
- limit rozmiaru po dekompresji;
- protokołowo poprawna pusta odpowiedź;
- respektowanie pauzy odbiornika.

Transport nie powinien interpretować rund, subagentów ani kosztów.

### Normalizacja OTLP

Właściciel: `src/main/java/dev/agentscanner/otel/OtlpIngestionService.java`.

Odpowiedzialność:

- zachowanie pełnego kanonicznego JSON-u i oryginalnych bajtów payloadu;
- wybór stabilnych pól potrzebnych do listowania i wspólnych pomiarów;
- przypisanie spanu do sesji na podstawie jawnych identyfikatorów;
- ekstrakcja wiadomości `input`, `output` i `definition`;
- zachowanie nieznanych atrybutów w `attributes_json` i zdarzeń w `events_json`;
- defensywne parsowanie wartości JSON zapisanych jako string.

Provider-specific parsing powinien pozostać tutaj tylko wtedy, gdy dotyczy
stabilnego kształtu emitera i jest pokryty anonimowym fixture'em.

### Persystencja

Właściciel: `src/main/java/dev/agentscanner/store/ScannerStore.java` oraz
`src/main/resources/schema.sql`.

Aktualne tabele:

| Tabela | Rola |
|---|---|
| `telemetry_signal` | Jeden odebrany batch, raw JSON, raw payload i metadane transportu. |
| `agent_session` | Znormalizowane podsumowanie sesji kluczowane conversation ID. |
| `span_record` | Spany z podstawowymi polami i pełnym JSON-em atrybutów i zdarzeń. |
| `message_record` | Treść wiadomości wejściowych, wyjściowych i definicji narzędzi. |
| `metric_or_event` | Znormalizowane metryki i logi spoza spanów. |
| `tool_classification_result` | Zwalidowany wynik AI dla sesji i dokładnego request hash. |

Klucze obce prowadzą od danych znormalizowanych do raw sygnału lub sesji i mają
`ON DELETE CASCADE`. Wynik analizy znika razem z sesją. Eksport sesji w wersji 1
nie został rozszerzony o analizę AI.

`schema.sql` używa `IF NOT EXISTS`, ale nie jest systemem migracji dowolnych zmian.
Każda zmiana istniejącej kolumny wymaga jawnej strategii zgodności ze starą bazą.

### REST

Właściciele:

- `src/main/java/dev/agentscanner/api/ScannerApiController.java`;
- `src/main/java/dev/agentscanner/api/ApiView.java`;
- `src/main/java/dev/agentscanner/api/SessionImportService.java`;
- `src/main/java/dev/agentscanner/ai/ToolClassificationController.java`.

Najważniejsze endpointy:

| Metoda | Ścieżka | Znaczenie |
|---|---|---|
| `GET` | `/api/status` | Stan odbiornika i retencji. |
| `GET` | `/api/config` | Dane konfiguracji IDE bez sekretów. |
| `GET` | `/api/sessions` | Lista sesji. |
| `GET` | `/api/sessions/{id}` | Spany, wiadomości i raw sygnały sesji. |
| `GET` | `/api/sessions/{id}/export` | Eksport `agent-scanner-session` v1. |
| `POST` | `/api/sessions/import` | Import wersji 1 z limitami i kontrolą konfliktu ID. |
| `POST` | `/api/pause` | Pauza lub wznowienie przyjmowania nowych danych. |
| `DELETE` | `/api/sessions/{id}` | Usunięcie jednej sesji. |
| `DELETE` | `/api/data` | Usunięcie wszystkich danych. |
| `GET` | `/api/ai/tool-classification/status` | Gotowość AI, model i flaga zajętości. |
| `POST` | `/api/ai/tool-classification/cached?sessionId=…` | Odczyt wyniku dla identycznego requestu. |
| `POST` | `/api/ai/tool-classification?sessionId=…` | Jawne uruchomienie klasyfikacji. |

Frontendowe interfejsy transportowe muszą pozostać zgodne z `ApiView` i
`ToolClassification`.

## Warstwy frontendu

### Kompozycja aplikacji

`AppComponent` odpowiada za polling, wybór sesji, ładowanie danych powiązanych,
aktywne zakładki i osadzenie wspólnego prawego panelu. Nie powinien przejmować
interpretacji mapy ani formatowania szczegółów rund.

Główne zakładki:

- `Koszt i przebieg` — KPI sesji oraz chronologia interakcji;
- `Mapa pracy` — przebieg, subagenci, opcjonalne kategorie AI i hipotezy kosztowe;
- `Dane techniczne` — drzewo spanów i raw dane.

### Interpretacja sesji

`SessionAnalysisService` jest fasadą interpretacji używaną przez kompozycję.
`WorkflowAnalysisService` buduje model mapy pracy. Pomocnicze moduły mają
wyspecjalizowane role:

| Moduł | Odpowiedzialność |
|---|---|
| `auxiliary-model-calls.ts` | Wspólne rozpoznawanie nazw agentów technicznych oraz deterministyczne oddzielanie ich inline wywołań i powiązanych narzędzi. |
| `context-compaction.ts` | Powiązanie wywołania kompaktującego z rozmową po dokładnych ID, opcjonalne wykrycie późniejszego użycia wyniku oraz odczyt requestu, rezultatu i kosztów. |
| `CostDashboardComponent` | Łączny bilans całej sesji oraz zwijane, kolumnowo porównywalne rozliczenie agenta głównego, kolejnych subagentów i kompaktowań. |
| `session-episodes.ts` | Rekonstrukcja epizodów agenta i subagentów z raw ID i drzewa spanów. |
| `workflow/telemetry.ts` | Bezpieczny odczyt atrybutów, wartości trójstanowe, sortowanie i hashowanie. |
| `workflow/observations.ts` | Obserwacje rund, narzędzi, tokenów i markerów. |
| `workflow/phases.ts` | Starsze deterministyczne profile przepływu; nie są etykietami kategorii AI. |
| `model-response.ts` | Wspólny parser tekstu, tool calli i wyników narzędzi z kilku kopert danych. |
| `flow-tool-catalog.ts` | Minimalny, wersjonowalny request klasyfikacji AI. |
| `model-action-evidence.ts` | Mapowanie wyniku AI na rundy oraz dowody konsumpcji wyników. |
| `action-credit-attribution.ts` | Lokalna estymacja podziału credits na kategorie. |

Interpretacja należy do tych modułów, a nie do wyrażeń w template.

### Mapa pracy

Właściciel:
`frontend/src/app/features/workflow/workflow-view.component.*`.

Komponent odpowiada za:

- wybór interakcji;
- przełącznik `Fakty / Kategorie`;
- uruchomienie lub przywrócenie analizy;
- podział credits według kategorii;
- agregację sąsiednich rund w fazy;
- prezentację typu narzędzi w fazie;
- szczegółowy diagram głównego agenta i subagentów;
- warstwy `Kontekst`, `Tokeny`, `Credits`;
- poziome przeciąganie szczegółowej mapy;
- otwarcie wspólnego panelu rundy.

Aktualny porządek po analizie:

```text
zlecenie
  ↓
menu analizy
  ↓
podział credits według kategorii
  ↓
zagregowany przebieg faz
  ↓
szczegółowy przebieg rund i subagentów
```

### Szczegóły rundy

Właściciele:

- `RoundDetailsPanelService` — stan, fokus i nawigacja wspólnego panelu;
- `RoundDetailsAsideComponent` — prawy panel o minimalnej szerokości desktopowej;
- `RoundDetailsDialogComponent` — właściwa, faktograficzna treść cyklu.

`InteractionTimelineComponent` korzysta z wariantu szablonowego tego samego panelu
dla pracy subagenta i kompaktowania. Belka kompaktowania pozostaje krótkim
zestawieniem kosztów, a `ContextCompactionDetailsComponent` pokazuje razem
systemowe zasady i format, polecenie konkretnego kompaktowania oraz opcjonalne
polecenie użytkownika, a następnie messages, tools, rezultat i opcjonalny wpływ na
kolejny request; nie powstaje drugi, konkurencyjny mechanizm panelu.

Panel przedstawia `M → A → M`:

- lewa strona: co model zwrócił agentowi, łącznie z tool callami i argumentami;
- prawa strona: co agent przekazał następnemu modelowi;
- odpowiedzi narzędzi są łączone ze wcześniejszym żądaniem po call ID;
- surowa wiadomość jest dostępna w zwijanym szczególe;
- `<` i `>` przechodzą po sekwencji przekazanej przez widok otwierający.

Nie należy ponownie tworzyć osobnego panelu „klasyfikacji rundy”. Kategorie są
warstwą orientacyjną mapy, a audyt rundy ma pozostać uniwersalny i faktograficzny.

## Rekonstrukcja subagentów

`session-episodes.ts` rekonstruuje epizody ponad historycznym podziałem rekordów
sesji. Powiązanie rodzic–dziecko wymaga dowodu:

1. `execute_tool` ma `gen_ai.tool.call.id`;
2. epizod dziecka emituje odpowiadający raw conversation/chat ID;
3. dla kształtu `copilot-episode-v1` jawne `chat_session_id` i
   `parent_chat_session_id` są zgodne z relacją strukturalną;
4. powiązanie jest jednoznaczne;
5. krawędź nie zamyka cyklu.

Kolizja kandydatów powoduje odrzucenie atrybucji. To bezpieczniejsze niż wybranie
najbliższej sesji po czasie. Zagnieżdżone poddrzewo jest liczone raz.

Rundy subagenta są osobnymi wywołaniami modelu i mają etykiety `Sx:My`.
Delegujący tool call pozostaje częścią rundy rodzica. Zwrot subagenta działa jak
wynik narzędzia: może wejść do kolejnego requestu modelu rodzica, jeżeli taki
request istnieje i telemetria potwierdza powiązanie.

## Przepływ klasyfikacji AI

```text
WorkflowAnalysis
  → flowToolCatalog()
  → kanoniczny request i lokalny klucz zakresu
  → sprawdzenie cache przeglądarki
  → POST /cached z pełnym requestem
  → H2: session_id + SHA-256(version + model + request)

Jawny przycisk użytkownika, gdy brak cache:
  → POST /api/ai/tool-classification
  → bounded worker, jedno zadanie naraz
  → CopilotCompletion
  → osobny CopilotClient w trybie EMPTY
  → jedna sesja tekstowa, bez tools/MCP/skilli/instrukcji repo
  → odpowiedź JSON
  → ścisła walidacja kompletności i spójności
  → zapis w H2
  → warstwa kategorii w Angularze
```

`CopilotCompletion` tworzy jednorazowego klienta i kończy proces przez
`forceStop()`. Omija to starsze, nieobsługiwane przez część CLI wywołania
`connect`/`runtime.shutdown`. Konfiguracja sesji blokuje narzędzia i uprawnienia.

Backend waliduje między innymi:

- dokładnie jeden wynik dla każdego tool ID, invocation ID i round ID;
- brak dodatkowych pól i duplikatów kluczy JSON;
- dozwolone enumy i niepuste uzasadnienia;
- zgodność `toolId` z requestem;
- `fit=UNKNOWN`, gdy nie ma celu;
- akcje rundy równe sumie akcji wszystkich jej żądań;
- pełny zestaw `evidenceInvocationIds`;
- `UNKNOWN` dla nieobserwowanego pustego outputu bez tool calli.

AI nie oblicza credits. Angular łączy zwrócone kategorie z pomiarami lokalnie.

## Klucze wersjonowania

| Kontrakt | Aktualna wartość | Skutek zmiany |
|---|---|---|
| Klasyfikacja AI | `model-actions-v5` | Wymaga nowej analizy; stary rekord pozostaje pod starym hashem. |
| Rekonstrukcja epizodów | `copilot-episode-v1` | Wymaga testów na fixture'ach relacji. |
| Model mapy | `workflow-mvp-0.2` | Wskazuje wersję wynikowego modelu analizy. |
| Eksport sesji | `agent-scanner-session`, v1 | Breaking change wymaga nowej wersji importu/eksportu. |

Hash klasyfikacji zawiera wersję reguł, ID modelu i kanoniczny JSON requestu.
Zmiana definicji, argumentu, celu, rundy lub modelu powoduje cache miss.

## Konfiguracja uruchomieniowa

Domyślna baza:

```text
jdbc:h2:file:./agent-scanner-data/agent-scanner
```

Konfiguracja AI może pochodzić z ignorowanego
`config/application.properties` albo zmiennych środowiskowych:

```properties
agent-scanner.ai.github-token=
agent-scanner.ai.model=
agent-scanner.ai.cli-path=copilot
agent-scanner.ai.timeout-seconds=120
```

Brak AI nie blokuje odbiornika ani trybu `Fakty`.

## Weryfikacja zmian

Frontend:

```powershell
cd frontend
npm test -- --watch=false
npm run build
```

Backend bez ponownego budowania frontendu:

```powershell
mvn "-Dskip.frontend=true" test
```

Pełna paczka:

```powershell
mvn clean package
```

Zmiana korelacji, kosztów, normalizacji lub schematu wymaga testu na minimalnym,
anonimowym fixture, który zachowuje istotny kształt emitera.
