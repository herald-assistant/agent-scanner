# Konfiguracja

Status: aktualna referencja.

[Dokumentacja](README.md)

Źródła: [application.yml](../src/main/resources/application.yml),
[ScannerProperties](../src/main/java/dev/agentscanner/config/ScannerProperties.java)
i [CopilotProperties](../src/main/java/dev/agentscanner/ai/CopilotProperties.java).

## Odbiornik i baza

| Zmienna | Domyślna wartość | Znaczenie |
|---|---:|---|
| `PORT` | `8081` | wspólny port UI, REST API i OTLP/HTTP |
| `AGENT_SCANNER_DB_URL` | `jdbc:h2:file:./agent-scanner-data/agent-scanner` | lokalizacja plikowej bazy H2 |
| `AGENT_SCANNER_RETENTION_DAYS` | `30` | retencja sygnałów w dniach |
| `AGENT_SCANNER_MAX_PAYLOAD_BYTES` | `67108864` | limit rozpakowanego payloadu oraz importu |

Retencja uruchamia się pięć minut po starcie, a następnie raz na dobę. Import
przyjmuje Copilot OTel JSONL, wymaga wyboru jednej rozmowy i odrzuca konflikt
rozmowy, subagenta lub OTel spanu. Eksport Scanner nie jest wejściem importu.

## Statyczne demo

W katalogu `frontend`, po `npm ci --no-audit --no-fund`:

```powershell
npm run start:demo
npm run build:demo -- --base-href /agent-scanner/
node scripts/check-demo-artifact.mjs /agent-scanner/
```

`start:demo` działa bez proxy i Spring Boot. Build zapisuje do
`frontend/dist/demo`; dla hostingu w root użyj `--base-href /`.
Hash routing pozwala odświeżać widoki sesji na statycznym serwerze.
[Konfiguracja runtime](../frontend/src/app/runtime-configuration.demo.ts)
ustawia tryb demo oraz limit pliku 64 MiB. Limit sprawdzany jest przed odczytem
i ponownie w Workerze. Zmiana tego pliku wymaga nowego buildu.

Magazyn `agent-scanner-demo` w IndexedDB ma schemat 2. Dane są związane z originem
i profilem przeglądarki, bez serwerowej retencji. Brak miejsca, niedostępny magazyn
lub blokada migracji przez inną kartę kończą operację jawnym błędem.
Demo nie uruchamia usług AI ani odbiornika OTLP. Standardowy `npm run build`
nadal pakuje wariant HTTP do zasobów Spring Boot.

[Workflow Pages](../.github/workflows/demo-pages.yml) waliduje PR bez publikacji;
publikuje udane buildy gałęzi `master` i ręczne uruchomienie na tej gałęzi.
Pakuje tylko output demo. Repozytorium `herald-assistant/agent-scanner` wymaga
w ustawieniach Pages źródła GitHub Actions. Adres projektu:
[Agent Scanner demo](https://herald-assistant.github.io/agent-scanner/).

## Opcjonalne AI

| Właściwość | Zmienna środowiskowa w YAML | Domyślnie |
|---|---|---|
| `agent-scanner.ai.github-token` | `COPILOT_GITHUB_TOKEN` | pusta |
| `agent-scanner.ai.model` | `AGENT_SCANNER_AI_MODEL` | pusta |
| `agent-scanner.ai.cli-path` | `AGENT_SCANNER_COPILOT_CLI` | `copilot` |
| `agent-scanner.ai.data-directory` | — | `./agent-scanner-data/copilot` |
| `agent-scanner.ai.timeout-seconds` | — | `120` |

Tabela podaje aliasy jawnie zapisane w YAML. Pozostałe ustawienia mogą korzystać
ze standardowego wiązania właściwości Spring Boot. Kroki przygotowania lokalnego pliku opisuje sekcja poniżej.

Ścieżki względne bazy i danych SDK są liczone względem katalogu uruchomienia
aplikacji. Token nie powinien trafić do repozytorium, odpowiedzi API ani logów.

## Uruchomienie AI

Projekt używa Copilot Java SDK 1.0.11; przyjęty kontrakt integracji wymaga Copilot
CLI 1.0.55 lub nowszego oraz tokena z dostępem do Copilota. Brak konfiguracji AI
nie blokuje odbiornika i widoków faktograficznych.

1. Skopiuj [plik przykładowy](../config/application.properties.example) jako
   `config/application.properties` w katalogu uruchomienia aplikacji. W repozytorium
   plik docelowy jest ignorowany przez Git; przykład nie może zawierać tokena.
2. Ustaw `agent-scanner.ai.github-token` i `agent-scanner.ai.model`.
   ID modelu musi pochodzić z katalogu dostępnego dla danego konta.
3. Jeśli CLI nie jest w `PATH`, ustaw pełną ścieżkę executable w
   `agent-scanner.ai.cli-path`, np. `C:/tools/copilot/copilot.exe`.
4. Uruchom backend ponownie.

```powershell
Invoke-RestMethod http://localhost:8081/api/ai/tool-classification/status
```

Status potwierdza obecność konfiguracji, ale nie poprawność tokena ani udane
wykonanie modelu. Lista modeli kontaktuje się z runtime/usługą bez inferencji.
Zakresy danych, wykonanie i diagnostykę opisuje [kontrakt AI](ai.md).
