# Deterministyczna klasyfikacja faz pracy i profili subagentów

> Status: specyfikacja produktowo-analityczna, wersja robocza 0.1.  
> Dokument opisuje proponowany model analizy. Nie oznacza, że wszystkie wymienione
> reguły i pola wynikowe są już zaimplementowane w aplikacji.

> Aktualizacja kierunku UI, 2026-09-05: Mapa pracy prezentuje początkowo fakty,
> a kategorie nakłada dopiero po klasyfikacji akcji żądanych w odpowiedziach
> modelu przez AI. Profil subagenta zestawia akcje jego własnych rund. Kontrakt opisuje
> [Klasyfikacja narzędzi AI](klasyfikacja-narzedzi-ai.md). Poniższe profile I/O
> pozostają dokumentacją wcześniejszego modelu analizy, nie etykietami obecnego UI.

## Mapa dokumentu

- [Cel i decyzje projektowe](#1-cel-dokumentu)
- [Jednostki analizy](#4-jednostki-analizy-i-granice)
- [Dane dostępne w telemetrii](#5-dane-dostępne-w-obecnej-telemetrii)
- [Kompletność i jakość danych](#6-obecność-kompletność-i-jakość-danych)
- [Wektor cech rundy](#7-wektor-cech-dla-rundy)
- [Profile, stan kontekstu i markery](#8-trzy-niezależne-osie-wyniku-rundy)
- [Reguły klasyfikacji faz](#11-model-sekwencyjny)
- [Klasyfikacja całej sesji](#12-klasyfikacja-całej-sesji)
- [Relacje i cechy subagentów](#13-generyczne-wykrywanie-relacji-subagenta)
- [Reguły profili subagentów](#15-deterministyczne-profile-subagenta)
- [Credits subagenta i rodzica](#16-zużycie-credits-przez-subagenta-i-rodzica)
- [Anomalie i rekomendacje](#17-deterministyczne-anomalie-i-rekomendacje)
- [Wiarygodność, kontrakt i UI](#18-wiarygodność-i-sposób-komunikacji)
- [MVP, testy i architektura](#21-proponowany-zakres-mvp)

## Słownik

| Termin | Znaczenie w tym dokumencie |
|---|---|
| żądanie (`request`) | jeden input wysłany do modelu w ramach spanu `chat` |
| wynik (`output`) | tokeny lub przechwycona treść zwrócona przez model; zależnie od kontekstu |
| świeży input (`fresh input`) | `input_tokens - cache_read_tokens`, gdy oba pola zostały wyemitowane |
| przechwytywanie treści (`capture content`) | udostępnienie w telemetrii messages, arguments, results lub innych treści |
| dokładna zgodność (`exact`) | identyczność ID albo pełnego kanonicznego payloadu; nie podobieństwo semantyczne |
| pokrycie danych (`coverage`) | odsetek wymaganych obserwacji dostępnych i poprawnych; nie pewność wniosku |
| wiarygodność (`confidence`) | kategoryczna siła wniosku wynikająca z dowodów, pokrycia i marginesu; nie prawdopodobieństwo |
| wniosek (`finding`) | ustrukturyzowany wynik reguły wraz z dowodami, brakami i kontrprzesłankami |
| emiter/provider | komponent, który wyemitował telemetrię lub raportowane wartości modelu |
| snapshot analizy | wynik policzony dla konkretnego, jawnego punktu odcięcia danych |

## 1. Cel dokumentu

Celem jest zdefiniowanie audytowalnego sposobu analizowania pojedynczej sesji
agenta na podstawie telemetrii już odbieranej przez Agent Scanner. Analiza ma:

- pokazywać, jak zmieniał się przepływ pracy w kolejnych rundach;
- rozpoznawać ilościowe profile pracy bez polegania na nazwach narzędzi;
- uwzględniać zajęcie i presję okna kontekstowego;
- wykorzystywać kolejność rund, błędy, kompaktowanie i delegowanie;
- opisywać przepływ danych oraz zużycie credits subagenta względem rodzica;
- wskazywać anomalie i alternatywne podejścia warte zbadania;
- zawsze ujawniać przesłanki, braki danych oraz granice wniosku.

Klasyfikator ma być deterministyczny w sensie technicznym:

> Te same dane wejściowe oraz ta sama wersja reguł zawsze dają ten sam wynik.

Nie oznacza to, że telemetria pozwala z absolutną pewnością poznać intencję
agenta. Wynik może być deterministyczną, ale nadal heurystyczną interpretacją
obserwowanego przepływu.

## 2. Najważniejsze decyzje projektowe

1. **Dowód jest ważniejszy niż etykieta.** Każda klasyfikacja wskazuje konkretne
   spany, rundy, wartości i zastosowaną regułę.
2. **Brak danych nie jest zerem.** Brak atrybutu blokuje część obliczeń albo obniża
   kompletność; nie jest zastępowany znaczeniem `0`.
3. **Nazwy narzędzi nie określają fazy ani profilu subagenta.** Custom tool może
   realizować dowolną czynność, a jego nazwa może być myląca.
4. **Klasyfikujemy kształt przepływu, nie semantyczny cel.** Deterministyczne
   etykiety to m.in. akumulacja, kondensacja, generowanie, iteracja i
   rehydratacja. Etykiety `research`, `mapowanie`, `review` lub `implementacja`
   wymagają jawnej metadanej albo osobnej hipotezy AI.
5. **Stan kontekstu nie jest fazą.** Niskie lub wysokie zapełnienie modyfikuje
   interpretację fazy, ale nie definiuje jej samodzielnie.
6. **Historia jest priorem, a nie dowodem.** Poprzednia faza może pomóc rozstrzygnąć
   niejednoznaczność, lecz nie może sama stworzyć etykiety następnej fazy.
7. **Subagenta wiążemy wyłącznie relacją identyfikatorów.** Bliskość czasowa ani
   nazwa narzędzia nie są wystarczającym dowodem relacji rodzic–dziecko.
8. **Wyemitowane credits są autorytatywną wartością zużycia prezentowaną przez
   Scanner.** Scanner nie weryfikuje ich względem rozliczenia dostawcy. Wskaźniki
   ważone służą do porównań i rekomendacji, ale nie są rzeczywistą ceną modelu ani
   oceną jakości.
9. **`UNKNOWN` jest prawidłowym wynikiem.** Lepiej nie przypisać fazy niż ukryć
   brak dowodów pod pozornie precyzyjną etykietą.

## 3. Cztery poziomy informacji

Wynik analizy powinien jawnie rozdzielać cztery poziomy:

| Poziom | Przykład | Charakter |
|---|---|---|
| Fakt telemetryczny | `input_tokens = 12000`, status spanu `ERROR` | bezpośrednio wyemitowane |
| Dokładna pochodna | `Nowy input = 12000 - 8000 = 4000` | jawna formuła na kompletnych danych |
| Wzorzec heurystyczny | „profil akumulacji kontekstu” | deterministyczna interpretacja wielu faktów |
| Hipoteza semantyczna | „agent prowadził research repozytorium” | poza zakresem warstwy deterministycznej |

Rekomendacja nie może podnosić poziomu pewności przesłanki. Jeżeli źródłem jest
wzorzec heurystyczny, komunikat powinien mówić „warto zbadać”, a nie „należy” lub
„na pewno oszczędzisz”.

## 4. Jednostki analizy i granice

### 4.1. Sygnał

Jedno żądanie do endpointu OTLP. Scanner zachowuje pełny kanoniczny JSON oraz
oryginalne zdekodowane bajty. Sygnał jest źródłem audytowym, ale sam w sobie nie
jest fazą pracy.

### 4.2. Sesja

Sesja jest przede wszystkim grupowana po `gen_ai.conversation.id`. Gdy atrybutu
brakuje, istniejący fallback ma postać `trace:<traceId>`.
W dalszych formułach tę dokładną wartość grupującą nazywamy `sessionKey`.

Agregaty sesji są przydatne do podsumowania, ale nie powinny być podstawą
klasyfikacji rund. Przy kolejnych batchach mogą być scalane przez maksimum, a
znormalizowane zera mogą oznaczać zarówno brak wartości, jak i rzeczywiste zero.

### 4.3. Interakcja użytkownika

Interakcja oznacza jeden prompt użytkownika i uruchomioną przez niego pracę.
Frontend grupuje ją po `traceId`; preferowanym rootem jest `invoke_agent`.

Nowa interakcja resetuje sekwencyjny prior faz. Nie wolno kontynuować automatycznie
historii klasyfikacji z poprzedniego promptu tylko dlatego, że oba prompty należą
do tej samej konwersacji.

### 4.4. Runda

Runda jest jednym spanem `chat`:

```text
request agenta do modelu
  → tekst i/lub żądania narzędzi zwrócone przez model
  → wykonania narzędzi
  → ich wyniki mogą wejść do następnego spanu chat
```

To podstawowa jednostka pomiaru tokenów, credits i stanu okna.

### 4.5. Krok narzędziowy

W obecnej analizie wykonania narzędzi następujące po odpowiedzi modelu są
przypisywane do rundy na podstawie czasu: od zakończenia bieżącego `chat` do startu
kolejnego `chat` w tej samej interakcji.

Jest to deterministyczna reguła, ale przy równoległości może być niejednoznaczna.
`phase-rules-v1` zachowuje obecny kontrakt czasowy. `parentSpanId` może sygnalizować
niespójność albo zwiększyć wiarygodność zgodnego przypisania, lecz nadanie mu
pierwszeństwa byłoby osobną zmianą semantyki wymagającą fixture'a, testów i
aktualizacji `AGENTS.md`. Niejednoznaczność musi obniżać kompletność cech
narzędziowych.

### 4.6. Faza

Faza to jedna runda albo seria sąsiednich rund o podobnym profilu przepływu.
Sesja nie powinna otrzymywać jednej globalnej etykiety kosztem utraty kolejności.
Wynikiem ma być sekwencja, np.:

```text
runda 1: przetwarzanie [stan: duży kontekst startowy]
  → faza: akumulacja kontekstu
  → przetwarzanie istniejącego kontekstu
  → akumulacja [marker: po potwierdzonym błędzie]
  → konsolidacja outputu
```

### 4.7. Epizod subagenta

Epizod subagenta obejmuje jego dokładnie powiązaną sesję, wszystkie rundy, kroki
narzędziowe oraz zagnieżdżone dzieci. Wejście i wyjście z subagenta są granicami
osobnych sekwencji faz. Jest to docelowy kontrakt po wdrożeniu generycznego grafu;
obecny read model nie buduje jeszcze kompletnych rekurencyjnych poddrzew.

## 5. Dane dostępne w obecnej telemetrii

Scanner zachowuje wszystkie atrybuty i eventy spanów w `attributesJson` oraz
`eventsJson`, nawet jeśli dane pole nie ma osobnej kolumny. Pełny raw OTLP
pozostaje ostatecznym źródłem audytu. Kanoniczny `rawJson` jest dostępny w REST;
oryginalny `rawPayload` jest zapisany w bazie, ale obecnie nie jest udostępniany
przez API ani UI.

### 5.1. Struktura i czas spanów

| Dane | Dostępność | Zastosowanie | Ograniczenia |
|---|---|---|---|
| `traceId` | znormalizowane | granica interakcji | nie opisuje celu pracy |
| `spanId` | znormalizowane | referencja dowodu, deduplikacja | wymaga unikalności w trace |
| `parentSpanId` | znormalizowane | graf zależności | może być niewyemitowane lub niepełne |
| `gen_ai.operation.name` | znormalizowane jako `operationName` | rozpoznanie `invoke_agent`, `chat`, `execute_tool`, `execute_hook` | opisuje typ operacji, nie semantyczny cel |
| start i koniec | znormalizowane | kolejność, nakładanie, przerwy | brak timestampu osłabia sekwencję |
| `durationMs` | dokładna pochodna | opis długości operacji | długi czas nie dowodzi błędu ani marnotrawstwa |
| status i komunikat | znormalizowane | potwierdzony błąd | brak błędu nie potwierdza sukcesu biznesowego |
| model żądania/odpowiedzi | jedna kolumna: pierwsza niepusta wartość z `gen_ai.response.model`, następnie `gen_ai.request.model`; oba pola osobno w raw | porównania zużycia credits, reset przy zmianie modelu | jedna sesja może używać wielu modeli |
| agent i conversation ID | kolumna i raw | identyfikacja oraz grupowanie | nazwa agenta nie jest archetypem |

Resource attributes są zachowane dla batcha, ale read model spanu nie przechowuje
dokładnego przypisania do konkretnego `ResourceSpans`; precyzyjne użycie wymaga
parsowania `rawJson`. Jeżeli jeden trace zawiera różne `gen_ai.conversation.id`,
grupowanie ingestora może wybrać ostatnią napotkaną wartość. Klasyfikator relacji
powinien więc czytać raw atrybut konkretnego spanu.

OTel może raportować liczbę odrzuconych atrybutów lub eventów. Jeśli takie pola są
obecne w surowym payloadzie, powinny obniżać pokrycie danych; ich brak nie
dowodzi, że nic nie zostało ucięte upstream.

### 5.2. Tokeny dla spanu `chat`

| Symbol | Atrybut | Znaczenie |
|---|---|---|
| `I` | `gen_ai.usage.input_tokens` | cały input naliczony dla requestu |
| `K` | `gen_ai.usage.cache_read.input_tokens` | część inputu odczytana z cache |
| `CW` | `gen_ai.usage.cache_creation.input_tokens` | cache write, tylko gdy jawnie wyemitowane |
| `O` | `gen_ai.usage.output_tokens` | output raportowany przez providera |
| `Q` | maksimum z dwóch pól reasoning | osobna informacja o reasoning |
| `TTFT` | `copilot_chat.time_to_first_token` | wartość interpretowana przez Scanner jako ms |

Podstawowa pochodna:

```text
F = max(0, I - K)
```

gdzie `F` jest „Nowym inputem”, czyli inputem poza cache. Nie jest to dokładna
miara nowej wiedzy. Ponownie wysłana stara treść po utracie cache również może
zostać policzona jako fresh input.

`F` jest wiarygodne tylko wtedy, gdy zarówno `I`, jak i `K` zostały wyemitowane.
Brak `K` nie pozwala założyć, że całe `I` było świeże.

Nie należy:

- dodawać reasoning ponownie do outputu bez dowodu, że provider go wyklucza;
- przypisywać fragmentów requestu do cache lub fresh na podstawie pozycji;
- porównywać sumy inputu ze wszystkich rund z jednym oknem kontekstowym;
- traktować `cache read` jako treści, która nie zajmuje okna.

Ingestor kopiuje wartość TTFT bez przeliczania jednostki. Klasyfikator może
traktować ją jako milisekundy tylko zgodnie z kontraktem konkretnego emitera;
nie powinien sam wnioskować jednostki z wielkości liczby.

### 5.3. Credits

Dla spanu `chat` może być dostępny atrybut:

```text
copilot_chat.copilot_usage_nano_aiu
```

Scanner stosuje przeliczenie:

```text
credits = nanoAiu / 1_000_000_000
```

Credits są jednostką GitHub Copilot AI credits, nie walutą. Dla każdej agregacji
trzeba zwracać również pokrycie, np. `7/8 rund z credits`.

Jeżeli credits są obecne tylko dla części rund:

- wolno podać `suma znanych credits`;
- nie wolno nazywać tej wartości pełnym zużyciem credits sesji;
- nie wolno bez zastrzeżenia porównywać udziałów rodzica i dziecka.

### 5.4. Limity oraz kształt requestu

W `attributesJson` spanu `chat` mogą występować:

- `copilot_chat.request.max_prompt_tokens`;
- `gen_ai.request.max_tokens`;
- `copilot_chat.request.shape`;
- `hasPreviousResponseId` wewnątrz request shape;
- `inputItemCount` oraz `inputItemTypes`;
- `gen_ai.response.id`;
- `copilot_chat.server_request_id`;
- finish reason i parametry modelu.

`hasPreviousResponseId=true` oznacza, że widoczna lista wiadomości może być tylko
przyrostem, podczas gdy runtime zachowuje poprzedni stan odpowiedzi. Autorytatywną
miarą kontekstu pozostaje wtedy `input_tokens`, a nie suma znaków widocznych
części requestu.

### 5.5. Przechwycone treści

Przy włączonym capture content dostępne mogą być:

- `gen_ai.system_instructions`;
- `gen_ai.input.messages`;
- `gen_ai.output.messages`;
- `gen_ai.tool.definitions`;
- `copilot_chat.user_request`;
- `gen_ai.tool.call.arguments`;
- `gen_ai.tool.call.result`.

Na tej podstawie można deterministycznie mierzyć:

- liczbę wiadomości i elementów;
- rozmiar instrukcji, definicji, argumentów, wyników i odpowiedzi;
- strukturę JSON;
- dokładne powtórzenia przez hash;
- częściowe podobieństwo przez wersjonowany algorytm tekstowy.

Znormalizowany `message_record` nie zawsze zachowuje pełną otoczkę elementu. Jeśli
element zawiera pole `content`, normalizacja zapisuje przede wszystkim jego
wartość; typy, ID i inne pola trzeba w razie potrzeby odczytać z raw atrybutu.
Dokładny hash całego elementu powinien więc bazować na raw, nie wyłącznie na
`message_record`.

Nie ma dokładnych tokenów dla wiadomości, instrukcji, argumentu ani wyniku narzędzia.
Takie fragmenty należy mierzyć w jednej jawnie ustalonej jednostce, preferencyjnie
w bajtach UTF-8. Jeżeli UI pozostanie przy JavaScript `string.length`, trzeba
nazwać tę jednostkę `UTF-16 code units`, a nie znakami lub tokenami.

Przeliczanie fragmentów na tokeny jest estymacją i musi mieć prefiks `≈`.
Capture content ani ustawienie nielimitowanej długości atrybutu nie gwarantują,
że wcześniejszy element łańcucha telemetrycznego nie skrócił treści. Rozmiary
zlecenia, wyniku narzędzia i zwrotu subagenta są rozmiarami obserwowanych
payloadów, nie gwarancją kompletności oryginalnych danych.

### 5.6. Wykonania narzędzi

Dla `execute_tool` dostępne są co najmniej struktura spanu, czas, status i eventy,
a przy capture content także argumenty oraz wynik. Klasyfikator może korzystać z:

- liczby wykonań;
- liczby niepustych wyników;
- sumy, mediany i maksimum rozmiaru wyników;
- sumy unikalnych wyników po deduplikacji;
- liczby dokładnych powtórzeń;
- czasu wykonania;
- potwierdzonych błędów;
- call ID oraz relacji grafowych.

Klasyfikator faz i profili **nie używa** `gen_ai.tool.name`, nazw parametrów,
ścieżek plików ani nazw skilli jako cech semantycznych. Nazwy mogą pozostać w UI
i dowodzie technicznym. Wyjątkiem są istniejące, osobno testowane formaty
jednoznacznego błędu; służą one detekcji błędu, a nie fazy.

### 5.7. Eventy, błędy i kompaktowanie

Każdy event spanu jest zachowany z nazwą, czasem i atrybutami. Potwierdzony problem
może wynikać z:

- `STATUS_CODE_ERROR`;
- niepustego `error.type`;
- eventu `exception`, `error`, `*.error` albo `github.copilot.session.abort`;
- eventu `github.copilot.session.compaction_complete` z `success=false` albo
  tekstową wartością `"false"`;
- ustrukturyzowanego wyniku `isError=true`, `success=false`, `ok=false`;
- pola `status=error|failed|failure` w ustrukturyzowanym wyniku;
- niezerowego kodu wyjścia w wyniku strukturalnym lub jednoznacznym formacie tekstowym;
- znanego, jednoznacznego formatu objętego testem regresyjnym.

Duży input, mały cache hit, wysoki latency, nietypowy output ani brak danych nie są
błędem.

Jawny event udanego kompaktowania jest faktem. Sam spadek inputu może być jedynie
resetem, nową interakcją, zmianą modelu, innym limitem albo niewidocznym zachowaniem
providera; nie dowodzi kompaktowania.

Obecny kod zna event `github.copilot.session.compaction_complete`, lecz repo nie
ma jeszcze fixture'a potwierdzającego realny kształt udanego eventu. Reguły
używające `success=true` są kontraktem docelowym i przed implementacją wymagają
zanonimizowanego fixture'a danej wersji emitera.

Powyższy katalog opisuje dane dostępne dla docelowego klasyfikatora. Obecny alert
rundy analizuje span modelu oraz przypisane `execute_tool`/`execute_hook`; event
zapisany na `invoke_agent` albo innym spanie może pozostać dostępny w raw, ale nie
musi jeszcze zostać pokazany jako problem tej rundy.

### 5.8. Metryki i logi OTLP

Scanner przechowuje metryki i logi, lecz obecny read model nie koreluje ich
bezpośrednio z sesją. Dlatego MVP klasyfikatora powinien bazować na spanach trace.
Log lub metryka może wejść do klasyfikacji dopiero po dodaniu jednoznacznego,
testowanego powiązania z sesją i rundą.

### 5.9. Dane, których telemetria nie dostarcza

Na podstawie obecnego modelu nie znamy bezpośrednio:

- semantycznego celu rundy lub subagenta;
- jakości, poprawności i wartości biznesowej wyniku;
- kontrfaktycznego kosztu innego workflow;
- dokładnego kosztu pieniężnego;
- tokenów pojedynczego fragmentu requestu lub tool resultu;
- tego, które konkretne fragmenty były fresh albo cache;
- tego, czy brak błędu oznacza osiągnięcie celu;
- tego, czy sesja jest nadal aktywna;
- rzeczywistego stanu repozytorium po każdej operacji, jeżeli nie ma osobnej
  jednoznacznej telemetrii.

## 6. Obecność, kompletność i jakość danych

### 6.1. Krytyczna pułapka obecnej normalizacji

Znormalizowane kolumny tokenowe są typu `NOT NULL` i mają wartość domyślną `0`.
Pomocnicza funkcja normalizacji zwraca `0` również wtedy, gdy atrybutu brakuje albo
nie jest liczbą.

Każda cecha klasyfikatora musi zatem przechowywać zarówno wartość, jak i stan:

```text
availability = emitted | derived | missing | invalid | ambiguous
```

Przykładowy kontrakt:

```text
MetricValue<T> {
  value?: T
  availability: emitted | derived | missing | invalid | ambiguous
  sourceAttributes: string[]
  evidenceRefs: string[]
}
```

Obecność należy sprawdzać w `attributesJson`, a nie wyłącznie w kolumnie
znormalizowanej.

### 6.2. Kompletność według obszaru

Klasyfikator powinien liczyć osobne miary pokrycia danych:

- `tokenCoverage` — kompletność `I`, `K`, `O`, opcjonalnie `CW` i reasoning;
- `freshInputCoverage` — obecność poprawnych `I` i `K` w każdej objętej rundzie;
- `promptPressureCoverage` — obecność dodatniego `Pmax` oraz `I`;
- `fullWindowCoverage` — obecność dodatnich `Pmax`, `Omax` oraz `I`;
- `outputBudgetCoverage` — obecność dodatniego `Omax` oraz `O`;
- `creditCoverage` — liczba spanów `chat` z credits / liczba spanów `chat` w analizowanym zakresie;
- `requestContentCoverage` — dostępność wymaganych messages, instructions i definitions;
- `toolResultContentCoverage` — dostępność wyników wszystkich objętych analizą wykonań;
- `delegationContentCoverage` — dostępność argumentów wszystkich powiązanych uruchomień dzieci;
- `returnContentCoverage` — dostępność rezultatu każdego powiązanego uruchomienia dziecka;
- `hashCoverage` — udział pełnych kanonicznych elementów, dla których można policzyć hash;
- `sequenceCoverage` — timestampy oraz poprawna kolejność;
- `subagentLinkCoverage` — kompletność zbioru źródłowych call ID i conversation ID
  potrzebnych do relacji rodzic–dziecko;
- `errorCoverage` — dostępność statusów, eventów i wyników;
- `modelCoverage` — model dla każdej rundy.

`contentCoverage` może być zbiorczym obiektem powyższych pól, ale nie jedną
wartością boolowską. Reguła może wymagać wyłącznie właściwego kanału, np.
`toolResultContentCoverage`, i nie powinna tracić wiarygodności przez brak
nieużywanych w niej system instructions.

„Pełne pokrycie” oznacza kompletność względem elementów, których istnienie da się
ustalić w odebranym snapshotcie, a nie gwarancję kompletności całego upstreamu:

- dla requestu oczekiwane elementy uzgadniamy z `request.shape`, item count/types
  i obecnością właściwych raw atrybutów; bez możliwości uzgodnienia stan to
  `unknown`, nie `complete`;
- dla wyników tooli każdy objęty analizą span wykonania musi mieć jawnie
  wyemitowany rezultat, także gdy jest on pusty;
- dla delegacji i powrotu każde dokładnie powiązane uruchomienie musi mieć jawnie
  wyemitowane arguments/result;
- dodatnia zgodność call ID z conversation ID zawsze jest dowodem konkretnej
  relacji, ale brak dopasowania dowodzi braku dziecka tylko przy kompletnym
  `subagentLinkCoverage`; przy niezweryfikowanej kompletności reguła wymagająca
  „braku dziecka” ma stan `unknown`;
- hash coverage dotyczy wyłącznie pełnych elementów odebranych przez Scanner;
- dodatni dropped count wymusza `partial`, a brak dropped count nie dowodzi, że
  wcześniejszy element pipeline'u niczego nie uciął.

Wynik powinien więc przechowywać również `upstreamCompleteness = confirmed |
unverified | truncated`. W typowej obecnej telemetrii będzie to `unverified`.

Jedna globalna flaga `contentCaptured` jest zbyt ogólna. Może być prawdziwa mimo
braku części wyników albo fałszywa mimo dostępności innych fragmentów. Obecnie
jest ustawiana na `true`, gdy znaleziono co najmniej jedno z: input messages,
output messages lub tool call arguments. Sama obecność system instructions,
tool definitions albo tool resultu nie musi jej ustawić.

### 6.3. Deduplikacja

Należy rozróżnić duplikat reprezentacji telemetrycznej od rzeczywiście
powtórzonego transferu:

- ten sam span lub message zapisany ponownie wskutek retransmisji liczymy raz;
- ten sam rezultat widoczny jednocześnie w `gen_ai.tool.call.result` i odpowiadającym
  mu `function_call_output` jest jedną reprezentowaną wymianą;
- dwa różne wykonania z różnymi call ID, które zwróciły identyczny payload, są
  dwoma transferami, ale jedną unikalną treścią.

Dlatego przechowujemy obie miary:

```text
totalObservedBytes(scopeRef, contentKind) = suma każdego rzeczywistego transferu
uniqueContentBytes(scopeRef, contentKind) = suma różnych kanonicznych payloadów
duplicateBytes(scopeRef, contentKind) =
  totalObservedBytes(scopeRef, contentKind)
  - uniqueContentBytes(scopeRef, contentKind)
duplicateRatio(scopeRef, contentKind) =
  duplicateBytes(scopeRef, contentKind)
  / totalObservedBytes(scopeRef, contentKind)
```

Każde użycie musi zapisać oba parametry. `scopeRef` jest konkretną rundą,
`phaseWindow`, `comparisonSequence`, epizodem subagenta albo jawną parą gałęzi.
`contentKind` to jeden określony kanał, np. `toolResults`, `systemInstructions`,
`toolDefinitions` lub `returns`; nie wolno mieszać kanałów tylko po to, aby
przekroczyć próg. Iloraz wymaga `totalObservedBytes > 0` i pełnego coverage
wybranego kanału w całym zakresie, w przeciwnym razie ma stan `unknown`.

Wszystkie cztery miary dla danego `(scopeRef, contentKind)` używają tej samej
reprezentacji `content-bytes-v1`:
długości UTF-8 pełnego kanonicznego payloadu. `totalObservedBytes` sumuje ją dla
każdego rzeczywistego transferu, a `uniqueContentBytes` raz dla każdej grupy o
identycznym hashu. Dzięki temu `duplicateBytes` nie miesza długości raw i
kanonicznej.

Pierwsza opisuje narzut komunikacji, druga przyrost unikalnej treści. Nie wolno
deduplikować powtórnych rzeczywistych wykonań z `totalObservedBytes`.

W obecnym storage spany są scalane po `(traceId, spanId)`, natomiast rekordy
wiadomości nie mają równoważnego ograniczenia unikalności. Deduplikacja
retransmisji wiadomości jest zatem realnym wymaganiem warstwy analizy, nie tylko
ochroną teoretyczną.

`dedup-representation-v1` stosuje kolejno:

1. dla spanu klucz `(traceId, spanId)`;
2. dla powtórzonego rekordu wiadomości klucz `(traceId, spanId, direction,
   sequenceNo, sourceKind, rawContentHash)`;
3. pomiędzy `gen_ai.tool.call.result` i `function_call_output` — zgodne call ID
   oraz identyczny hash pełnego kanonicznego payloadu;
4. dwa różne call ID zawsze pozostają dwoma transferami, nawet przy identycznej
   treści; hash łączy je wyłącznie w `uniqueContentBytes`.

Jeżeli call ID albo pełnego payloadu brakuje, nie wolno deduplikować dwóch różnych
reprezentacji wyłącznie na podstawie czasu lub podobnego rozmiaru.

### 6.4. Kanonikalizacja i hashe

Dla JSON-u:

1. sparsować wartość defensywnie;
2. posortować klucze obiektów leksykograficznie według sekwencji punktów kodowych Unicode;
3. zachować kolejność tablic;
4. serializować bez nieistotnych białych znaków, ze znormalizowanym zapisem liczb
   (`-0` jako `0`, bez zbędnych zer), nie zmieniając wartości stringów;
5. policzyć kryptograficzny hash lokalnie.

Dla niestrukturalnego tekstu `content-bytes-v1` używa surowej wartości stringu
zakodowanej jako UTF-8, bez normalizacji Unicode, końców linii i whitespace.
Oddzielny hash po normalizacji końców linii i białych znaków może wykrywać
techniczne różnice formatowania, ale jest jedynie podobieństwem.

Częściowe podobieństwo, np. Jaccard na deterministycznych shingles, jest słabszym
wzorcem. Nie powinno być przedstawiane jako dokładne powtórzenie.

Hash po normalizacji whitespace nie dowodzi równoważności semantycznej kodu ani
tekstu. Jeżeli hashe miałyby być zapisywane, muszą podlegać tej samej retencji i
usuwaniu co sesja. Ponieważ hash przewidywalnej poufnej treści może zostać
odgadnięty słownikowo, MVP powinno liczyć go w pamięci/cache analizy albo użyć
HMAC z lokalnym sekretem zamiast trwałego, niesolonego hashu.

Algorytm kanonikalizacji, hash i ewentualny `hashKeyId` należą do
`componentVersions`. Rotacja sekretu nie może powodować porównywania digestów
policzonych różnymi kluczami; taki zakres ma `hashCoverage=unknown` do czasu
ponownego przeliczenia w jednym snapshotcie.

### 6.5. Trójwartościowa logika reguł

Każdy predykat ma stan `true | false | unknown`. `missing`, `invalid` oraz
`ambiguous` na wejściu dają `unknown`, chyba że inna gałąź wyrażenia rozstrzyga
wynik bez tego pola.

```text
AND: false, jeśli dowolny składnik jest false;
     true, jeśli wszystkie są true;
     w pozostałych przypadkach unknown.

OR:  true, jeśli dowolny składnik jest true;
     false, jeśli wszystkie są false;
     w pozostałych przypadkach unknown.

NOT: true → false, false → true, unknown → unknown.
```

Dzięki temu np. brak limitu promptu nie blokuje `freshBurst`, jeśli gałąź oparta
na historii daje `true`, ale wynik pozostaje `unknown`, gdy gałąź historyczna jest
`false`, a limitu brakuje. Implementacja nie może zastępować `unknown` przez
`false` tylko po to, aby wymusić klasyfikację.

## 7. Wektor cech dla rundy

Dla rundy `t` należy zbudować jeden niezmienny obiekt obserwacji.

### 7.1. Tożsamość i granice

```text
sessionId
conversationId
traceId
chatSpanId
interactionIndex
roundIndex
model
startedAt / endedAt
```

Stabilna kolejność `round-order-v1` używa kolejno: `startedAt`, `endedAt` i
leksykograficznego `spanId`. `spanId` rozstrzyga remis wyłącznie po to, aby wynik
był powtarzalny; przy równych lub nakładających się timestampach relacja
sekwencyjna pozostaje `ambiguous` i nie otrzymuje premii przejścia. Runda bez
poprawnego czasu może mieć profil lokalny, ale nie uczestniczy w trendach,
przejściach ani segmentacji wymagającej kolejności.

Normatywne pojęcia zakresu `sequence-scope-v1`:

```text
agentStreamId = "root:" + sessionKey dla analizowanego root agenta
                albo "child:" + rawConversationId dla sesji dziecka powiązanej
                dokładną krawędzią call ID → conversation ID

latestKnownBefore(b, field) = najbliższa wcześniejsza runda w tym samym
  traceId/interakcji i agentStreamId, która emituje poprawną wartość field

explicitChangeAt(b, field) = b emituje poprawną wartość field
  AND latestKnownBefore(b, field) istnieje
  AND wartości są różne

baseCompatible(a, b) =
  a i b są sąsiednimi rundami tego samego traceId/interakcji
  AND ten sam agentStreamId
  AND jednoznaczne a.startedAt < b.startedAt
  AND NOT explicitChangeAt(b, model)
  AND NOT explicitChangeAt(b, Pmax)
  AND NOT explicitChangeAt(b, Omax)

comparisonSequence = maksymalny ciąg kolejnych baseCompatible rund, przecięty
  dodatkowo przez event kompaktowania oraz bezpośrednio po rundzie z
  potwierdzonym błędem

nextInComparisonSequence(t) = bezpośrednio następna runda po t w tej samej
  comparisonSequence

phaseWindow = cała comparisonSequence albo jawnie wskazane przesuwne okno N
  kolejnych rund wewnątrz niej; nigdy arbitralnie wybrany podzbiór
```

„Brak jawnej zmiany” nie znaczy „potwierdzona stałość”. Brak w rundzie pośredniej
nie ukrywa późniejszej jawnej zmiany: `X → missing → Y` tworzy granicę przed `Y`,
jeśli `X != Y`; `X → missing → X` jej nie tworzy. Jeśli model albo limit jest
brakujący w którejkolwiek rundzie, runda może pozostać w tej samej
`comparisonSequence`, ale `modelContinuity`, `promptLimitContinuity` lub
`outputLimitContinuity` ma stan `unknown`. Na poziomie całej sekwencji continuity
jest `confirmed` wyłącznie wtedy, gdy odpowiednie pole jest obecne we wszystkich
rundach i ma tę samą wartość; jakikolwiek brak daje `unknown`, a jawna różnica
tworzy nową sekwencję. `limitContinuity=confirmed` jest skrótem wymagającym obu
limitów; reguła korzystająca tylko z `Pmax` wymaga wyłącznie
`promptLimitContinuity`.
Reguła wymagająca porównywalności modelu lub limitu, w tym transition prior i
delta presji, nie korzysta wtedy z tej pary. Dwie różne, jawne wartości tworzą
twardą granicę. Przy niejednoznacznej kolejności każda z objętych rund stanowi
osobną sekwencję dla reguł kolejnościowych.

Potwierdzony błąd zamyka sekwencję po rundzie błędu; jawne kompaktowanie rozdziela
rundy przed i po evencie. Tylko reguły `POST_ERROR`,
`POST_COMPACTION_CONTEXT_GROWTH` i `REHYDRATION_PATTERN` mogą spojrzeć przez tę
konkretną granicę. Wymagają wtedy `baseCompatible` po pominięciu odpowiednio
warunku błędu lub kompaktowania. „Segment fazy” jest wynikiem klasyfikacji z
sekcji 11.8 i nigdy nie jest wejściem do definicji `comparisonSequence`.

### 7.2. Tokeny i output

```text
inputTokens I_t
cacheReadTokens K_t
freshInputTokens F_t
cacheWriteTokens CW_t
outputTokens O_t
reasoningTokens Q_t
```

Każda wartość musi mieć flagę obecności.

### 7.3. Stan kontekstu

Niech:

```text
P_t = copilot_chat.request.max_prompt_tokens
M_t = gen_ai.request.max_tokens
```

Pochodne:

```text
fullWindowLimit_t     = P_t + M_t
fullWindowOccupancy_t = I_t / (P_t + M_t)
promptPressure_t      = I_t / P_t
promptHeadroom_t      = P_t - I_t
cacheShare_t          = K_t / I_t
freshShare_t          = F_t / I_t
reportedOutputBudgetUse_t = O_t / M_t
```

`fullWindowOccupancy` odpowiada obecnemu pojęciu „Okno przy wysłaniu”. Dla oceny
ryzyka zapełnienia promptu ważniejszy jest `promptPressure`.

Przykład:

```text
I = 250k, P = 272k, M = 128k
fullWindowOccupancy = 62,5%
promptPressure      = 91,9%
```

Wartość powyżej `100%` nie powinna być automatycznie obcinana. Jest sygnałem
niespójnych danych, innej semantyki pola albo zachowania providera i obniża
wiarygodność. Surową wartość pokazujemy do audytu, ale domyślnie nadajemy jej stan
`ambiguous` i nie przypisujemy pasma, dopóki fixture emitera nie potwierdzi takiej
semantyki.

Każdy iloraz wymaga dodatniego, skończonego mianownika oraz nieujemnych,
skończonych liczników. `K > I`, `I < 0`, `P <= 0`, `M <= 0`, ujemny czas trwania
albo ujemny headroom dają `invalid` lub `ambiguous`, a nie `0`, `NaN`, wartość
obciętą ani procent. `reportedOutputBudgetUse` opisuje wykorzystanie wyemitowanego
limitu odpowiedzi tylko przy zgodnej semantyce output/reasoning danego emitera.

Proponowane, jawnie wersjonowane pasma startowe `context-bands-v1`:

| Presja promptu | Stan |
|---:|---|
| `[0%, 25%)` | niska |
| `[25%, 60%)` | umiarkowana |
| `[60%, 85%)` | wysoka |
| `[85%, 100%]` | krytyczna |

Są to progi produktowe do kalibracji, nie fakty pochodzące od providera. Brak
limitu daje stan `unknown`, nigdy `0%`. Pasma stosujemy wyłącznie do poprawnych
wartości z przedziału `0–100%`.

`context-mix-v1` opisuje udział cache w raportowanym input token mix:

| `cacheShare` | Etykieta |
|---:|---|
| `< 40%` | `FRESH_DOMINANT` |
| `40–60%` | `BALANCED` |
| `> 60%` | `CACHE_DOMINANT` |

Wartości dokładnie `40%` i `60%` należą do `BALANCED`. Przy brakującym `I`/`K`,
`I=0` albo `K>I` etykieta ma stan `UNKNOWN` lub `INVALID` zgodnie z walidacją.

Trend `context-trend-v1` dla poprawnej, jednoznacznie poprzedniej rundy ma wartość
`STABLE`, gdy `abs(deltaPressure) <= 0.05`, `RISING`, gdy `deltaPressure > 0.05`,
i `FALLING`, gdy `deltaPressure < -0.05`. Pierwsza runda, reset albo
niejednoznaczna kolejność dają `UNKNOWN`.

Cache nadal zajmuje kontekst. Wysoka presja może więc współistnieć z bardziej
cache-dominant miksem inputu. Dopiero wyemitowane credits opisują pełne zużycie
danej rundy; output i model mogą nadal dominować.

### 7.4. Przepływ narzędziowy

```text
toolExecutionCount_t
nonEmptyToolResultCount_t
toolArgumentBytes_t
toolResultBytes_t
uniqueToolResultBytes_t
largestToolResultBytes_t
medianToolResultBytes_t
exactDuplicateResultCount_t
toolErrorCount_t
toolDurationMs_t
```

Wyniki narzędzi wykonanych po `chat_t` zwykle mogą wejść do
`nextInComparisonSequence(t)`. Dlatego sygnałem akumulacji jest relacja pomiędzy
wolumenem wyników po rundzie `t` a zmianą requestu w tej następnej rundzie; nie należy przypisywać tego samego wolumenu do
inputu bieżącej rundy.

### 7.5. Przechwycona powierzchnia requestu i odpowiedzi

```text
systemInstructionBytes_t
inputMessageBytes_t
toolDefinitionBytes_t
requestVisibleBytes_t
observedRequestElementUnionBytes_t
assistantTextBytes_t
responseToolCallArgumentBytes_t
responseToolCallCount_t
roundCondensationRatio_t
inputItemCount_t
hasPreviousResponseId_t
```

Te cechy opisują widoczną strukturę requestu. Nie sumują się automatycznie do
`inputTokens`, szczególnie przy `hasPreviousResponseId=true`.

`observedRequestElementUnionBytes` jest unią pełnych kanonicznych elementów
wiadomości, instrukcji i definicji widocznych w danym żądaniu, z identycznymi
elementami liczonymi raz. `roundCondensationRatio = assistantTextBytes /
observedRequestElementUnionBytes` ma sens tylko przy pełnym pokryciu requestu,
jawnym `hasPreviousResponseId=false`, dodatnim mianowniku i braku ucięcia treści.

### 7.6. Credits i czas

```text
credits_t
creditsPresent_t
durationMs_t
ttftMs_t
```

Credits wpływają na wagę biznesową rekomendacji, ale nie rozstrzygają fazy. Czas
i TTFT są opisem wydajności technicznej, nie dowodem semantycznego rodzaju pracy.

### 7.7. Zdarzenia i stan

```text
confirmedError_t
errorEvidenceRefs_t
compactionCompleted_t
compactionSuccess_t
abort_t
finishReason_t
childLaunchCount_t
childReturnCount_t
```

### 7.8. Cechy sekwencyjne

Porównania wykonujemy tylko w obrębie jednej `comparisonSequence`; dana cecha
może dodatkowo wymagać potwierdzonego `modelContinuity` albo `limitContinuity`:

```text
deltaInput_t          = I_t - I_(t-1)
deltaPressure_t       = pressure_t - pressure_(t-1)
deltaFresh_t          = F_t - F_(t-1)
deltaOutput_t         = O_t - O_(t-1)
rollingPressureTrend  = trend z ostatnich 2–3 rund
freshBurst_t          = F_t względem mediany wcześniejszych rund lub limitu promptu
outputBurst_t         = O_t względem mediany wcześniejszych rund
duplicateHistoryRatio = udział treści widzianej wcześniej
gapFromPreviousMs_t
```

Nie należy używać surowych różnic między modelami o różnych limitach. Zmiana
modelu lub limitu resetuje bazę; znormalizowane proporcje mogą być pokazane po obu
stronach granicy, ale nie dowodzą ciągłości tego samego stanu.

### 7.9. Macierz wpływu danych na klasyfikację

Tabela jest skróconym kontraktem: „wpływ” oznacza dozwolone użycie w regule, nie
związek przyczynowy.

| Dane | Profil rundy/fazy | Profil sesji | Profil subagenta | Czego nie wolno z nich wnioskować |
|---|---|---|---|---|
| `traceId`, root `invoke_agent` | granica interakcji i reset prioru | liczba interakcji | granica porównania z rodzicem | semantyczny cel zadania |
| `chat` i kolejność czasu | kolejność rund, segmentacja, trend | długość ścieżki, cykle | liczba rund i sekwencja dziecka | że późniejszy span jest skutkiem wcześniejszego bez relacji/czasu |
| `parentSpanId` | kontrola spójności przypisania toola | topologia techniczna | wsparcie relacji, ale nie zamiennik call ID | relacja subagenta wyłącznie z drzewa spanów |
| `I` | wolumen requestu, trend i podstawa proporcji | suma raportowanego inputu, peak | input-heavy, wolumen własny | źródło konkretnych tokenów |
| `K` i pochodne `F` | cache/fresh mix, burst fresh | udział cache/fresh | profil tokenowy i współczynnik credits | że wskazany fragment był w cache lub był nową wiedzą |
| `O` | output-dominant, niezerowy rezultat | udział outputu w przebiegu | output-heavy | jakość, finalizacja albo użyteczność wyniku |
| `CW` | informacja dodatkowa | ograniczenie agregacji | ograniczenie współczynnika v1 | cena cache write bez jawnej semantyki billingowej |
| `Q` reasoning | osobna metryka opisowa | suma znanych reasoning | cecha opisowa | że należy dodać ją drugi raz do outputu |
| `Pmax`, `Omax` | presja promptu i wykorzystanie limitów | peak/trend presji | stan kontekstu dziecka | problem tylko dlatego, że okno jest pełne |
| `inputItemCount`, typy, `hasPreviousResponseId` | słabe wsparcie kształtu requestu | opis mechanizmu zachowania stanu | ograniczenie widoczności wejścia | że agent przetwarzał głównie stary kontekst |
| liczba/czas wykonań tooli | akumulacja lub iteracja wraz z innymi cechami | udział przepływu iteracyjnego | iteracyjność | semantyczna rola na podstawie nazwy toola |
| bajty argumentów i wyników | wolumen napływu/transferu | wolumen obserwowanej komunikacji | przepływ zlecenie–wyniki–zwrot | tokeny fragmentu, wiedza lub skutek uboczny operacji |
| identyczne hashe pełnych elementów | powtórzenia i churn | powtarzalność między fazami | kondensacja/passthrough/powtórzenia | równoważność semantyczna albo niezmienność źródła |
| messages, instructions, definitions | widoczna powierzchnia requestu | narzut treści w rundach | treść dostępna dziecku | dokładny udział fragmentu w tokenach fresh/cache/credits |
| status, `error.type`, eventy i strukturalne failure | marker `POST_ERROR`, twarda granica | udział rund po błędzie | liczba potwierdzonych problemów | błąd z samego czasu, dużego inputu lub braku telemetryki |
| jawny event kompaktowania | marker i, z dodatkowymi danymi, rehydratacja | profil kompaktowanie–rehydratacja | marker dziecka | kompaktowanie wyłącznie ze spadku inputu |
| `tool.call.id` + raw `conversation.id` | marker delegowania | graf i udział potomków | warunek atrybucji profilu dziecka | relacja z samej nazwy lub bliskości czasu |
| model żądania/odpowiedzi | reset bazy i porównywalności | segmenty według modelu | grupowanie współczynnika credits | cennik albo „drogi model” bez credits |
| credits | priorytet ekonomiczny findingu | suma znanych credits i udziały | współczynnik/udział względem rodzica | faza, jakość, cena pieniężna albo nieefektywność |
| duration i TTFT | cechy opisowe | udział czasu | czas epizodu | błąd, marnotrawstwo lub rodzaj pracy |
| finish reason / response ID | marker techniczny i ciągłość stanu | ograniczenie interpretacji końca | ciągłość odpowiedzi | zakończenie celu biznesowego |
| logi, metryki, resource attributes | dopiero po dokładnym powiązaniu | dodatkowe dowody po korelacji | dodatkowe dowody po korelacji | atrybucja do sesji bez testowanej relacji |
| nazwa toola, skilla lub agenta | brak wpływu semantycznego | brak wpływu semantycznego | brak wpływu semantycznego | research, mapowanie, review, implementacja itp. |

Cecha może wpływać na kilka osi, ale musi zostać policzona raz i wskazywać te
same źródłowe spany. Credits, czas i reasoning służą głównie opisowi oraz
priorytetyzacji; nie mogą „przegłosować” profilu przepływu wyznaczonego z danych
wejścia, wyjścia i sekwencji.

## 8. Trzy niezależne osie wyniku rundy

Każda runda powinna otrzymać trzy niezależne opisy.

### 8.1. Profil przepływu

Odpowiada na pytanie: „Jak rozkładał się przepływ danych i generowanie?”.

Profile podstawowe to: akumulacja, przetwarzanie istniejącego kontekstu,
output-dominant, mieszany i nieustalony. Kondensacja i iteracja są osobnymi
kwalifikatorami, a delegowanie markerem grafu.

### 8.2. Stan kontekstu

Odpowiada na pytanie: „W jakich warunkach kontekstowych pracował model?”.

Przykład:

```text
wysoka presja · cache-dominant · trend rosnący · 34k headroom
```

Jest to obiekt złożony, nie jedna konkurencyjna etykieta:

```text
ContextState {
  band: LOW | MODERATE | HIGH | CRITICAL | UNKNOWN
  promptPressure
  fullWindowOccupancy
  promptHeadroom
  cacheMix
  trend: FALLING | STABLE | RISING | UNKNOWN
  initialLargeContext: true | false | unknown
}
```

`INITIAL_LARGE_CONTEXT` jest flagą tego obiektu. Nie zastępuje pasma `HIGH` lub
`CRITICAL` i nie jest profilem przepływu.

### 8.3. Marker cyklu życia lub anomalii

Odpowiada na pytanie: „Co istotnego wydarzyło się wokół tej rundy?”.

Przykłady: po potwierdzonym błędzie, po udanej kompaktacji, powtórzone dane,
zmiana modelu, wejście do subagenta, niepełne dane o credits.

Łączny opis może brzmieć:

> Konsolidacja-podobna · krytyczna presja promptu · po wcześniejszej akumulacji ·
> credits dostępne dla tej rundy.

Normatywny podział kodów:

| Rodzaj | Machine code | Polska etykieta UI |
|---|---|---|
| profil podstawowy | `CONTEXT_ACCUMULATION` | Akumulacja kontekstu |
| profil podstawowy | `CONTEXT_PROCESSING` | Przetwarzanie istniejącego kontekstu |
| profil podstawowy | `OUTPUT_DOMINANT` | Output-dominant |
| profil podstawowy | `MIXED` | Profil mieszany |
| profil podstawowy | `UNKNOWN` | Profil nieustalony |
| kwalifikator kształtu | `CONDENSING` | Kondensacja |
| kwalifikator kształtu | `ITERATIVE_FLOW` | Przepływ iteracyjny |
| kwalifikator sekwencji | `REHYDRATION_PATTERN` | Wzorzec rehydratacji |
| stan początkowy | `INITIAL_LARGE_CONTEXT` | Duży kontekst startowy |
| marker grafu | `DELEGATION` | Delegowanie do dziecka |
| marker cyklu | `POST_ERROR` | Aktywność po potwierdzonym błędzie |
| marker cyklu | `COMPACTION_COMPLETE` | Jawne zakończenie kompaktowania |
| marker sekwencji | `POST_COMPACTION_CONTEXT_GROWTH` | Wzrost kontekstu po kompaktowaniu bez dowodu identyczności treści |
| marker cyklu | `CHILD_RETURN` | Powrót dokładnie powiązanego dziecka |
| anomalia | `REPETITIVE_CHURN` | Powtarzalność o małym przyroście unikalnej treści |

Jedna runda ma dokładnie jeden profil podstawowy, zero lub wiele kwalifikatorów,
jeden stan kontekstu i zero lub wiele markerów/anomalii. Dzięki temu
`POST_ERROR` nie konkuruje punktowo z `CONTEXT_ACCUMULATION`.

## 9. Deterministyczny katalog profili, kwalifikatorów i markerów

Poniższe etykiety opisują zachowanie, nie intencję.

### 9.1. Stan: duży kontekst startowy / inicjalizacja

Silne przesłanki:

- pierwsza runda interakcji albo subagenta;
- wysokie `I` lub `F` względem kolejnych rund albo jawnego progu;
- brak wcześniejszych rund, z których kontekst mógł zostać zbudowany;
- opcjonalnie duży rozmiar zlecenia, instructions lub definitions.

Nie wolno wnioskować, że agent wcześniej prowadził research. Wysoki input może
pochodzić z promptu użytkownika, instrukcji, środowiska, dużego handoffu albo
gotowego kontekstu projektu.

### 9.2. Profil podstawowy: akumulacja kontekstu

Silne przesłanki:

- niepuste, unikalne wyniki narzędzi między rundami;
- wzrost `I` lub `promptPressure` w następnej rundzie;
- wysoki fresh input w następnej rundzie;
- kilka kolejnych rund zwiększających wolumen unikalnych danych.

Przesłanki pomocnicze:

- rosnąca liczba elementów requestu;
- wiele małych albo jeden duży wynik;
- mały lub średni output w porównaniu z późniejszą konsolidacją.

Kontrprzesłanki:

- brak zmiany requestu mimo dużych wyników;
- `hasPreviousResponseId` i niekompletna widoczność requestu;
- zmiana modelu/limitu;
- dokładne duplikaty bez przyrostu unikalnej treści.

Poprawna interpretacja: „agent akumulował dane w kontekście”.  
Niepoprawna interpretacja bez dodatkowych dowodów: „agent robił research”.

### 9.3. Profil podstawowy: przetwarzanie istniejącego kontekstu

Przesłanki:

- mały nowy napływ wyników;
- stabilny `I` lub `promptPressure`;
- niezerowy output;
- brak dominującego sygnału akumulacji, konsolidacji albo delegowania.

`hasPreviousResponseId=true` jest wyłącznie słabą przesłanką pomocniczą: dowodzi
użycia mechanizmu zachowania stanu, lecz nie dowodzi, że model wykonywał głównie
przetwarzanie zamiast innego rodzaju pracy.

Etykieta nie rozstrzyga, czy była to analiza, klasyfikacja, planowanie, review czy
transformacja. Mówi jedynie, że model pracował przede wszystkim na już dostępnym
kontekście.

### 9.4. Profil podstawowy: konsolidacja outputu / output-dominant

Silne przesłanki:

- output wyraźnie większy niż w poprzednich rundach;
- mały nowy napływ danych przed lub po rundzie;
- stabilny albo wysoki kontekst;
- wcześniejsza faza akumulacji lub przetwarzania;
- brak kolejnego szerokiego cyklu narzędziowego.

W pojedynczej rundzie bez historii poprawną etykietą jest `output-dominant`, nie
„synteza” ani „finalizacja”. Słowo „konsolidacja-podobna” jest dopuszczalne dopiero
przy wsparciu sekwencji.

Ostatnia znana runda nie jest automatycznie finalizacją. Status „Ostatnio odebrano
telemetrię” nie jest sygnałem heartbeat i nie potwierdza zakończenia sesji.

### 9.5. Kwalifikator: kondensacja

Przesłanki:

- duży kontekst wejściowy i/lub duży wolumen unikalnych danych;
- mały rezultat tekstowy albo mały wynik zwrócony rodzicowi;
- relatywnie niewielka dalsza ekspansja;
- mała liczba rund nie jest wymagana, ale wzmacnia interpretację.

Kondensacja jest kwalifikatorem zgodnym z podsumowaniem, ekstrakcją lub klasyfikacją,
ale telemetria ilościowa nie pozwala rozróżnić tych semantycznych celów.

### 9.6. Kwalifikator: iteracyjna praca narzędziowa

Przesłanki:

- wiele rund oraz wykonań narzędzi;
- powtarzalny profil wolumenów;
- wiele małych albo średnich przyrostów zamiast jednego dominującego;
- brak jednoznacznej konsolidacji przez dłuższy fragment sekwencji.

Nie wolno nazywać tej fazy kodowaniem, testowaniem, review ani debugowaniem na
podstawie nazw narzędzi.

### 9.7. Marker grafu: delegowanie / aktywność gałęzi

Delegowanie jest przede wszystkim faktem topologicznym. Wymaga dokładnie
powiązanego dziecka. Można mierzyć:

- liczbę dzieci;
- nakładanie przedziałów telemetrycznych oraz pracę sekwencyjną;
- udział dzieci w znanych credits;
- wolumen zleceń i zwrotów;
- sumę znanych credits całego poddrzewa i pokrycie danych.

Samo wywołanie dowolnego toola nie oznacza delegowania.

`DELEGATION` przypisujemy rundzie rodzica, której krok narzędziowy zawiera launch
z dokładnie powiązanym dzieckiem. `CHILD_RETURN` przypisujemy pierwszej późniejszej
rundzie rodzica zaczynającej się po zakończeniu launch tool calla zawierającego
rezultat. Oba markery wymagają zgodnego ID; `CHILD_RETURN` wymaga dodatkowo
jednoznacznej kolejności. Brak kolejnej rundy nie oznacza utraty wyniku — marker
pozostaje wtedy nieprzypisany do rundy.

### 9.8. Marker cyklu: aktywność po potwierdzonym błędzie

Marker `po błędzie` wymaga potwierdzonego błędu zgodnie z istniejącym kontraktem.
Kolejna faza zachowuje własny profil:

```text
akumulacja kontekstu po potwierdzonym błędzie
przetwarzanie po potwierdzonym błędzie
powtórzona próba po potwierdzonym błędzie
```

Nie wolno automatycznie nazywać kolejnej rundy researchem, diagnozą ani udanym
recovery. „Recovery” jest dopuszczalne wyłącznie dla tej samej jednoznacznie
identyfikowalnej operacji, gdy późniejszy wynik strukturalny jawnie potwierdza jej
powodzenie. `STATUS_CODE_OK` nie potwierdza sukcesu biznesowego. W pozostałych
przypadkach używamy wyłącznie „aktywność po błędzie”.

### 9.9. Marker i kwalifikator: kompaktowanie oraz rehydratacja

Jawny event kompaktowania jest markerem cyklu życia. Silny wzorzec rehydratacji
wymaga łącznie:

1. potwierdzonej udanej kompaktacji;
2. spadku `I` lub `promptPressure` w pierwszej `baseCompatible` rundzie po
   evencie, przy pominięciu samej granicy kompaktowania;
3. późniejszego wzrostu fresh inputu;
4. ponownego pojawienia się treści widzianej przed kompaktowaniem, najlepiej
   potwierdzonego identycznym hashem;
5. dostępności jawnego source version/hash, jeśli chcemy potwierdzić, że źródło
   nie zmieniło się pomiędzy pobraniami.

Bez capture content można wykryć „ponowny wzrost obciążenia kontekstu po
kompaktowaniu”,
ale nie „ponowne pobranie tych samych danych”.

### 9.10. Anomalia: powtarzalność o małym przyroście unikalnej treści

Silny wzorzec wymaga kombinacji:

- co najmniej kilku podobnych rund;
- tych samych argumentów lub wyników potwierdzonych hashem;
- małego przyrostu unikalnej obserwowanej treści;
- braku proporcjonalnego rezultatu;
- opcjonalnie rosnących credits albo presji kontekstu.

Same podobne liczby tokenów nie wystarczają. Dwie rundy mogą mieć identyczne
wolumeny i całkowicie różną treść.

### 9.11. Profile podstawowe: mieszana i nieustalona

- `MIXED` — co najmniej dwa profile mają zbliżoną siłę dowodów;
- `UNKNOWN` — nie ma minimalnych danych albo żaden profil nie przekracza progu.

Klasyfikator powinien zwrócić drugą możliwą interpretację, jeśli różnica punktów
jest niewielka.

## 10. Stan kontekstu jako modyfikator fazy

Wysokość okna zmienia znaczenie tego samego zachowania:

| Obserwacja | Interpretacja ilościowa |
|---|---|
| niska presja + szybki przyrost fresh inputu | początkowe budowanie kontekstu |
| wysoka presja + dalszy duży napływ | akumulacja pod presją limitu |
| stabilna wysoka presja + mało nowych danych + rosnący output | konsolidacja-podobna |
| spadek po jawnej kompaktacji + późniejszy wzrost | kontynuacja/rehydratacja-podobna |
| wysoka presja + wysoki cache share | pełny kontekst z relatywnie tańszym miksem inputu; cały request nie musi być tani |
| wysoka presja + niski cache share | pełny kontekst o fresh-dominant miksie; zużycie potwierdzają dopiero credits |
| niska presja po błędzie + nowy burst | aktywność po błędzie z odbudową kontekstu |

Wysoka presja sama nie dowodzi problemu. Niska presja sama nie dowodzi początku
pracy. Po kompaktowaniu lub przejściu do nowej gałęzi niska wartość może wystąpić
w środku długiej sesji.

## 11. Model sekwencyjny

### 11.1. Scoring

Dla każdej fazy `p` i rundy `t`:

```text
score_t(p) =
  localEvidence_t(p)
  + contextModifier_t(p)
  + boundedTransitionPrior_t(p)
  - counterEvidence_t(p)
```

Zasady:

- musi istnieć co najmniej jeden lokalny dowód dla wybranej fazy;
- premia przejścia nie przekracza `MAX_TRANSITION_BONUS`;
- jawny event tworzy marker lub granicę, ale w v1 nie dodaje punktów do profilu
  podstawowego;
- zbliżone wyniki prowadzą do `MIXED` lub `UNKNOWN`;
- reguły, progi i wagi mają jawny `classifierVersion`.

### 11.2. Typowe przejścia jako priory

| Poprzedni profil | Profil bardziej prawdopodobny później | Warunek dodatkowy |
|---|---|---|
| akumulacja | przetwarzanie | spadek nowego napływu |
| akumulacja/przetwarzanie | konsolidacja | wzrost outputu i brak dalszej ekspansji |
| konsolidacja | ponowna akumulacja | lokalny `freshBurst` albo `uniqueResultSignal` w tej samej interakcji |

Są to premie, nie dozwolone i niedozwolone przejścia. Agent może wielokrotnie
wracać od konsolidacji do akumulacji. Duży kontekst startowy modyfikuje stan,
a błąd i kompaktowanie tworzą markery lub granice; nie konkurują z profilami w
tej tabeli.

Powrót subagenta jest niezależnym markerem `CHILD_RETURN`. Może wzmacniać lokalną
interpretację następnej rundy rodzica, jeżeli obserwowany rezultat wszedł do jej
requestu, ale rodzic nie dziedziczy fazy dziecka.

### 11.3. Reset sekwencji

Prior resetujemy przy:

- nowej interakcji użytkownika;
- rozpoczęciu osobnej sekwencji sesji subagenta;
- zmianie modelu lub semantyki limitu;
- niejednoznacznej kolejności timestampów — prior nie przechodzi przez parę,
  której kolejności nie da się potwierdzić.

Sama długa przerwa czasowa nie resetuje prioru w v1, ponieważ nie dowodzi nowego
celu ani utraty stanu. `gapFromPreviousMs` pozostaje cechą opisową. Ewentualny
próg czasu musi zostać wprowadzony dopiero jako nowa, wersjonowana reguła.

Rodzic i każde dziecko mają niezależną maszynę stanów. Start dziecka nie resetuje
automatycznie historii rodzica; po powrocie rodzic otrzymuje marker
`CHILD_RETURN`, a nie ostatnią etykietę fazy dziecka.

### 11.4. Ochrona przed kołowym wnioskowaniem

Nie wolno uzasadniać fazy wyłącznie poprzednią wywnioskowaną etykietą. Inaczej
jeden błąd klasyfikacji propaguje się przez całą sesję.

Ochrona:

- cechy powstają wyłącznie z surowej telemetryki i dokładnych pochodnych;
- transition prior jest ograniczony;
- rekomendacje są wyzwalane przez fakty, nie samą etykietę;
- wynik zachowuje kontrprzesłanki i alternatywną klasę;
- przyszłego modelu nie trenujemy na etykietach wygenerowanych przez te same
  heurystyki bez niezależnej walidacji człowieka.

Docelowo można zastosować HMM/CRF albo globalne wyszukiwanie najlepszej sekwencji,
ale dopiero po zebraniu ręcznie oznaczonego zbioru. Dla MVP bardziej audytowalny
jest wersjonowany scoring regułowy.

### 11.5. Referencyjne predykaty `phase-rules-v1`

Poniższe wartości tworzą implementowalny punkt startowy. Są progami produktowymi,
nie prawem wynikającym z Copilota. Po kalibracji każda zmiana wartości wymaga nowej
wersji reguł i testu granicznego.

```text
MIN_INPUT_TOKENS          = 256
MIN_OUTPUT_TOKENS         = 32
MIN_CONTENT_BYTES         = 1024
LARGE_CONTENT_BYTES       = 4096
PRESSURE_GROWTH           = 0.10       // +10 punktów procentowych
PRESSURE_DROP             = 0.20       // -20 punktów procentowych
STABLE_PRESSURE_DELTA     = 0.05
BURST_FACTOR              = 1.50
OUTPUT_TO_INPUT_HIGH      = 0.05
DUPLICATE_RATIO_HIGH      = 0.50
ITERATIVE_MIN_ROUNDS      = 3
ITERATIVE_ROUND_SHARE_MAX = 0.60
ITERATIVE_INPUT_CV_MAX    = 0.50
INITIAL_CONTEXT_PRESSURE  = 0.60
INITIAL_LARGE_INPUT_TOKENS = 4096
CONDENSATION_RATIO_MAX    = 0.25
CLASS_THRESHOLD           = 50
MIXED_MARGIN              = 10
MAX_TRANSITION_BONUS      = 10
```

To jest centralny rejestr współdzielonych stałych `phase-rules-v1`. Dalsze
reguły tej wersji odwołują się do nazw, a nie powtarzają wartości liczbowych.
Stałe o jednostce `*_TOKENS`/`*_INPUT` nie są wymienne ze stałymi `*_BYTES`.
Jeśli inny komponent reguł potrzebuje tej samej wartości i semantyki, deklaruje
jawny alias do tego rejestru zamiast drugiej niezależnej liczby.

Wszystkie porównania są domknięte po stronie progu, np. `>= 0.10` spełnia
`PRESSURE_GROWTH`. Wartość brakująca lub `invalid` daje stan predykatu `unknown`,
nie `false`. Predykat `unknown` nie dodaje ani nie odejmuje punktów, ale obniża
pokrycie danych.

Bazą dla burstu jest mediana wcześniejszych dodatnich wartości w tej samej
`comparisonSequence`; gałąź historyczna wymaga dodatkowo potwierdzonego
`modelContinuity` pomiędzy wszystkimi użytymi rundami:

```text
freshBurst_t =
  F_t >= MIN_INPUT_TOKENS
  AND (
    F_t >= BURST_FACTOR × median(previousPositiveFresh)
    OR (P_t > 0 AND F_t / P_t >= PRESSURE_GROWTH)
  )

outputBurst_t =
  O_t >= MIN_OUTPUT_TOKENS
  AND O_t >= BURST_FACTOR × median(previousPositiveOutput)
```

Gałąź oparta na medianie jest dostępna dopiero przy co najmniej dwóch wcześniejszych
dodatnich obserwacjach. Dotyczy to osobno `previousPositiveFresh` i
`previousPositiveOutput`. Gałąź `freshBurst` wykorzystująca limit wymaga
poprawnego `P_t`. Całe wyrażenia są liczone zgodnie z logiką Kleene'a z sekcji
6.5, w następującej kolejności:

- brak `F_t`/`O_t` daje `unknown`;
- `F_t < MIN_INPUT_TOKENS` rozstrzyga `freshBurst=false`, nawet jeśli obie
  gałęzie w nawiasie są `unknown`;
- `F_t >= MIN_INPUT_TOKENS` oraz brak rozstrzygającej gałęzi historycznej i
  limitowej daje `freshBurst=unknown`; prawdziwość dowolnej gałęzi daje `true`, a
  dwie rozstrzygnięte wartości `false` dają `false`;
- `O_t < MIN_OUTPUT_TOKENS` rozstrzyga `outputBurst=false` bez historii;
- `O_t >= MIN_OUTPUT_TOKENS` i brak wymaganej historii daje
  `outputBurst=unknown`; przy dostępnej historii drugi człon rozstrzyga wynik.

Relacja `O/I` pozostaje osobnym predykatem `highOutputRatio`, dzięki czemu ten sam
dowód nie jest punktowany drugi raz jako burst historyczny.

Pozostałe predykaty:

```text
pressureGrowth_t = deltaPressure_t >= PRESSURE_GROWTH
pressureStable_t = abs(deltaPressure_t) <= STABLE_PRESSURE_DELTA
pressureDrop_t   = deltaPressure_t <= -PRESSURE_DROP

pressureGrowth_next(t) = pressureGrowth_n, gdzie n = nextInComparisonSequence(t)
freshBurst_next(t)     = freshBurst_n, gdzie n = nextInComparisonSequence(t)

uniqueResultSignal_t =
  uniqueToolResultBytes_t >= MIN_CONTENT_BYTES
  OR distinctNonEmptyToolResultCount_t >= 2

lowResultSignal_t =
  toolResultContentCoverage kompletne
  AND uniqueToolResultBytes_t < MIN_CONTENT_BYTES
  AND distinctNonEmptyToolResultCount_t <= 1

nonTrivialOutput_t = O_t >= MIN_OUTPUT_TOKENS
highOutputRatio_t  = I_t > 0 AND O_t / I_t >= OUTPUT_TO_INPUT_HIGH
highDuplicateRatio_t =
  duplicateRatio(round:t, toolResults) >= DUPLICATE_RATIO_HIGH
```

`uniqueResultSignal` opisuje wolumen wyników, nie dowodzi pozyskania wiedzy.
`lowResultSignal` może być `unknown`, gdy capture content jest niepełne.

### 11.6. Punktacja profilu podstawowego `phase-rules-v1`

Punkty lokalne:

| Predykat | `CONTEXT_ACCUMULATION` | `CONTEXT_PROCESSING` | `OUTPUT_DOMINANT` |
|---|---:|---:|---:|
| `uniqueResultSignal_t` | +35 | -20 | -20 |
| `pressureGrowth_next(t)` dla `nextInComparisonSequence(t)` | +30 | -20 | -10 |
| `freshBurst_next(t)` dla `nextInComparisonSequence(t)` | +25 | -15 | -10 |
| `pressureStable_t` | 0 | +25 | +10 |
| `lowResultSignal_t` | -15 | +25 | +20 |
| `nonTrivialOutput_t` | 0 | +20 | +10 |
| `outputBurst_t` | -10 | 0 | +40 |
| `highOutputRatio_t` | -10 | 0 | +25 |
| `highDuplicateRatio_t` | -20 | 0 | 0 |
| poprawne `I/O` i co najmniej `MIN_INPUT_TOKENS` | 0 | +10 | 0 |

Semantyka każdej komórki jest jednakowa: predykat `true` dodaje wskazaną wagę,
także ujemną; `false` dodaje `0`; `unknown` dodaje `0` i obniża pokrycie danych.
Kontrprzesłanka nie jest odejmowana, dopóki jej predykat nie ma wartości `true`.
Modyfikatory oraz priory stosują tę samą zasadę. Jeśli po warunku minimalnego
lokalnego dowodu nie pozostał żaden uprawniony kandydat, wynik to `UNKNOWN`
niezależnie od samych sum punktów.

Uwagi dotyczące osi czasu:

- wyniki tooli po rundzie `t` należą do kroku narzędziowego rundy `t`;
- ich wpływ na request sprawdzamy przez `pressureGrowth` oraz `freshBurst` dla
  `nextInComparisonSequence(t)`;
- jeśli `nextInComparisonSequence(t)` nie istnieje w snapshotcie, punkty zależne od przyszłej rundy są
  `unknown`, a wynik rundy `t` pozostaje `provisional`;
- runda po twardej granicy nie jest `nextInComparisonSequence(t)` i nie stanowi
  dowodu dla rundy `t`.

Modyfikatory kontekstu, które same nie mogą utworzyć klasy:

```text
localAccumulationEvidence_t = freshBurst_t OR uniqueResultSignal_t
localProcessingEvidence_t   = lowResultSignal_t OR nonTrivialOutput_t
localOutputEvidence_t       = outputBurst_t
```

| Warunek | Profil | Punkty |
|---|---|---:|
| `contextBand_t IN {LOW, MODERATE} AND localAccumulationEvidence_t=true` | `CONTEXT_ACCUMULATION` | +5 |
| `contextBand_t IN {HIGH, CRITICAL} AND localAccumulationEvidence_t=true` | `CONTEXT_ACCUMULATION` | +5 |
| `pressureStable_t=true AND localProcessingEvidence_t=true` | `CONTEXT_PROCESSING` | +5 |
| `(pressureStable_t=true OR contextBand_t IN {HIGH, CRITICAL}) AND localOutputEvidence_t=true` | `OUTPUT_DOMINANT` | +5 |

Każde `AND`/`OR` jest oceniane trójwartościowo zgodnie z sekcją 6.5. Te predykaty
lokalne bazują wyłącznie na obserwacji rundy, nie na priorze ani wcześniej nadanej
etykiecie. Dwa wiersze akumulacji są rozłączne, więc jedna runda może otrzymać z
nich najwyżej `+5`.

Ograniczone priory przejścia:

| Poprzedni profil | Bieżący kandydat | Premia |
|---|---|---:|
| `CONTEXT_ACCUMULATION` | `CONTEXT_PROCESSING` | +10 |
| `CONTEXT_ACCUMULATION` | `OUTPUT_DOMINANT` | +10 |
| `CONTEXT_PROCESSING` | `OUTPUT_DOMINANT` | +10 |
| `OUTPUT_DOMINANT` | `CONTEXT_ACCUMULATION` | +5, tylko gdy `(freshBurst_t=true OR uniqueResultSignal_t=true)` |
| dowolny inny przypadek | dowolny | 0 |

Po `MIXED` albo `UNKNOWN` premia przejścia wynosi `0`. Nie wybieramy arbitralnie
jednego z kandydatów poprzedniej rundy. Premia wynosi również `0`, gdy
`modelContinuity`, `limitContinuity` albo kolejność pary nie są potwierdzone.

Wybór klasy:

1. policzyć trzy wyniki po odrzuceniu predykatów `unknown`;
2. kandydat musi mieć co najmniej jeden dodatni lokalny predykat inny niż
   `poprawne I/O`, modyfikator kontekstu lub prior;
3. jeśli najwyższy wynik jest mniejszy niż `CLASS_THRESHOLD`, zwrócić `UNKNOWN`;
4. utworzyć zbiór wszystkich klas z wynikiem co najmniej `CLASS_THRESHOLD` i
   odległością od najwyższego wyniku nie większą niż `MIXED_MARGIN`; jeśli zbiór
   ma co najmniej dwa elementy, zwrócić `MIXED` i cały zbiór w stałej kolejności
   `CONTEXT_ACCUMULATION`, `CONTEXT_PROCESSING`, `OUTPUT_DOMINANT`;
5. w przeciwnym razie zwrócić najwyższą klasę;
6. punkty nie są prawdopodobieństwem i nie są pokazywane użytkownikowi jako `%`.

Reguła celowo pozwala uzyskać `UNKNOWN` częściej niż zgadywać. Progi powinny być
kalibrowane na syntetycznych fixture'ach i ręcznie opisanych, zanonimizowanych
sesjach przed uznaniem etykiet za stabilny kontrakt produktu.

### 11.7. Kwalifikatory i anomalie `phase-rules-v1`

`INITIAL_LARGE_CONTEXT`:

```text
pierwsza runda `agentStreamId` w danej interakcji
AND (
  promptPressure >= INITIAL_CONTEXT_PRESSURE
  OR I >= INITIAL_LARGE_INPUT_TOKENS AND I >= 2 × median(laterValidInput)
)
```

Druga gałąź wymaga co najmniej dwóch późniejszych poprawnych rund i jest
retrospektywna. Do czasu ich pojawienia się ma stan `unknown`, a wynik zależny od
tej gałęzi pozostaje `provisional`.

`CONDENSING` dla pojedynczej rundy z pełnym przechwytywaniem treści:

```text
requestContentCoverage kompletne
AND hasPreviousResponseId jawnie false
AND observedRequestElementUnionBytes >= LARGE_CONTENT_BYTES
AND O >= MIN_OUTPUT_TOKENS
AND responseToolCallCount = 0
AND roundCondensationRatio <= CONDENSATION_RATIO_MAX
```

Przy niepełnych kanałach kwalifikator rundy ma stan `unknown`; profil podstawowy
nadal może powstać z tokenów. Reguła nie mówi, że odpowiedź jest podsumowaniem —
opisuje wyłącznie relację obserwowanego requestu do tekstu odpowiedzi. Osobna
reguła `CONDENSING` dla całego subagenta używa
`returnPayloadBytes / observedSourceUnionBytes` w sekcji 15.11.

`ITERATIVE_FLOW`:

Przed segmentacją profili przyjmujemy jako okno całą `comparisonSequence` z
`sequence-scope-v1`. Dla tej reguły wymagane jest dodatkowo potwierdzone
`modelContinuity` w całym oknie. Nie wolno wybierać wygodnego podzbioru dłuższej
sekwencji.

```text
totalReportedTokenVolume okna = Σ(I_t + O_t)
```

```text
roundCount okna >= ITERATIVE_MIN_ROUNDS
AND co najmniej 2 z nich mają toolExecutionCount > 0
AND pełne pokrycie I oraz O w całym oknie
AND totalReportedTokenVolume okna > 0
AND dla każdej rundy:
    (I_t + O_t) / totalReportedTokenVolume okna <= ITERATIVE_ROUND_SHARE_MAX
AND populationCoefficientOfVariation(I w oknie) <= ITERATIVE_INPUT_CV_MAX
```

```text
populationCoefficientOfVariation(I) =
  sqrt(Σ(I_t - meanI)^2 / roundCount) / meanI
```

Wymagane są wszystkie `I >= 0`, `O >= 0`, `meanI > 0` oraz pełne pokrycie obu
liczników tokenowych. W przeciwnym razie kwalifikator jest `unknown`. Przy
dopasowaniu obejmuje całą `comparisonSequence`. Reguła nie wymaga capture
content: opisuje iteracyjność po liczbie rzeczywistych wykonań i rozłożeniu
raportowanego wolumenu tokenów. Nie oznacza kodowania ani testowania.

`REHYDRATION_PATTERN`:

```text
preCompactionHashes = unia hashy pełnych wyników tooli od poprzedniej twardej
                      granicy do eventu kompaktowania
postRounds           = pierwsze maksymalnie 2 kolejne baseCompatible rundy po
                       evencie, przy pominięciu granicy kompaktowania
postObservedBytes    = suma content-bytes-v1 rzeczywistych transferów wyników
                      tooli w postRounds, po deduplikacji reprezentacji
rehydratedBytes      = część postObservedBytes, której hash jest obecny
                      w preCompactionHashes
rehydrationOverlapRatio = rehydratedBytes / postObservedBytes
```

```text
jawny compaction_complete success=true
AND (
  w pierwszej rundzie postRounds pressureDrop=true
  OR (I_before > 0 AND (I_before - I_after) / I_before >= 0.30)
)
AND w postRounds występuje co najmniej jeden freshBurst=true
AND postObservedBytes >= MIN_CONTENT_BYTES
AND rehydrationOverlapRatio >= DUPLICATE_RATIO_HIGH
```

`I_before` jest inputem ostatniej poprawnie uporządkowanej rundy przed eventem,
a `I_after` pierwszej `baseCompatible` rundy po nim przy pominięciu samej granicy
kompaktowania. Reguła wymaga fixture'a
potwierdzającego event sukcesu, pełnego `toolResultContentCoverage` i
`hashCoverage` przed oraz po evencie, a także dodatniego mianownika.
`POST_COMPACTION_CONTEXT_GROWTH` jest dopasowany, gdy event sukcesu, warunek
spadku i późniejszy `freshBurst` są prawdziwe, ale warunek identyczności treści
jest fałszywy albo `unknown`. Jest to marker wzrostu po kompaktowaniu, nie
rehydratacja tych samych danych.

`REPETITIVE_CHURN`:

Regułę oceniamy dla każdego `phaseWindow` będącego przesuwnym oknem dokładnie
trzech rund wewnątrz `comparisonSequence` użytej przez `ITERATIVE_FLOW`:

```text
co najmniej 3 rzeczywiste wykonania
AND co najmniej 2 różne call ID
AND totalObservedToolResultBytes > 0
AND duplicateRatio(phaseWindow, toolResults) >= DUPLICATE_RATIO_HIGH
AND outputBurst=false dla każdej z 3 rund
```

Dowolne `outputBurst=unknown` albo niepełne pokrycie wyników daje `unknown` dla
okna. Każde pasujące okno pozostaje osobnym findingiem; UI może wizualnie scalić
nakładające się zakresy, ale nie zmienia ich dowodów.

Jeśli brak source version/hash, komunikat nie może twierdzić, że źródło było
niezmienione.

### 11.8. Segmentacja rund w fazy `phase-segmentation-v1`

1. Klasyfikujemy każdą rundę według snapshotu kończącego się na
   `analysisCutoffSignalId` i zapisujemy `analyzedAt`.
2. Twardą granicę przed kolejną rundą tworzą: nowa interakcja, inny
   `agentStreamId`, jawna zmiana modelu, jawna zmiana limitu oraz event
   kompaktowania, zgodnie z `sequence-scope-v1`.
3. Potwierdzony błąd kończy bieżący segment; pierwsza późniejsza runda
   `baseCompatible` przy pominięciu tej granicy błędu dostaje marker `POST_ERROR`,
   ale zachowuje własny profil podstawowy.
4. Sąsiednie rundy o tym samym profilu podstawowym i bez twardej granicy łączą
   się w jeden segment.
5. `UNKNOWN` nigdy nie jest automatycznie wchłaniany przez znany profil.
6. Pojedynczy `MIXED` pomiędzy dwiema rundami o tym samym profilu można włączyć
   do ich segmentu tylko wtedy, gdy profil sąsiadów należy do
   `candidateProfileCodes` rundy `MIXED`, nie ma markera granicznego, a różnica punktów mieści się w
   `MIXED_MARGIN`.
7. Nie ma minimalnej długości segmentu: jedna runda może być pełną fazą.
8. Gdy dopływa `nextInComparisonSequence(t)`, klasyfikacja `t` może zmienić się z `provisional` na
   ustaloną. Snapshot i wersja reguł pozwalają wyjaśnić zmianę.
9. Kwalifikatory i markery nie są wygładzane ani dziedziczone na cały segment,
   chyba że ich własna reguła definiuje zakres wielorundowy.

## 12. Klasyfikacja całej sesji

Sesja powinna być opisana jako ścieżka i zestaw udziałów, nie pojedyncza rola.

### 12.1. Podsumowanie ilościowe

- liczba interakcji oraz rund;
- szczyt i trend presji promptu;
- suma raportowanych tokenów input i output;
- udział cache i fresh w raportowanym input token mix;
- suma znanych credits oraz pokrycie danych;
- liczba faz i przejść;
- liczba błędów, kompaktowań i epizodów rehydratacji;
- liczba dzieci, maksymalna głębokość i udział poddrzew;
- udział rund `UNKNOWN`.

Suma inputów opisuje rozliczony wolumen wielu requestów, a nie największe
zapełnienie jednego okna. Stan kontekstu sesji opisujemy przez serię i maksimum,
nie przez sumę.

### 12.2. Profile sesyjne

Deterministycznie można opisać m.in.:

- `SINGLE_PASS` — jedna lub niewiele rund, bez szerokiej ekspansji;
- `PROGRESSIVE_CONTEXT_GROWTH` — stopniowa akumulacja i wzrost presji;
- `ACCUMULATION_OUTPUT_CYCLES` — powtarzane cykle akumulacja → output-dominant;
- `DELEGATION_HEAVY` — znacząca część grafu lub credits w dzieciach;
- `ITERATIVE_TOOL_FLOW` — wiele małych kroków bez jednego dużego przyrostu;
- `POST_ERROR_ACTIVITY_HEAVY` — duży udział rund bezpośrednio po potwierdzonych błędach;
- `COMPACTION_REHYDRATION` — jawne kompaktowanie i wzorzec odbudowy kontekstu.

Nazwy te opisują architekturę przebiegu. Nie określają dziedziny zadania.

Warto pokazywać trzy różne udziały faz:

- udział w liczbie rund;
- udział w znanych credits;
- udział w czasie.

Nie są one zamienne. Jedna runda o wysokim zużyciu credits może dominować ten
wymiar, lecz nie liczbę kroków.

### 12.3. Referencyjne reguły `session-profile-rules-v1`

Profil sesji jest wieloetykietowy. Sekwencyjne profile liczymy tylko dla rund
głównego agenta, osobno w każdej `comparisonSequence` z `sequence-scope-v1`.
Nie wybieramy krótszego podzbioru takiej sekwencji. Reguła zależna od modelu lub
limitu wymaga wskazanego coverage/continuity. Udział delegowania liczymy dla
całego grafu dokładnie powiązanych sesji.
Nie mieszamy tych mianowników. Warunek negujący marker lub zdarzenie jest
rozstrzygalny tylko przy pełnym pokryciu odpowiedniego kanału. Jeżeli profil
zależy od rundy albo segmentu `provisional`, sam wynik sesyjny także pozostaje
`provisional`.

„Główny agent” oznacza rundy należące do analizowanej sesji po wyłączeniu
dokładnie powiązanych potomków oraz znanych technicznych/auxiliary calls.
Niepowiązanych kandydatów nie włączamy ani do root, ani do drzewa; pokazujemy je
osobno wraz z obniżonym `subagentLinkCoverage`. Obecny filtr nazw auxiliary jest
ograniczeniem implementacji i nie nadaje tym sesjom profilu semantycznego.

```text
rootRoundCount       = wszystkie spany chat głównego agenta
childRoundCount      = spany chat wszystkich dokładnie powiązanych potomków
treeRoundCount       = rootRoundCount + childRoundCount
unknownRootShare     = rundy root o profilu UNKNOWN / rootRoundCount
delegatedRoundShare  = childRoundCount / treeRoundCount
delegatedCreditShare = znane credits potomków / znane credits całego drzewa
```

Każdy iloraz wymaga dodatniego mianownika. Oba udziały delegowania służą do reguły
wyłącznie przy kompletnym `subagentLinkCoverage`; przy brakach pokazujemy udział
w znanym grafie bez rozstrzygania progu. `delegatedCreditShare` wymaga dodatkowo
pełnego `creditCoverage` całego drzewa; w przeciwnym razie pokazujemy wyłącznie
udział w znanych credits.

Agregaty oparte na predykatach rund lub segmentów zachowują `unknown`. Dla zbioru
kwalifikujących jednostek `U` i predykatu `m(u) ∈ {true, false, unknown}` liczymy:

```text
matchedCount(U, m) = liczba jednostek z m=true
unknownCount(U, m) = liczba jednostek z m=unknown
shareLower(U, m)   = matchedCount / |U|
shareUpper(U, m)   = (matchedCount + unknownCount) / |U|

shareAtLeast(U, m, T) =
  true,    jeśli shareLower >= T
  false,   jeśli shareUpper < T
  unknown, w pozostałych przypadkach

countAtLeast(U, m, N) =
  true,    jeśli matchedCount >= N
  false,   jeśli matchedCount + unknownCount < N
  unknown, w pozostałych przypadkach
```

Pusty `U` daje `unknown` dla udziału i normalny wynik `false` dla
`countAtLeast(U, m, N)`, gdy `N > 0`. UI może pokazać przedział
`[shareLower, shareUpper]`; nie może pokazać dolnej granicy jako ostatecznego
udziału. W tej notacji:

```text
iterativeRootShareBounds = przedział dla m(r)=ITERATIVE_FLOW(r)
postErrorRootShareBounds = przedział dla m(r)=POST_ERROR(r)
accumulationShareBounds  = przedział dla m(r)=profil(r)=CONTEXT_ACCUMULATION
```

Dla cykli każdemu rozstrzygniętemu segmentowi `CONTEXT_ACCUMULATION` odpowiada
maksymalnie jeden `cycleCandidate`. Sprawdzamy kolejno najwyżej dwa następne
segmenty w tej samej `comparisonSequence`: kandydat jest `true`, gdy przed kolejną
akumulacją wystąpi rozstrzygnięty segment `OUTPUT_DOMINANT`; jest `false`, gdy dwa
następne segmenty są rozstrzygnięte i żaden nie spełnia warunku albo wcześniej
wystąpi rozstrzygnięta kolejna akumulacja; jest `unknown`, gdy do rozstrzygnięcia
brakuje profilu, kolejności lub przyszłego segmentu w snapshotcie. Granica
sekwencji kończy kandydata jako `false` tylko wtedy, gdy snapshot ma jawny sygnał
zakończenia; w przeciwnym razie kandydat pozostaje `unknown/provisional`.
Liczbę cykli ocenia `countAtLeast(cycleCandidates, isCycle,
SESSION_MIN_CYCLES)`.

Stałe startowe:

```text
SESSION_MIN_SEQUENCE_ROUNDS = 3
SESSION_SHARE_HIGH          = 0.30
SESSION_MAJORITY            = 0.50
SESSION_PRESSURE_GROWTH     = 0.20
SESSION_MIN_CYCLES          = 2
```

| Kod | Warunek v1 |
|---|---|
| `SINGLE_PASS` | `1 <= rootRoundCount <= 2`, `childRoundCount = 0` przy kompletnym `subagentLinkCoverage`, brak `CONTEXT_ACCUMULATION`, `ITERATIVE_FLOW`, błędu i kompaktowania oraz `unknownRootShare = 0` |
| `PROGRESSIVE_CONTEXT_GROWTH` | jedna `comparisonSequence` ma co najmniej `SESSION_MIN_SEQUENCE_ROUNDS`, `promptPressureCoverage=complete`, `promptLimitContinuity=confirmed`, `shareAtLeast(rundy sekwencji, profil=CONTEXT_ACCUMULATION, SESSION_MAJORITY)=true` i `peakPromptPressure - firstPromptPressure >= SESSION_PRESSURE_GROWTH` |
| `ACCUMULATION_OUTPUT_CYCLES` | `countAtLeast(cycleCandidates, isCycle, SESSION_MIN_CYCLES)=true` |
| `DELEGATION_HEAVY` | przy kompletnym `subagentLinkCoverage`: `delegatedRoundShare >= SESSION_SHARE_HIGH` albo, dodatkowo przy pełnym pokryciu credits, `delegatedCreditShare >= SESSION_SHARE_HIGH` |
| `ITERATIVE_TOOL_FLOW` | `rootRoundCount >= SESSION_MIN_SEQUENCE_ROUNDS` i `shareAtLeast(rundy root, ITERATIVE_FLOW, SESSION_MAJORITY)=true` |
| `POST_ERROR_ACTIVITY_HEAVY` | `countAtLeast(rundy root, POST_ERROR, 2)=true` i `shareAtLeast(rundy root, POST_ERROR, SESSION_SHARE_HIGH)=true` |
| `COMPACTION_REHYDRATION` | istnieje co najmniej jeden kwalifikator `REHYDRATION_PATTERN` oparty na pełnych wymaganych danych |

Dla każdego kodu wynik ma stan `matched | not_matched | unknown`. Zwracamy
wszystkie `matched` oraz osobną listę nierozstrzygniętych reguł. Obecność profilu
`matched` nie ukrywa innych reguł `unknown`. Jeżeli nie ma żadnego `matched`, ale
istnieje co najmniej jeden `unknown`, podsumowanie ma kod `UNKNOWN`. Kod
`NO_DOMINANT_SESSION_PATTERN` powstaje wyłącznie wtedy, gdy wszystkie reguły są
`not_matched`. Sesja może spełnić kilka profili jednocześnie; nie emitujemy
sztucznego globalnego `MIXED`.

W tabeli zapis `...=true` jest normatywny: `unknown` z funkcji agregującej
propaguje się przez pozostałe `AND`/`OR` zgodnie z sekcją 6.5. Reguła nie może
uznać progu za niespełniony wyłącznie dlatego, że część jednostek ma stan
`unknown`. Dla `SINGLE_PASS` wszystkie negowane przesłanki muszą być
rozstrzygnięte jako nieobecne; jakikolwiek brak pokrycia błędu, kompaktowania,
profilu rundy lub relacji dziecka daje `unknown`, nie `matched`.

Profile sesyjne są opisem przebiegu widocznego w snapshotcie. Nie dowodzą
zakończenia zadania, jakości wyniku ani niezmienności źródeł.

## 13. Generyczne wykrywanie relacji subagenta

### 13.1. Docelowa reguła

Relacja rodzic–dziecko jest potwierdzona tylko wtedy, gdy:

```text
gen_ai.tool.call.id spanu rodzica
  == gen_ai.conversation.id sesji lub spanów dziecka
```

Docelowe wykrywanie:

1. zebrać wszystkie niepuste call ID z operacji wykonawczych;
2. zbudować indeks `gen_ai.conversation.id` odczytanych z raw atrybutów
   poszczególnych spanów, a identyfikator sesji traktować tylko jako indeks
   pomocniczy;
3. wykonać dokładne złączenie po identyfikatorze;
4. odrzucić niejednoznaczne kolizje;
5. zbudować skierowany graf sesji;
6. wykryć cykle i oznaczyć je jako niespójność danych;
7. liczyć poddrzewa bez podwójnego uwzględniania spanów.

Jeżeli jedno call ID pasuje do więcej niż jednego kandydata, nie tworzymy żadnej
z tych krawędzi, a wszystkie trafiają do `ambiguousLinks[]`. Krawędź zamykająca
cykl również nie uczestniczy w poddrzewie ani atrybucji credits; otrzymuje stan
`invalidCycle`. Rozstrzygnięcie nie może zależeć od kolejności rekordów.

Bliskość czasowa może wyświetlić `niepowiązany kandydat`, lecz nie daje prawa do
przypisania credits ani klasyfikacji dziecka.

### 13.2. Stan implementacji przed mapą pracy

Obecny frontend najpierw rozpoznaje potencjalny launch po nazwach
`execution_subagent` oraz `runSubagent`, a następnie stosuje dokładne call ID.
Ładowanie powiązanych szczegółów dodatkowo filtruje sesje uznane na podstawie
nazwy/prefiksu za auxiliary i pobiera również kandydatów z bliskiego okna
czasowego. Narzędzia dziecka są obecnie pobierane tylko z `relatedDetails`, a
zagnieżdżone poddrzewa nie są budowane rekurencyjnie. Ogranicza to wsparcie
custom tooli i oznacza, że samo załadowanie czasowego kandydata nie daje prawa do
atrybucji jego danych.

Docelowa klasyfikacja nie powinna używać nazwy do wykrywania relacji. Do czasu
zmiany implementacji dokument należy czytać jako kontrakt docelowy; nazwa może
chwilowo służyć technicznemu wykrywaniu, ale nigdy nie wpływa na profil przepływu.
Zmiana sposobu wykrywania wymaga fixture'a dla nowego kształtu telemetrii, testów korelacji
oraz aktualizacji reguł w `AGENTS.md`.

Znormalizowane `conversationId` spanu może być wartością grupującą odziedziczoną
z trace'a. Dokładne złączenie powinno sprawdzać źródłowy atrybut spanu w `attributesJson`;
nie może polegać wyłącznie na kolumnie grupującej.

### 13.3. Obsługa mieszanego epizodu `copilot-episode-v1`

Audyt lokalnego payloadu i syntetyczne fixture'y potwierdziły odmianę, w której
spany `chat` i `invoke_agent` dziecka zachowują conversation ID rodzica, a narzędzia
dziecka emitują własny conversation ID. Nie wolno przez to dzielić epizodu według
rekordów sesji utworzonych dla poszczególnych paczek OTLP.

W `workflow-mvp-0.2` dodatkowy dowód relacji wymaga łącznie:

- rodzic spanu `invoke_agent` dziecka jest wykonaniem delegującym;
- `copilot_chat.chat_session_id` dziecka jest równy call ID tego wykonania;
- `copilot_chat.parent_chat_session_id` dziecka odpowiada jawnemu chat ID lub
  conversation ID wykonania rodzica.

Potomkowie tego `invoke_agent` należą do osobnego epizodu również wtedy, gdy ich
raw conversation ID nadal wskazuje rodzica. Sprzeczne metadane pozostawiają
epizod nierozstrzygnięty, nie dołączają jego rund do głównego toru. Dla dziecka
w osobnym trace nadal działa dokładne złączenie call ID z raw conversation ID
jego rund. Reguła nie używa nazwy narzędzia ani bliskości czasowej.

Oba widoki rekonstruują epizody ponad historycznymi rekordami sesji i deduplikują
spany po trace/span ID. Osobno normalizacja nowych danych używa własnego ID spanu;
gdy raw conversation ID jest równy jawnemu parent chat ID, a chat ID jest odrębny,
używa chat ID jako klucza sesji dziecka. Braki i nierozstrzygalne relacje pozostają
jawne. Raw atrybuty oraz formuły tokenów/credits nie ulegają zmianie.

Kontrakt jest testowany w `MixedEpisodeTraceFixture` i `mixed-episode.fixture.ts`:
zmiana kolejności paczek, pojedyncze dostarczenia, historyczne rozdzielenie epizodu,
duplikaty i sprzeczność parent chat ID. Nie zmienia to reguły czasowego przypisania
wyników narzędzi do rund wewnątrz jednego epizodu.

## 14. Wektor cech subagenta

Główny agent i subagent używają tego samego klasyfikatora rund. Subagent otrzymuje
dodatkowe cechy wejścia, wyjścia i grafu.

### 14.1. Poziom bazowy: profil tokenowy

Profil bazowy musi działać bez capture content. Używa wyłącznie:

- pierwszego, maksymalnego i sumarycznego `I`, `K`, `F`, `O` wraz ze stanami obecności;
- udziałów cache/fresh i output/input;
- liczby rund oraz wykonań narzędzi bez interpretacji ich nazw;
- presji kontekstu i trendu, jeśli limity zostały wyemitowane;
- modelu, czasu, potwierdzonych błędów i markerów kompaktowania;
- grafu delegacji o relacjach potwierdzonych dokładną zgodnością ID;
- credits i pokrycie danych, wyłącznie do priorytetyzacji ekonomicznej.

Pozwala to nadać neutralne kody na osobnych osiach:

| Rodzaj | Kod | Znaczenie ilościowe |
|---|---|---|
| profil | `LOW_VOLUME` | niski wolumen względem jawnego progu |
| profil | `INPUT_HEAVY` | input dominuje nad outputem |
| profil | `CONTEXT_GROWTH` | input/presja rosną przez kolejne rundy |
| profil | `OUTPUT_HEAVY` | output ma wysoki udział albo burst |
| kwalifikator | `ITERATIVE` | wiele rund o zbliżonym profilu wolumenu |
| marker grafu | `NESTED_DELEGATION` | istnieją dokładnie powiązane dzieci |
| podsumowanie profilu | `UNKNOWN` | braki uniemożliwiają rozstrzygnięcie któregokolwiek profilu |
| podsumowanie profilu | `NO_DOMINANT_SUBAGENT_PATTERN` | wszystkie profile rozstrzygnięto, ale żaden nie pasuje |

Profil bazowy nie wie, jaki materiał pobrano ani co zawierał zwrot. Dzięki temu
klasyfikacja pozostaje możliwa przy wyłączonym capture content, ale ma mniejszą
zdolność wykrywania kondensacji, passthrough i powtórzeń.

### 14.2. Poziom rozszerzony: przepływ rodzic → dziecko → rodzic

```text
delegationPayloadBytes = rozmiar obserwowanego zlecenia przekazanego dziecku
uniqueToolResultBytes  = suma unikalnych obserwowanych wyników tooli dziecka
returnPayloadBytes     = rozmiar obserwowanego wyniku zwróconego rodzicowi
```

Te trzy wartości porównujemy w tej samej jednostce treści, np. bajtach UTF-8.
Nie wolno mieszać ich bezpośrednio z tokenami requestu.

`delegationPayloadBytes` nie jest pełnym inputem pierwszej rundy dziecka. Do
modelu mogły zostać dodane instrukcje, definicje narzędzi i kontekst środowiska.
`uniqueToolResultBytes` nie oznacza automatycznie „pozyskanej wiedzy”: wynik toola
może być potwierdzeniem, błędem, skutkiem ubocznym albo payloadem mutacji. Nie jest
też tożsamy z fresh inputem, ponieważ część wyników mogła zostać odfiltrowana,
skrócona albo niewysłana do kolejnej rundy. Wszystkie trzy payloady mogły zostać
skrócone przed dotarciem do Scannera.

W `content-flow-subagent-v1` jednym elementem jest pełna raw wartość atrybutu
zlecenia, rezultatu wykonania albo zwrotu po kanonikalizacji; nie dzielimy
samodzielnie zagnieżdżonego JSON-u na pola. Kilka osobno wyemitowanych messages lub
results pozostaje kilkoma elementami. Dla jednego dokładnie powiązanego epizodu:

```text
sourceElements = unia po dokładnym hashu:
  delegationElements(childEpisode) ∪ childToolResultElements(childEpisode)

observedSourceUnionBytes = Σ content-bytes-v1 każdego elementu sourceElements
delegationPayloadBytes   = Σ rzeczywistych transferów delegationElements
uniqueToolResultBytes    = uniqueContentBytes(childEpisode, toolResults)
returnPayloadBytes       = Σ rzeczywistych transferów returnElements

returnToObservedSourceRatio = returnPayloadBytes / observedSourceUnionBytes
toolResultToDelegationRatio = uniqueToolResultBytes / delegationPayloadBytes

returnedSourceMatchBytes = Σ bajtów tych rzeczywistych returnElements,
  których pełny hash występuje w sourceElements
exactReturnedSourceByteShare = returnedSourceMatchBytes / returnPayloadBytes
```

Każdy iloraz powstaje tylko przy kompletnych kanałach użytych przez jego licznik
i mianownik oraz mianowniku co najmniej `MIN_RATIO_BASE_BYTES` z rejestru w
sekcji 15.11. W v1 dwa elementy o częściowym, ale niepełnym overlapie są dla unii
dwoma różnymi elementami. Jest to jawne ograniczenie i może zawyżać
`observedSourceUnionBytes`; nie nadaje metryce stanu `ambiguous` i nie zmienia
wyniku exact-match. Opcjonalna metryka podobieństwa jest raportowana osobno i nie
uruchamia profili v1.

### 14.3. Pozostałe cechy

- liczba rund;
- pierwsze, maksymalne i sumaryczne `I`, `K`, `F`, `CW`, `O`;
- peak prompt pressure i trend;
- liczba wykonań narzędzi;
- suma oraz maksimum rozmiaru wyników;
- unikalny wolumen wyników i duplicate ratio;
- assistant output bytes;
- liczba błędów i kompaktowań;
- czas trwania i nakładanie z pracą rodzica;
- model dla każdej rundy;
- credits, pokrycie danych oraz udział w poddrzewie;
- liczba dokładnie powiązanych dzieci;
- rozmiar wyniku zwróconego rodzicowi;
- informacja, czy wynik pojawił się w kolejnym żądaniu rodzica.

Ostatnia informacja może mieć wartość `unknown`. Przy
`hasPreviousResponseId=true` wynik może pozostać w stanie providera bez ponownej
obecności tekstu w widocznych wiadomościach. Brak identycznego payloadu w
przechwyconym żądaniu nie dowodzi, że rodzic go nie użył.

Rozróżniamy:

- `sumInputTokens` — suma raportowanego inputu wszystkich requestów;
- `peakInputTokens` — największy pojedynczy kontekst;
- `uniqueContentBytes` — dostępny, zdeduplikowany wolumen treści;
- `returnBytes` — komunikację z powrotem do rodzica.

## 15. Deterministyczne profile subagenta

### 15.1. Kondensujący

Przesłanki:

- duże `observedSourceUnionBytes` albo osobno duży obserwowany wolumen zlecenia
  lub wyników;
- małe `returnPayloadBytes`;
- niski `return/input` albo `return/source`;
- niewielka dalsza ekspansja.

Profil jest zgodny z podsumowaniem, klasyfikacją lub ekstrakcją, ale nie pozwala
rozróżnić tych intencji.

### 15.2. Pozyskująco-ekspansywny

Przesłanki:

- małe lub średnie `delegationPayloadBytes`;
- duże `uniqueToolResultBytes`;
- kilka unikalnych wyników;
- rosnąca presja kontekstu;
- `returnPayloadBytes` stanowiący kondensację obserwowanych wyników albo duży handoff.

Profil jest zgodny z researchem, lecz nie jest dowodem researchu.

### 15.3. Praca głównie na przekazanym kontekście

Przesłanki:

- duże `delegationPayloadBytes` lub duży kontekst pierwszej rundy;
- małe `uniqueToolResultBytes`;
- niezerowe `returnPayloadBytes`;
- niewiele rund i mało dalszej akumulacji.

Profil oznacza przewagę pracy na przekazanym materiale. Nie mówi, czy czynność
była podsumowaniem, tłumaczeniem, review czy generowaniem dokumentu.

### 15.4. Generacyjny / output-heavy

Przesłanki:

- wysoki output względem inputu i wcześniejszych rund;
- duży wynik zwrócony rodzicowi;
- niewielki unikalny wolumen pozyskiwania.

### 15.5. Kwalifikator: narzędziowo-iteracyjny

Przesłanki:

- wiele rund i wykonań;
- małe albo średnie rezultaty na krok;
- brak jednego dominującego przyrostu;
- podobne wektory kolejnych rund.

### 15.6. Marker grafu: zagnieżdżona delegacja

Fakt topologiczny: subagent posiada co najmniej jedno dokładnie powiązane dziecko.
Jedno dziecko daje marker `NESTED_DELEGATION`; sesyjny profil
`DELEGATION_HEAVY` wymaga dodatkowo wersjonowanego progu udziału rund lub znanych
credits poddrzewa.
Można pokazać fan-out, głębokość i nakładanie przedziałów telemetrycznych. Nie
trzeba znać nazw tooli.

### 15.7. Niski wolumen

Przesłanki względne:

- jedna lub niewiele rund;
- małe zlecenie, wyniki tooli, zwrot, tokeny i credits względem rodzica/interakcji;
- brak zagnieżdżonych dzieci;
- brak szerokiej akumulacji.

„Niski” musi być wersjonowaną relacją do sesji lub jawnym progiem. Nie oznacza
małej ważności ani trudności zadania. Nie należy udawać, że istnieje uniwersalna
granica tokenów dla każdego modelu i zadania.

### 15.8. Handoff-heavy / passthrough

Przesłanki:

- bardzo duże `returnPayloadBytes`;
- zwrot ma znaczące dokładne pokrycie z obserwowanymi wynikami tooli;
- niewielka kondensacja;
- rezultat trafia dalej do requestu rodzica.

Może być uzasadniony potrzebą pełnej wierności. Sam duży handoff nie jest błędem.

### 15.9. Wieloprofilowy lub nieustalony

Profile subagenta są wieloetykietowe, dlatego w v1 nie zwijamy kilku pasujących
przepływów do `MIXED`: zachowujemy wszystkie spełnione kody. `UNKNOWN` oznacza,
że dokładna relacja rodzic–dziecko istnieje, ale braki danych uniemożliwiają
rozstrzygnięcie profilu. Bez dokładnej relacji nie istnieje „subagent UNKNOWN” —
jest tylko niepowiązany kandydat bez atrybucji danych.

Jeśli wszystkie reguły profilu dają `not_matched`, wynik ma kod
`NO_DOMINANT_SUBAGENT_PATTERN`. Markery grafu, kwalifikatory i anomalie pozostają
na osobnych osiach i nie zamieniają tego kodu w rozpoznany profil przepływu.

### 15.10. Etykiety zabronione bez dodatkowego dowodu

Warstwa deterministyczna nie przypisuje wyłącznie z wolumenów etykiet:

- researcher;
- mapper;
- implementer;
- reviewer;
- tester;
- debugger;
- documenter;
- classifier.

Można powiedzieć „profil zgodny z kondensacją” albo „profil pozyskująco-
ekspansywny”. Opcjonalna warstwa AI może później nazwać prawdopodobny cel na
podstawie treści zlecenia i wyniku, ale musi pozostać wyraźnie oddzielona.

### 15.11. Referencyjne reguły `subagent-profile-rules-v1`

Wynik subagenta jest wieloosiowy: zawiera `profileCodes[]`, `qualifiers[]`,
`markers[]` i `anomalyCodes[]`. `CONTEXT_GROWTH` oraz `ITERATIVE` mogą wystąpić
równocześnie, ale drugi kod pozostaje kwalifikatorem. UI nie powinno ukrywać
jednego z nich pod sztuczną jedną rolą. Reguły wykorzystują stałe z
`phase-rules-v1`.

Rejestr stałych właściwych dla `subagent-profile-rules-v1`:

```text
SUBAGENT_LOW_TOKEN_VOLUME_MAX = 4096       // tokeny, próg wyłączny
SUBAGENT_MIN_INPUT_TOKENS     = MIN_INPUT_TOKENS
SUBAGENT_MIN_OUTPUT_TOKENS    = 128
SUBAGENT_OUTPUT_INPUT_RATIO   = OUTPUT_TO_INPUT_HIGH
SUBAGENT_PRESSURE_GROWTH      = 0.15
SUBAGENT_FRESH_GROWTH_MIN     = 1024       // tokeny
SUBAGENT_LARGE_PAYLOAD_BYTES  = LARGE_CONTENT_BYTES
MIN_RATIO_BASE_BYTES          = MIN_CONTENT_BYTES
TOOL_EXPANSION_RATIO_MIN      = 4.0
RETURN_HEAVY_RATIO_MIN        = 0.75
PASSTHROUGH_EXACT_SHARE_MIN   = 0.75
```

Prawa strona aliasu wskazuje jedyne źródło wartości w tej wersji. Próg tokenowy
`4096` i próg bajtowy `LARGE_CONTENT_BYTES` mają przypadkiem tę samą liczbę, ale
nie są tym samym parametrem i nie wolno ich zamieniać.

Warunkiem wejściowym jest relacja rodzic–dziecko potwierdzona dokładną zgodnością
ID. Sumy własne obejmują wszystkie spany dziecka, bez potomków. Znane wartości
można pokazać jako sumy częściowe z pokryciem, ale reguła wymagająca pełnej sumy
ma wynik `unknown`, jeśli choć jeden objęty nią span nie ma wymaganego pola.

```text
sumI = Σ I_t
sumK = Σ K_t
sumF = Σ F_t
sumO = Σ O_t
reportedTokenVolume = sumI + sumO
roundCount = liczba spanów chat dziecka
toolExecutionCount = liczba przypisanych rzeczywistych wykonań
```

Reguły bazowe bez capture content:

| Kod | Warunek v1 |
|---|---|
| `LOW_VOLUME` | `roundCount <= 2`, `toolExecutionCount <= 1`, `reportedTokenVolume < SUBAGENT_LOW_TOKEN_VOLUME_MAX` oraz brak dziecka przy kompletnym `subagentLinkCoverage` |
| `INPUT_HEAVY` | `sumI >= SUBAGENT_MIN_INPUT_TOKENS` oraz `sumO / sumI < SUBAGENT_OUTPUT_INPUT_RATIO` |
| `OUTPUT_HEAVY` | `sumO >= SUBAGENT_MIN_OUTPUT_TOKENS` oraz `sumO / sumI >= SUBAGENT_OUTPUT_INPUT_RATIO` |
| `CONTEXT_GROWTH` | w jednej `comparisonSequence`: `sequenceRoundCount >= 2 AND ((promptPressureCoverage=complete AND promptLimitContinuity=confirmed AND peakPressure - firstPressure >= SUBAGENT_PRESSURE_GROWTH) OR (freshInputCoverage=complete AND modelContinuity=confirmed AND ΣF_afterFirst >= max(SUBAGENT_FRESH_GROWTH_MIN, F_first)))` |

W regule `CONTEXT_GROWTH` wszystkie wartości `first`, `peak`, `afterFirst` i oba
coverage odnoszą się wyłącznie do tej samej `comparisonSequence`. Dopasowanie w
jednej sekwencji wystarcza, a pozostałe sekwencje są zachowane jako osobne dowody
i mogą mieć wynik `unknown`.

Każdy iloraz wymaga dodatniego mianownika. Przy `sumI=0` profil oparty na proporcji
jest `invalid/unknown`, a nie output-heavy przez dzielenie przez zero.

Osobno nadajemy:

- kwalifikator `ITERATIVE`, gdy dziecko spełnia `ITERATIVE_FLOW`;
- marker `NESTED_DELEGATION`, gdy ma co najmniej jedno dziecko powiązane dokładną
  zgodnością ID.

Żaden z tych dwóch kodów nie jest profilem przepływu i sam nie zapobiega
`UNKNOWN` albo `NO_DOMINANT_SUBAGENT_PATTERN`.

Reguły rozszerzone przy pełnym pokryciu kanałów treści wymaganych przez daną
regułę; sama zbiorcza flaga `contentCaptured` nie wystarcza:

| Kod | Warunek v1 |
|---|---|
| `CONDENSING` | `observedSourceUnionBytes >= SUBAGENT_LARGE_PAYLOAD_BYTES`, `returnPayloadBytes > 0` i `returnToObservedSourceRatio <= CONDENSATION_RATIO_MAX` |
| `TOOL_RESULT_EXPANSION` | `uniqueToolResultBytes >= SUBAGENT_LARGE_PAYLOAD_BYTES` przy pełnym pokryciu wyników albo (`delegationPayloadBytes >= MIN_RATIO_BASE_BYTES` i `toolResultToDelegationRatio >= TOOL_EXPANSION_RATIO_MIN`) przy pełnym pokryciu wyników i zlecenia |
| `PROVIDED_CONTEXT_DOMINANT` | `delegationPayloadBytes >= SUBAGENT_LARGE_PAYLOAD_BYTES`, `uniqueToolResultBytes < MIN_CONTENT_BYTES`, niepusty zwrot |
| `RETURN_HEAVY` | `returnPayloadBytes >= SUBAGENT_LARGE_PAYLOAD_BYTES`, `observedSourceUnionBytes >= MIN_RATIO_BASE_BYTES` i `returnToObservedSourceRatio >= RETURN_HEAVY_RATIO_MIN` |
| `PASSTHROUGH` | `returnPayloadBytes >= MIN_RATIO_BASE_BYTES`, `observedSourceUnionBytes >= MIN_RATIO_BASE_BYTES` i `exactReturnedSourceByteShare >= PASSTHROUGH_EXACT_SHARE_MIN`, gdzie licznik obejmuje bajty pełnych elementów zwrotu o hashu identycznym z pełnym elementem źródłowym |
| `REPETITIVE_CONTENT` | dla epizodu dziecka obejmującego co najmniej dwa rzeczywiste transfery: `duplicateRatio(childEpisode, toolResults) >= DUPLICATE_RATIO_HIGH` |

`REPETITIVE_CONTENT` trafia do `anomalyCodes[]`, nie do `profileCodes[]`.

`content-overlap-v1` porównuje wyłącznie hashe pełnych kanonicznych elementów
JSON/message/result. Nie wykrywa fragmentów skopiowanych do większego tekstu.
Przypadki częściowego overlapu mogą zostać pokazane jako osobna słaba metryka,
ale nie uruchamiają `PASSTHROUGH` w wersji v1.

Każdą regułę profilu bazowego i rozszerzonego oceniamy osobno jako `matched |
not_matched | unknown`. Zwracamy wszystkie `matched` i osobno nierozstrzygnięte
reguły. Jeśli istnieje profil dopasowany z treści, brak `I/O` nie zmienia go w
globalne `UNKNOWN`. Gdy nie ma żadnego profilu `matched`, ale co najmniej jeden
ma stan `unknown`, podsumowanie to `UNKNOWN`. Kod
`NO_DOMINANT_SUBAGENT_PATTERN` powstaje wyłącznie wtedy, gdy wszystkie reguły
profili są `not_matched`. Kwalifikator `ITERATIVE`, marker
`NESTED_DELEGATION` i anomalia `REPETITIVE_CONTENT` nie biorą udziału w tej
agregacji.

Dla krótkiej etykiety UI kolejność prezentacyjna profili v1 to:

```text
CONDENSING
→ TOOL_RESULT_EXPANSION
→ PROVIDED_CONTEXT_DOMINANT
→ PASSTHROUGH
→ RETURN_HEAVY
→ CONTEXT_GROWTH
→ OUTPUT_HEAVY
→ INPUT_HEAVY
→ LOW_VOLUME
```

Jest to wyłącznie priorytet etykiety, nie dodatkowy wniosek semantyczny.

## 16. Zużycie credits przez subagenta i rodzica

### 16.1. Fakty dotyczące credits

Najpierw pokazujemy:

- znane credits subagenta;
- pokrycie danych credits;
- udział znanych credits dziecka w kompletnej interakcji;
- sumę znanych własnych credits dziecka;
- sumę znanych credits całego jego poddrzewa;
- token mix: cache, fresh i output;
- model użyty w każdej rundzie.

Udział w credits jest pełnym faktem tylko przy pełnym pokryciu wszystkich
porównywanych rund. Przy brakach używamy nazwy `udział w znanych credits`.

Współczynnik liczymy z wartości obecnych na źródłowych spanach `chat`, nie z
agregatu sesji scalonego przez maksimum. Jeżeli nowa wersja emitera zmieni
semantykę na wartość kumulatywną albo wyemituje tę samą wartość wielokrotnie,
wymagany jest fixture i osobna normalizacja; nie wolno zgadywać z samych delt.

### 16.2. Wersjonowany współczynnik credits

Proponowany wskaźnik MVP:

```text
weightedUnitsV1_t = K_t + 10 × F_t + 100 × O_t
MIN_WEIGHTED_UNITS_V1 = 10_000

observedCreditRateV1_agent,model =
  Σ credits_t / Σ weightedUnitsV1_t

relativeObservedRateV1_childModel =
  childObservedCreditRateV1_childModel / parentReferenceRateV1
```

Liczymy iloraz sum, a nie średnią współczynników rund. Małe requesty nie otrzymują
wtedy nieproporcjonalnej wagi.

Wskaźnik powinien nazywać się:

> Obserwowany współczynnik credits przy wagach v1

Nie jest to cena modelu ani efektywność zadania. Byłby estymatorem wspólnego
mnożnika ceny tylko wtedy, gdy prawdziwe stawki były proporcjonalne do
`cache:fresh:output = 1:10:100` i nie istniały inne składniki.

Warunki porównywalności:

- `I`, `K`, `O` i credits są obecne dla wszystkich włączonych rund;
- mianownik obu porównywanych stron wynosi co najmniej `MIN_WEIGHTED_UNITS_V1`;
- model jest niepusty dla wszystkich włączonych rund, a rundy są grupowane według
  modelu; telemetria nie dostarcza osobnego identyfikatora taryfy ani trybu
  billingowego, co pozostaje ograniczeniem;
- nie podwajamy spanów rodzica/dziecka;
- nie mieszamy częściowo znanych credits z pełnym pokryciem;
- pokazujemy token mix obok współczynnika;
- w żadnej włączonej rundzie nie ma dodatniego, jawnie wyemitowanego `CW`; brak
  pola `CW` nie jest zamieniany na zero, lecz pozostaje ograniczeniem modelu v1.

Zakres porównania jest normatywny:

- `childSelfRate` obejmuje tylko spany `chat` bezpośrednio należące do dziecka,
  bez potomków, i jest liczony osobno dla każdego modelu dziecka;
- `parentReferenceRate` obejmuje spany `chat` rodzica z tej samej interakcji i z
  tym samym modelem co runda delegująca, bez dzieci i auxiliary calls;
- `subtreeCredits` jest pokazywane osobno i obejmuje dziecko oraz potomków
  powiązanych dokładną zgodnością ID, bez duplikatów;
- dla każdego modelu dziecka porównujemy jego osobny `childSelfRate` z tą samą
  referencją rodzica; nie uśredniamy modeli dziecka w jedną pozorną stawkę;
- jeśli zbiór referencyjny jest pusty, niekompletny lub poniżej minimalnego
  mianownika, `relativeObservedRateV1` ma wartość `unknown`;
- porównanie różnych modeli jest dozwolone wyłącznie jako „obserwowany
  współczynnik przy wagach v1”, nie dowód ich cennika.

`cache write` wymaga osobnej decyzji o semantyce billingowej. Nie wolno go po
prostu dodać do mianownika i równocześnie pozostawić w fresh inputie bez dowodu,
czy oznacza składnik zastępujący, czy dodatkowy. Jeżeli w którejkolwiek włączonej
rundzie wyemitowano `CW > 0`, samodzielny `observedCreditRateV1` może zostać
pokazany wyłącznie informacyjnie z flagami `cacheWriteNotModelled=true` i
`comparable=false`. `relativeObservedRateV1` ma wtedy stan `unknown`, a wartość
informacyjna nie uruchamia porównania ani rekomendacji ekonomicznej. Jawne `CW=0`
nie blokuje porównania; brak `CW` pozostaje wymienionym ograniczeniem, ale nie
blokuje v1.

Reasoning pozostaje osobno i nie jest dodawany do outputu bez dowodu.

### 16.3. Zużycie credits nie jest efektywnością

Subagent o wyższym zużyciu credits może być właściwym wyborem dla trudnego
zadania. Z pojedynczej sesji bez jakościowego kontrfaktycznego wykonania nie da
się potwierdzić, że był nieoptymalny.

Poprawny komunikat:

> Subagent miał profil kondensujący, wykorzystał 38% znanych credits interakcji,
> a obserwowany współczynnik przy wagach v1 był 2,1× wyższy niż u rodzica. Warto
> sprawdzić wariant z modelem o niższym obserwowanym współczynniku credits albo
> jako skill w tej samej sesji.

Niepoprawny komunikat:

> Subagent był 2,1× za drogi i zmarnował credits.

## 17. Deterministyczne anomalie i rekomendacje

Rekomendacja powinna mieć:

```text
ruleId i ruleVersion
subject oraz evidenceRefs
zmierzone wartości
trigger i kontrprzesłanki
coverage
mechanizm potencjalnej oszczędności
alternatywę wartą zbadania
czego nie wiemy
```

Wersja `recommendation-rules-v1` używa poniższego słownika progów. Pozwala on
czytać dalsze, bardziej opisowe reguły jednoznacznie:

```text
SEVERAL_ROUNDS              = 3
LARGE_PAYLOAD_BYTES         := phase-rules-v1.LARGE_CONTENT_BYTES
SMALL_UNIQUE_RESULT_BYTES   := phase-rules-v1.MIN_CONTENT_BYTES
HIGH_PROMPT_PRESSURE        := context-bands-v1.HIGH.lowerBound
CRITICAL_PROMPT_PRESSURE    := context-bands-v1.CRITICAL.lowerBound
HIGH_FRESH_INPUT_TOKENS     = 4096
LOW_CACHE_SHARE             = 0.25
HIGH_DUPLICATE_RATIO        := phase-rules-v1.DUPLICATE_RATIO_HIGH
HIGH_CREDIT_SHARE           = 0.30
HIGH_RELATIVE_CREDIT_RATE   = 1.50
HIGH_BRANCH_OVERLAP         = 0.50
HIGH_EXACT_HANDOFF_SHARE    := subagent-profile-rules-v1.PASSTHROUGH_EXACT_SHARE_MIN
```

Operator `:=` oznacza alias do źródłowej stałej, nie kopię jej wartości. Zmiana
źródłowego progu wraz z wersją komponentu automatycznie zmienia alias; osobna
zmiana semantyki rekomendacji wymaga nowej stałej i wersji reguł.

- „kilka rund/wykonań” oznacza co najmniej `SEVERAL_ROUNDS`;
- „duży payload/handoff/wynik” oznacza co najmniej `LARGE_PAYLOAD_BYTES`;
- „mały przyrost unikalny” w oknie iteracji oznacza
  `uniqueContentBytes(comparisonSequence, toolResults) < SMALL_UNIQUE_RESULT_BYTES`
  i `duplicateRatio(comparisonSequence, toolResults) >= HIGH_DUPLICATE_RATIO`;
- „wysoka” i „krytyczna” presja używają pasm `context-bands-v1`;
- „duży fresh input” oznacza `freshBurst=true`;
- „istotny udział credits” oznacza udział `>= HIGH_CREDIT_SHARE` przy pełnym
  pokryciu porównywanego zakresu;
- „wyższy współczynnik credits” w rekomendacji ekonomicznej oznacza
  `relativeObservedRateV1 >= HIGH_RELATIVE_CREDIT_RATE`;
- „brak proporcjonalnego outputu” oznacza `outputBurst=false`; przy
  `outputBurst=unknown` cała zależna przesłanka pozostaje `unknown`.

Każda reguła zwraca `matched | not_matched | unknown` zgodnie z trójwartościową
logiką. Credits mogą podnosić priorytet rekomendacji, lecz nie zastępują dowodu
powtórzenia lub profilu przepływu.

W regułach powtórzeń `toolOperationKeyV1` jest dokładną, nieinterpretowaną
wartością `gen_ai.tool.name`; jeśli jej brak, reguła wymagająca tożsamości operacji
ma stan `unknown`. Nazwa służy tu wyłącznie do porównania dwóch wykonań, nigdy do
nadania fazy. `argumentHash` i `resultHash` są hashami pełnych kanonicznych raw
payloadów. Każdy udział credits w tej sekcji wymaga pełnego `creditCoverage`
własnego licznika i mianownika.

### 17.1. Powtórzone wykonanie z identycznymi argumentami i rezultatem

Identyfikator reguły: `REPEATED_IDENTICAL_TOOL_EXCHANGE`.

Trigger:

- co najmniej dwa wykonania w tej samej `comparisonSequence` mają identyczne
  `toolOperationKeyV1`, `argumentHash` i `resultHash`;
- wszystkie trzy wartości mają pełne `hashCoverage` w porównywanych wykonaniach.

Jawny source version/hash może dodatkowo potwierdzić brak zmiany danych pomiędzy
wykonaniami. Jego brak nie blokuje triggera, ale jest obowiązkowo opisanym
ograniczeniem: identyczność wejścia i wyniku nie dowodzi niezmienności źródła.

Rekomendacja: najpierw sprawdzić, czy operacja jest bezpieczna do ponownego
użycia. Dla operacji odczytowej zbadać reuse wyniku, cache, mapę/indeks albo
trwały artefakt. Identyczny payload nie dowodzi, że operacja nie miała skutku
ubocznego.

Bez identycznego hashu komunikat powinien mówić „podobny wolumen/podobna treść”, a nie
„te same dane”.

Nazwa lub definicja toola może być użyta jako nieprzejrzysty klucz tożsamości
technicznej operacji. Klasyfikator nie interpretuje jej znaczenia i nie mapuje na
research, implementację ani inną fazę.

### 17.2. Identyczny retry po błędzie

Identyfikator reguły: `IDENTICAL_RETRY_AFTER_ERROR`.

Trigger:

- pierwsze wykonanie ma potwierdzony błąd, a pierwsze późniejsze wykonanie
  `baseCompatible` przy pominięciu tej granicy błędu ma identyczne
  `toolOperationKeyV1` i `argumentHash`.

Brak jawnego sygnału zmiany warunków nie jest atomem triggera. Jest obowiązkowym
ograniczeniem findingu, bo nie dowodzi, że warunki faktycznie się nie zmieniły.

Rekomendacja: walidacja przed retry, zmiana strategii albo przerwanie pętli.

### 17.3. Kompaktowanie i rehydratacja z wysokim zużyciem credits

Identyfikator reguły: `POST_COMPACTION_REHYDRATION_CREDITS`.

Trigger:

- `REHYDRATION_PATTERN=matched` z sekcji 11.7;
- `rehydrationCreditShare = credits(postRounds) / credits(interaction)` jest
  rozstrzygalne przy pełnym pokryciu i wynosi `>= HIGH_CREDIT_SHARE`.

Credits dotyczą całych `postRounds`; nie przypisujemy ich konkretnym
zduplikowanym fragmentom. Jeśli wzorzec rehydratacji pasuje, ale credits są
niepełne albo udział jest nierozstrzygalny, pozostaje finding rehydratacji, lecz
ta konkretna rekomendacja ma stan `unknown`.

Rekomendacja: zbadać lepsze podsumowanie kompaktujące, mapę projektu, artefakt albo
kontrolowane wskazówki „gdzie ponownie szukać”. Nie twierdzić, że kompaktowanie
było wadliwe — mogło być konieczne.

### 17.4. Długotrwała akumulacja pod presją okna

Identyfikator reguły: `SUSTAINED_ACCUMULATION_UNDER_PRESSURE`.

Trigger:

- jeden segment `CONTEXT_ACCUMULATION` zawiera co najmniej `SEVERAL_ROUNDS` rund
  w tej samej `comparisonSequence`;
- co najmniej dwie rundy segmentu mają `contextBand IN {HIGH, CRITICAL}`;
- `nextInComparisonSequence(lastRound(segment))` istnieje i ma
  `freshBurst=true`;
- każda runda segmentu oraz ta następna runda ma `outputBurst=false`.

Brak proporcjonalnego outputu oznacza tu wyłącznie brak historycznego burstu
według `phase-rules-v1`; nie jest oceną jakości ani kompletności zwrotu.

Rekomendacja: zawęzić retrieval, użyć mapy/indeksu, agregatora lub narzędzia
zwracającego gotowy wycinek. Nie zakładać rodzaju custom toola.

### 17.5. Wiele małych kroków o małym przyroście unikalnej treści

Identyfikator reguły: `ITERATIVE_LOW_UNIQUE_GAIN`.

Trigger:

- `ITERATIVE_FLOW=true` dla konkretnej `comparisonSequence`;
- `duplicateRatio(comparisonSequence, toolResults) >= HIGH_DUPLICATE_RATIO`;
- `uniqueContentBytes(comparisonSequence, toolResults) < SMALL_UNIQUE_RESULT_BYTES`;
- co najmniej `SEVERAL_ROUNDS`; znane credits jedynie ustalają priorytet.

Rekomendacja: zbadać batching, szersze pojedyncze zapytanie albo dedykowaną
operację deterministyczną.

### 17.6. Duży inline handoff

Identyfikator reguły: `LARGE_INLINE_HANDOFF`.

Trigger:

- `returnPayloadBytes >= LARGE_PAYLOAD_BYTES`;
- dla pierwszej późniejszej rundy rodzica po `CHILD_RETURN`, z kompletnym
  `requestContentCoverage`, liczymy:

  ```text
  exactReturnedNextRequestByteShare =
    bajty rzeczywistych pełnych returnElements, których hash występuje w
    observedRequestElements tej rundy
    / returnPayloadBytes
  ```

- `exactReturnedNextRequestByteShare >= HIGH_EXACT_HANDOFF_SHARE`;
- `freshBurst=true` w tej samej rundzie rodzica.

Przy `hasPreviousResponseId=true` albo niepełnym pokryciu requestu obecność
handoffu w stanie rodzica może być `unknown`; brak widocznego tekstu nie jest
dowodem, że transfer nie nastąpił.

Rekomendacja: zbadać handoff przez plik/referencję albo bardziej zwarty kontrakt.
Duży wynik może być potrzebny dla wierności, więc nie jest automatycznie błędem.
Jeśli ten sam payload zostanie później rzeczywiście ponownie przesłany i
potwierdzony hashem, rekomendacja otrzymuje wyższą siłę; sama możliwość ponownego
przesłania pozostaje wyłącznie opisem ryzyka.

### 17.7. Rodzic powtarza operację wykonaną wcześniej przez dziecko

Identyfikator reguły: `PARENT_REPEATS_CHILD_TOOL_EXCHANGE`.

Trigger:

- dokładnie powiązany subagent;
- po jego powrocie rodzic wykonuje osobny tool call o innym call ID;
- oba wykonania mają identyczne `toolOperationKeyV1` i `argumentHash`, a pełny
  rezultat rodzica ma `resultHash` identyczny z wcześniejszym wynikiem toola
  dziecka.

Jawny source version/hash jest dowodem pomocniczym. Jeśli go brakuje, nie można
potwierdzić niezmienności źródła i finding musi podać to jako ograniczenie; brak
tego pola sam nie blokuje triggera.

Rekomendacja: jeśli operacja jest odczytowa, poprawić kontrakt rezultatu, użyć
wspólnego artefaktu lub dołączyć mapę źródeł do wyniku dziecka. Dla operacji ze
skutkiem ubocznym powtórzenie może być wymagane i nie wolno proponować cache bez
dodatkowego dowodu. Samo przesłanie rezultatu dziecka do kolejnego requestu
rodzica nie spełnia tej reguły — jest zwykłym handoffem analizowanym w sekcji
17.6.

### 17.8. Wiele gałęzi zwraca te same pełne elementy

Identyfikator reguły: `CROSS_BRANCH_DUPLICATION`.

Trigger:

- dla każdej nieuporządkowanej pary różnych, dokładnie powiązanych dzieci `A,B`
  tworzymy zbiory unikalnych pełnych `returnElements`;
- `intersectionBytes` jest sumą `content-bytes-v1` hashy obecnych w obu zbiorach,
  a `uniqueBytesA/B` sumą unikalnych bajtów odpowiedniego zbioru;
- `intersectionBytes >= LARGE_PAYLOAD_BYTES` oraz
  `intersectionBytes / min(uniqueBytesA, uniqueBytesB) >= HIGH_BRANCH_OVERLAP`;
- dodatkowo co najmniej jedna z dwóch kolejno zadeklarowanych gałęzi wyrażenia
  jest prawdziwa:
  `(pełne freshInputCoverage własnych rund A i B AND ΣF_A+B >= HIGH_FRESH_INPUT_TOKENS)`
  albo `(pełne creditCoverage interakcji AND childPairCreditShare >= HIGH_CREDIT_SHARE)`,
  gdzie `childPairCreditShare = credits(self A + self B) / credits(interaction tree)`.

Mianownik overlapu musi być dodatni. Tokeny i credits są przypisane do całych
rund dzieci, nie do wspólnego fragmentu; to ograniczenie pozostaje w findingu.

Rekomendacja: wspólna mapa/indeks, wspólny etap wejściowy albo podział zakresów.

### 17.9. Profil kondensujący lub oparty na przekazanym kontekście z wysokimi credits

Identyfikator reguły: `HIGH_RATE_CONDENSING_CHILD`.

Trigger:

- `CONDENSING=matched OR PROVIDED_CONTEXT_DOMINANT=matched`;
- `uniqueToolResultBytes < SMALL_UNIQUE_RESULT_BYTES` przy pełnym
  `toolResultContentCoverage` dziecka;
- `childSelfCreditShare = credits(child self) / credits(parent interaction tree)
  >= HIGH_CREDIT_SHARE` przy pełnym `creditCoverage`;
- `relativeObservedRateV1 >= HIGH_RELATIVE_CREDIT_RATE` oraz
  `comparable=true` według sekcji 16.2.

Cały trigger jest koniunkcją czterech punktów; tylko pierwszy punkt zawiera `OR`.
Brak któregoś wymaganego kanału daje `unknown`, nie „małą ekspansję”.

Rekomendacja: zbadać wariant z modelem o niższym obserwowanym współczynniku
credits, skill w tej samej sesji albo algorytmiczne przetworzenie. Nie
gwarantować utrzymania jakości.

### 17.10. Akumulacja po błędzie o wysokim wolumenie lub udziale credits

Identyfikator reguły: `POST_ERROR_ACCUMULATION_HOTSPOT`.

Trigger:

- segment `CONTEXT_ACCUMULATION`, którego pierwsza runda ma marker `POST_ERROR`;
- co najmniej jedna z kolejno zadeklarowanych gałęzi jest prawdziwa:
  `(pełne freshInputCoverage segmentu AND ΣF_segment >= HIGH_FRESH_INPUT_TOKENS)`,
  `(pełne toolResultContentCoverage segmentu AND
  uniqueContentBytes(segment, toolResults) >= LARGE_PAYLOAD_BYTES)` albo
  `(pełne creditCoverage interakcji AND
  segmentCreditShare >= HIGH_CREDIT_SHARE)`, gdzie
  `segmentCreditShare = credits(segment) / credits(interaction tree)`.

Możliwy wcześniejszy krok walidacyjny o niższym wolumenie jest hipotezą
projektową rekomendacji, nie przesłanką triggera.

Rekomendacja: zbadać walidację wejścia, preflight lub mniejszy krok kontrolny.
Komunikat powinien nazywać fazę „akumulacją po błędzie”, nie automatycznie
„niepotrzebnym researchem”.

### 17.11. Duży narzut instrukcji i definicji

Identyfikator reguły: `REPEATED_INSTRUCTION_OVERHEAD`.

Trigger przy pełnym pokryciu odpowiednich kanałów treści:

- `comparisonSequence` ma co najmniej `SEVERAL_ROUNDS`;
- istnieje jeden `contentKind` z `{systemInstructions, toolDefinitions}`, dla
  którego jednocześnie
  `totalObservedBytes(comparisonSequence, contentKind) >= LARGE_PAYLOAD_BYTES`
  oraz
  `duplicateRatio(comparisonSequence, contentKind) >= HIGH_DUPLICATE_RATIO`;
- `taskPayloadBytes < SMALL_UNIQUE_RESULT_BYTES`, gdzie `taskPayloadBytes` jest
  pełnym raw `copilot_chat.user_request` dla root agenta albo
  `delegationPayloadBytes` dla dziecka;
- w tej samej `comparisonSequence` co najmniej jedna runda ma
  `freshBurst=true` albo `promptPressure >= HIGH_PROMPT_PRESSURE`.

Wszystkie cztery punkty są połączone przez `AND`, a ostatni przez wskazane `OR`.
`cacheShare <= LOW_CACHE_SHARE` zwiększa jedynie priorytet, gdy jest znane; wysoki
cache share obniża priorytet, a `cacheShare=unknown` jest ograniczeniem. Żaden z
tych stanów nie zmienia wyniku samego triggera.

Rekomendacja: zbadać skrócenie instrukcji albo ograniczenie udostępnionego toolsetu.
Tokeny konkretnych części pozostają estymacją; dowodem są bajty treści,
identyczny hash i pełny `input_tokens`. Nie wolno twierdzić, że to właśnie
instrukcje lub definicje były fresh — znamy jedynie współwystępowanie.

### 17.12. Przełożenie wniosków z prezentacji na pojedynczą sesję

| Podejście z prezentacji | Co można wykryć deterministycznie | Co można rekomendować | Czego pojedyncza sesja nie potwierdzi |
|---|---|---|---|
| kosztowna komunikacja orkiestratora | graf delegacji, liczba handoffów, obserwowane bajty zwrotów, wzrost inputu rodzica, znane credits własne i poddrzewa | ograniczenie liczby przekazań albo objętości kontraktu | że mniej agentów zachowa jakość |
| handoff przez plik/referencję | duży inline payload i jego identyczne ponowne wysłanie; ewentualnie jawna mała referencja w przechwyconym payloadzie | trwały artefakt lub referencję zamiast pełnej treści | ile dokładnie credits oszczędzi plik bez drugiego wykonania |
| jedna sesja + skille | silnie zależne fazy rozdzielone dzieckiem, duży transfer rodzic–dziecko–rodzic, kondensujący profil dziecka | wykonanie procedury jako skill w tej samej sesji | czy izolacja dziecka była potrzebna dla jakości lub bezpieczeństwa |
| najpierw mapa, potem research | długą lub powtarzaną akumulację, rehydratację po kompaktowaniu, wiele gałęzi z tymi samymi wynikami | mapę/indeks jako punkt startowy i celowany retrieval | że repo jest duże ani że mapa już istnieje, jeśli brak takiej telemetrii |
| utwórz, aktualizuj i używaj mapy | powtórzone operacje zwracające identyczne pełne elementy w tej lub kilku gałęziach jednej sesji | utrwalony, wersjonowany artefakt oraz wymuszenie użycia go w workflow | czy było to ponowne odkrywanie oraz koszt utrzymania i zwrot między sesjami w MVP |
| dedykowane narzędzie zamiast szerokiego researchu | wiele kroków, dużo wyników, mały przyrost unikalnej treści, duży narzut definicji | batching, węższy kontrakt lub deterministyczny agregator | jaki tool należy zbudować ani czy jest dostępny |
| dobrana hybryda | współwystępowanie faz, poddrzew, artefaktów i różnych profili transferu | zestaw alternatyw przypisanych do konkretnych hotspotów | jednej uniwersalnie najlepszej architektury |

Wszystkie pozycje w kolumnie „rekomendować” są hipotezami mechanizmu. Scanner
może pokazać, dlaczego alternatywa pasuje do obserwowanego wzorca, ale nie może
nazwać jej osiągniętą optymalizacją przed porównaniem jakości i zużycia w
rzeczywistym wykonaniu.

### 17.13. Opcjonalna warstwa AI

MVP nie potrzebuje AI do policzenia żadnego faktu, profilu ani triggera. Warstwa
AI może później:

- nazwać prawdopodobny cel semantyczny, np. research, mapowanie lub review;
- wyjaśnić dowody mniej technicznym językiem;
- dopasować katalog alternatyw do treści zadania;
- wskazać pytania, które warto zweryfikować w następnym eksperymencie.

Powinna otrzymywać ustrukturyzowane obserwacje, ograniczenia i referencje do
dowodów z warstwy deterministycznej. Jej wynik musi być osobnym obiektem
`AiHypothesis`, a nie zmianą `ClassificationFinding`. Treści promptów, kodu i
wyników narzędzi są niezaufanymi danymi mogącymi zawierać prompt injection;
model nie może traktować ich jako instrukcji systemowych. Wysłanie raw telemetrii
poza lokalną aplikację wymaga osobnej zgody i modelu prywatności.

AI nie może:

- uzupełniać brakujących tokenów, credits ani relacji ID;
- podnosić podobieństwa do rangi identyczności;
- nazywać rekomendacji potwierdzoną oszczędnością;
- ukrywać `UNKNOWN`, braków pokrycia ani kontrprzesłanek;
- zmieniać deterministycznej wersji reguł w zależności od promptu.

## 18. Wiarygodność i sposób komunikacji

### 18.1. Poziomy dowodu

| Poziom | Nazwa | Przykład |
|---|---|---|
| 1 | Fakt zmierzony | event kompaktowania, status ERROR, dokładna liczba tokenów |
| 2 | Dokładne wyliczenie | fresh input, prompt pressure, identyczny hash, krawędź rodzic–dziecko potwierdzona zgodnością ID |
| 3 | Silny wzorzec | rehydratacja oparta na evencie, spadku okna i identycznych hashach |
| 4 | Słaby wzorzec | podobny trend wolumenu lub częściowy overlap |
| 5 | Hipoteza AI | semantyczny cel `research` albo `mapowanie` |

### 18.2. Wiarygodność klasyfikacji `confidence-v1`

Wiarygodność opisuje siłę dopasowania reguły, a nie prawdopodobieństwo, że agent
„naprawdę” miał określoną intencję. Najpierw klasyfikator wybiera profil; dopiero
potem nadaje mu etykietę `wysoka | średnia | niska`. Wiarygodność nie może zmienić
`UNKNOWN` w znaną klasę.

Dla profilu podstawowego rundy liczymy:

```text
evidenceCoverage(p) =
  suma |wag| lokalnych predykatów p o stanie true albo false
  / suma |wag| wszystkich lokalnych predykatów p

allProfileScores = wyniki w stałej kolejności:
  CONTEXT_ACCUMULATION, CONTEXT_PROCESSING, OUTPUT_DOMINANT

secondHighestScore = maksimum dwóch wyników innych niż highestScore
scoreMargin = highestScore - secondHighestScore

mixedMinScore = minimum score(p) dla p w candidateProfileCodes
mixedMinCoverage = minimum evidenceCoverage(p) dla p w candidateProfileCodes
```

Jeśli kilka klas ma identyczny najwyższy wynik, wybór z sekcji 11.6 daje `MIXED`,
a nie arbitralnego zwycięzcę. Dla pojedynczego profilu zawsze istnieją dwie inne
klasy, więc `secondHighestScore` jest określony. Dla dwu- i trzyklasowego `MIXED`
wiarygodność używa minimum po całym `candidateProfileCodes`, nie tylko drugiej
pozycji.

Do mianownika nie wchodzą premia przejścia ani modyfikator stanu kontekstu.
`unknown`, `invalid` i `ambiguous` nie zwiększają licznika. Wartość `false`
zwiększa pokrycie, ponieważ oznacza, że predykat dało się rozstrzygnąć, nawet
jeśli nie wspiera profilu.

| Wynik `phase-rules-v1` | Wysoka | Średnia | Niska |
|---|---|---|---|
| pojedynczy profil | wynik `>= 75`, `scoreMargin >= 20`, `evidenceCoverage >= 0.75`, `provisional=false` | wynik `>= 60`, `scoreMargin > MIXED_MARGIN`, `evidenceCoverage >= 0.60`, `provisional=false` | każdy inny profil poprawnie wybrany przez próg `CLASS_THRESHOLD` |
| `MIXED` | `mixedMinScore >= 75`, `mixedMinCoverage >= 0.75`, `provisional=false` | `mixedMinScore >= 60`, `mixedMinCoverage >= 0.60`, `provisional=false` | każdy inny poprawnie wybrany `MIXED` |
| `UNKNOWN` | nie dotyczy | nie dotyczy | nie dotyczy; pokazujemy przyczynę braku klasy |

Predykaty o wejściu `ambiguous` mają stan `unknown`, nie dodają punktów i obniżają
`evidenceCoverage`; nie istnieje osobna, jakościowa kategoria „krytycznej
niejednoznaczności”. Niejednoznaczność pola nieużywanego przez dany profil nie
wpływa na jego coverage.

Dla reguł boolowskich profilu subagenta, kwalifikatora albo anomalii:

```text
evaluationCoverage = rozstrzygnięte atomowe predykaty / wszystkie atomowe
  predykaty wyrażenia

decisivePath = pierwsza w kolejności zadeklarowanej w wersji reguły ścieżka
  atomowych predykatów, która samodzielnie rozstrzyga wyrażenie

decisiveCoverage = rozstrzygnięte predykaty decisivePath / wszystkie predykaty
  decisivePath

nearBoundary = dla dowolnego decydującego progu T:
               T != 0 AND abs(value - T) / abs(T) <= 0.10
supportingChannelCount = liczba różnych kanałów wspierających wynik
```

Kanały to: tokeny, stan kontekstu, przechwycona treść, sekwencja/czas, graf,
event/status oraz credits. `supportingChannelCount` liczy wyłącznie kanały
atomowych dowodów `true` w `decisivePath`. Dla `AND` ścieżka rozstrzygająca `true` zawiera
wszystkie gałęzie; dla `OR` wystarcza pierwsza zadeklarowana gałąź o wartości
`true`. Dlatego `true OR unknown` daje `matched`, `decisiveCoverage=1` i
`evaluationCoverage<1`; brak w drugiej gałęzi nadal jest pokazany, ale nie blokuje
dowodu z pierwszej. `false AND unknown` analogicznie daje `not_matched`. Dopiero
brak ścieżki rozstrzygającej daje `unknown` zgodnie z sekcją 6.5. Dla dopasowanego
`MIXED` coverage jest minimum po decydujących dowodach wszystkich kodów w
`candidateProfileCodes`.

Etykietę wyniku przypisujemy przez pierwszą pasującą regułę z poniższej,
normatywnej kolejności. Warunki są dzięki temu rozłączne operacyjnie:

| Priorytet | Warunek dla dopasowanej reguły boolowskiej | Etykieta |
|---:|---|---|
| 1 | wynik `provisional` | niska |
| 2 | bezpośredni fakt/event albo dokładna relacja ID, bez kolizji | wysoka na poziomie dowodu faktu |
| 3 | `supportingChannelCount >= 2` i brak `nearBoundary` | wysoka |
| 4 | `supportingChannelCount = 1` i `nearBoundary=true` | niska |
| 5 | każdy pozostały dopasowany wynik z `supportingChannelCount >= 1` | średnia |

Dopasowany wynik z `supportingChannelCount=0` jest błędem implementacji i musi
zostać zdegradowany do `unknown`, a nie otrzymać etykietę. Dla `MIXED` najpierw
wyznaczamy etykietę każdego profilu składowego powyższą kolejnością, a następnie
przyjmujemy najniższą z nich jako etykietę całego `MIXED`.

Próg liczbowy jest zaliczony deterministycznie także dokładnie na granicy, ale
`nearBoundary` sygnalizuje kruchość wniosku. Dla warunków dyskretnych, np.
`roundCount >= 3`, stosujemy tę samą formułę z `T=3`. Żaden próg decydujący w v1
nie ma `T=0`; gdyby taki próg powstał, musi otrzymać osobną, wersjonowaną tolerancję
absolutną zamiast dzielenia przez zero.

Etykieta powinna dodatkowo uwzględniać następujące twarde ograniczenia:

- brak dokładnej zgodności ID → brak potwierdzonego profilu subagenta;
- brak content capture → rozszerzony profil zlecenie/wyniki/zwrot jest niepełny,
  ale profil tokenowy nadal może powstać;
- brak limitu → presja kontekstu `unknown`;
- niepełne credits → brak pełnego porównania współczynnika credits;
- jedna runda → brak mocnego sekwencyjnego dowodu syntezy/finalizacji;
- brak timestampów → obniżenie pokrycia sekwencji;
- bez jawnego sygnału zakończenia ostatni segment zależny od przyszłej rundy
  pozostaje `provisional`; `lastSignalAt` nie rozstrzyga aktywności.

Na MVP pokazujemy wyłącznie etykiety słowne, nie pozornie precyzyjne `87%`.
Prawdopodobieństwo można raportować dopiero po kalibracji na niezależnym, ręcznie
oznaczonym zbiorze.

### 18.3. Przykład audytowalnego findingu

```text
Profil podstawowy: akumulacja kontekstu
Kwalifikator: rehydratacja kontekstu
Wiarygodność: wysoka
Zakres: interakcja 1, rundy 7–9

Dowody:
- event compaction_complete success=true w span X;
- prompt pressure spadło z 84% do 29%;
- fresh input wzrósł w kolejnej rundzie o 41k;
- 61% sumarycznego wolumenu wyników stanowiły pełne elementy, których identyczny
  hash wystąpił przed kompaktowaniem.

Ograniczenie:
- telemetria nie mówi, czy ponowne pobranie było konieczne dla jakości.

Alternatywna interpretacja:
- częściowo nowa akumulacja danych po zmianie zakresu zadania.
```

## 19. Kontrakt wyniku analizy

### 19.1. Kolejność obliczeń

Implementacja powinna wykonywać kroki w stałej kolejności, aby uniknąć zależności
kołowych:

```text
snapshot surowych danych
  → obecność, walidacja i pokrycie pól
  → interakcje, rundy oraz stabilne uporządkowanie
  → przypisanie wykonań tooli do rund
  → kanonikalizacja i deduplikacja reprezentacji/treści
  → graf dokładnie powiązanych agentów
  → RoundObservation dla każdego strumienia
  → profile podstawowe rund
  → kwalifikatory, markery i segmentacja faz
  → profile sesji i subagentów
  → agregacje credits i współczynniki v1
  → anomalie oraz rekomendacje
  → polskie etykiety w UI
```

Rekomendacja nie może wracać do wcześniejszego kroku i zmieniać cech albo profilu,
aby lepiej pasowały do jej treści.

### 19.2. Model danych wyniku

Proponowany, niezależny od UI model:

```text
RoundObservation {
  subjectRef
  sequence
  orderingAvailability
  metricsWithAvailability
  contextState
  contentFlow
  events
  model
  completeness
  upstreamCompleteness
  evidenceRefs[]
}

AnalysisSnapshot {
  analyzedAt
  analysisCutoffSignalId
  classifierVersion
  componentVersions
  completeThroughTimestamp?
}

ClassificationFinding {
  ruleId
  ruleVersion
  classifierVersion
  subjectType: round | phase | interaction | session | subagent
  subjectRefs
  ruleState: matched | not_matched | unknown
  profileCode
  candidateProfileCodes[]
  qualifiers
  markers
  anomalyCodes
  scores?
  confidenceLevel
  evidenceLevel
  dataCoverage
  nearBoundary
  evidence[]
  counterEvidence[]
  missingSignals[]
  alternativeProfileCode?
  provisional
}

Recommendation {
  recommendationId
  ruleVersion
  subjectRefs
  triggerFindingIds
  measuredImpact
  mechanism
  experimentSuggestion
  limitations[]
}

AiHypothesis {                    // opcjonalnie, poza deterministycznym MVP
  subjectRefs
  probableSemanticGoal
  explanation
  supportingFindingIds[]
  alternativeInterpretations[]
  limitations[]
  modelAndPromptVersion
}
```

Każdy evidence item powinien zawierać typ (`emitted`, `derived`, `pattern`), wartość,
jednostkę, formułę oraz referencje do sesji, trace, spanów i rund.

Backend nie powinien emitować polskich tekstów prezentacyjnych. Kody reguł i
ustrukturyzowane dowody mogą być formatowane w języku polskim po stronie UI.
`classifierVersion` może być wersją pakietu, a `componentVersions` powinno
utrwalać co najmniej wersje kolejności, deduplikacji, pasm kontekstu, klasyfikacji
faz, segmentacji, profili sesji/subagentów, współczynnika credits, rekomendacji i
wiarygodności.

### 19.3. Powtarzalność i zmiana wyniku

Identyczny zbiór sygnałów, ten sam punkt odcięcia i te same wersje reguł muszą
dać identyczne klasy, kolejność, dowody i agregaty. Timestamp `analyzedAt` może się
różnić i nie bierze udziału w klasyfikacji.

Po dopływie nowych sygnałów powstaje nowy snapshot. Zmiana wyniku jest dozwolona,
zwłaszcza dla reguł zależnych od `nextInComparisonSequence(t)`, ale UI powinno móc wskazać, że zmienił się
`analysisCutoffSignalId`, pokrycie albo wersja reguły. Nie nadpisujemy historii w
sposób sugerujący, że wcześniejszy wynik był policzony z późniejszych danych.

## 20. Prezentacja w UI

### 20.1. Widok podstawowy: oś przebiegu

Najczytelniejszy widok pojedynczej sesji:

1. oś rund;
2. pasma profili/faz pod rundami;
3. linia `promptPressure` nad osią;
4. osobne warstwy cache/fresh i credits;
5. znaczniki błędów, kompaktowania, duplikatów i zmiany modelu;
6. swimlane dla rodzica i każdego dokładnie powiązanego subagenta;
7. krawędzie delegacji i powrotu;
8. panel „Dlaczego tak sklasyfikowano?” z dowodami;
9. rekomendacje jako alternatywy warte zbadania;
10. jawne pokrycie i brakujące dane.

Wykres powinien zachować wspólną oś czasu, ale nie musi skalować szerokości rund
wyłącznie czasem — bardzo długie narzędzie mogłoby ukryć resztę sesji. Czas można
pokazać jako osobną długość/tooltip, a kolejność jako równomierne kolumny.

### 20.2. Uzupełniające przekroje

Jeden wykres nie odpowie dobrze na wszystkie pytania. Te same obserwacje można
pokazać w kilku zsynchronizowanych przekrojach:

| Widok | Pytanie, na które odpowiada | Ważne ograniczenie |
|---|---|---|
| oś faz + linia presji | kiedy zmienił się sposób pracy i stan okna? | nie sumować okien z wielu rund |
| macierz rundy × cechy | które dowody uruchomiły konkretną etykietę? | komórka `missing` różni się od `0` |
| drzewo delegacji | gdzie powstały rundy i znane credits? | tylko dokładnie powiązane dzieci |
| swimlane rodzic/dzieci | czy przedziały pracy nakładały się i gdzie był handoff? | overlap czasu nie dowodzi równoległego CPU |
| waterfall token mix | jak zmieniały się input, cache, fresh i output? | to wiele requestów, nie jeden rosnący licznik |
| przepływ przechwyconych bajtów | ile obserwowanej treści weszło, wróciło i się powtórzyło? | bajty nie są tokenami ani wiedzą |
| lista anomalii z replayem | które spany i payloady stanowią dowód rekomendacji? | treść może być poufna i domyślnie zwinięta |
| karta „co zbadać” | jaki mechanizm alternatywy odpowiada obserwacji? | nie obiecywać oszczędności bez eksperymentu |

Kliknięcie fazy, subagenta lub rekomendacji powinno filtrować pozostałe przekroje
do tych samych `subjectRefs`. Dzięki temu użytkownik może przejść od obrazu
sesji do surowego dowodu bez ręcznego szukania spanu.

### 20.3. Etykiety i hipotezy

Przykładowa etykieta fazy:

> Akumulacja kontekstu · wysoka presja · fresh-dominant · po potwierdzonym błędzie

Przykładowa karta subagenta:

> Profil kondensujący · 3 rundy · peak prompt 72% · 18% znanych credits
> interakcji · obserwowany zwrot 14× mniejszy od unii przechwyconego zlecenia i
> wyników narzędzi.

Nazwa semantyczna wygenerowana przez AI, jeśli zostanie dodana, musi znajdować się
w osobnej sekcji „Hipoteza dotycząca celu”, a nie zastępować faktów.

## 21. Proponowany zakres MVP

### 21.1. W zakresie

- `RoundObservation` ze stanami obecności;
- presja promptu, pełne okno, cache/fresh i trendy;
- profile podstawowe: akumulacja, przetwarzanie, output-dominant, mixed/unknown;
- osobne kwalifikatory, stany i markery: duży kontekst startowy, kondensacja,
  iteracja, aktywność po błędzie, kompaktowanie i rehydratacja;
- generyczne, dokładne wiązanie subagentów po identyfikatorach, bez nazw tooli;
- bazowe profile tokenowe subagentów oraz rozszerzony przepływ
  zlecenie/wyniki/zwrot przy dostępnym content capture;
- znane credits własne i poddrzewa, pokrycie danych oraz współczynnik wag v1;
- kilka najsilniejszych anomalii opartych o identyczne hashe i jawne eventy;
- referencje do dowodów, wersje reguł, poziom wiarygodności i ograniczenia;
- widok pojedynczej sesji bez automatycznego eksperymentu między sesjami.

### 21.2. Poza MVP

- automatyczne porównywanie alternatywnych wykonań;
- twierdzenie o osiągniętej oszczędności;
- semantyczne role wywnioskowane wyłącznie z wolumenów;
- AI jako źródło faktów telemetrycznych;
- probabilistyczna pewność bez uczenia i kalibracji;
- wyuczone HMM/CRF bez ręcznie oznaczonych danych;
- dokładna tokenizacja pojedynczych fragmentów;
- zdalne wysyłanie treści telemetrii.

## 22. Testy kontraktowe klasyfikatora

Minimalny zestaw przypadków:

1. Te same wolumeny i przebieg, całkowicie różne nazwy narzędzi — ten sam profil.
2. Custom tool name nie wpływa na żadną cechę fazy ani subagenta.
3. Brak metryki jest odróżniany od jawnego `0`.
4. `cache read` zajmuje okno, ale pozostaje osobnym składnikiem token mix.
5. Brak `Pmax` daje `promptPressure=unknown`, nie `0%`.
6. Zmiana modelu/limitu resetuje bazę sekwencyjną.
7. Pierwsza runda z wysokim inputem nie jest nazywana wcześniejszym researchem.
8. Output-heavy bez historii nie jest nazywany syntezą/finalizacją.
9. Potwierdzony błąd + następna runda daje marker `po błędzie`, ale nie
   `naprawiono`.
10. Kompaktowanie bez ponownego napływu nie daje rehydratacji.
11. Kompaktowanie + spadek inputu + elementy o identycznych hashach daje silny wzorzec
    rehydratacji.
12. Spadek inputu bez eventu nie jest nazywany kompaktowaniem.
13. Dokładna zgodność call ID wiąże dziecko; bliskość czasowa nie.
14. Brak call ID daje niepowiązanego kandydata, bez atrybucji credits.
15. Brak capture content pozostawia profil tokenowy, a rozszerzony przepływ ma
    stan unknown zamiast zera.
16. Ten sam tool result w dwóch reprezentacjach nie jest liczony podwójnie.
17. Niepełne credits blokują pełne porównanie stawki.
18. Współczynnik credits jest ilorazem sum, nie średnią ilorazów.
19. Cache write missing różni się od `cache write = 0`.
20. Reasoning nie jest drugi raz dodawany do outputu.
21. Zagnieżdżone dzieci nie powodują podwójnego policzenia credits.
22. Długi czas bez potwierdzonego błędu nie zmienia fazy.
23. Podobieństwo bez identycznego hashu nie jest opisywane jako identyczność.
24. Wartości dokładnie poniżej, na i powyżej każdego progu dają stabilny wynik.
25. Każdy finding zawiera referencje do stanowiących dowód spanów.
26. Ta sama fixture i ta sama wersja reguł zawsze dają identyczny wynik.
27. `K > I`, ujemne liczniki i zerowy mianownik dają `invalid/unknown`, a nie
    wartość obciętą ani dzielenie przez zero.
28. Trójwartościowe `AND`, `OR` oraz `NOT` zachowują `unknown` zgodnie z sekcją 6.5.
29. Stan okna rundy korzysta z `input_tokens` tej samej rundy, nie z kolejnej.
30. `hasPreviousResponseId=true` samo nie wystarcza do profilu przetwarzania.
31. Ostatnia runda zależna od `nextInComparisonSequence(t)` jest `provisional`; po dopływie danych nowy
    snapshot zachowuje inny cutoff i wyjaśnialną zmianę wyniku.
32. Profile sesji są wieloetykietowe, a mianowniki root i całego drzewa nie są
    mieszane.
33. Profil `DELEGATION_HEAVY` z credits nie powstaje przy niepełnym pokryciu
    drzewa, ale może powstać z pełnego udziału rund potomków.
34. Cykle sesji nie są liczone przez granicę interakcji, modelu, limitu ani event
    kompaktowania.
35. Niepełny span dziecka nie jest pomijany w sposób zaniżający sumę i nie
    uruchamia `LOW_VOLUME`.
36. `parentReferenceRate` używa tylko rund rodzica z tej samej interakcji i tego
    samego modelu co runda delegująca.
37. Brak jednego kanału treści nie obniża reguły, która tego kanału nie wymaga;
    brak kanału wymaganego daje `unknown`.
38. Reguła dokładnie na progu może być dopasowana, ale otrzymuje deterministyczny
    sygnał `nearBoundary` i odpowiednio niższą wiarygodność.
39. Znormalizowany grupujący `conversationId` bez zgodnego raw atrybutu spanu nie
    tworzy relacji rodzic–dziecko.
40. Credits, TTFT i czas trwania nie zmieniają podstawowego profilu fazy.
41. Wysokie `O/I` bez wystarczającej historii ustawia `highOutputRatio`, ale
    pozostawia `outputBurst=unknown` i nie nalicza dwa razy tego samego dowodu.
42. Bez capture content kilka rund o podobnym tokenowym wolumenie i co najmniej
    dwa rzeczywiste wykonania może uzyskać `ITERATIVE_FLOW`; reguły duplikatów
    treści pozostają `unknown`.
43. Dodatni, jawny cache write pozwala pokazać oflagowany współczynnik v1 tylko
    informacyjnie, ale ustawia porównanie względne na `unknown` i nie uruchamia
    rekomendacji ekonomicznej.
44. Brak dokładnie powiązanego dziecka przy niekompletnym
    `subagentLinkCoverage` nie spełnia negatywnej przesłanki „brak dziecka” — daje
    `unknown`.
45. Call ID pasujące do dwóch conversation ID nie jest rozstrzygane kolejnością
    rekordów i nie tworzy żadnej krawędzi.
46. Krawędź zamykająca cykl jest oznaczona `invalidCycle`, wyłączona z poddrzewa
    i nie powoduje podwójnego policzenia credits.
47. Brak modelu w rundzie dziecka albo referencji rodzica pozostawia
    `relativeObservedRateV1=unknown`, nawet gdy tokeny i credits są kompletne.
48. Przy braku historii wartość poniżej absolutnego minimum rozstrzyga
    `freshBurst/outputBurst=false`, a wartość co najmniej równa minimum bez
    dostępnej gałęzi porównawczej daje `unknown`.
49. Agregat sesyjny jest `true`, gdy znane dopasowania same przekraczają próg,
    `false`, gdy nawet wszystkie `unknown` nie mogą go osiągnąć, i `unknown` w
    przedziale pośrednim.
50. Wynik `provisional` zawsze otrzymuje niską confidence przed oceną liczby
    kanałów i `nearBoundary`; żadna kombinacja nie pasuje do dwóch poziomów.
51. Sekwencja `model X → missing → model Y` dzieli się przed `Y`, natomiast
    `X → missing → X` pozostaje jedną `comparisonSequence` z continuity unknown.
52. Częściowe podobieństwo dwóch elementów nie scala ich hashy, nie zmniejsza
    deterministycznie `uniqueContentBytes` i pozostaje wyłącznie ograniczeniem.
53. Dla `true OR unknown` wersjonowana pierwsza prawdziwa gałąź tworzy pełny
    `decisivePath`, choć `evaluationCoverage` całego wyrażenia pozostaje niepełne.
54. Confidence trzyprofilowego `MIXED` jest minimum z trzech, nie tylko z dwóch
    najwyżej punktowanych profili.

Testy powinny używać syntetycznych fixture'ów. Realna telemetria musi zostać
zanonimizowana przed zapisaniem w repozytorium.

## 23. Architektura implementacji

Proponowany podział odpowiedzialności:

- ingestion nadal zachowuje raw i normalizuje stabilne pola;
- obecność atrybutów powinna zostać udostępniona przez read model albo sprawdzana
  w jednym centralnym parserze;
- grupowanie interakcji/rund i graf dokładnie powiązanych subagentów pozostaje w warstwie analizy;
- klasyfikacja powinna być czystą, testowalną usługą, np.
  `WorkflowAnalysisService`, używaną przez `SessionAnalysisService`;
- komponenty UI wyłącznie prezentują kody, dowody i rekomendacje;
- parsing JSON nie może być powielany w template expressions;
- cięższe hashowanie i deduplikacja powinny być cache'owane;
- raw JSON i pełna wartość wyniku otrzymana przez Scanner pozostają dostępne do
  audytu w API/UI; oryginalny raw payload pozostaje zapisany w bazie.

Jeśli kontrakt REST zostanie rozszerzony, interfejsy w
`frontend/src/app/models/scanner.models.ts` muszą zostać zsynchronizowane.

## 24. Warunki uznania klasyfikatora za gotowy

Klasyfikator można uznać za gotowy do MVP, gdy:

- działa bez zależności od nazw tooli dla faz i profili;
- zachowuje `missing` niezależnie od znormalizowanego zera;
- każda etykieta ma dowody i wersję reguły;
- wszystkie przejścia respektują granice interakcji i subagentów;
- stan okna używa bieżącego requestu i właściwego limitu danej rundy;
- subagenci są atrybuowani wyłącznie przez dokładną zgodność ID;
- rekomendacje nie obiecują jakości ani oszczędności bez eksperymentu;
- UI rozdziela fakty, pochodne, wzorce i ewentualne hipotezy AI;
- testy regresyjne obejmują braki, zera, custom tools, kompaktowanie, błędy,
  duplikaty i częściowe credits;
- wynik pozostaje audytowalny z poziomu surowej telemetrii.

## 25. Źródła w repozytorium

- [`../AGENTS.md`](../AGENTS.md) — kontrakt produktu, telemetrii i implementacji;
- [`../README.md`](../README.md) — opis działania oraz konfiguracji;
- [`../src/main/java/dev/agentscanner/otel/OtlpIngestionService.java`](../src/main/java/dev/agentscanner/otel/OtlpIngestionService.java) — normalizacja spanów, messages i agregatów;
- [`../src/main/java/dev/agentscanner/otel/OtelJson.java`](../src/main/java/dev/agentscanner/otel/OtelJson.java) — konwersja atrybutów i zachowanie braków jako zera w licznikach;
- [`../src/main/resources/schema.sql`](../src/main/resources/schema.sql) — przechowywane dane;
- [`../frontend/src/app/core/session-analysis.service.ts`](../frontend/src/app/core/session-analysis.service.ts) — obecne grupowanie interakcji i rund;
- [`../frontend/src/app/features/interaction-timeline/interaction-timeline.component.ts`](../frontend/src/app/features/interaction-timeline/interaction-timeline.component.ts) — bieżąca korelacja subagentów, credits i błędy;
- [`../frontend/src/app/features/round-details/round-details-dialog.component.ts`](../frontend/src/app/features/round-details/round-details-dialog.component.ts) — kształt requestu, limity oraz estymacje fragmentów.
