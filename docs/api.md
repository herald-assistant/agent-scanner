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
| `POST /api/sessions/import` | Import v1; tylko trace signals, limit rozmiaru, HTTP 409 przy konflikcie conversation ID. |
| `DELETE /api/sessions/{id}` | Usunięcie sesji i powiązanych danych. |
| `DELETE /api/data` | Usunięcie wszystkich danych. |

Eksport nie obejmuje wyników AI ani rozmów. Format i zgodność opisuje
[kontrakt backendu](backend.md), a skutki dla danych —
[poradnik prywatności](uzytkowanie.md).

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
