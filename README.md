# Agent Scanner

Lokalny odbiornik i przeglądarka telemetryki OpenTelemetry emitowanej przez agentów
GitHub Copilot w VS Code. Aplikacja nie jest proxy, nie skanuje repozytorium i nie
próbuje odtwarzać danych, których runtime nie wyemitował.

## Szybki start

Wymagane do budowania: JDK 17+ i Maven. Node.js jest pobierany przez Maven wyłącznie
na czas budowania frontendu.

```powershell
mvn clean package
java -jar target/agent-scanner.jar
```

### IntelliJ IDEA

Wybierz współdzieloną konfigurację **Agent Scanner (Maven)** z listy konfiguracji
Run i uruchom ją. Korzysta z `spring-boot:run`, więc nie zależy od classpathu
ręcznie utworzonego modułu IntelliJ.

Jeżeli chcesz uruchamiać bezpośrednio klasę `AgentScannerApplication`, otwórz
okno **Maven**, wybierz **Reload All Maven Projects**, a następnie w konfiguracji
Application ustaw **Use classpath of module** na moduł `agent-scanner`. Komenda
uruchomieniowa musi zawierać classpath; jeśli po opcjach JVM od razu występuje
nazwa klasy głównej, konfiguracja modułu nadal jest niepoprawna.

Otwórz `http://localhost:8080` i skopiuj z ekranu startowego ustawienia do pliku
`settings.json` w VS Code:

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

Przeładuj okno VS Code i rozpocznij sesję agenta. Ustawienia zarządzane przez
organizację mają pierwszeństwo przed zmiennymi środowiskowymi i ustawieniami użytkownika.

> `captureContent=true` może zapisywać lokalnie kod, prompty, komendy, ścieżki oraz
> wyniki narzędzi. UI pozwala natychmiast usunąć sesję lub wszystkie dane.

## Co zawiera projekt

- odbiornik OTLP/HTTP JSON i protobuf: `POST /v1/traces`, `/v1/metrics`, `/v1/logs`;
- obsługa nieskompresowanych i gzipowanych payloadów;
- zachowanie oryginalnego protobufu i jego pełnej reprezentacji JSON;
- normalizacja sesji, spanów, tokenów, wiadomości, tooli, skilli i błędów;
- plikowa baza H2 w `./agent-scanner-data`;
- automatyczne odświeżanie statusu i sesji bez utrzymywania podatnego na zerwanie połączenia SSE;
- eksport sesji do JSON, pauza, retencja oraz pełne czyszczenie;
- responsywny frontend Angular 20 osadzony w jednym wykonywalnym JAR-ze;
- test kontraktowy na zanonimizowanym, syntetycznym drzewie Copilot OTel.

## Testy i development

```powershell
# testy backendu bez przebudowy Angulara
mvn "-Dskip.frontend=true" test

# build frontendu w trybie produkcyjnym
cd frontend
npm ci
npm run build

# backend developerski (po zbudowaniu frontendu)
cd ..
mvn "-Dskip.frontend=true" spring-boot:run
```

Test integracyjny sprawdza przepływ protobuf → OTLP receiver → H2 → REST API, gzip,
tryb pauzy i błędne payloady. Fixture jest syntetyczny i bazuje na opublikowanym
kontrakcie. Po pierwszej próbie z konkretną wersją VS Code warto dodać osobny,
zanonimizowany rzeczywisty payload do `src/test/resources/fixtures`.

## Konfiguracja

| Zmienna | Domyślna wartość | Znaczenie |
|---|---:|---|
| `PORT` | `8080` | port HTTP aplikacji i OTLP |
| `AGENT_SCANNER_DB_URL` | `jdbc:h2:file:./agent-scanner-data/agent-scanner` | lokalizacja H2 |
| `AGENT_SCANNER_RETENTION_DAYS` | `30` | automatyczna retencja |
| `AGENT_SCANNER_MAX_PAYLOAD_BYTES` | `67108864` | limit rozpakowanego payloadu OTLP |

## Granice wiarygodności

Widoki `Raw telemetry`, spanów i użytych tooli pokazują dane jawne. Treść system
promptu może zawierać instructions lub treść skilla, ale aktualny kontrakt nie
gwarantuje osobnego zdarzenia z nazwą i ścieżką każdego pliku instrukcji. Brak
atrybutu oznacza „brak danych”, a nie „funkcja nie była dostępna”.

Dokumentacja źródłowa:

- [Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [OTLP specification](https://opentelemetry.io/docs/specs/otlp/)
- [Diagnose prompt caching with Cache Explorer](https://code.visualstudio.com/docs/agents/agent-troubleshooting/cache-explorer)

## Uwagi do lokalnego spike'u

Do pełnej walidacji pozostają obserwacje zależne od zainstalowanej wersji runtime'u:

1. dokładne położenie `gen_ai.input.messages` dla każdego harnessu;
2. kształt instructions i skill content;
3. ewentualne obcięcie argumentów/wyników przed wysłaniem;
4. zachowanie exportera, gdy odbiornik jest wyłączony;
5. rozmiar typowej sesji z pełną treścią.

Projekt celowo nie zgaduje odpowiedzi na te pytania — zachowuje raw OTLP, aby
wyniki pierwszego realnego testu były widoczne i możliwe do utrwalenia jako fixture.
