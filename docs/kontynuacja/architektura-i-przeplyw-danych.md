# Architektura i przepływ danych

Stan dokumentu: 2026-09-20.

## Widok całości

```text
GitHub Copilot w VS Code
  -> OTLP/HTTP: traces, metrics, logs
  -> OtlpController: dekodowanie, gzip, limit payloadu
  -> OtlpIngestionService: raw payload + normalizacja stabilnych pól
  -> ScannerStore + H2: telemetry, model odczytowy i audyt AI
  -> SessionReconstructionService: wersjonowana rekonstrukcja sesji i źródeł
  -> ScannerApiController: REST /api
  -> ScannerApiService
  -> ScannerShellStateService + AppComponent
  -> /sessions/:id/{overview|cost|workflow|ai-hub|technical}
  -> SessionPageComponent
     |- SessionAnalysisService
     |- WorkflowAnalysisService + session-episodes.ts
     |- flow-tool-catalog.ts + action-credit-attribution.ts
     `- komponenty widoków Angular

Jawne funkcje AI w AI Hub:
AI Hub → ToolClassificationController → ToolClassificationService
           → CopilotCompletion → Copilot CLI / GitHub Copilot
           → ścisła walidacja JSON → H2 → kategorie w UI

AI Hub → OptimizationAdviceController → lokalne prepare źródeł
  → jawne wykonanie CopilotCompletion → ścisła walidacja → H2

AI Hub → rozmowa o całej sesji:
użytkownik wskazuje interakcję lub rundę w pierwszej wiadomości
           → SessionAnalysisQueryService → zamrożony cutoff + mały bootstrap
           → SessionChatController → createSession / resumeSession
           → ograniczone narzędzia scanner_* → ścisła walidacja JSON i evidence refs
           → H2: rozmowa + tury + audyt narzędzi → dedykowany modal
```

Backend zachowuje telemetrię i udostępnia stabilny widok HTTP. Większość
interpretacji prezentacyjnej pozostaje po stronie Angulara, natomiast deterministyczna
rekonstrukcja i odczyty analityczne są współdzielone przez REST i narzędzia AI.
AI nie otrzymuje repozytorium ani narzędzi obserwowanej sesji; może wykonywać tylko
zamknięty zestaw odczytów `scanner_*` w zakresie jednej zamrożonej sesji.

`Mapa pracy` pozostaje widokiem faktograficznym: pokazuje wyłącznie telemetrię i
deterministyczne powiązania. Korzysta z tego samego modelu `WorkflowAnalysis`, który
`AI Hub` może przygotować dla jawnie uruchomionej analizy, ale sama mapa nie wysyła
danych do Copilota ani nie prezentuje klasyfikacji AI.

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
| `optimization_advice_preview` | Zamrożony, lokalnie zweryfikowany pakiet doradczy z fingerprintem i czasem wygaśnięcia. |
| `optimization_advice_result` | Ściśle zwalidowany wynik doradztwa dla request hash, fingerprintu, modelu i wersji promptu. |
| `session_chat` | Zamrożony cutoff całej sesji, bootstrap, model i identyfikator trwałej sesji SDK. |
| `session_chat_turn` | Pytanie, status i ściśle zwalidowana odpowiedź każdej tury rozmowy. |
| `session_chat_tool_call` | Audyt parametrów i ograniczonego wyniku każdego odczytu wykonanego przez AI. |
| `session_chat_evidence` | Ledger referencji faktycznie przekazanych modelowi. |

Klucze obce prowadzą od danych znormalizowanych do raw sygnału lub sesji i mają
`ON DELETE CASCADE`. Wynik analizy i podglądy znikają razem z sesją. Wygasłe
podglądy są usuwane przy zapisaniu następnej migawki. Eksport sesji w wersji 1
nie został rozszerzony o analizę AI ani podglądy.

`schema.sql` używa `IF NOT EXISTS`, ale nie jest systemem migracji dowolnych zmian.
Każda zmiana istniejącej kolumny wymaga jawnej strategii zgodności ze starą bazą.

### REST

Właściciele:

- `src/main/java/dev/agentscanner/analysis/SessionReconstructionService.java`;
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
| `GET` | `/api/sessions/{id}/analysis` | Lekka kanoniczna rekonstrukcja `session-reconstruction-v1`: epizody, interakcje, rundy i wykonania narzędzi bez powielania raw sygnałów. |
| `GET` | `/api/sessions/{id}/workflow-sources` | Powiązane przez call ID lub wspólny trace źródła Mapy pracy; pobierane leniwie, bez skanowania wszystkich sesji w przeglądarce. |
| `GET` | `/api/sessions/{id}/export` | Eksport `agent-scanner-session` v1. |
| `POST` | `/api/sessions/import` | Import wersji 1 z limitami i kontrolą konfliktu ID. |
| `POST` | `/api/pause` | Pauza lub wznowienie przyjmowania nowych danych. |
| `DELETE` | `/api/sessions/{id}` | Usunięcie jednej sesji. |
| `DELETE` | `/api/data` | Usunięcie wszystkich danych. |
| `GET` | `/api/ai/tool-classification/status` | Gotowość AI, model i flaga zajętości. |
| `POST` | `/api/ai/tool-classification/cached?sessionId=…` | Odczyt wyniku dla identycznego requestu. |
| `POST` | `/api/ai/tool-classification?sessionId=…` | Jawne uruchomienie klasyfikacji. |
| `POST` | `/api/ai/optimization-advice/prepare?sessionId=…` | Lokalna walidacja źródeł raw/normalized i zapis 30-minutowej migawki; bez SDK i inferencji. |
| `GET` | `/api/ai/optimization-advice/status` | Konfiguracja modelu i zajętość wspólnego wykonawcy; bez SDK. |
| `POST` | `/api/ai/optimization-advice/cached?sessionId=…` | Lokalny lookup wyniku dla zweryfikowanego `previewId`; 204 przy braku. |
| `POST` | `/api/ai/optimization-advice?sessionId=…` | Jedna inferencja uruchamiana wyłącznie jawnym kliknięciem; body zawiera tylko `previewId`. |
| `GET` | `/api/ai/session-chats/models` | Modele dostępne dla konta Copilot i emitowane limity kontekstu; bez inferencji. |
| `POST` | `/api/ai/session-chats?sessionId=…` | Zamrożenie całej sesji dla wybranego modelu; bez inferencji. |
| `GET` | `/api/ai/session-chats?sessionId=…` | Lista zapisanych rozmów dla sesji; bez SDK. |
| `GET` | `/api/ai/session-chats/{id}?sessionId=…` | Bootstrap, historia i audyt narzędzi jednej rozmowy; bez SDK. |
| `POST` | `/api/ai/session-chats/{id}/turns?sessionId=…` | Jawna tura: utworzenie albo wznowienie sesji SDK i zapis wyniku. |
| `DELETE` | `/api/ai/session-chats/{id}?sessionId=…` | Usunięcie rozmowy, audytu i najlepsza możliwa próba usunięcia stanu SDK. |
| `GET` | `/api/sessions/{id}/analysis-data/*` | Wspólne, celowane odczyty faktów sesji dla UI i klientów automatycznych. |

Frontendowe interfejsy transportowe muszą pozostać zgodne z `ApiView`,
`session-reconstruction-v1` i `ToolClassification`. Rekonstrukcja jest cache'owana
według `sessionId + cutoffSignalId + wersja`; kontroler REST i przyszły adapter
narzędzi AI mają korzystać z tego samego `SessionReconstructionService`.

## Warstwy frontendu

### Kompozycja aplikacji

`AppComponent` jest shellem: uruchamia polling, obsługuje wybór sesji i osadza
wspólny prawy panel. `SessionPageComponent` ładuje dane wybranej sesji, posiada
aktywne zakładki i koordynuje widoki sesji. Żaden z nich nie powinien przejmować
interpretacji mapy ani formatowania szczegółów rund.

Główne zakładki:

- `Podsumowanie` — krótki widok stanu i najważniejszych danych sesji;
- `Koszt i przebieg` — KPI sesji oraz chronologia interakcji;
- `Mapa pracy` — faktograficzny przebieg rund, narzędzi i subagentów w warstwach
  `Kontekst`, `Tokeny` oraz `Credits`;
- `AI Hub` — jedyne miejsce dla jawnie uruchamianej klasyfikacji, doradztwa i rozmów
  o zamrożonej sesji;
- `Dane techniczne` — drzewo spanów i raw dane.

Routingi są lazy-loaded: shell aplikacji obsługuje stronę główną i adres
`/sessions/:sessionId/:tab`, a `SessionPageComponent` ładuje szczegóły sesji oraz
źródła Mapy pracy dopiero po otwarciu zakładki `Mapa pracy` lub `AI Hub`.

### Interpretacja sesji

`SessionAnalysisService` jest fasadą interpretacji używaną przez kompozycję.
`WorkflowAnalysisService` buduje model mapy pracy. Pomocnicze moduły mają
wyspecjalizowane role:

| Moduł | Odpowiedzialność |
|---|---|
| `app.config.ts` | Wspólne providery startowe aplikacji, w tym routing i globalny `material-symbols-outlined`; konfiguracja na poziomie root zapewnia prawidłowe ikony także w dynamicznych overlayach i modalach. |
| `auxiliary-model-calls.ts` | Wspólne rozpoznawanie nazw agentów technicznych oraz deterministyczne oddzielanie ich inline wywołań i powiązanych narzędzi. |
| `context-compaction.ts` | Powiązanie wywołania kompaktującego z rozmową po dokładnych ID, opcjonalne wykrycie późniejszego użycia wyniku oraz odczyt requestu, rezultatu i kosztów. |
| `CostDashboardComponent` | Łączny bilans całej sesji oraz zwijane, kolumnowo porównywalne rozliczenie agenta głównego, kolejnych subagentów i kompaktowań. |
| `tool-usage-analysis.ts` | Globalny, deterministyczny audyt przechwyconych definicji, żądań narzędzi i wyników wracających po dokładnym call ID. Wynik liczy raz przy pierwszym odbiorze. Dla jego późniejszych przechwyconych wystąpień, tylko do następnego kompaktowania sesji, osobno estymuje udział w cache przez proporcję wyemitowanego `cache read / input łącznie` i zachowuje pokrycie metryką. Buduje oznaczone `≈` wartości per tool bez AI i sortuje przez pomocnicze `input + 10 × output`, bez przypisywania credits. |
| `ToolOptimizationOverviewComponent` | Początkowo zwinięta karta hipotez pod bilansem sesji z zakładkami `Niewykorzystane` i `Wykorzystane`; rozwija się inline z dostępnego chevrona, używa jednej neutralnej białej ikony toola i czerwonego pilla tylko dla niewykorzystanych. Rozdziela definicje, wywołania, pierwszy odbiór odpowiedzi i szacowany cache kolejnych rund, nie pokazuje ich mylącej sumy. Definicje mają kolor cache read, a tooltip wyjaśnia proporcjonalną estymację oraz to, że wynik jest już sumą wszystkich rund z dostępną definicją; nie tłumaczy wyboru koloru. Dla użytych tooli pokazuje prostą, czerwoną powyżej zera liczbę kolejnych wywołań tej samej nazwy z identycznymi kanonicznymi parametrami w całej powiązanej sesji, także przez granice agentów i kompaktowania. Kliknięcie tożsamości toola otwiera `ToolDefinitionDialogComponent` z opisem, parametrami wszystkich przechwyconych wersji, pełnym kanonicznym JSON-em oraz rozbiciem powtórzeń na różne strumienie agentów, okres po kompaktowaniu i rozłączne stany rezultatu powiązanego po call ID; modal wymienia też rundy `M…`/`S…:M…`. Pierwsza zakładka wskazuje konsolę agenta oraz konfigurację `tools`/toolsetów w VS Code. |
| `session-episodes.ts` | Rekonstrukcja epizodów agenta i subagentów z raw ID i drzewa spanów. |
| `workflow/telemetry.ts` | Bezpieczny odczyt atrybutów, wartości trójstanowe, sortowanie i hashowanie. |
| `workflow/observations.ts` | Obserwacje rund, narzędzi, tokenów i markerów. |
| `workflow/phases.ts` | Starsze deterministyczne profile przepływu; nie są etykietami kategorii AI. |
| `model-response.ts` | Wspólny parser tekstu, tool calli i wyników narzędzi z kilku kopert danych. |
| `flow-tool-catalog.ts` | Minimalny, wersjonowalny request klasyfikacji AI. |
| `model-action-evidence.ts` | Mapowanie wyniku AI na rundy oraz dowody konsumpcji wyników. |
| `action-credit-attribution.ts` | Lokalna estymacja podziału credits na kategorie. |
| `optimization/guidance-evidence.ts` | Lokalny, zamrożony pakiet dowodowy dla fazy lub pojedynczego kompaktowania: limity, redakcja, pochodzenie, braki, pominięcia i fingerprint. Nie uruchamia AI. |
| `SessionChatDialogComponent` | Rozmowa o całej zamrożonej sesji, z historią, aktywnością narzędzi i evidence refs. Rundę lub interakcję użytkownik wskazuje w wiadomości. |
| `AiHubComponent` | Jawne uruchamianie Quick Analysis, prezentacja podziału credits oraz wejścia do nowej, ostatniej i historycznej rozmowy. |

Interpretacja należy do tych modułów, a nie do wyrażeń w template.

### Mapa pracy

Właściciel:
`frontend/src/app/features/workflow/workflow-view.component.*`.

Komponent odpowiada za:

- wybór interakcji;
- szczegółowy diagram głównego agenta i subagentów;
- warstwy `Kontekst`, `Tokeny`, `Credits`;
- poziome przeciąganie szczegółowej mapy;
- otwarcie wspólnego panelu rundy.

Aktualny porządek po analizie:

```text
zlecenie → wybór interakcji i warstwy → szczegółowy przebieg rund i subagentów
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
prezentowane w `AI Hub`, a audyt rundy ma pozostać uniwersalny i faktograficzny.

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

`CopilotCompletion` tworzy klienta na czas pojedynczego działania i kończy proces
przez `forceStop()`. Klasyfikacja i doradztwo używają izolowanych sesji. Rozmowa
o rundach zapisuje sesję SDK i wznawia ją w kolejnych turach, ale również zamyka
klienta/CLI po każdym wywołaniu. Konfiguracja blokuje narzędzia i uprawnienia.

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

## Podgląd i jawne wykonanie doradztwa

```text
Jawny przycisk w poradniku konkretnej fazy / jednego kompaktowania
  → GuidanceEvidenceBuilder
  → ograniczenie zakresu i fragmentów
  → usunięcie system/developer i reasoning
  → redakcja rozpoznanych sekretów
  → manifest pominięć + SHA-256
  → POST /api/ai/optimization-advice/prepare
  → ścisłe DTO, allowlista technik i kontrola metryk
  → potwierdzenie spanu w raw signal + hash pełnego źródła normalized
  → kontrola przynależności sesji głównej / potomnej / kompaktora
  → zapis niezmiennego podglądu na 30 minut
  → koniec etapu prepare; brak CopilotCompletion
  → jawne „Wyślij do AI”
  → frontend wysyła tylko previewId
  → ponowna walidacja ważności i niezmienności źródeł
  → przejęcie wspólnego AiExecutionCoordinator
  → powtórny lookup cache
  → jedna izolowana tura CopilotCompletion, bez tools/skills/repo/pamięci
  → ścisła walidacja odpowiedzi i observationIds
  → ponowna kontrola źródeł oraz zapis wyniku
```

Pakiet przechowuje fakty wyemitowane, wyliczenia deterministyczne, wcześniejszą
klasyfikację AI i braki jako różne typy pochodzenia. Wspierający request następnej
rundy jest dołączany wyłącznie poza wybranym zakresem i jawnie oznaczany.
Kompaktowanie dostaje pomiary przed/po tylko po potwierdzonym odbiorze wyniku.
Referencja zawiera raw signal ID, trace/span ID i hash pełnego znormalizowanego
źródła (atrybuty, zdarzenia oraz wiadomości spanu). Backend odrzuca zmianę źródła,
obcą sesję, brak spanu w raw signal, niezgodną metrykę i konflikt wersji. Zwrot
`RAW_AND_NORMALIZED` oznacza lokalną walidację dowodu, a nie wynik inferencji.
Sam podgląd, status i lookup cache nie uruchamiają modelu. Wynik AI zachowuje
wersję promptu `optimization-advice-prompt-v1`, model, request hash i fingerprint.
Stany `INSUFFICIENT_EVIDENCE` oraz `NO_SUITABLE_TECHNIQUE` są poprawnymi
odpowiedziami, nie awariami.

## Rozmowa o sesji

```text
„Zapytaj o sesję” lub „Zapytaj o rundy”
  → cała sesja zamrożona do cutoffSignalId
  → mały bootstrap z backendu
  → wybór modelu z katalogu SDK
  → zapis rozmowy bez inferencji
  → jawne „Rozpocznij rozmowę”
  → przejęcie wspólnego AiExecutionCoordinator
  → pierwsza tura: createSession + bootstrap + pytanie
  → następne tury: resumeSession + nowe pytanie
  → celowane wywołania tylko scanner_* nad wspólnym SessionAnalysisQueryService
  → ścisła walidacja odpowiedzi i evidence ledger
  → ponowna kontrola zamrożonego źródła i zapis odpowiedzi w H2
```

Bootstrap zawiera wyłącznie orientację w sesji i konfiguracji. Interakcję lub rundę
użytkownik wskazuje naturalnym językiem w wiadomości.
Dokładne requesty, odpowiedzi, tool calls, konfiguracja, koszty i subagenci są
pobierani na żądanie przez ograniczone custom tools. Handlery mają scope zamknięty
na serwerze i nie przyjmują `sessionId`. Repozytorium, terminal, built-in tools,
MCP, skille i custom agents obserwowanej sesji są wyłączone. Każde wywołanie i
ograniczony wynik są audytowane, a evidence ref może pojawić się w odpowiedzi
wyłącznie wtedy, gdy bootstrap lub tool faktycznie dostarczył go modelowi.

## Klucze wersjonowania

| Kontrakt | Aktualna wartość | Skutek zmiany |
|---|---|---|
| Klasyfikacja AI | `model-actions-v5` | Wymaga nowej analizy; stary rekord pozostaje pod starym hashem. |
| Pakiet dowodowy poradnika | `guidance-evidence-v2` | Zmiana redakcji, limitów, próbkowania lub pochodzenia wymaga nowej migawki. |
| Żądanie i wynik doradztwa | `optimization-advice-v1` | `prepare` zamraża podgląd, a jawne wykonanie przyjmuje tylko jego ID i waliduje wynik. |
| Prompt doradcy | `optimization-advice-prompt-v1` | Wchodzi do klucza cache; zmiana wymaga nowej inferencji. |
| Rozmowa o sesji | bieżący kontrakt `session-chat` | Brak obsługi i migracji usuniętego eksperymentalnego kontraktu rozmów o rundach. |
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
