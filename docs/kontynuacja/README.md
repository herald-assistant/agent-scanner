# Agent Scanner — punkt startowy do kontynuacji

Stan dokumentu: 2026-09-06.

Ten katalog przekazuje kontekst potrzebny do kontynuowania rozwoju Agent Scanner
w nowym zadaniu Codexa. Opisuje aktualny kierunek produktu i implementacji. Nie
zastępuje kodu ani testów: jeżeli dokument i działający kod się różnią, trzeba
najpierw ustalić, czy zmiana jest niedokończona, a następnie zaktualizować oba.

## Kolejność czytania

1. [Cel produktu i model wartości](cel-produktu-i-model-wartosci.md) — jaki problem
   rozwiązujemy i jakie decyzje ma ułatwiać ekran.
2. [Architektura i przepływ danych](architektura-i-przeplyw-danych.md) — komponenty,
   granice warstw, persystencja i ścieżka klasyfikacji AI.
3. [Semantyka telemetrii i zasady interpretacji](semantyka-telemetrii-i-zasady-interpretacji.md)
   — definicje rund, subagentów, tokenów i credits oraz granica fakt–estymacja–AI.
4. [Zasady pracy w projekcie](zasady-pracy-w-projekcie.md) — granice warstw,
   konwencje implementacyjne, testy, prywatność i typowe pułapki.
5. [Stan funkcji i plan rozwoju](stan-funkcji-i-plan-rozwoju.md) — co już działa,
   ograniczenia, priorytety i proponowany kontrakt rekomendacji.
6. [`AGENTS.md`](../../AGENTS.md) — wiążące zasady pracy w repozytorium.

Dokumenty specjalistyczne:

- [Klasyfikacja odpowiedzi modelu](../klasyfikacja-narzedzi-ai.md) — dokładny
  kontrakt `model-actions-v5`, zakres promptu, walidacja i estymacja credits;
- [Playbook GitHub Copilot SDK Java](../github-copilot-sdk-local-java-spring-ai.md)
  — konfiguracja i diagnostyka lokalnego klienta;
- [Deterministyczna klasyfikacja faz i subagentów](../deterministyczna-klasyfikacja-faz-i-subagentow.md)
  — wcześniejszy model badawczy. Profile oparte na proporcjach input/output nie są
  obecnymi etykietami biznesowymi mapy pracy.

## Aktualny punkt produktu

Agent Scanner jest lokalnym narzędziem obserwowalności sesji agentowych GitHub
Copilot. Odbiera OTLP/HTTP, przechowuje raw telemetry, buduje audytowalny model
sesji i pokazuje użytkownikowi:

- co zlecił użytkownik;
- jakie decyzje zwracał model i jakich działań żądał od agenta;
- jakie narzędzia wykonał agent i co wróciło do kolejnego wywołania modelu;
- gdzie pojawili się subagenci;
- jak rosły tokeny, zajętość okna kontekstowego i credits;
- które części przepływu warto sprawdzić pod kątem optymalizacji.

Zakładka `Mapa pracy` ma dwa tryby:

- `Fakty` pokazują wyłącznie dane z telemetrii i deterministyczne relacje;
- `Kategorie` nakładają wynik jawnie uruchomionej analizy AI na te same rundy.

Po analizie kolejność głównych sekcji jest następująca:

1. `Podział credits według kategorii` — procentowa estymacja dla całego badanego
   przepływu;
2. `Zagregowany przebieg` — lista sąsiednich faz z nazwami rund, udziałem typów
   narzędzi i pełnymi credits wywołań należących do fazy;
3. `Szczegółowy przebieg` — rozwinięty diagram wywołań modelu głównego agenta i
   subagentów, z warstwami kontekstu, tokenów i credits.

Kliknięcie rundy na szczegółowym diagramie otwiera wspólny prawy panel
`M → A → M`. Panel jest faktograficzny i nie dubluje klasyfikacji AI. Pokazuje
rzeczywisty output modelu, żądania narzędzi, ich argumenty oraz input następnego
wywołania. Nawigacja `<` i `>` przechodzi po rundach sekwencji.

## Najważniejsze decyzje, których nie należy cofać przypadkiem

- Jednostką klasyfikacji jest akcja zażądana w odpowiedzi modelu, a nie ogólna
  intencja wynikająca z celu zadania.
- Wyszukiwanie i odczyt są jedną kategorią `Pozyskanie danych`.
- Runda biznesowa jest prezentowana jako `M → A → M`: odpowiedź modelu, wykonanie
  przez agenta i dane wracające do kolejnego modelu.
- Delegacja jest tool callem rodzica. Własne wywołania subagenta mają etykiety
  `Sx:My`, ale cały epizod jest połączony z rundą rodzica przez dokładny call ID.
- Credits nie są przesuwane między spanami jako fakty. Podział według kategorii
  jest lokalną estymacją oznaczoną `≈`.
- Fazy łączą wyłącznie sąsiednie wywołania o identycznym zbiorze kategorii.
- Zagregowane karty faz nie są klikalne. Do audytu służą oznaczenia rund i
  szczegółowy diagram.
- Szczegółowy diagram jest początkowo rozwinięty, można go ukryć, a poziome
  przewijanie obsługuje przeciąganie tła.
- Sekwencja kart faz zawija się. Wszystkie strzałki pozostają skierowane w prawo,
  także na początku kolejnego wiersza.
- Brak danych pozostaje brakiem danych. Nie wolno pokazywać zera bez wyemitowanego
  zera ani odtwarzać ukrytej treści reasoning.

## Stan techniczny przy zapisaniu dokumentu

- Java 17, Spring Boot 3.4.5, H2, OpenTelemetry protobuf 1.7.0-alpha.
- Angular 22, Node.js 22.22.3 w Maven frontend plugin.
- GitHub Copilot Java SDK 1.0.11; wymagany zgodny Copilot CLI.
- Kontrakt analizy AI: `model-actions-v5`.
- Kontrakt rekonstrukcji epizodów: `copilot-episode-v1`.
- Frontend: 106 testów przechodziło po ostatniej zmianie wizualnej.
- `npm run build` przechodził; initial bundle miał 776,34 kB i przekraczał budżet
  750 kB o 26,34 kB.
- Working tree zawiera szeroki, niezatwierdzony zestaw zmian tej funkcji. Nie
  wykonywać resetu ani automatycznego formatowania całego repozytorium.

## Pierwsze kroki w nowym zadaniu

```powershell
git status --short
rg --files docs frontend/src/app src/main/java/dev/agentscanner
cd frontend
npm test -- --watch=false
npm run build
```

Backend po zmianie semantyki, API, bazy lub integracji AI:

```powershell
cd ..
mvn "-Dskip.frontend=true" test
```

Pełny pakiet uruchamiać po zmianie zależności albo integracji buildu:

```powershell
mvn clean package
```

Analiza AI może zużyć limit konta Copilot. Nie uruchamiać jej w testach, przy
starcie aplikacji ani bez jawnej akcji użytkownika.

## Gotowy kontekst otwierający kolejny chat

Można rozpocząć nowe zadanie od poniższej wiadomości:

```text
Kontynuujemy rozwój Agent Scanner w bieżącym working tree. Najpierw przeczytaj
AGENTS.md oraz docs/kontynuacja/README.md i wskazane tam dokumenty. Zachowaj
niezatwierdzone zmiany i nie cofaj obecnych decyzji semantycznych bez wyraźnego
powodu. Fakty OTLP, deterministyczne wyliczenia i interpretacje AI muszą pozostać
rozdzielone. Przed zmianą sprawdź aktualny kod i testy właściciela danej warstwy.
Następnie wykonaj poniższe zadanie: <TU WPISZ NOWE ZADANIE>.
```
