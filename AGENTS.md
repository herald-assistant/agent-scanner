# AGENTS.md — zasady pracy w Agent Scanner

Obowiązuje w całym repozytorium. Pierwszeństwo ma bieżące żądanie użytkownika,
potem ten plik i wskazane kontrakty, następnie konwencje najbliższego kodu.
Podlinkowane kontrakty są wiążącą częścią instrukcji.

## Początek zadania

Sprawdź `git status --short` i zachowaj istniejące zmiany. Znajdź właściciela
w [architekturze](docs/architektura.md), przeczytaj właściwy kontrakt oraz kod
i testy. [Indeks dokumentacji](docs/README.md) opisuje obecną aplikację.

## Zasady wspólne

- **Dowód przed wnioskiem:** zachowuj raw i nieznane atrybuty; oddzielaj fakty,
  deterministyczne wyliczenia, estymacje i AI. Brak pomiaru nie jest zerem.
- Nie odtwarzaj brakującej treści ani ukrytego reasoning. Nie przypisuj providerowi
  zachowania, którego payload nie dowodzi. Scanner nie jest proxy, żywym
  połączeniem z IDE, źródłem rozliczeń ani dokładnym tokenizerem. Standaryzacja
  odczytuje wybrane konfiguracje repozytorium, nie audytuje całego kodu.
- Credits oznaczają GitHub Copilot AI credits, bez waluty i etykiet `cost`/`cr`.
  Nie sumuj dwukrotnie powiązanych poddrzew.
- Zmiany korelacji i formuł wymagają fixture'u. Nie rozszerzaj zmiany UI na
  telemetrię, retencję, import lub publiczne API bez wyraźnego zamiaru użytkownika.
  Rozbieżność dokumentu i kodu najpierw wyjaśnij.
- Mapa pracy jest faktograficzna; jawne AI należy do AI Hub i Standaryzacji. Nie uruchamiaj
  inferencji przy starcie, w pollingu ani zwykłych testach.
- Nie dodawaj prawdziwej telemetrii, tokenów, bazy ani outputu buildu do repozytorium
  i nie drukuj ich w testach. Dodatkowa wysyłka, analytics lub zdalny storage
  wymagają wyraźnej autoryzacji i udokumentowanej prywatności.
- Używaj `rg` i zmian opartych na patchach. Nie resetuj cudzej pracy, nie wykonuj
  destrukcyjnych poleceń Git ani masowego formatowania repozytorium.

## Kontrakty według zakresu

| Zmiana | Przeczytaj |
|---|---|
| Grupowanie, metryki, błędy, kompaktowanie | [Telemetria](docs/telemetria.md) |
| OTLP, normalizacja, baza i HTTP | [Backend](docs/backend.md), [API](docs/api.md) |
| Angular, komponenty i zachowanie ekranów | [Frontend](docs/frontend.md) |
| CSS, Material i dostępność | [Stylowanie](docs/stylowanie.md) |
| Klasyfikacja, doradztwo, rozmowy i Copilot | [AI](docs/ai.md) |
| Konfiguracje repozytorium i ich ocena AI | [Standaryzacja](docs/standaryzacja.md), [AI](docs/ai.md) |
| Ustawienia uruchomienia | [Konfiguracja](docs/konfiguracja.md) |
| Testy, prywatność, dokumentacja i zakończenie | [Rozwój](docs/rozwoj.md) |

## Weryfikacja

Baseline: Java 17, Spring Boot 3.4.x, MVC/JDBC/H2, OTel protobuf 1.7.0-alpha,
Angular 22 standalone z Material, strict TypeScript/templates i Vitest,
Copilot Java SDK 1.0.11. Maven używa Node.js 22.22.3.
Wersje rozstrzygają [pom.xml](pom.xml), [package.json](frontend/package.json)
i [lockfile](frontend/package-lock.json).

Aktualizuj manifest i lockfile razem; przy zmianie zależności sprawdź osobny build
frontendu i pełny Maven. Synchronizuj DTO Java i TypeScript, dodawaj regresje
dla semantyki i uruchamiaj [sprawdzenia właściwe dla zmiany](docs/rozwoj.md#weryfikacja-zmian).
Aktualizuj jeden właściwy dokument razem z kodem. README i AGENTS pozostają krótkie.
