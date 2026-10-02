# Agent Scanner

Lokalna aplikacja do przeglądania telemetrii sesji agentowych GitHub Copilot
w VS Code. Zachowuje surowe dane OTLP i pokazuje po polsku przebieg, narzędzia,
tokeny oraz GitHub Copilot AI credits. Brak pomiaru pozostaje brakiem, estymacje
mają `≈`, a opcjonalna analiza AI wymaga jawnego uruchomienia.

## Uruchomienie

Statyczne [demo przeglądarkowe](https://herald-assistant.github.io/agent-scanner/)
wczytuje Copilot OTel JSONL, pozwala wybrać rozmowy i zapisuje je lokalnie w IndexedDB.
Zakładki i katalog technik działają bez backendu; pozostałe funkcje pokazują
„Dostępne w pełnej wersji”. [Uruchomienie i build demo](docs/konfiguracja.md#statyczne-demo).

Wymagane: JDK 17+ i Maven. W katalogu repozytorium:

```powershell
mvn clean package
java -jar target/agent-scanner.jar
```

Maven pobiera Node.js do budowania frontendu. Otwórz
[aplikację lokalną](http://localhost:8081), a następnie
[włącz eksport telemetrii z VS Code](docs/uzytkowanie.md#uruchomienie-i-pierwsza-sesja).

## Dokumentacja

- [Obsługa aplikacji](docs/uzytkowanie.md) — ekrany, pomiary, narzędzia i dane.
- [Konfiguracja](docs/konfiguracja.md) — odbiornik, retencja i opcjonalny Copilot.
- [Indeks techniczny](docs/README.md) — architektura, kontrakty, API i rozwój.
- [AGENTS.md](AGENTS.md) — punkt startowy dla agenta rozwijającego projekt.

Przechwytywanie treści zapisuje w lokalnej bazie m.in. prompty, kod i wyniki
narzędzi. Eksport może zawierać te same dane. Jawnie uruchomione funkcje AI
przekazują określony zakres do Copilota; [szczegóły prywatności](docs/uzytkowanie.md#dane-i-prywatność).
