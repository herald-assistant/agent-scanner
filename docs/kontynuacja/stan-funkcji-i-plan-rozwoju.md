# Stan funkcji i plan rozwoju

Stan dokumentu: 2026-09-06.

## Co działa obecnie

### Odbiór i przechowywanie

- OTLP/HTTP dla traces, metrics i logs;
- protobuf, JSON, gzip i limit rozpakowanego payloadu;
- raw JSON i oryginalny payload obok znormalizowanych rekordów;
- plikowa baza H2, retencja, pauza odbiornika, eksport/import v1 i usuwanie;
- konfiguracja onboardingowa dla VS Code i IntelliJ IDEA.

### Model sesji

- sesje grupowane po conversation ID z fallbackiem trace;
- interakcje grupowane po trace ID;
- rundy oparte na spanach `chat`;
- wyliczenia nowego inputu, zajętości okna i credits zgodne ze wspólnymi
  formułami;
- rozdzielenie brakującej wartości od wyemitowanego zera;
- potwierdzone błędy oparte na zamkniętym zbiorze dowodów;
- rekonstrukcja epizodów głównego agenta i subagentów ponad historycznym
  podziałem rekordów sesji;
- odrzucanie niejednoznacznych powiązań i cykli.

### Koszt i przebieg

- podsumowanie sesji;
- interakcje i cykle model–agent–model;
- główne i pomocnicze wywołania modelu;
- subagenci z własnymi wywołaniami i credits;
- prawy panel szczegółów rundy z rzeczywistym requestem i response;
- korelacja odpowiedzi narzędzia ze wcześniejszym żądaniem po call ID;
- czytelna lista argumentów z zawijaniem długiego tekstu;
- treść reasoning tylko wtedy, gdy provider ją jawnie emituje.

### Mapa pracy — tryb faktów

- wyemitowane zlecenie użytkownika;
- szczegółowy diagram rund głównego agenta i subagentów;
- warstwa `Kontekst` pokazująca zajętość okna w chwili wysłania;
- warstwa `Tokeny` z osobnymi seriami nowego inputu, cache read, outputu i
  cache write;
- warstwa `Credits` z narastającą sumą wyemitowanych credits;
- wybór rundy otwierający uniwersalny panel `M → A → M`;
- domyślnie rozwinięty diagram, możliwość ukrycia i poziome przewijanie przez
  przeciąganie tła.

### Mapa pracy — tryb kategorii

- analiza uruchamiana wyłącznie jawnie przez użytkownika;
- podgląd zakresu i szacunek tokenów przed wysłaniem;
- klasyfikacja unikalnych definicji oraz wszystkich żądań i rund;
- kategorie wieloetykietowe oparte na działaniach zażądanych przez model;
- połączenie wyszukiwania i odczytu w `Pozyskanie danych`;
- profil każdego agenta na podstawie jego własnych rund;
- zapis zwalidowanego wyniku w H2 i automatyczne przywrócenie bez kolejnego
  zapytania;
- procentowy podział credits według kategorii z resztą `Poza kategoriami`;
- dominujący obszar i ostrożna wskazówka do sprawdzenia;
- fazy tworzone z sąsiednich rund o identycznym zestawie kategorii;
- oznaczenia `M1–M3` i `S2:M1–M15`;
- udział typów narzędzi w każdej fazie;
- pełne credits wywołań należących do fazy i pokrycie braków;
- osobne sekcje: podział credits, zagregowany przebieg, szczegółowy przebieg.

## Aktualne ograniczenia

### Interpretacja AI

Ścisła walidacja zapewnia kompletność i spójność struktury, ale nie gwarantuje
poprawności semantycznej każdej etykiety. Model może nadal wybrać nieoptymalną
kategorię przy skróconych argumentach, ubogiej definicji lub niejednoznacznym
poleceniu. `reason` pomaga w audycie, lecz nie jest dowodem telemetrycznym.

Brakuje zestawu ręcznie ocenionych przypadków, który mierzyłby precision/recall
kategorii i specjalizacji na kilku emiterach i rodzajach zadań.

### Atrybucja credits

Podział procentowy jest estymacją opartą na tokenach i rozmiarze przechwyconych
elementów. Nie zna wewnętrznej formuły AIU providera. Nie przypisze inputu do
kategorii, gdy wynik narzędzia nie ma jednoznacznego call ID, nie został
przechwycony albo nie da się wskazać konsumenta.

Suma credits fazy i udział kategorii celowo odpowiadają na inne pytania:

- faza: ile pełnych credits zużyły wywołania w danym fragmencie sekwencji;
- kategoria: jaka część mierzalnych wywołań jest związana z danym działaniem.

### Pokrycie providerów

Transport OTLP jest wspólny, lecz semantyka atrybutów może różnić się między
wersjami VS Code i JetBrains. Nowy kształt musi otrzymać anonimowy fixture.
Nie należy dodawać warunku po nazwie providera, jeśli wystarcza relacja
strukturalna lub atrybut semantyczny.

### Widoczność skilli, indeksów i repo map

Aplikacja nie może twierdzić, że agent miał lub nie miał skilla, indeksu albo repo
mapy, jeśli telemetria tego nie opisuje. Obecnie można jedynie wskazać dominację
narzędzi uniwersalnych i poprosić użytkownika o sprawdzenie alternatywy.

### Porównanie efektów

Widok analizuje pojedynczą sesję. Nie ma jeszcze porównania „przed i po” ani
normalizacji względem podobnego zadania, modelu i wersji narzędzi. Bez takiej
kontroli nie wolno przypisywać spadku credits jednej zmianie.

### UI i wydajność

- bardzo długie sesje nadal tworzą szeroki szczegółowy diagram;
- zagregowane karty są skrótem, ale wieloetykietowe fazy mogą mieć długie nazwy;
- initial bundle Angulara przy ostatniej weryfikacji miał 776,34 kB i przekraczał
  budżet 750 kB o 26,34 kB;
- CSS komponentu mapy jest duży i mocno skompresowany, co utrudnia dalsze zmiany.

## Priorytet P0 — utrwalenie poprawności

### 1. Zestaw referencyjny klasyfikacji

Przygotować anonimowe przypadki obejmujące:

- czysty odczyt i wyszukiwanie;
- terminal łączący odczyt i walidację;
- modyfikację kodu;
- zapis pośredni i końcowy;
- odpowiedź bez tool calla;
- brak przechwyconego outputu;
- delegację z jednym i wieloma subagentami;
- brakującą, konfliktową i zmienioną definicję;
- narzędzie uniwersalne użyte bezpośrednio do celu;
- narzędzie domenowe i task-specific.

Dla każdego przypadku zapisać oczekiwany zbiór kategorii, specjalizację, fit i
uzasadnienie ograniczeń. Test promptu nie powinien wykonywać płatnego wywołania;
walidator można testować na zapisanych syntetycznych odpowiedziach.

### 2. Fixture'y emiterów

Dodać zanonimizowane fixture'y rzeczywistych kształtów:

- VS Code z wieloma tool callami i retencją wyników;
- JetBrains z capture content;
- delegacja, w której nested invoke powtarza ID rodzica;
- reasoning jako plaintext, `[encrypted]` i brak;
- jawny cache write;
- dropped attributes/elements.

Fixture ma zachować strukturę, ale nie prompt, kod, repo URL, użytkownika, sekrety
ani oryginalne identyfikatory.

### 3. Audyt istniejących dokumentów

Przy zmianie UI aktualizować równocześnie:

- `README.md`;
- `AGENTS.md`;
- `docs/klasyfikacja-narzedzi-ai.md`;
- niniejszy pakiet kontynuacyjny.

Szczególnie uważać na domyślne rozwinięcie diagramu, nazwy przycisków i kolejność
sekcji — te elementy zmieniały się w trakcie prac.

## Priorytet P1 — rekomendacje optymalizacyjne

Następny duży krok produktu to rekomendacje, ale powinny powstawać lokalnie z
połączenia kategorii i faktów. Sama odpowiedź AI nie może być rekomendacją.

### Kontrakt pojedynczej rekomendacji

```text
Tytuł
  → obserwowany sygnał i zakres rund
  → skala: credits, tokeny, liczba powtórzeń, pokrycie
  → hipoteza alternatywy
  → konkretne rundy do sprawdzenia
  → ograniczenie dowodu
```

Proponowany model danych:

```ts
interface OptimizationFinding {
  id: string;
  kind: 'RESULT_SIZE' | 'REPEATED_ACQUISITION' | 'GENERIC_TOOL_DENSITY'
    | 'DELEGATION_OVERLAP' | 'VALIDATION_SCOPE' | 'CONTEXT_RETENTION';
  title: string;
  phaseIds: string[];
  roundRefs: string[];
  evidence: EvidenceRef[];
  measuredCredits: number | null;
  creditCoverage: {covered: number; total: number};
  hypothesis: string;
  limitation: string;
}
```

Nie dodawać tego typu do publicznego API, dopóki rekomendacje pozostają czysto
frontendowym, deterministycznym wyliczeniem.

### Kandydaci na pierwsze reguły

#### Duże pozyskiwanie danych przez narzędzia uniwersalne

Warunki kandydackie:

- faza zawiera `ACQUIRE_DATA`;
- ma wysoki udział credits w badanym przepływie;
- większość tool calli używa `GENERAL_PURPOSE`;
- wyniki są przechwycone i mają znaczący rozmiar.

Komunikat powinien proponować sprawdzenie krótszych wyników, indeksu, repo mapy,
skilla lub narzędzia celowanego. Nie powinien stwierdzać, że obecny tool jest zły.

#### Powtarzane pozyskanie podobnych danych

Wymaga deterministycznego sygnału podobieństwa bez wysyłania pełnej treści:

- ta sama definicja i podobne kanoniczne argumenty;
- nakładające się ścieżki, zapytania lub zakresy;
- kolejne fazy `ACQUIRE_DATA` rozdzielone inną krótką akcją;
- jawne pokrycie, aby brak treści nie wyglądał jak brak powtórzeń.

#### Duży wynik zatrzymany w kontekście

Połączyć dokładny call ID z pierwszym i kolejnymi requestami, zmierzyć udział
przechwyconej treści i pokazać, przez ile wywołań wynik pozostawał w historii.
Hipotezą może być zapis artefaktu i przekazanie referencji lub krótszego summary.

#### Delegacja o dużym poddrzewie

Pokazać dokładne credits dziecka, liczbę jego rund, powtarzające się kategorie i
rozmiar finalnego zwrotu. Rekomendacja ma dotyczyć zakresu delegacji albo formatu
zwrotu, nie samego faktu użycia subagenta.

#### Szeroka walidacja

Wykrywać wyłącznie z widocznych argumentów, że model uruchomił pełny build lub
szeroki test zamiast zakresu celowanego. Trzeba uwzględniać, że pełna walidacja
może być wymagana i nie jest automatycznie stratą.

### Kolejność wdrożenia rekomendacji

1. Dodać czysto deterministyczny model `OptimizationFinding` i fixture'y.
2. Pokazać jedną rekomendację dla dominującej fazy z pełnym audytem.
3. Przetestować język na osobach, które nie znają OTLP.
4. Dopiero potem rozszerzać katalog reguł.
5. AI wykorzystać do formułowania opisu dopiero wtedy, gdy dane wejściowe i
   ograniczenia są jawne; decyzja o wyświetleniu rekomendacji powinna pozostać
   deterministyczna.

## Priorytet P2 — porównania i ocena efektu

### Porównanie sesji

Docelowy widok powinien porównywać dwa podobne przebiegi:

- ten sam typ zadania i repozytorium;
- model i limit kontekstu;
- liczba interakcji, wywołań głównego agenta i subagentów;
- tokeny fresh/cache/output;
- credits całego drzewa;
- udział kategorii i typów narzędzi;
- wielkość wyników wracających do modelu.

Różnica nie jest przyczynowością. UI powinno opisywać zmianę, a nie twierdzić, że
konkretna modyfikacja ją spowodowała.

### Eksport analizy

Jeśli wynik AI lub rekomendacje mają być eksportowane, należy przygotować nową,
wersjonowaną sekcję albo eksport v2. Nie zmieniać po cichu formatu v1.

### Historia definicji narzędzi

Przy wielu sesjach można pokazać, jak zmieniała się definicja i specjalizacja
narzędzia oraz czy po zmianie spadła liczba rund lub wielkość wyników. Wymaga to
stabilnego, prywatnościowego identyfikatora kanonicznej definicji.

## Dług techniczny do kontrolowania

- Rozdzielić duży arkusz `workflow-view.component.css` na czytelniejsze sekcje lub
  współwłaścicieli wizualnych bez tworzenia pustych wrapper components.
- Kontrolować budżet bundla i ustalić, czy wzrost pochodzi z Material, nowych
  parserów czy duplikacji kodu.
- Utrzymać `WeakMap` cache dla parsowanych spanów i nie parsować JSON-u w template.
- Nie dopuścić do równoległych płatnych klasyfikacji; backend ma obecnie jeden
  bounded worker i flagę `running`.
- Jeśli analiza rośnie, rozważyć limit requestu z komunikatem o niepełnym zakresie,
  zamiast cichego obcinania całych rund.
- Nie opierać trwałych migracji H2 na samym `CREATE TABLE IF NOT EXISTS`.

## Rejestr najważniejszych decyzji

| Decyzja | Uzasadnienie |
|---|---|
| Usunięto heurystyczne profile input/output z głównej mapy. | Opisywały kształt tokenów, ale nie mówiły użytkownikowi, czego model zażądał. |
| AI klasyfikuje definicje i konkretne żądania. | `run_in_terminal` może oznaczać odczyt, walidację lub zmianę; nazwa sama nie wystarcza. |
| Wyszukiwanie i odczyt połączono. | Oba dostarczają dane do dalszego modelu i mają wspólny cel optymalizacyjny. |
| Kategorie rund są wieloetykietowe. | Jedno polecenie może jednocześnie pozyskać dane i uruchomić walidację. |
| Cykl UI ma postać `M → A → M`. | Koszt kolejnego inputu wynika z wykonania wcześniejszych żądań. |
| Subagent jest poddrzewem delegacji rodzica. | Delegacja jest tool callem; wywołania dziecka nadal są osobnymi wywołaniami modelu. |
| Panel rundy jest faktograficzny. | Użytkownik potrzebuje jednego miejsca do audytu requestu i response bez dublowania klasyfikacji. |
| Podział kategorii pokazuje procenty. | Konkretne credits na kategoriach wyglądały jak dokładne dane billingowe. |
| Fazy pokazują pełne credits wywołań. | Ta wartość jest audytowalną sumą spanów należących do fazy. |
| Fazy nie są klikalne. | Przejście do dowodów odbywa się przez oznaczenia rund na szczegółowym diagramie. |
| Karty faz zawijają się i zachowują strzałki w prawo. | Unikamy poziomego scrolla i dodatkowej numeracji. |
| Szczegółowy diagram jest osobną sekcją i startuje rozwinięty. | Użytkownik widzi ścieżkę dowodu bez szukania kolejnego przełącznika. |

## Checklista następnego zadania

Przed zmianą:

- przeczytać `docs/kontynuacja/README.md` i odpowiedni dokument specjalistyczny;
- sprawdzić `git status --short` i zachować cudze zmiany;
- wskazać, czy zmiana dotyczy faktu, formuły czy interpretacji;
- odnaleźć właściciela warstwy i istniejące testy;
- przy semantyce providera obejrzeć raw fixture zamiast zgadywać.

Po zmianie:

- dodać test zachowania lub formuły, jeśli istnieje ryzyko regresji;
- uruchomić najmniejszy właściwy zestaw testów;
- dla frontendu uruchomić `npm run build`;
- dla backendu uruchomić `mvn "-Dskip.frontend=true" test`;
- sprawdzić brak sekretów, realnej telemetrii i wygenerowanego `target` w diffie;
- zaktualizować ten dokument, gdy zmienia się trwała decyzja produktu.
