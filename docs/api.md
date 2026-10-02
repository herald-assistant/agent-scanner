# API HTTP

Status: aktualna referencja.

[Dokumentacja](README.md)

Domyślny adres: `http://localhost:8081`. Identyfikator sesji w ścieżce lub query
oznacza lokalny identyfikator rekordu, nie raw `gen_ai.conversation.id`.
W tabelach rozmów `chatId` oznacza identyfikator rozmowy; kontroler nazywa tę
zmienną ścieżki `id`.

## OTLP i stan odbiornika

| Metoda i ścieżka | Znaczenie |
|---|---|
| `POST /v1/traces` | Odbiór trace'ów OTLP. |
| `POST /v1/metrics` | Odbiór metryk OTLP. |
| `POST /v1/logs` | Odbiór logów OTLP. |
| `GET /api/status` | Status, liczba sygnałów i retencja. |
| `GET /api/config` | Konfiguracja VS Code i informacja o prywatności. |
| `POST /api/pause` | Pauza lub wznowienie zapisu; body `{"paused": true}` albo `{"paused": false}`. |

Typy treści, gzip, limit rozpakowanego payloadu i odpowiedzi protokołu opisuje
[kontrakt backendu](backend.md). Pauza potwierdza poprawne żądania OTLP
bez zapisu. Nie zatrzymuje importu.

## Sesje i przechowywanie

| Metoda i ścieżka | Znaczenie |
|---|---|
| `GET /api/sessions` | Lista znormalizowanych sesji. |
| `GET /api/sessions/{id}` | Sesja, spany, wiadomości i raw signals. |
| `GET /api/sessions/{id}/analysis` | Rekonstrukcja `session-reconstruction-v1`: epizody, interakcje, rundy i narzędzia. |
| `GET /api/sessions/{id}/workflow-sources` | Źródła mapy pobierane leniwie przez widoki workflow i AI Hub. |
| `GET /api/sessions/{id}/export` | Eksport `agent-scanner-session` v1. |
| `POST /api/sessions/import/preview` | Body `application/x-ndjson`: plik Copilot OTel JSONL → lista sesji, bez zapisu. |
| `POST /api/sessions/import?conversationId=…` | Ten sam plik JSONL i wybór jednej sesji; zapis jej spanów i jednoznacznie powiązanych subagentów. HTTP 409 przy istniejących danych. |
| `DELETE /api/sessions/{id}` | Usunięcie sesji i powiązanych danych. |
| `DELETE /api/data` | Usunięcie wszystkich danych. |

Eksport nie obejmuje wyników AI ani rozmów. Format i zgodność opisuje
[kontrakt backendu](backend.md), a skutki dla danych —
[poradnik prywatności](uzytkowanie.md).

Podgląd zwraca `sessions`: `conversationId`, `agentName`, `repository`, `model`,
`startedAt`, `endedAt`, `spans`, `turns`, `relatedSessions`, `relatedTurns`,
`auxiliaryCalls`, `contentCaptured` i `alreadyImported`, oraz `ignoredRecords`,
`duplicateRecords` i `unassignedSpans`. `turns` i `model` opisują głównego agenta;
`relatedTurns` — rundy jednoznacznie powiązanych subagentów, a `auxiliaryCalls` —
wywołania pomocnicze w importowanym zakresie. `spans` obejmuje cały wybrany zakres,
`startedAt` i `endedAt` zakres głównej rozmowy. Techniczne grupy bez dowodu sesji
nie są pozycjami do wyboru; `unassignedSpans` liczy spany niepowiązane z żadną
wybieralną rozmową. Podgląd nie
utrwala pliku i nie uruchamia AI. Po wyborze frontend ponownie przesyła plik;
backend ponownie sprawdza zakres oraz konflikty i atomowo zapisuje wybrany zakres.
Wynik zapisu ma `sessionId`, `signals` i `spans`. Oba endpointy egzekwują
`maxPayloadBytes` (413); niepoprawne JSONL lub wybór dają 400.
Rekordy logów, metryk i inne rekordy bez spanów nie są importowane; liczba
pominięć pozostaje jawna. Import eksportu `agent-scanner-session` v1 został
usunięty; eksport nadal jest dostępny jako materiał do inspekcji.

## Standaryzacja repozytorium

| Metoda i ścieżka | Znaczenie |
|---|---|
| `GET /api/standardization/catalog` | Wersjonowane wymagania, źródła i limity; bez AI. |
| `POST /api/standardization/snapshots` | Zapis zamaskowanych konfiguracji i zaznaczeń przed AI. Body: `snapshotId`, `repositoryId` (null dla nowych), `repositoryName`, `inventoryComplete`, `gitDetected`, `files` z `path`, `content`, `selected`, `omissionReason`. Zwraca `RepositorySnapshot`; bez modeli i poświadczeń. |
| `GET /api/standardization/repositories/{id}/inputs/{snapshotId}` | Zapisane wejście z plikami i zaznaczeniami; bez AI. |
| `DELETE /api/standardization/repositories/{id}/inputs/{snapshotId}` | Usunięcie wejścia bez wyniku AI; pliki powiązane z wynikiem usuwa się przez usunięcie analizy. |
| `POST /api/standardization/repositories/{id}/inputs/{snapshotId}/prepare` | `{"model":"…"}` → pakiet z zaznaczonych zapisanych plików w trybie AUTO, z trwałym powiązaniem do niezmiennego wejścia; bez inferencji. |
| `POST /api/standardization/prepare` | Tryb `AUTO`, model, wybrane pliki i pominięcia → niezmienny podgląd, hash, termin ważności i dokładny prompt; bez AI. |
| `POST /api/standardization/analyze` | `{"previewId":"…"}` → jawne wykonanie i zwalidowane oceny. |
| `POST /api/standardization/analyze-and-save` | `{"previewId":"…","repositoryId":null,"repositoryName":"…"}` tworzy repozytorium albo używa wskazanego ID, wykonuje analizę i zapisuje wynik z migawką. Zwraca `repositoryId`, `analysisId`, `preview`, `result` i `snapshotId` (null dla wcześniejszych analiz). Pakiet z zapisanego wejścia wymaga jego właściwego repozytorium. |
| `GET /api/standardization/repositories` | Repozytoria z listami `analyses` i `snapshots` (wejścia bez wyniku: `id`, `savedAt`, `fileCount`); bez odczytu zawartości plików i bez AI. |
| `GET /api/standardization/repositories/{id}/analyses/{analysisId}` | Zapisany wynik i zamaskowany pakiet dowodowy; bez AI. |
| `GET /api/standardization/repositories/{id}/analyses/{analysisId}/export` | Pobranie zapisanej analizy i jej zamaskowanej migawki jako załącznika JSON; bez AI. |
| `DELETE /api/standardization/repositories/{id}/analyses/{analysisId}` | Usunięcie wybranej analizy i migawki; po ostatniej analizie także pustego wpisu repozytorium. Sukces: 204, brak analizy w tym repozytorium: 404. |
| `POST /api/standardization/cancel` | `{"previewId":"…"}` → przerwanie tego wykonania. |
| `DELETE /api/standardization/previews/{id}` | Usunięcie nieaktywnego podglądu z pamięci. |

Funkcja nie wymaga identyfikatora sesji. Widok najpierw zapisuje wejście przez
`snapshots`, a po potwierdzeniu modelu w modalu przygotowuje pakiet z zapisanego
wejścia i używa `analyze-and-save` z jego `repositoryId`.
Zapis i odczyt wejścia nie wymagają poświadczeń Copilot;
zapisane analizy pozostają w lokalnej bazie H2 także po odświeżeniu strony.
Eksport ma format `agent-scanner-standardization-analysis` v1 i pole `analysis`
z zapisanym wynikiem oraz podglądem. Nie jest formatem importu sesji.
Usuwanie jest ograniczone do wskazanej pary repozytorium–analiza, kończy się
`CHECKPOINT` i nie dotyczy sesji telemetrii ani analiz pozostałych repozytoriów.
Modele pochodzą z istniejącego `GET /api/ai/session-chats/models`.
Uruchomienie AI wymaga skonfigurowanych poświadczeń Copilot; model wybiera użytkownik,
nie musi być ustawiony domyślny model w konfiguracji.
Interfejs wysyła `profile: "AUTO"` i pustą `clientVersion`. Pola pozostają w DTO
dla zgodności kontraktu; backend oznacza wersję klienta jako nieznaną i ocenia
różnice zależne od klienta warunkowo. Model dostaje treść odczytaną przez aplikację,
bez narzędzia do samodzielnego odczytu lokalnego folderu.

`prepare` przyjmuje konfiguracje Copilot oraz pomocnicze `.md`/`.txt` z ich
dedykowanych katalogów. Manifesty, kod, workflow i dokumentacja projektu są
odrzucane jako zakres spoza analizy, również gdy przesłano je obok konfiguracji.
Dokładne reguły doboru materiałów opisuje [Standaryzacja](standaryzacja.md).

DTO i wersje definiuje [Standardization.java](../src/main/java/dev/agentscanner/standardization/Standardization.java).
Pakiet `standardization-evidence-v1` zawiera pliki z identyfikatorami, hashami
i numerami linii, kontrole lokalne, reguły, źródła, pełne dokumenty standardów
oraz pary plik–reguła wymagające oceny. Odpowiedź modelu
`standardization-answer-v1` zawiera `assessments`. Każda ocena odwołuje się do
`assessmentId` z pakietu oraz zawiera `verdict`, `rationale`, `evidence`,
`sourceIds`, `limitations` i `recommendation`.

Dozwolone werdykty to `SUPPORTED`, `CONCERN`, `INSUFFICIENT_EVIDENCE`,
`NOT_APPLICABLE` i `UNRESOLVED`. Dowód określa plik, zakres linii i cytat
albo jawne stwierdzenie braku. Backend weryfikuje identyfikatory i cytaty;
nie gwarantuje trafności uzasadnienia AI. Wynik API dodaje m.in.
`unreviewedTargetIds` i `rejectedRecords`, aby częściowa odpowiedź była jawna.
Kryteria z podstawą `AS-W` wymagają oceny uniwersalności względem technologii
i architektury; `NOT_APPLICABLE` jest dla nich odrzucane. Przy rzeczywistym
braku dowodów dopuszczalne jest `INSUFFICIENT_EVIDENCE` z ograniczeniem.

Niepoprawny zakres lub body daje `400`; body ponad 8 MiB — `413`.
Zajęty slot, zużyty/wygasły podgląd
albo przerwanie analizy — `409`; brak konfiguracji AI — `503`; timeout — `504`;
błąd wykonania lub nieakceptowalny kontrakt — `502`. Szczegółowe limity,
prywatność i retencję opisuje [Standaryzacja](standaryzacja.md).

## Celowane odczyty analityczne

Wszystkie poniższe ścieżki mają prefiks
`GET /api/sessions/{sessionId}/analysis-data`. Odczyty nie uruchamiają inferencji.

| Sufiks | Parametry query | Znaczenie |
|---|---|---|
| `/overview` | — | Lekkie podsumowanie i pokrycie danych. |
| `/configuration` | — | Konfiguracja widoczna w telemetrii. |
| `/interactions` | `cursor=0`, `limit=25` | Lista interakcji. |
| `/rounds` | opcjonalne `interactionRef`, `actorRef`, `roundRefs`; `cursor=0`, `limit=25` | Lista rund w zadanym zakresie. |
| `/round-evidence` | wymagane `roundRef`, opcjonalne `sections` | Dokładny materiał jednej rundy. |
| `/subagents` | — | Drzewo powiązanych agentów. |
| `/cost` | opcjonalne `roundRefs` | Metryki i pokrycie całej sesji lub wskazanych rund. |
| `/search` | wymagane `query`; `cursor=0`, `limit=20` | Wyszukiwanie w danych sesji. |

Wartości po `=` są domyślnymi parametrami kontrolera. Wspólna usługa ogranicza
rozmiar stron i treści. REST i narzędzia `scanner_*` używają tej samej logiki
odczytu; tylko chat utrwala zakres na jednym cutoff.
[Kontrakt rozmowy i narzędzi](ai.md#rozmowa-o-sesji).

## Katalog i doradztwo

| Metoda i ścieżka | Efekt |
|---|---|
| `GET /api/optimization/techniques` | Lokalny katalog T01–T16, bez AI. |
| `GET /api/ai/optimization-advice/status` | Konfiguracja i zajętość wykonawcy, bez inferencji. |
| `POST /api/ai/optimization-advice/prepare?sessionId={id}` | Walidacja źródeł i zamrożenie podglądu na 30 minut, bez inferencji. |
| `POST /api/ai/optimization-advice/cached?sessionId={id}` | Odczyt wyniku dla zweryfikowanego podglądu; 204 przy braku. |
| `POST /api/ai/optimization-advice?sessionId={id}` | Jawne wykonanie dla body zawierającego tylko `previewId`. |

Pakiet, redakcję, hash i walidację opisuje [doradztwo AI](ai.md#doradztwo-i-podgląd-dowodów).

## Klasyfikacja działań

| Metoda i ścieżka | Efekt |
|---|---|
| `GET /api/ai/tool-classification/status` | Gotowość konfiguracji, model i zajętość; bez tokena i inferencji. |
| `POST /api/ai/tool-classification/cached?sessionId={id}` | Lookup dla identycznego requestu; 204 przy braku. |
| `POST /api/ai/tool-classification?sessionId={id}` | Jawne uruchomienie klasyfikacji. |
| `DELETE /api/ai/tool-classification?sessionId={id}` | Usunięcie zapisanego wyniku wskazanego requestem; bez usuwania telemetrii. |

Trzy operacje z `sessionId` przyjmują body typu `ToolClassification.Request`.
[Kategorie, zakres, cache i walidacja](ai.md#klasyfikacja-działań).

## Rozmowy o sesji

| Metoda i ścieżka | Efekt |
|---|---|
| `GET /api/ai/session-chats/models` | Pobranie modeli i limitów dla konta Copilot; kontakt z runtime bez inferencji. |
| `POST /api/ai/session-chats?sessionId={id}` | Utworzenie lokalnej rozmowy dla modelu, bez inferencji. |
| `GET /api/ai/session-chats?sessionId={id}` | Lokalny indeks rozmów. |
| `GET /api/ai/session-chats/{chatId}?sessionId={id}` | Bootstrap, historia i audyt rozmowy. |
| `POST /api/ai/session-chats/{chatId}/turns?sessionId={id}` | Jawne pytanie; utworzenie lub wznowienie sesji SDK. |
| `DELETE /api/ai/session-chats/{chatId}?sessionId={id}` | Usunięcie rozmowy i audytu oraz próba sprzątnięcia stanu SDK. |

[Body żądań, zakres i odpowiedź rozmowy](ai.md#rozmowa-o-sesji).

## Źródła implementacji

- [OtlpController](../src/main/java/dev/agentscanner/otel/OtlpController.java).
- [ScannerApiController](../src/main/java/dev/agentscanner/api/ScannerApiController.java).
- [SessionAnalysisController](../src/main/java/dev/agentscanner/analysis/SessionAnalysisController.java).
- [ToolClassificationController](../src/main/java/dev/agentscanner/ai/ToolClassificationController.java).
- [OptimizationAdviceController](../src/main/java/dev/agentscanner/ai/advisory/OptimizationAdviceController.java).
- [SessionChatController](../src/main/java/dev/agentscanner/ai/sessionchat/SessionChatController.java).
- [Modele transportowe frontendu](../frontend/src/app/models/scanner.models.ts).

Przy zmianie endpointu aktualizuj ten dokument, DTO i odpowiednie testy. Błędy
operacji użytkownika są po polsku; odpowiedź API nie powinna ujawniać stack trace
ani surowych sekretów.
