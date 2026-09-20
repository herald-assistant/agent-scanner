# Dokumentacja Agent Scanner

Status: indeks bieżącej aplikacji.

Zacznij od [obsługi](uzytkowanie.md). Przy zmianie kodu przeczytaj
[AGENTS.md](../AGENTS.md), architekturę i kontrakt odpowiedniego obszaru.

| Dokument | Zawartość |
|---|---|
| [Obsługa](uzytkowanie.md) | Uruchomienie, VS Code, ekrany, interpretacja danych i prywatność. |
| [Konfiguracja](konfiguracja.md) | Zmienne, baza, retencja i uruchomienie AI. |
| [Architektura](architektura.md) | Przepływ danych, warstwy, moduły i persystencja. |
| [Telemetria](telemetria.md) | Tożsamość sesji i rund, subagenci, kompaktowanie, wzory i błędy. |
| [API](api.md) | Endpointy i parametry HTTP. |
| [AI](ai.md) | Klasyfikacja, podział credits, doradztwo, rozmowa, runtime i cache. |
| [Backend](backend.md) | Reguły transportu, normalizacji, SQL, importu i kolejnych emiterów. |
| [Frontend](frontend.md) | Angular, właściciele komponentów i aktualne zachowanie widoków. |
| [Stylowanie](stylowanie.md) | Tokeny, Material, dostępność i kontrola wizualna. |
| [Rozwój](rozwoj.md) | Środowisko, testy, prywatność, dokumentacja i kryteria ukończenia. |

Każdy temat ma jedno miejsce utrzymania. Poradnik objaśnia działanie, a kontrakty
podają dokładne reguły. Kod i testy potwierdzają implementację.

Po zmianie dokumentacji, z katalogu repozytorium:

```powershell
node scripts/check-docs.mjs
git diff --check
```
