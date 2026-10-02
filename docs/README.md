# Dokumentacja Agent Scanner

Status: indeks bieżącej aplikacji.

Zacznij od [obsługi](uzytkowanie.md). Przy zmianie kodu przeczytaj
[AGENTS.md](../AGENTS.md), architekturę i kontrakt odpowiedniego obszaru.

| Dokument | Zawartość |
|---|---|
| [Obsługa](uzytkowanie.md) | Uruchomienie, VS Code, ekrany, interpretacja danych i prywatność. |
| [Konfiguracja](konfiguracja.md) | Zmienne, baza, retencja i uruchomienie AI. |
| [Architektura](architektura.md) | Przepływ danych, warstwy, moduły i persystencja. |
| [Architektura docelowa](architektura-docelowa.md) | Wdrożone demo i wspólny rdzeń; kolejny etap integracji ze Spring Boot, GraalJS, bazą klienta i MCP. |
| [Plan realizacji demo](plan-demo.md) | Etapy dojścia do GitHub Pages: lokalny import JSONL, IndexedDB, obecne widoki, dostępność funkcji, testy i publikacja. |
| [Telemetria](telemetria.md) | Tożsamość sesji i rund, subagenci, kompaktowanie, wzory i błędy. |
| [API](api.md) | Endpointy i parametry HTTP. |
| [AI](ai.md) | Klasyfikacja, podział credits, doradztwo, rozmowa, runtime i cache. |
| [Backend](backend.md) | Reguły transportu, normalizacji, SQL, importu i kolejnych emiterów. |
| [Frontend](frontend.md) | Angular, właściciele komponentów i aktualne zachowanie widoków. |
| [Stylowanie](stylowanie.md) | Tokeny, Material, dostępność i kontrola wizualna. |
| [Rozwój](rozwoj.md) | Środowisko, testy, prywatność, dokumentacja i kryteria ukończenia. |

Każdy temat ma jedno miejsce utrzymania. Poradnik objaśnia działanie, a kontrakty
podają dokładne reguły. Kod i testy potwierdzają implementację.

## Standaryzacja repozytorium

[Standaryzacja środowiska GitHub Copilot](standaryzacja.md) opisuje widok
repozytoriów, historię analiz, prywatność, limity i granice implementacji. Prowadzi do
wymagań dla instrukcji, skills, agentów, MCP i promptów. Ich kryteria
merytoryczne oraz pełne dokumenty kategorii są przekazywane do analizy AI.
[Walidacja AI](standaryzacja-ai.md) opisuje wymagania referencyjne oceny;
aktualny kontrakt HTTP dokumentuje [API](api.md#standaryzacja-repozytorium).

Po zmianie dokumentacji, z katalogu repozytorium:

```powershell
node scripts/check-docs.mjs
git diff --check
```
