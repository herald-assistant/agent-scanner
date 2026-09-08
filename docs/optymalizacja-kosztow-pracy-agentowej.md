# Strategia optymalizacji kosztów pracy agentowej z AI

Stan dokumentu: 2026-09-07.

## Cel dokumentu

Ten dokument wyznacza kierunek rozwoju rekomendacji optymalizacyjnych w Agent
Scannerze. Łączy wnioski z przekazanych materiałów szkoleniowych z obowiązującą w
produkcie zasadą **dowód przed wnioskiem**. Jest punktem startowym do przygotowania
dedykowanych stron z poradami, przykładami i eksperymentami „przed/po”.

Szczegółową kolejność prac, katalog 16 technik, ekrany, kontrakty danych i testy
opisuje [plan wdrożenia poradnika i doradztwa AI](plan-technik-optymalizacji-bez-ai-i-z-ai.md).
Rozdziela techniki edukacyjne dostępne bez dodatkowego AI, obserwacje oparte
na faktach oraz propozycje eksperymentów AI na osobne żądanie dla wybranej fazy,
kategorii lub kompaktowania. Rozszerzenie G9–G11 pozwala zaznaczyć rundy na
szczegółowym diagramie, zadać własne pytanie i prowadzić rozmowę o tym fragmencie.
Automatyczny finding nie jest warunkiem poznania techniki, pytania o przebieg
ani poproszenia o alternatywy.

Rozmowa ma własny kontrakt, wersjonowaną migawkę dowodów i jawny koszt kolejnych
wywołań (brak pomiaru pozostaje brakiem). Nie każde wyjaśnienie wymaga rekomendacji.
Pierwsze wejście wybranego odcinka i rzeczywiste dalsze requesty zachowują osobne
granice; początkowy kontekst nie jest automatycznie wspólną pamięcią wszystkich
rund i agentów. Użytkownik widzi przerwy, źródła wspierające oraz hipotezy.

Strategia odpowiada na pięć pytań:

1. Co faktycznie tworzy koszt w pracy agentowej?
2. Jakie zmiany architektury i sposobu pracy mają największy potencjał?
3. Jak Agent Scanner powinien formułować rekomendację, aby nie mylić hipotezy z
   dowodem?
4. Jak sprawdzić, czy optymalizacja nie obniżyła jakości, bezpieczeństwa ani
   kontroli procesu?
5. Jak odróżnić problem sposobu pracy agenta od błędnej, nieaktywnej albo zbyt
   późno załadowanej konfiguracji?

W tym dokumencie słowo „koszt” oznacza łącznie zużycie zmierzonych credits,
tokenów, wywołań modelu i czasu. Credits są GitHub Copilot AI credits, a nie walutą
ani źródłem dokładnego rozliczenia finansowego.

## Synteza materiałów szkoleniowych

Materiały pokazują agentowy system AI jako pętlę, w której runtime:

1. buduje request z instrukcji, celu użytkownika, stanu rozmowy, kontekstu
   workspace, wyników wcześniejszych narzędzi, skilli i definicji narzędzi;
2. wysyła request do modelu;
3. odczytuje odpowiedź modelu i wykonuje żądane akcje;
4. dodaje ich wyniki do następnego requestu;
5. powtarza cykl aż do odpowiedzi końcowej albo warunku stopu.

Najważniejszy wniosek brzmi:

> Koszt pracy agentowej powstaje nie tylko podczas generowania odpowiedzi. Rośnie
> przy każdym ponownym przeniesieniu instrukcji, historii, schematów narzędzi,
> wyników i artefaktów przez granicę model–agent lub agent–agent.

Materiały wskazują również, że:

- planowanie jest osobnym trybem pracy, który kupuje rozpoznanie, jawne decyzje i
  kontrolę, ale może kosztować więcej niż bezpośrednie wykonanie;
- szeroki katalog narzędzi zajmuje miejsce w każdym requeście, nawet gdy większość
  narzędzi nie zostanie użyta;
- dobrze zaprojektowany skill ogranicza improwizację, lecz pełną treść trzeba
  rzeczywiście załadować, a nie tylko umieścić skill w indeksie;
- mapy projektu, indeksy i dedykowane narzędzia mogą zastąpić wielorundowe,
  uniwersalne wyszukiwanie celowanym pobraniem faktów;
- handoff między agentami tworzy nowy output i nowy input, więc nie jest darmowym
  transferem pamięci;
- artefakt przekazany przez referencję może ograniczyć wielokrotne przepisywanie
  tej samej wiedzy;
- wspólna sesja ze skillami usuwa część kosztu handoffów, ale zwiększa ryzyko
  zatrzymania nadmiarowego kontekstu;
- kontrakt wyniku, walidacja i warunki stopu ograniczają zbędne rundy oraz
  niekontrolowane rozszerzanie zakresu;
- sama obecność customizacji nie dowodzi jej poprawności, dopasowania ani
  faktycznego użycia przez runtime;
- porównanie wykonania z konfiguracją wymaga historycznej migawki obowiązującej
  podczas sesji, a nie bieżącego stanu plików;
- po kompaktowaniu warto mierzyć dokładnie potwierdzone ponowne pozyskiwanie
  danych, nie deklarować ogólnie sukcesu lub porażki „rehydracji”.

Te obserwacje są dobrymi hipotezami projektowymi. Same slajdy nie są jednak
uniwersalnym benchmarkiem ani dowodem zachowania każdej wersji providera.
Przedstawione w nich wartości, np. porównanie jednego i pięćdziesięciu narzędzi
albo trybu domyślnego i planowania, służą jako przykłady mechanizmu. Nie należy z
nich tworzyć stałych progów rekomendacji.

## Cel nadrzędny

Optymalizujemy **koszt uzyskania zaakceptowanego wyniku**, a nie najniższą liczbę
tokenów w oderwaniu od rezultatu.

```text
wartość optymalizacji
  = mniejszy zmierzony ciężar przepływu
  + zachowana lub lepsza jakość wyniku
  + akceptowalne ryzyko i wysiłek utrzymania
```

Redukcja credits lub liczby rund nie jest sukcesem, jeśli równocześnie:

- rośnie liczba błędów albo poprawek użytkownika;
- pomijane są wymagane testy lub kontrola bezpieczeństwa;
- wynik staje się niekompletny albo trudny do audytu;
- rozwiązanie wymaga kosztownego w utrzymaniu komponentu, który rzadko się zwraca;
- oszczędność wynika wyłącznie z braku telemetrii.

## Model kosztu, który ma stosować produkt

### Jednostką analizy jest całe drzewo pracy

Koszt sesji jest rozłączną sumą zmierzonych wywołań:

```text
agent główny
  + jednoznacznie powiązani subagenci
  + jednoznacznie przypisane wywołania kompaktowania
```

Delegacja rodzica i wywołania dziecka są powiązanym przepływem, ale nie wolno
liczyć credits poddrzewa drugi raz jako dodatkowego kosztu delegującego tool calla.

### Nie istnieje jedna wystarczająca metryka

Dla sesji, interakcji i rund należy obserwować równolegle:

| Wymiar | Co mierzymy | Jak czytać |
|---|---|---|
| Liczba wywołań | główny agent, subagenci, wywołania pomocnicze i kompaktowanie | Więcej wywołań zwykle powiela część stałego kontekstu, ale może kupować kontrolę lub specjalizację. |
| Nowy input | `max(0, inputTokens - cacheReadTokens)` | Najbliższy pomiar nowej treści wysłanej do modelu. |
| Cache read | wyemitowany cache read | Nie jest automatycznie stratą; wysoki cache może oznaczać skuteczne użycie stabilnego prefiksu. |
| Cache write | wartość tylko wtedy, gdy została wyemitowana | Nie wolno jej estymować z różnic cen lub tokenów. |
| Output | wyemitowane output tokens | Duży output może stać się drogim inputem kolejnych rund lub agentów. |
| Reasoning | wyemitowany licznik tokenów reasoning | Brak treści reasoning nie pozwala jej rekonstruować. |
| Credits | wyemitowane Copilot AI credits | Służą do porównania ciężaru wywołań, nie do obliczania waluty. |
| Kontekst | input względem wyemitowanego limitu | Pokazuje presję w chwili wysłania, nie jakość wykorzystania okna. |
| Czas | suma czasów modeli i osobno czas ścienny sesji | Te wartości odpowiadają na różne pytania i nie powinny być mieszane. |
| Jakość | wynik testów, potwierdzone błędy, akceptacja kryteriów | Jest bramką bezpieczeństwa dla oszczędności. |

### Koszt przepływu informacji

W pętli `M → A → M` należy szukać czterech multiplikatorów:

1. **Powtarzalny kontekst stały** — instrukcje, opis roli, aktywne skille i
   definicje narzędzi obecne w kolejnych requestach.
2. **Narastający kontekst roboczy** — historia, odczytane pliki, wyniki terminala,
   błędy i artefakty pośrednie.
3. **Liczba granic** — każda dodatkowa runda lub handoff może ponownie wysłać i
   zinterpretować część danych.
4. **Szerokość odpowiedzi** — output modelu i tool result mogą wejść do wielu
   późniejszych requestów.

Dlatego optymalizacja pojedynczego promptu bywa mniej istotna niż zmiana sposobu
retrievalu, granicy delegacji albo formatu wyniku.

## Zasady formułowania rekomendacji

### 1. Rekomendacja jest hipotezą, nie werdyktem

Agent Scanner może powiedzieć „sprawdź możliwość skrócenia wyniku”, gdy widzi
duży result zatrzymany w kolejnych requestach. Nie może powiedzieć „ten wynik
zmarnował 30% kosztu”, jeśli provider nie wyemitował takiej atrybucji.

### 2. Automatyczny finding wymaga deterministycznej reguły

Wynik AI może dostarczyć kategorie działań i ocenę specjalizacji narzędzia.
Ostateczny finding powinien jednak wynikać z jawnej reguły łączącej:

- fakty telemetryczne;
- deterministyczne relacje, np. dokładny call ID;
- wyliczenia z opisanym pokryciem;
- opcjonalne, jawnie oznaczone kategorie AI.

AI może pomóc zredagować opis findingu, ale nie zastępuje reguły jego wykrycia.
Osobne doradztwo uruchomione przez użytkownika może dobierać techniki i proponować
eksperymenty. Musi odróżniać obserwacje od hipotez, podawać warunki i utrzymanie,
a także dopuszczać brak wystarczających danych lub sensownej alternatywy.

### 3. Obserwacja dotycząca sesji prowadzi do konkretnego dowodu

Karta musi wskazać interakcję, fazę i rundy, a z niej użytkownik powinien przejść
do faktograficznego panelu `M → A → M`.

Technika edukacyjna może opierać się na oznaczonym przykładzie syntetycznym,
bez sesji użytkownika. Spersonalizowana propozycja AI wskazuje użyte obserwacje
i ograniczenia; samo wskazanie dowodu nie potwierdza skuteczności alternatywy.

### 4. Skala opisuje ciężar obserwacji, nie obiecaną oszczędność

Można pokazać zmierzone credits rund objętych findingiem, tokeny, rozmiar wyniku,
liczbę powtórzeń i pokrycie. Nie wolno przedstawiać tych wartości jako kwoty, którą
na pewno da się odzyskać.

### 5. Brak danych jest częścią wyniku

Brak treści, call ID, credits albo definicji narzędzia ogranicza siłę rekomendacji.
Nie zastępujemy go zerem, podobieństwem czasowym ani przekonującym opisem AI.

### 6. Optymalizacja musi mieć plan walidacji

Każda propozycja kończy się minimalnym eksperymentem: co zmienić, na jakich
zadaniach powtórzyć pomiar, jakie metryki porównać i jakie kryterium jakości musi
pozostać spełnione.

## Granica rozszerzenia: audyt środowiska agentowego

Obecny Agent Scanner wyjaśnia przede wszystkim to, co zostało wyemitowane w
telemetrii. Audyt plików customizacji, instrukcji, skilli i konfiguracji runtime'u
jest nową warstwą produktu. Wymaga jawnej decyzji o rozszerzeniu zakresu,
uprawnienia do odczytu ograniczonego zestawu źródeł oraz osobnego modelu
prywatności. Nie powinien niepostrzeżenie zmieniać aplikacji w ogólny skaner
repozytorium.

Docelowy audyt powinien rozdzielać sześć kolejnych pytań:

```text
czy customizacja była dostępna
  → czy była poprawna
  → czy pasowała do zadania
  → czy trafiła do requestu albo została odczytana
  → czy stało się to przed pierwszą istotną akcją
  → czy agent wykonał obserwowalne kroki wymaganej procedury
```

Każdy poziom ma inny rodzaj dowodu. Poprawność ścieżki, nazwy, frontmatteru,
obsługiwanych pól, `applyTo`, referencji i zadeklarowanych narzędzi można oceniać
deterministycznie względem wersjonowanej specyfikacji. Dopasowanie semantyczne,
jakość opisu i sens procedury są interpretacją AI i muszą pozostać oznaczone jako
hipoteza.

### Historyczna migawka konfiguracji

Porównywanie telemetrii z bieżącym stanem plików może prowadzić do fałszywych
wniosków. Audyt musi odnosić się do konfiguracji obowiązującej podczas badanej
sesji. Minimalna migawka powinna zawierać:

- logiczną ścieżkę i rodzaj customizacji;
- zakres źródła: workspace, użytkownik, organizacja lub host;
- hash treści, a pełną treść tylko po świadomej zgodzie;
- wynik walidacji i wersję specyfikacji, według której ją wykonano;
- czas przechwycenia oraz commit i stan worktree, jeżeli są dostępne;
- jawne oznaczenie źródeł, których nie można było odczytać.

Brak dostępu do konfiguracji użytkownika, organizacji albo hosta oznacza
`niewystarczające dane`, a nie `konfiguracji nie było`. Hash pozwala wykrywać
zgodność i zmianę bez domyślnego przechowywania potencjalnie wrażliwej treści.

### Warstwy raportu

Ekran audytu powinien prowadzić trzema osobnymi warstwami:

1. **Fakty** — przechwycone pliki, wyniki walidacji, requesty, odczyty i kolejność
   zdarzeń.
2. **Niespójności** — deterministyczne różnice między deklaracją, konfiguracją a
   obserwowanym wykonaniem.
3. **Hipotezy AI** — możliwa przyczyna, poprawa opisu, promptu albo procedury.

Nie należy łączyć tych warstw w arbitralny wynik typu `73/100`. Siła komunikatu
wynika z kompletności dowodów, nie z pewności zadeklarowanej przez model.

## Portfel strategii optymalizacyjnych

### A. Dobieraj tryb pracy do ryzyka i niepewności

**Problem:** faza planowania i discovery może utworzyć wiele dodatkowych wywołań,
odczytów oraz zapisów stanu, zanim powstanie zmiana.

**Stosuj planowanie**, gdy zadanie jest duże, niejasne, ryzykowne, wymaga decyzji
architektonicznych, jawnej akceptacji albo rozdzielenia discovery od wykonania.

**Preferuj bezpośrednie wykonanie**, gdy zmiana jest mała, lokalna, odwracalna,
dobrze opisana i ma szybki test.

**Eksperyment:** porównaj podobne zadania w obu trybach pod względem liczby
wywołań, nowego inputu, outputu, credits, czasu i wyniku testów. Nie porównuj
niepodobnych zadań ani różnych modeli jako jednego testu przyczynowego.

### B. Umieszczaj reguły w prawidłowej warstwie konfiguracji

| Warstwa | Umieszczaj tutaj | Nie umieszczaj tutaj |
|---|---|---|
| Prompt | cel bieżącej rozmowy, jednorazowe ograniczenia i aktualny zakres | stałe zasady projektu i długie procedury powtarzane ręcznie |
| Instructions | trwałe standardy repozytorium, technologii i organizacji | workflow jednego typu zadania albo jednorazowe decyzje |
| Skill | procedura zadania, wymagane wejścia, kontrakt wyniku, walidacja i stop rules | globalne standardy całego projektu albo tożsamość każdej roli |
| Agent | lokalny cel, perspektywa, odpowiedzialność, dostępne narzędzia i styl współpracy | wspólne procedury wszystkich zadań i kopie globalnych instrukcji |

Prawidłowy podział redukuje ręczne powtarzanie wiedzy i ogranicza konfliktujące
instrukcje. Nie gwarantuje jednak, że runtime załaduje plik. Obecność skilla lub
instrukcji trzeba potwierdzić telemetrią, gdy emitter ją udostępnia.

### C. Projektuj skille jako procedury ograniczające improwizację

Dobry skill powinien zawierać:

1. stabilną, zadaniową nazwę;
2. opis mówiący **kiedy** użyć skilla i kiedy go nie używać;
3. zakres problemu i granice odpowiedzialności;
4. wejścia wymagane i opcjonalne oraz warunek dopytania;
5. kolejność działań;
6. kontrakt wyniku;
7. walidację, warunki stopu i fallback.

Semantyka indeksu powinna nie tylko sugerować dopasowanie. Jeśli runtime na to
pozwala, powinna jasno wskazywać obowiązek odczytu pełnego `SKILL.md` przed daną
klasą działań. Efekt oceniamy po faktycznym odczycie lub innym markerze emitera,
nie po samej obecności nazwy w katalogu.

**Eksperyment:** dla powtarzalnego zadania porównaj liczbę błędnych startów,
odczytów, rund korekcyjnych i nieudanych walidacji przed i po wprowadzeniu skilla.

### D. Ograniczaj katalog narzędzi do potrzeb zadania

**Mechanizm:** definicje i schematy narzędzi mogą być częścią requestu, więc szeroki
katalog zużywa okno zanim agent wykona pierwszą akcję.

**Zmiana:** udostępniaj role-based lub task-based zestaw narzędzi. Ładuj rzadkie
grupy dopiero wtedy, gdy są potrzebne. Usuwaj duplikaty o nakładających się
kontraktach.

**Dowód:** porównuj pełny `input_tokens` requestu i widoczne definicje narzędzi.
Rozmiar pojedynczej definicji można pokazać jako przybliżenie nawigacyjne, ale nie
przypisywać jej dokładnej liczby tokenów bez pomiaru providera.

**Ryzyko:** zbyt wąski katalog może dodać rundę potrzebną do przełączenia zestawu
albo pozbawić agenta ważnego fallbacku.

### E. Najpierw mapa lub indeks, potem celowany research

**Mechanizm:** bez punktu startowego agent może wielokrotnie przeszukiwać strukturę
projektu i czytać szerokie fragmenty kodu.

**Zmiana:** utrzymuj lekką mapę modułów, endpointów, symboli, testów i dokumentów.
Mapa ma wskazywać, gdzie zweryfikować fakt, a nie zastępować kod, test lub dokument
źródłowy.

Skuteczny cykl ma trzy elementy:

1. utworzenie mapy jako kontrolowany koszt początkowy;
2. aktualizacja tylko fragmentów dotkniętych zmianą;
3. jawne użycie mapy przed szerokim researchem.

**Eksperyment:** zmierz liczbę operacji wyszukiwania i odczytu, nowy input oraz
credits faz `Pozyskanie danych` dla podobnych zadań z mapą i bez niej.

### F. Zastępuj ręczne discovery dedykowanym narzędziem, gdy fakt jest algorytmiczny

**Mechanizm:** uniwersalny researcher często wykonuje sekwencję `tree → search →
read → interpretacja`. Jeśli potrzebną relację można policzyć deterministycznie,
narzędzie może zwrócić mały, zadaniowy wynik w jednym kroku.

Przykładowe kontrakty:

- `getEndpointFlow(endpoint)`;
- `getHandlerSlice(symbol)`;
- `findTestsForSymbol(symbol)`;
- `getDependencyPath(from, to)`.

Narzędzie powinno filtrować i strukturyzować fakty, a model interpretować wynik i
podejmować decyzję. Szeroki researcher pozostaje fallbackiem dla przypadków
dynamicznych i brzegowych.

**Decyzja inwestycyjna:** dedykowany tool ma koszt budowy, testów i utrzymania.
Warto go tworzyć dla częstego, powtarzalnego wzorca o stabilnym kontrakcie, a nie
dla jednorazowej sesji.

### G. Ograniczaj wielkość i czas życia wyników w kontekście

**Mechanizm:** duży tool result może zostać wysłany do jednego lub wielu kolejnych
wywołań modelu. Ten sam wynik może więc obciążać sesję dłużej niż samo wykonanie
narzędzia.

Możliwe interwencje:

- filtrowanie i paginacja po stronie narzędzia;
- limit liczby trafień i rozmiaru fragmentu;
- zwrot identyfikatora, ścieżki i krótkiego wyciągu zamiast całego artefaktu;
- zapis dużej treści do pliku i przekazanie referencji;
- usuwanie wyników po ich wykorzystaniu, jeśli runtime wspiera takie sterowanie;
- kompaktowanie dopiero wtedy, gdy koszt i ryzyko utraty szczegółu są uzasadnione.

**Dowód:** dokładny call ID powinien łączyć żądanie, result, pierwszy request
odbierający i kolejne requesty, w których treść została rzeczywiście zachowana.

### H. Projektuj granice delegacji, zamiast domyślnie mnożyć agentów

Wybór architektury zależy od przepływu wiedzy:

| Wzorzec | Najlepsze zastosowanie | Główny koszt lub ryzyko |
|---|---|---|
| Jedna sesja + skille | silnie zależne, sekwencyjne etapy korzystające z tego samego kontekstu | szum i zatrzymanie zbyt wielu surowych danych |
| Handoff przez artefakt | trwały, weryfikowalny wynik potrzebny kolejnemu etapowi | koszt utworzenia i odczytu artefaktu |
| Inline handoff | mały, jednorazowy zwrot bez wartości jako osobny artefakt | pełny output może przejść przez orkiestratora i zostać wysłany ponownie |
| Subagent | izolacja, równoległość, specjalistyczna rola albo niezależny review | własne instrukcje, tools, rundy i ponowne discovery |

Subagent powinien dostać precyzyjny zakres, wymagane wejścia, format zwrotu i
warunek zakończenia. Rodzic nie powinien powtarzać researchu dziecka bez powodu.
Jeśli pełny wynik jest duży lub wielokrotnie używany, preferowany jest artefakt z
krótką referencją.

**Eksperyment:** porównaj całe rozłączne drzewo credits, rundy dziecka, rozmiar
zwrotu, powtórzone akcje `Pozyskanie danych` i jakość wyniku. Sam fakt użycia
subagenta nie jest wadą.

### I. Rozdzielaj planowanie od wykonania tylko wtedy, gdy kupuje to kontrolę

Plan powinien być trwałym, zwięzłym artefaktem zawierającym cel, kontekst i
decyzje, kroki, status oraz zasady walidacji. Nie powinien kopiować wszystkich
odczytanych materiałów.

Jeżeli plan ma obowiązywać w kolejnej fazie, jego użycie potwierdza rzeczywisty
odczyt lub narzędzie pamięci, a nie samo wystąpienie frazy „current plan” w
instrukcjach.

Plan mode jest kontrolą procesu, nie domyślną optymalizacją kosztu. Najlepiej
sprawdza się przy zadaniach, w których koszt błędnej implementacji przewyższa
koszt dodatkowego discovery.

### J. Wprowadzaj kontrakty wyniku, walidację i stop rules

Kontrakt wyniku ogranicza wariancję odpowiedzi i pozwala przekazać dalej mały,
powtarzalny artefakt. Powinien opisywać wymagane sekcje, maksymalny użyteczny
poziom szczegółu oraz sposób oznaczania braków.

Walidacja odpowiada na pytanie „czy wynik jest poprawny”, a stop rule „kiedy
zakończyć działanie”. Razem ograniczają:

- poprawianie bez odtworzenia błędu;
- zmianę większą niż wymaga zadanie;
- wielokrotne uruchamianie równoważnej walidacji;
- kontynuację po osiągnięciu kryterium;
- tworzenie kolejnych podsumowań tego samego wyniku.

Zakres testu powinien być najwęższy, który daje wystarczający dowód dla bieżącego
etapu. Pełny build lub regresja mogą pozostać obowiązkową bramką końcową.

### K. Traktuj kompaktowanie jako osobną inwestycję w kontekst

Kompaktowanie samo jest wywołaniem modelu i ma własny input, output, czas oraz
credits. Jego wynik może zmniejszyć kolejne requesty, ale sam spadek inputu nie
dowodzi kompletności ani udanej rehydracji.

Ocena kompaktowania wymaga:

- pokazania jego własnego kosztu;
- jednoznacznego powiązania z rozmową;
- potwierdzenia, że rezultat pojawił się w późniejszym requeście;
- oddzielenia zmiany zajętości okna od oceny jakości streszczenia;
- sprawdzenia, czy po kompaktowaniu nie wzrosło ponowne pozyskiwanie utraconych
  faktów.

#### Ponowne pozyskiwanie kontekstu po kompaktowaniu

Jednostką analizy jest faktyczne wywołanie kompaktora. Nie wymagamy osobnego,
umownego zdarzenia `compaction`, jeżeli samo wywołanie i jego treść są widoczne.
Potencjalny łańcuch kosztu wygląda tak:

```text
wywołanie kompaktora
  → potwierdzony odbiór wyniku w późniejszym requeście
  → późniejszy nowy input
  → ponowne odczyty, wyszukania lub dostarczenie tych samych wyników
```

Powtórzenie można uznać za dokładne tylko przy zgodnych call ID, hashach treści
albo kanonicznych argumentach. Semantycznie podobny odczyt bez takiego łącza jest
hipotezą AI. Nawet dokładne ponowienie nie dowodzi błędu kompaktowania: plik mógł
się zmienić, zakres zadania mógł się rozszerzyć, a ponowna walidacja mogła być
wymagana. Produkt powinien mówić o **ponownym pozyskiwaniu po kompaktowaniu**, a
nie o „nieudanej rehydracji”, dopóki nie istnieje dowód zachowania i późniejszego
wykorzystania konkretnego faktu.

Możliwe eksperymenty obejmują zmianę momentu kompaktowania, zachowanie krótkiego
indeksu faktów i otwartych decyzji, ograniczenie wielkości surowych wyników przed
kompaktowaniem oraz wymuszenie referencji do trwałych artefaktów.

### L. Audytuj aktywację customizacji, nie tylko jej obecność

Samo istnienie `SKILL.md`, instructions albo definicji agenta nie oznacza, że
runtime użył ich w badanej sesji. Dla każdej relewantnej customizacji należy
pokazać osobno:

- dostępność w historycznej migawce;
- poprawność strukturalną względem właściwej specyfikacji;
- regułę dopasowania do zadania;
- zaobserwowane przekazanie w requeście lub odczyt pełnej treści;
- czas aktywacji względem pierwszej istotnej akcji;
- zgodność z krokami procedury, które da się potwierdzić telemetrycznie.

Odczyt pełnego skilla można korelować z hashem przechwyconego `SKILL.md` i
wynikiem narzędzia odczytującego plik. Nie trzeba wymagać ręcznego markera w
promptach. Brak odczytu przy niepełnej telemetrii pozostaje brakiem danych.
Narzędzie dostępne, lecz niewykorzystane, nie jest automatycznie problemem.

Naruszenie procedury jest deterministyczne wyłącznie wtedy, gdy skill zawiera
jawny, obserwowalny krok obowiązkowy, np. uruchomienie testu przed edycją, i pełna
telemetria dowodzi przeciwnego porządku. Ocena, czy opis skilla był dostatecznie
jasny albo czy agent „powinien był” go wybrać, należy do warstwy hipotez AI.

W analizie wielu sesji warto mierzyć współczynnik obserwowanej aktywacji,
czas do pierwszego załadowania, liczbę rund przed aktywacją i zmianę tych wartości
po modyfikacji nazwy lub opisu. Jedna sesja pokazuje symptom; seria podobnych sesji
ujawnia powtarzalny wzorzec, nadal bez automatycznego dowodu przyczynowości.

### M. Audytuj jakość promptu początkowego jako hipotezę AI

Prompt początkowy można oceniać pod kątem obecności celu, zakresu, wymaganych
wejść, kryterium zakończenia i kontraktu wyniku. Faktycznymi sygnałami problemu są
np. późniejsze pytanie o brakujące dane, rozszerzenie zakresu, powtarzane discovery
albo korekta formatu odpowiedzi. Nie dowodzą one jednak, że winny był prompt.

Agent Scanner może pokazać brakujące elementy i zaproponować zwięzłą wersję
promptu do kolejnego eksperymentu. Taka sugestia musi być oznaczona jako hipoteza
AI i nie może samodzielnie tworzyć deterministycznego findingu. Treść promptu jest
wrażliwa; wysłanie jej do dodatkowego modelu wymaga jawnej akcji użytkownika,
podglądu zakresu danych i zachowania dotychczasowych zasad lokalności.

## Docelowy kontrakt rekomendacji

Obecny szkic `OptimizationFinding` warto rozszerzyć o plan działania i walidacji:

```ts
interface OptimizationFinding {
  id: string;
  kind: OptimizationFindingKind;
  source: 'TELEMETRY' | 'CONFIG_SNAPSHOT' | 'COMBINED';
  title: string;
  summary: string;

  interactionIds: string[];
  phaseIds: string[];
  roundRefs: string[];
  evidence: EvidenceRef[];
  configurationRefs: string[];

  observed: {
    credits: number | null;
    creditCoverage: { covered: number; total: number };
    freshInputTokens: number | null;
    outputTokens: number | null;
    repetitions: number | null;
    retainedAcrossCalls: number | null;
  };

  hypothesis: string;
  intervention: string[];
  expectedDirection: Array<
    'FEWER_CALLS' | 'LESS_FRESH_INPUT' | 'LESS_OUTPUT' |
    'LESS_CONTEXT_RETENTION' | 'LOWER_CREDITS' | 'FASTER_WALL_TIME'
  >;
  qualityGate: string[];
  validationPlan: string[];
  tradeoffs: string[];
  limitation: string;
  evidenceStrength: 'EXACT' | 'PARTIAL';
  guideSlug: string;
}
```

`expectedDirection` opisuje przewidywany kierunek, a nie gwarantowaną wielkość
efektu. `evidenceStrength` nie jest oceną pewności modelu. Wynika z kompletności
dowodów potrzebnych konkretnej regule.

Rekomendacji z niewystarczającym minimalnym dowodem nie pokazujemy jako findingu.
Może pozostać neutralna wskazówka edukacyjna na stronie strategii.

Audyt customizacji ma więcej stanów niż finding optymalizacyjny, dlatego wymaga
osobnego kontraktu zamiast wciskania każdego wyniku w rekomendację:

```ts
interface CustomizationAuditCheck {
  customizationRef: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  validity: 'VALID' | 'INVALID' | 'UNKNOWN';
  applicability: 'APPLICABLE' | 'NOT_APPLICABLE' | 'AI_HYPOTHESIS' | 'UNKNOWN';
  activation: 'OBSERVED' | 'NOT_OBSERVED' | 'UNKNOWN';
  timing: 'BEFORE_RELEVANT_ACTION' | 'AFTER_RELEVANT_ACTION' | 'UNKNOWN';
  adherence: 'CONFIRMED' | 'CONTRADICTED' | 'NOT_EVALUATED';
  evidence: EvidenceRef[];
  limitation: string;
}
```

`NOT_OBSERVED` oznacza brak szukanego zdarzenia w kompletnym, zadeklarowanym
zakresie telemetrii. `UNKNOWN` obejmuje brak źródła, treści albo wymaganej części
telemetrii. `AI_HYPOTHESIS` nie może być automatycznie zamieniona na błąd
konfiguracji.

## Pierwszy katalog reguł produktowych

| Rodzaj findingu | Minimalny sygnał | Hipoteza do sprawdzenia | Czego nie wolno twierdzić |
|---|---|---|---|
| `RESULT_SIZE` | wynik połączony call ID z następnym requestem i znaczący udział treści | skrócić, filtrować albo zapisać jako artefakt | że cały result był zbędny |
| `REPEATED_ACQUISITION` | ta sama definicja i podobne kanoniczne argumenty lub nakładające się zakresy | użyć mapy, cache artefaktu albo szerszego pierwszego zapytania | że dwa odczyty mają identyczną intencję bez treści |
| `GENERIC_TOOL_DENSITY` | dominująca faza `ACQUIRE_DATA`, większość wywołań `GENERAL_PURPOSE`, widoczne wyniki | rozważyć indeks lub tool celowany | że narzędzie uniwersalne jest gorsze z definicji |
| `TOOL_CATALOG_OVERHEAD` | przechwycone definicje i duży katalog obecny w kolejnych requestach | zawęzić katalog dla roli lub etapu | przypisać dokładne tokeny każdej definicji bez pomiaru |
| `DELEGATION_OVERLAP` | dokładnie połączone poddrzewo oraz powtórzone kategorie i zakresy rodzica/dziecka | zmienić zakres delegacji albo format zwrotu | że subagent był niepotrzebny na podstawie samego kosztu |
| `HANDOFF_RESULT_SIZE` | duży zwrot dziecka połączony z requestem rodzica lub kolejnego agenta | przekazać artefakt i krótką referencję | że plik zawsze będzie tańszy w pojedynczym użyciu |
| `VALIDATION_SCOPE` | widoczne argumenty wskazują pełny build/test przy lokalnej zmianie | dodać test celowany przed bramką pełną | że szeroka walidacja jest zbędna |
| `CONTEXT_RETENTION` | dokładny wynik obecny w wielu kolejnych requestach | skrócić czas życia wyniku albo użyć referencji | że każdy cache read jest marnotrawstwem |
| `COMPACTION_COST` | wywołanie kompaktora z kosztami; opcjonalnie późniejsze użycie wyniku | zmienić moment kompaktowania lub rozmiar wejścia | że kompaktowanie się zwróciło bez potwierdzonego odbioru i jakości |
| `POST_COMPACTION_REACQUISITION` | wywołanie kompaktora, potwierdzony odbiór wyniku i dokładnie powiązane późniejsze pozyskanie tych samych danych | zachować indeks faktów, zmienić moment kompaktowania albo użyć referencji | że rehydracja się nie udała lub że ponowny odczyt był zbędny |
| `CUSTOMIZATION_LATE_LOAD` | historyczna migawka, jednoznaczne dopasowanie przez `applyTo` lub wskazanie użytkownika i dokładny odczyt po pierwszej istotnej akcji | poprawić routing albo wymusić odczyt przed działaniem | że późny odczyt pogorszył wynik bez eksperymentu |
| `CUSTOMIZATION_RULE_NOT_FOLLOWED` | jawny obserwowalny krok obowiązkowy, kompletna telemetria i przeciwny porządek zdarzeń | doprecyzować procedurę lub dodać bramkę runtime'u | że agent zignorował regułę, której wykonania nie da się zaobserwować |
| `CONFIGURED_TOOL_NOT_EXPOSED` | narzędzie zadeklarowane w migawce, wymagane dla aktywnej roli i nieobecne w kompletnych definicjach requestu | naprawić konfigurację zestawu narzędzi | że każde zadeklarowane narzędzie musi być dostępne w każdym etapie |

Progi „duży”, „dominujący” i „znaczący” nie powinny być jedną stałą globalną.
Pierwsza wersja może używać rankingu wewnątrz badanej sesji oraz wymogu minimalnego
pokrycia, a później progów kalibrowanych na anonimowym zestawie referencyjnym.

`CONFIG_INVALID` jest wynikiem walidacji konfiguracji, nie findingiem kosztowym.
`CUSTOMIZATION_NOT_OBSERVED` powinno pozostać stanem audytu, dopóki pełne pokrycie
źródeł i telemetrii nie pozwoli odróżnić nieaktywności od braku widoczności.
`PROMPT_UNDERSPECIFICATION` jest hipotezą AI i może zostać pokazane dopiero po
jawnej analizie użytkownika, obok faktów, które ją motywują.

## Priorytetyzacja rekomendacji

Findingi należy porządkować według:

1. zmierzonego ciężaru rund objętych obserwacją;
2. liczby jednoznacznie potwierdzonych powtórzeń;
3. kompletności danych i pokrycia credits;
4. odwracalności proponowanego eksperymentu;
5. ryzyka obniżenia jakości;
6. kosztu wdrożenia i utrzymania interwencji.

Ranking nie jest estymacją oszczędności. Najwyżej może znaleźć się obserwacja,
która obejmuje największą mierzalną część sesji i ma najłatwiejszy do sprawdzenia
wariant alternatywny.

W pierwszej wersji ekran powinien pokazywać jedną główną rekomendację dla
dominującego obszaru oraz ewentualnie dwie drugorzędne. Długa lista zmienia poradnik
w kolejny katalog szumu.

## Metodyka eksperymentu „przed/po”

### Kontroluj warunki

Porównuj możliwie podobne przebiegi:

- ten sam typ zadania i podobny zakres;
- to samo repozytorium lub ten sam jego stan;
- ten sam model i limit kontekstu;
- ta sama wersja agenta, narzędzi i instrukcji poza badaną zmianą;
- ten sam hash pozostałej konfiguracji albo jawnie opisane różnice;
- ta sama definicja sukcesu.

Pojedyncza para sesji jest obserwacją, nie dowodem przyczynowym. Dla wzorca, który
ma zostać standardem zespołu, warto powtórzyć zadanie na kilku reprezentatywnych
przypadkach i opisywać rozrzut, nie tylko najlepszy wynik.

### Mierz przed zmianą

- credits całego rozłącznego drzewa i ich pokrycie;
- liczbę wywołań głównego agenta, subagentów i kompaktowań;
- nowy input, cache read, cache write, output i reasoning;
- maksymalną zajętość okna;
- liczbę tool calli według kategorii;
- wielkość wyników wracających do modelu;
- sumę czasu modeli i osobno czas ścienny;
- potwierdzone błędy;
- zakres dostępnej migawki konfiguracji oraz czas obserwowanej aktywacji skilli i
  instructions, jeżeli są częścią eksperymentu;
- wynik jakościowy określony dla zadania.

### Zmień jedną główną dźwignię

Na przykład:

- zawęź katalog tooli;
- dodaj mapę projektu;
- zmień kontrakt jednego toola;
- zastąp inline handoff artefaktem;
- dodaj lub popraw jeden skill;
- popraw routing customizacji albo prompt początkowy;
- zmień moment kompaktowania;
- użyj trybu bezpośredniego zamiast planowania.

Wprowadzenie wielu zmian naraz może być praktyczne, ale utrudnia wskazanie, która
z nich odpowiada za różnicę.

### Zastosuj quality gate

Optymalizacja jest kandydatem do przyjęcia dopiero wtedy, gdy spełnia jednocześnie:

- wymagany test, build, review lub walidację domenową;
- brak nowego potwierdzonego błędu;
- kompletny kontrakt wyniku;
- akceptowalny czas i wysiłek użytkownika;
- spadek co najmniej jednego mierzonego ciężaru bez ukrycia danych.

### Opisz wynik ostrożnie

Poprawny komunikat:

> Po zawężeniu katalogu w trzech podobnych sesjach mediana nowego inputu i liczby
> wywołań była niższa, a ten sam zestaw testów przeszedł.

Niepoprawny komunikat:

> Usunięcie narzędzi zawsze obniża koszt o 30%.

## Architektura przyszłych stron rekomendacyjnych

Każda dedykowana strona powinna mieć ten sam kontrakt treści:

1. **Decyzja użytkownika** — jedno pytanie, na które strona pomaga odpowiedzieć.
2. **Mechanizm kosztu** — gdzie w `M → A → M` powstaje dodatkowy input, output,
   wywołanie lub handoff.
3. **Sygnały w Agent Scannerze** — jakie fakty i wyliczenia można zobaczyć.
4. **Kiedy rekomendacja ma sens** — warunki zastosowania.
5. **Kiedy jej nie stosować** — kontrprzykłady i ryzyko.
6. **Wariant przed/po** — syntetyczny, mały przykład oparty na tym samym zadaniu.
7. **Jak wdrożyć** — wzorzec konfiguracji, skilla, toola albo przepływu.
8. **Jak zweryfikować** — metryki, quality gate i ograniczenie wniosku.
9. **Przejście do dowodu** — link lub akcja otwierająca właściwe rundy.

Wszystkie przykłady powinny być syntetyczne. Nie należy kopiować do dokumentacji
rzeczywistych promptów, kodu, identyfikatorów, ścieżek użytkownika ani payloadów
telemetrycznych.

### Proponowana kolejność stron

1. `jak-mierzyc-optymalizacje` — wspólny model kosztu, pokrycie i eksperyment.
2. `wyniki-i-retencja-kontekstu` — najbardziej bezpośrednia ścieżka od call ID do
   rosnącego inputu.
3. `odbudowa-kontekstu-po-kompaktowaniu` — koszt własny kompaktora, potwierdzony
   odbiór i dokładnie wykryte ponowne pozyskanie danych.
4. `powtarzane-pozyskiwanie-danych` — od powtórzeń do mapy, indeksu lub lepszego
   zapytania.
5. `katalog-narzedzi` — koszt definicji i selektywne udostępnianie tooli.
6. `mapa-projektu-i-celowany-retrieval` — trwała orientacja bez zastępowania
   źródeł prawdy.
7. `dedykowane-narzedzia` — kiedy opłaca się zastąpić discovery algorytmem.
8. `skille-i-routing` — anatomia skilla, faktyczne załadowanie i redukcja
   improwizacji.
9. `audyt-konfiguracji-i-aktywacji` — poprawność, dopasowanie, obserwowane
   załadowanie, czas aktywacji i wykonanie mierzalnych kroków procedury.
10. `jakosc-promptu-poczatkowego` — cel, zakres, wejścia, stop rule i kontrakt
    wyniku jako jawna hipoteza AI.
11. `subagenci-i-handoff` — jedna sesja, inline, artefakt i izolowany subagent.
12. `planowanie-kontra-wykonanie` — koszt kontroli procesu i kryteria wyboru.
13. `walidacja-i-stop-rules` — minimalna walidacja etapowa oraz pełna bramka.

Pierwsze cztery strony mają najlepszą ścieżkę audytu w obecnym modelu telemetrii,
przy czym ponowne pozyskanie po kompaktowaniu wymaga dokładnych łączy i
potwierdzonego odbioru wyniku. Strony o skillach i mapach muszą wyraźnie mówić, że
Agent Scanner nie potwierdzi ich obecności ani użycia, jeśli emitter lub jawnie
włączona migawka konfiguracji nie dostarcza takiego dowodu. Audyt konfiguracji
wymaga wcześniejszego rozszerzenia granicy produktu, a ocena promptu — jawnego
uruchomienia AI i osobnego komunikatu o prywatności.

## Roadmapa produktu

### Etap 0 — kontrakt i dane referencyjne

- utrwalić model `OptimizationFinding`;
- podjąć jawną decyzję, czy produkt rozszerzamy o ograniczony audyt customizacji;
- jeżeli tak, zdefiniować kontrakt historycznej migawki, zakres źródeł, zgodę,
  retencję i wersjonowanie specyfikacji;
- zdefiniować minimalny dowód dla każdej reguły;
- przygotować syntetyczne fixture'y pozytywne, negatywne i z brakami danych;
- ustalić jeden słownik komunikatów: obserwacja, hipoteza, eksperyment,
  ograniczenie;
- nie dodawać rekomendacji do publicznego API, dopóki są wyliczane lokalnie.

### Etap 1 — pierwszy finding z pełnym audytem

- wdrożyć `RESULT_SIZE` albo `CONTEXT_RETENTION`;
- wyświetlić jedną kartę przy dominującej fazie;
- pokazać metryki, pokrycie i konkretne rundy;
- prowadzić do wspólnego panelu `M → A → M`;
- dodać link do dedykowanej strony edukacyjnej;
- sprawdzić język z użytkownikami nieznającymi OTLP.

### Etap 2 — katalog deterministycznych reguł

- dodać powtarzane pozyskanie danych;
- dodać gęstość narzędzi uniwersalnych i katalog tooli;
- dodać duży handoff oraz koszt poddrzewa delegacji;
- dodać dokładne ponowne pozyskanie danych po kompaktowaniu bez twierdzenia o
  udanej lub nieudanej rehydracji;
- dodać ostrożną sugestię zakresu walidacji;
- nie uruchamiać AI tylko po to, aby wygenerować finding.

### Etap 3 — audyt konfiguracji i aktywacji

- odczytywać wyłącznie jawnie objęte zakresem typy customizacji, nie całe repo;
- walidować lokalizację, nazwę, frontmatter, obsługiwane pola, `applyTo`,
  referencje i zadeklarowane narzędzia względem wersjonowanej specyfikacji;
- przechowywać historyczny hash i kontekst wersji, a treść tylko zgodnie z
  ustawieniem prywatności;
- łączyć odczyty z requestami i pierwszą istotną akcją przy użyciu dokładnych
  identyfikatorów, ścieżek lub fingerprintów;
- rozdzielić fakt, niespójność deterministyczną i hipotezę AI;
- nie nazywać braku aktywacji błędem, gdy zakres telemetrii albo źródeł jest
  niepełny.

### Etap 4 — porównanie sesji i walidacja efektu

- umożliwić wybór sesji bazowej i sesji po zmianie;
- porównywać model, zakres, wersje i pokrycie;
- pokazywać różnicę metryk bez twierdzenia o przyczynowości;
- dla customizacji pokazywać współczynnik obserwowanej aktywacji, czas do
  załadowania i rundy wykonane przed aktywacją;
- odróżniać symptom pojedynczej sesji od wzorca powtarzanego w serii;
- zapisywać opis badanego eksperymentu poza niezmienionym eksportem v1;
- wersjonować eksport, jeśli findings mają stać się jego częścią.

### Etap 5 — kalibracja i uczenie organizacyjne

- zbudować anonimowy zestaw referencyjny dla różnych providerów i zadań;
- mierzyć trafność reguł oraz liczbę odrzuconych rekomendacji;
- śledzić, które interwencje przeszły quality gate;
- kalibrować hipotezy o jakości promptu i semantycznie podobnych powtórzeniach
  osobno od reguł deterministycznych;
- kalibrować progi na danych, zamiast przyjmować liczby ze slajdów;
- utrzymywać historię wersji definicji tooli, skilli i reguł rekomendacyjnych.

## Kryteria gotowości automatycznych findingów

Nowy typ findingu jest gotowy do użycia, gdy:

- ma jednoznacznie opisany minimalny dowód;
- zachowuje brak danych jako brak;
- nie myli braku obserwacji z brakiem konfiguracji lub działania;
- wskazuje rundy możliwe do otwarcia i audytu;
- nie przypisuje przyczynowości na podstawie korelacji;
- nie obiecuje konkretnej oszczędności bez testu „przed/po”;
- ma co najmniej jeden fixture pozytywny, negatywny i niepełny;
- podaje interwencję, trade-off, quality gate i plan walidacji;
- działa bez dodatkowego płatnego wywołania AI;
- używa AI tylko w zakresie już objętym jawną analizą kategorii;
- ma odpowiadającą stronę edukacyjną z syntetycznym przykładem.

To kryteria lokalnych findingów, nie zakaz dodatkowej analizy na żądanie.
Katalog edukacyjny i doradztwo AI mają osobne kryteria w
[planie implementacji](plan-technik-optymalizacji-bez-ai-i-z-ai.md), w tym podgląd
wysyłanych danych, ograniczony zakres, własny kontrakt i brak obietnic oszczędności.

Dla findingu korzystającego z konfiguracji dodatkowo wymagane są historyczna
migawka z czasu sesji, wersja reguł walidacji, zakres dostępnych źródeł i czytelna
informacja o źródłach niedostępnych. Hipoteza AI dotycząca promptu, dopasowania
skilla albo semantycznego powtórzenia nie może spełniać deterministycznego
minimum w zastępstwie brakującego dowodu.

## Decyzje strategiczne

1. Nie optymalizujemy liczby agentów, lecz przepływ wiedzy, koszt i jakość dla
   konkretnego zadania.
2. Najpierw pokazujemy ciężar i dowód, potem alternatywę.
3. Rekomendacja jest sprawdzalną hipotezą, a nie automatyczną oceną architektury.
4. Duży zmierzony ciężar wskazuje miejsce do analizy, ale nie dowodzi
   marnotrawstwa.
5. Skille, mapy i dedykowane narzędzia są inwestycjami wielosesyjnymi; oceniamy
   również koszt ich utrzymania.
6. Subagenci są dodatkiem do głównej ścieżki, gdy kupują izolację, równoległość lub
   specjalizację.
7. Artefakty i referencje ograniczają koszt komunikacji tylko wtedy, gdy eliminują
   ponowne przenoszenie pełnej treści.
8. Kompaktowanie ma własny koszt i nie jest sukcesem bez potwierdzonego użycia
   rezultatu oraz kontroli jakości.
9. Najlepsze rozwiązanie jest zwykle hybrydą dobraną do celu: mapa, celowany tool,
   dobrze umieszczone instructions, skill, główny agent i selektywna delegacja.
10. Każdy wzorzec optymalizacyjny musi zostać zmierzony ponownie na reprezentatywnej
    pracy, zanim stanie się standardem zespołu.
11. Audyt customizacji jest osobną warstwą produktu i nie może być wprowadzony
    jako ukryty efekt uboczny analizy telemetrii.
12. Konfigurację oceniamy w wersji obowiązującej podczas sesji, nie na podstawie
    bieżącego stanu plików.
13. Fakty, niespójności deterministyczne i hipotezy AI mają osobne statusy i
    osobną prezentację; nie zastępuje ich jeden syntetyczny score.
14. Wywołanie kompaktora jest faktem kosztowym, ale „udana rehydracja” nie jest
    faktem bez potwierdzonego odbioru i późniejszego wykorzystania wyniku.
15. Analiza promptu i treści customizacji wymaga jawnej akcji użytkownika oraz
    ochrony prywatności adekwatnej do zawartości kodu, instrukcji i rozmowy.
