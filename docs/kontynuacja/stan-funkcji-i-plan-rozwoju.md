# Stan funkcji i plan rozwoju

Stan dokumentu: 2026-09-11.

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
- oddzielenie technicznych wywołań osadzonych w tym samym trace od numeracji i
  sum głównych rund;
- zwartą belkę kosztową każdego jednoznacznie przypisanego wywołania
  `summarizeConversationHistory-full`, wraz z nazwą użytego modelu, także bez
  późniejszego requestu;
- łączny bilans kosztu agenta głównego, subagentów i kompaktowań oraz zwijane
  rozliczenie tych pozycji w identycznych kolumnach;
- globalne zestawienie narzędzi bez AI pod bilansem sesji, rozdzielone na zakładki
  `Niewykorzystane` i `Wykorzystane`, początkowo zwinięte i rozwijane chevronem;
  wiersze mają wspólną białą ikonę toola, a czerwony pill wyróżnia tylko stan
  niewykorzystany: bezpośrednio przechwycona dostępność
  definicji, liczba żądań modelu, wyniki odnalezione po
  dokładnym call ID oraz oznaczone `≈` estymacje treści definicji, wywołań i
  pierwszych odbiorów wyników; późniejsze przechwycone wystąpienia tego samego
  wyniku, tylko przed następnym kompaktowaniem sesji, mają osobną estymację udziału
  w cache read opartą na wyemitowanej proporcji `cache read / input łącznie` wraz
  z pokryciem metryką; kompletne zero użyć jest odróżnione od niepełnego capture
  outputu, a osobna suma wywołań i wyników jest pominięta; kolejność ustala
  pomocnicze `input + 10 × output`, gdzie definicje, pierwszy wynik i oszacowany
  cache należą do inputu, a żądania narzędzia do outputu;
  definicje używają cyjanu cache read, a tooltip opisuje proporcjonalną estymację
  i podkreśla, że wartość jest już sumą wszystkich rund z dostępną definicją,
  bez tłumaczenia wyboru koloru;
  kliknięcie nazwy lub ikony toola otwiera modal z wszystkimi wersjami definicji,
  czytelną listą parametrów i zwijanym pełnym JSON-em;
  zakładka niewykorzystanych wskazuje miejsca ograniczania narzędzi w VS Code bez
  opisywania mechaniki cache providera;
- aside kompaktowania z systemowymi zasadami i formatem rezultatu, poleceniem
  kompaktowania, opcjonalnym poleceniem użytkownika, messages, tools i rezultatem;
  wpływ na następny input jest
  pokazywany tylko po potwierdzonym użyciu wyniku;
- subagenci z własnymi wywołaniami i credits;
- prawy panel szczegółów rundy z rzeczywistym requestem i response;
- korelacja odpowiedzi narzędzia ze wcześniejszym żądaniem po call ID;
- czytelna lista argumentów z zawijaniem długiego tekstu;
- treść reasoning tylko wtedy, gdy provider ją jawnie emituje.

### Mapa pracy — tryb faktów

- wyemitowane zlecenie użytkownika;
- szczegółowy diagram rund głównego agenta i subagentów;
- warstwa `Kontekst` pokazująca zajętość okna w chwili wysłania;
- warstwa `Tokeny` z ułożonymi pionowo wykresami nowego inputu, cache read,
  outputu i cache write; każdy ma własną skalę oraz wartości narastające przy
  punktach, aby duży cache nie spłaszczał pozostałych pomiarów;
- warstwa `Credits` z narastającą sumą wyemitowanych credits;
- wybór rundy otwierający uniwersalny panel `M → A → M`;
- domyślnie rozwinięty diagram, możliwość ukrycia i poziome przewijanie przez
  przeciąganie tła oraz widoczne przyciski nawigacji dla długich przebiegów;
- jawne rozdzielenie liczników całej sesji agentów od liczników wybranej
  interakcji oraz numerowane pasy subagentów;
- limonkowy przycisk interakcji i cyjanowe przyciski dokładnie powiązanych
  kompaktowań bezpośrednio na głównej osi; ostatni węzeł `M…` jest pomarańczową
  odpowiedzią końcową bez dodatkowego, dublującego węzła końca;
  otwierają te same faktograficzne panele co zakładka kosztowa, a kompaktowania
  pozostają poza rundami agenta i klasyfikacją AI;
- stała szerokość kolumn wykresu, także dla jednoelementowych interakcji, bez
  deformowania elementów SVG.

### Mapa pracy — tryb kategorii

- analiza uruchamiana wyłącznie jawnie przez użytkownika;
- podgląd zakresu i szacunek tokenów przed wysłaniem;
- klasyfikacja unikalnych definicji oraz wszystkich żądań i rund;
- kategorie wieloetykietowe oparte na działaniach zażądanych przez model;
- połączenie wyszukiwania i odczytu w `Pozyskanie danych`;
- profil każdego agenta na podstawie jego własnych rund;
- zapis zwalidowanego wyniku w H2 i automatyczne przywrócenie bez kolejnego
  zapytania;
- procentowy podział credits według kategorii z resztą `Poza kategoriami` oraz
  lokalnie dodanym `Kompaktowaniem kontekstu`; jego wyemitowane credits wchodzą do
  wspólnego mianownika bez wysyłania kompaktowania do AI;
- dominujący obszar i ostrożna wskazówka do sprawdzenia;
- fazy tworzone z sąsiednich rund o identycznym zestawie kategorii oraz osobne,
  chronologiczne karty kompaktowań oparte na telemetrii;
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
- globalny provider `material-symbols-outlined` obejmuje routed UI i dynamiczne
  modale, dzięki czemu ligatury ikon nie są prezentowane jako obcięty tekst;
- po podziale na lazy routes initial bundle Angulara ma 295,77 kB, ale chunk
  strony sesji pozostaje duży — 394,40 kB;
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

Pierwszy przekrój poradnika bez AI jest wdrożony: topbar otwiera wspólny prawy
panel, a wersjonowany katalog `techniques-v1` udostępnia pełne T01–T16 przez
lokalne `GET /api/optimization/techniques`. Użytkownik może
wybrać temat i od razu zobaczyć problem kosztowy, oczekiwany rezultat, rozbudowany
przykład oraz sposób porównania całych przebiegów przed/po. Warunki, prostszy
wariant, pierwszy eksperyment, nakład i utrzymanie pozostają częścią techniki,
a kompletny plan próby można skopiować bez sesji oraz wywołania modelu.

Integracja G3 jest wdrożona: ranking i dominujący obszar, karty faz oraz
faktyczne kompaktowanie otwierają ten sam poradnik z zakresem, pochodzeniem
pomiaru, pokryciem i statycznie dobranymi technikami. Samo otwarcie nie wykonuje
nowej analizy AI ani nie wysyła danych sesji. Fazy korzystają ze wspólnego,
czystego grupowania. Poradnik pokazuje klikalne rundy lub kompaktowania jako
dowody; ich szczegóły otwierają się w istniejącym panelu faktów, a powrót zachowuje
wybraną technikę, rozwinięcia i pozycję przewijania.

Pierwszy przekrój G4 także jest wdrożony bez inferencji: dla konkretnej fazy lub
jednego kompaktowania aplikacja buduje lokalny, zamrożony pakiet
`optimization-advice-v1`. Użytkownik widzi dokładny JSON, zakres, fingerprint,
pochodzenie obserwacji, braki, pominięcia, rozmiar i szacowany input. Pakiet ma
reguły próbkowania i redakcji sekretów oraz nie zawiera ról system/developer ani jawnego
reasoning. Aktualne wskaźniki prowadzą do rekordów znormalizowanych, dlatego
lokalny backend porównuje ich pełny hash, sprawdza raw signal, metryki, wersje,
allowlistę technik i relację sesji. Zweryfikowana migawka jest zapisywana na 30
minut, ale model nie jest uruchamiany.

Pakiet fazy korzysta z `guidance-evidence-v2`: wszystkie rundy zachowują zwarty,
weryfikowalny rekord metryk i kategorii, natomiast duże treści są wybierane z
reprezentatywnych miejsc całej fazy zamiast z pierwszych 16 fragmentów. Definicje
narzędzi są deduplikowane, pominięcia zgrupowane, a frontend i backend liczą
referencje jako unikalne spany. Lokalne liczby rund, obserwacji, referencji,
fragmentów i znaków nie blokują analizy. Są widoczne w podglądzie i sterują
próbkowaniem, ale jedyną bramką rozmiaru pełnego promptu pozostaje rzeczywiste okno
kontekstowe skonfigurowanego modelu, egzekwowane przez dostawcę.

Jawne doradztwo dla tej migawki jest już wdrożone: **Wyślij do AI** przekazuje
tylko `previewId`, backend ponownie kontroluje źródła, współdzieli globalny slot
inferencji z klasyfikacją, uruchamia izolowany prompt bez narzędzi i waliduje
odpowiedź. UI pokazuje propozycje jako hipotezy do próby wraz z nakładem,
utrzymaniem, jakością, porównaniem i linkami do dowodów. Cache obejmuje model,
wersję promptu, request hash i fingerprint. Nie wykonano jeszcze ręcznego testu
na rzeczywistym koncie Copilot ani edycji fragmentów pakietu przed wysłaniem.
Kolejność określa
[plan G0–G12](../plan-technik-optymalizacji-bez-ai-i-z-ai.md). Pierwszy przyrost
G9/G10 jest wdrożony: w szczegółowej mapie użytkownik wybiera początek i koniec
jednego ciągłego zakresu tej samej interakcji i agenta, widzi jego credits oraz
pokrycie, a następnie otwiera dedykowany modal. Modal pokazuje zamrożony materiał,
pozwala wybrać model z katalogu GitHub Copilot SDK i rozpocząć rozmowę własnym
pytaniem albo podpowiedzią. Starter nie wysyła danych automatycznie.

Pierwsza tura tworzy trwałą sesję SDK, a kolejne używają `resumeSession`; własna
historia i migawka są zapisywane lokalnie w H2, zaś klient/CLI jest zamykany po
każdej turze. Narzędzia, skills, MCP, pamięć, repo i discovery pozostają wyłączone.
Odpowiedź rozdziela wyjaśnienia oparte na referencjach, hipotezy oraz wiedzę
ogólną. Migawka zachowuje przechwycone granice wejść, odpowiedzi, wykonań i
następnego requestu, a backend przed i po inferencji kontroluje ich przynależność
do raw telemetry. Lokalne liczby znaków i fragmentów nie blokują wysyłki; jedyną
bramką rozmiaru jest rzeczywiste okno wybranego modelu egzekwowane przez providera.

Pozostały: klikalny powrót z odpowiedzi do dokładnego dowodu, ręczna redakcja,
podgląd każdej kolejnej wysyłki, obsługa niepewnego wyniku/retencji i przypadki
kompaktowania wewnątrz zakresu. G11 — nieciągłe segmenty i kilka ścieżek agentów —
pozostaje planowane. G12 dodaje po jawnym wyborze osobny tryb `Telemetria + projekt`:
zatwierdzone mapowanie repozytorium na lokalny katalog, kontrolę zgodności stanu,
cztery celowane narzędzia tylko do odczytu i osobne cytowania plików. Domyślna
rozmowa telemetryczna nadal nie ma dostępu do projektu. Rozmowa jest osobnym
kontraktem od wyboru technik i nie
zamienia hipotez AI ani deklaracji użytkownika w fakty telemetryczne.

Poniższy kontrakt dotyczy automatycznych findingów powstających lokalnie z
połączenia kategorii i faktów. Sama odpowiedź AI nie tworzy dowodu problemu.
Nie blokuje to statycznego poradnika ani propozycji AI oznaczonej jako hipoteza
do przetestowania, z warunkami, nakładem i obowiązkami utrzymania.

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
5. AI wykorzystać do formułowania opisu findingu dopiero wtedy, gdy dane wejściowe
   i ograniczenia są jawne; jego automatyczne wykrycie pozostaje deterministyczne.
   Osobne doradztwo na żądanie realizować według planu G4–G6, nie uzależniając
   udostępnienia poradnika od wcześniejszego wdrożenia wszystkich findingów.

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
