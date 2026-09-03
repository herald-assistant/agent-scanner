# Agent Scanner

Agent Scanner jest lokalnym odbiornikiem i przeglądarką telemetrii OpenTelemetry
emitowanej przez agentów GitHub Copilot. Obsługuje OTLP/HTTP z VS Code oraz wtyczki
GitHub Copilot dla IDE JetBrains, w tym IntelliJ IDEA.

Aplikacja nie jest proxy dla modelu, nie skanuje repozytorium i nie rekonstruuje
danych, których runtime nie wyemitował. Zachowuje natomiast surowy sygnał OTLP,
aby każdą wartość prezentowaną w UI dało się porównać ze źródłem.

## Szybki start

Wymagane do budowania całej aplikacji są JDK 17+ i Maven. Maven pobiera własny
Node.js i npm na potrzeby produkcyjnego buildu frontendu.

```powershell
mvn clean package
java -jar target/agent-scanner.jar
```

Po uruchomieniu otwórz `http://localhost:8080`.

## Podłączenie GitHub Copilot

Scanner przyjmuje OTLP/HTTP pod adresem `http://localhost:8080`. W obu IDE należy
włączyć przechwytywanie treści, jeżeli UI ma pokazywać prompty, odpowiedzi modelu,
definicje narzędzi oraz argumenty tool calli.

### VS Code

1. Naciśnij `Ctrl+Shift+P`.
2. Uruchom `Preferences: Open User Settings (JSON)`.
3. Wstaw poniższe właściwości do istniejącego głównego obiektu JSON.
4. Przeładuj okno VS Code i rozpocznij nową interakcję z agentem Copilot.

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.protocol": "http/protobuf",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:8080",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}
```

To jest kompletny, poprawny obiekt JSON. Jeżeli `settings.json` ma już inne
właściwości, przenieś do niego same pary klucz–wartość bez tworzenia drugiego
obiektu głównego.

### IntelliJ IDEA i pozostałe IDE JetBrains

1. Zaktualizuj wtyczkę GitHub Copilot do wersji udostępniającej konfigurację
   OpenTelemetry.
2. Otwórz `File → Settings → Tools → GitHub Copilot → Chat → OpenTelemetry`.
3. Włącz eksport OpenTelemetry.
4. Ustaw collector endpoint na `http://localhost:8080`.
5. Wybierz protokół `http/protobuf` (OTLP przez HTTP, protobuf).
6. Włącz `Capture content`, aby Scanner otrzymywał treść promptów, odpowiedzi i
   argumentów narzędzi.
7. Pozostaw service name i dodatkowe resource attributes bez zmian, o ile nie są
   potrzebne do własnej identyfikacji źródła.
8. Zastosuj ustawienia i rozpocznij nową interakcję z agentem Copilot.

Jeżeli sekcja `OpenTelemetry` nie jest widoczna, najpierw zaktualizuj wtyczkę
GitHub Copilot. Scanner obsługuje transport OTLP/HTTP niezależnie od IDE, ale
normalizacja pól domenowych jest najlepiej pokryta fixture'em kontraktu VS Code.
Jeśli konkretna wersja wtyczki JetBrains emituje inny zestaw atrybutów, surowe
dane nadal będą dostępne w zakładce „Dane techniczne” i mogą posłużyć do dodania
nowego fixture'a.

GitHub opisuje ustawienia JetBrains w sekcji
[`Settings → Tools → GitHub Copilot → Chat → OpenTelemetry`](https://github.blog/changelog/2026-08-18-enterprise-managed-settings-in-github-copilot-for-jetbrains/).

### Sprawdzenie połączenia

Po wykonaniu nowej interakcji status w nagłówku zmieni się na „Ostatnio odebrano
telemetrię”, a sesja pojawi się na liście. Ten status oznacza, że Scanner ma w
bazie co najmniej jeden odebrany sygnał; nie jest testem żywego połączenia z IDE.

Stan odbiornika można również sprawdzić przez API:

```powershell
Invoke-RestMethod http://localhost:8080/api/status
```

## Jak czytać dane

- **Sesja** jest grupowana po `gen_ai.conversation.id`.
- **Interakcja użytkownika** odpowiada osobnemu trace'owi i zwykle zaczyna się od
  spanu `invoke_agent`.
- **Runda** jest jednym spanem `chat`: agent wysyła request do modelu, model zwraca
  tekst i opcjonalne żądania narzędzi, a wyniki narzędzi mogą wejść do kolejnej
  rundy.
- **Subagent** może mieć własną sesję i własne rundy. Scanner wiąże go z tool
  callem uruchamiającym za pomocą `gen_ai.tool.call.id`, jeśli taki związek został
  wyemitowany.

Najważniejsze metryki:

- `input` — cały input naliczony dla requestu;
- `cache read` — część inputu odczytana z cache;
- `nowy input` — `max(0, input - cache read)`;
- `cache write` — wyłącznie wartość jawnie wyemitowana przez runtime;
- `output` — tokeny odpowiedzi modelu, w tym decyzje o użyciu narzędzi zgodnie z
  raportowaniem providera;
- `reasoning` — osobna metryka telemetryczna; UI nie dodaje jej ponownie do
  outputu;
- `TTFT` — czas do pierwszego tokenu;
- `credits` — `copilot_chat.copilot_usage_nano_aiu / 1 000 000 000`; jest to
  zużycie GitHub Copilot AI credits, nie kwota pieniężna.

Jeżeli co najmniej jedna runda na prezentowanej liście zawiera jawną metrykę
`cache write`, belki wszystkich rund pokazują jej osobną kolumnę obok outputu.
Dla rund bez tej metryki widoczny jest znak `—`, a nie domniemane zero.

Brak wartości oznacza „brak danych w telemetrii”, a nie zero ani potwierdzenie,
że dana funkcja nie była użyta. Alert błędu pojawia się wyłącznie wtedy, gdy
problem da się potwierdzić na podstawie statusu spanu, zdarzenia błędu albo
ustrukturyzowanego wyniku narzędzia.

## Co zawiera projekt

- odbiornik OTLP/HTTP JSON i protobuf: `POST /v1/traces`, `/v1/metrics`, `/v1/logs`;
- obsługę nieskompresowanych i gzipowanych payloadów;
- zachowanie oryginalnego protobufu oraz jego pełnej reprezentacji JSON;
- normalizację sesji, spanów, tokenów, wiadomości, narzędzi i błędów;
- plikową bazę H2 w `./agent-scanner-data`;
- odświeżanie statusu i sesji przez polling;
- eksport/import sesji, pauzę odbiornika, retencję i pełne czyszczenie;
- frontend Angular 22 z Angular Material, osadzany w wykonywalnym JAR-ze;
- test kontraktowy przepływu OTLP → H2 → REST API;
- widok kosztu i przebiegu oraz niezależny widok surowych danych technicznych.

## Architektura

```text
VS Code / IntelliJ GitHub Copilot
            │ OTLP/HTTP
            ▼
       OtlpController
            │ decode JSON/protobuf/gzip + limit payloadu
            ▼
    OtlpIngestionService
            │ zachowanie raw + normalizacja
            ▼
       ScannerStore ───── H2
            │
            ▼
   ScannerApiController
            │ REST /api
            ▼
 Angular: API service → analiza sesji → komponenty widoków
```

Szczegółowe reguły architektury, semantyka domenowa i zasady wprowadzania zmian
znajdują się w [`AGENTS.md`](AGENTS.md).

## API

| Metoda i ścieżka | Znaczenie |
|---|---|
| `POST /v1/traces` | odbiór trace'ów OTLP |
| `POST /v1/metrics` | odbiór metryk OTLP |
| `POST /v1/logs` | odbiór logów OTLP |
| `GET /api/status` | status, liczba sygnałów i ustawienia retencji |
| `GET /api/config` | konfiguracja VS Code i ostrzeżenie prywatności |
| `GET /api/sessions` | lista znormalizowanych sesji |
| `GET /api/sessions/{id}` | sesja, spany, wiadomości i surowe sygnały |
| `GET /api/sessions/{id}/export` | eksport sesji w formacie wersjonowanym |
| `POST /api/sessions/import` | import eksportu Agent Scanner v1 |
| `POST /api/pause` | wstrzymanie lub wznowienie zapisu nowych sygnałów |
| `DELETE /api/sessions/{id}` | usunięcie sesji i powiązanych sygnałów |
| `DELETE /api/data` | usunięcie wszystkich danych |

## Development

### Backend bez przebudowy Angulara

```powershell
mvn "-Dskip.frontend=true" spring-boot:run
```

### Frontend z proxy do backendu

```powershell
cd frontend
npm ci --no-fund --no-audit
npm start
```

Angular działa wtedy pod adresem wskazanym przez CLI, a `/api` i `/v1` są
przekazywane do `http://localhost:8080` przez `frontend/proxy.conf.json`.

### Testy i build

```powershell
# testy backendu bez uruchamiania buildu frontendu
mvn "-Dskip.frontend=true" test

# testy frontendu
cd frontend
npm test -- --watch=false

# produkcyjny frontend do target/classes/static
npm run build

# pełny, wykonywalny artefakt
cd ..
mvn clean package
```

## Konfiguracja aplikacji

| Zmienna | Domyślna wartość | Znaczenie |
|---|---:|---|
| `PORT` | `8080` | wspólny port UI, REST API i OTLP/HTTP |
| `AGENT_SCANNER_DB_URL` | `jdbc:h2:file:./agent-scanner-data/agent-scanner` | lokalizacja plikowej bazy H2 |
| `AGENT_SCANNER_RETENTION_DAYS` | `30` | retencja sygnałów w dniach |
| `AGENT_SCANNER_MAX_PAYLOAD_BYTES` | `67108864` | limit rozpakowanego payloadu oraz importu |

Retencja uruchamia się pięć minut po starcie, a następnie raz na dobę. Import
akceptuje wyłącznie eksport `agent-scanner-session` w wersji `1` i odrzuca sesję
o istniejącym `conversationId`.

## Prywatność i bezpieczeństwo

`captureContent=true` może zapisywać lokalnie kod, prompty, instrukcje, ścieżki,
komendy, argumenty i wyniki narzędzi. Dane trafiają do lokalnej bazy H2 i nie są
przesyłane dalej przez Scanner. UI pozwala usunąć pojedynczą sesję lub całą bazę.

Przed dodaniem rzeczywistego payloadu do testów trzeba usunąć repozytoria,
identyfikatory, prompty, kod, ścieżki użytkownika, tokeny i inne sekrety. Preferuj
syntetyczne fixture'y.

## Granice wiarygodności

Widok techniczny i surowe sygnały są źródłem prawdy. Widoki przyjazne użytkownikowi
są deterministyczną interpretacją dostępnych atrybutów. Projekt celowo:

- nie estymuje brakującego `cache write`;
- nie przypisuje pojedynczego request-part do cache bez jawnej telemetrii;
- nie traktuje liczby znaków jako dokładnej liczby tokenów;
- nie uznaje ponownego wysłania instructions za błąd bez jednoznacznego sygnału;
- nie pokazuje „połączenia aktywnego” tylko dlatego, że wcześniej odebrano dane.

Fixture w `src/test/resources/fixtures` jest syntetycznym kontraktem, a nie dowodem
kształtu payloadu każdej wersji Copilota. Różnice providerów należy najpierw
sprawdzić w raw OTLP, a następnie utrwalić w zanonimizowanym teście regresyjnym.

## Dokumentacja źródłowa

- [VS Code: Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [GitHub Copilot for JetBrains: OpenTelemetry configuration](https://github.blog/changelog/2026-08-18-enterprise-managed-settings-in-github-copilot-for-jetbrains/)
- [GitHub Copilot OpenTelemetry concepts](https://docs.github.com/en/copilot/concepts/agents/opentelemetry)
- [OTLP specification](https://opentelemetry.io/docs/specs/otlp/)
- [VS Code: Diagnose prompt caching with Cache Explorer](https://code.visualstudio.com/docs/agents/agent-troubleshooting/cache-explorer)
