# Plan realizacji demo na GitHub Pages

Status: E0–E8 wdrożone i odebrane. Demo opublikowane na GitHub Pages i sprawdzone testami przeglądarkowymi na publicznym adresie.

[Dokumentacja](README.md) · [Architektura docelowa](architektura-docelowa.md)

Plan przekłada uzgodniony model na kolejność zmian w obecnej aplikacji. Decyzje
architektoniczne pozostają w architekturze docelowej, a reguły danych w
[telemetrii](telemetria.md), [backendzie](backend.md) i [API](api.md). Zachowanie
komponentów określają [frontend](frontend.md) i [stylowanie](stylowanie.md).
W każdym etapie obowiązują [zasady rozwoju i prywatności](rozwoj.md).

## Spis treści

- [Rezultat i granice pierwszego wydania](#rezultat-i-granice-pierwszego-wydania)
- [Punkt wyjścia w kodzie](#punkt-wyjścia-w-kodzie)
- [Kolejność i kamienie milowe](#kolejność-i-kamienie-milowe)
- [E0. Regresje](#e0-ustalenie-regresji-i-punktów-integracji)
- [E1. Kontrakty i transport](#e1-oddzielenie-operacji-od-transportu)
- [E2. Rdzeń, parser i Worker](#e2-czysty-rdzeń-parser-jsonl-i-web-worker)
- [E3. IndexedDB](#e3-persystencja-indexeddb)
- [E4. Pierwszy kompletny przepływ](#e4-wybór-wielu-sesji-i-pierwszy-kompletny-przepływ)
- [E5. Zakładki i operacje lokalne](#e5-pozostałe-zakładki-katalog-i-zarządzanie-danymi)
- [E6. Dostępność i onboarding](#e6-dostępność-funkcji-i-onboarding-plikowy)
- [E7. Build i publikacja](#e7-build-statyczny-i-publikacja-github-pages)
- [E8. Odbiór wydania](#e8-testy-wydania-i-aktualizacja-dokumentacji)
- [Ryzyka](#ryzyka-i-sposób-ich-zamknięcia)
- [Checklista zamknięcia](#checklista-zamknięcia-i-dalszy-etap-spring-boot)

## Rezultat i granice pierwszego wydania

Użytkownik otwiera statyczną aplikację Angular na GitHub Pages, importuje plik
Copilot OTel JSONL, wybiera jedną lub kilka głównych rozmów i zapisuje je
w IndexedDB. Następnie korzysta z obecnych lokalnych zakładek, także po
odświeżeniu strony. Plik i przechwycona treść pozostają w przeglądarce.

| Obszar | Wymagany rezultat |
|---|---|
| Import | Lokalny podgląd, poprawne grupowanie, wybór wielu rozmów, atomowy zapis wybranego zakresu. |
| Lista sesji | Odczyt z IndexedDB, wybór sesji i odświeżenie po lokalnych operacjach. |
| Podsumowanie | Metadane, konfiguracja emitowana w telemetrii i jawne pokrycie danych. |
| Koszt i przebieg | Dotychczasowe rundy, narzędzia, subagenci, kompaktowanie, tokeny i Copilot AI credits. |
| Mapa pracy | Dotychczasowa deterministyczna mapa i panele materiału dowodowego. |
| Dane techniczne | Spany, wiadomości, atrybuty i raw wybranego importu. |
| Poradnik technik | Lokalny katalog, filtrowanie, szczegóły i kopiowanie. |
| Funkcje wymagające backendu | Wspólny modal „Dostępne w pełnej wersji”, bez próby wywołania API. |
| Zarządzanie danymi | Lokalny eksport, potwierdzane usunięcie sesji lub wszystkich danych. |
| Dostarczenie | Osobny build demo, workflow Pages i sprawdzony URL publikacji. |

IndexedDB jest wymagane w pierwszym wydaniu. Pamięć karty służy do podglądu
i obliczeń przed zatwierdzeniem. Brak trwałego zapisu nie może być przedstawiany
jako udany import. Informacja o lokalnym zapisie wyjaśnia zależność danych od
originu i profilu przeglądarki oraz możliwość ich usunięcia przez przeglądarkę.

AI Hub, klasyfikacja, rozmowy, doradztwo AI, backendowa Standaryzacja oraz odbiornik
OTLP pozostają wejściami do modalu. Demo nie inicjuje historii AI, odczytu modeli
ani pollingu odbiornika. W komunikatach nie wspominamy o opłatach. Brak treści
lub pomiaru w pliku jest stanem danych, a nie blokadą funkcji.

Lokalny przegląd konfiguracji folderu repozytorium jest osobnym rozszerzeniem
po pierwszym wydaniu telemetrii. Integracja GraalJS, aktualizacja Java/Spring,
baza klienta, MCP i dostarczenie instalacji klienta należą do etapu backendowego.
Backend pełnej wersji pozostaje w Spring Boot.

## Punkt wyjścia w kodzie

| Obecny właściciel | Co wykorzystujemy i co trzeba zmienić |
|---|---|
| [CopilotFileImport](../src/main/java/dev/agentscanner/api/CopilotFileImport.java) i [jego testy](../src/test/java/dev/agentscanner/api/CopilotFileImportIntegrationTest.java) | Referencja semantyki parsera, kandydatów, powiązań, liczników i zakresu zapisu. Lokalna implementacja wymaga zgodności na fixture'ach. |
| [OtlpIngestionService](../src/main/java/dev/agentscanner/otel/OtlpIngestionService.java) | Referencja normalizacji, ekstrakcji wiadomości i zachowania dowodu. |
| [ScannerApiService](../frontend/src/app/core/scanner-api.service.ts) | Obecny transport HTTP; należy oddzielić go od operacji aplikacyjnych. |
| [ScannerShellStateService](../frontend/src/app/core/scanner-shell-state.service.ts) i [AppComponent](../frontend/src/app/app.component.ts) | Lista, import i start pollingu; także automatyczne ładowanie historii Standaryzacji. |
| [SessionImportDialogComponent](../frontend/src/app/features/sessions/session-import-dialog.component.ts) | Działający wybór jednej rozmowy; demo potrzebuje wyboru wielu. |
| [SessionPageComponent](../frontend/src/app/features/session/session-page.component.ts) | Odczyt analizy i źródeł mapy przez HTTP oraz eksport przez URL. Trzeba podłączyć operacje lokalne. |
| [SessionAnalysisService](../frontend/src/app/core/session-analysis.service.ts), [WorkflowAnalysisService](../frontend/src/app/core/workflow-analysis.service.ts) i funkcje `core` | Istniejąca analiza TypeScript; czyste reguły wydzielamy, zamiast tworzyć drugi silnik dla demo. |
| [Modele frontendu](../frontend/src/app/models/scanner.models.ts) | Punkt wyjścia DTO; identyfikatory rekordów magazynu trzeba odróżnić od identyfikatorów OTel. |
| [Katalog technik](../src/main/resources/optimization/techniques-v1.json) | Jedno źródło treści poradnika; zasób trzeba udostępnić w statycznym buildzie. |
| [angular.json](../frontend/angular.json), [app.config.ts](../frontend/src/app/app.config.ts), [app.routes.ts](../frontend/src/app/app.routes.ts) | Obecny build do zasobów Spring, routing i składanie providerów; potrzebny osobny wariant demo. |

Import Java już rozwiązuje problem technicznych trace'ów prezentowanych jako
osobne rozmowy. Przeniesienie do przeglądarki musi zachować tę semantykę. Obecne
API zatwierdza jedną rozmowę; wybór wielu w demo nie wymaga rozszerzenia API Spring
w tym etapie. Adapter HTTP zachowuje obecny kontrakt.

## Kolejność i kamienie milowe

| Etap | Zależności | Wynik |
|---|---|---|
| E0. Regresje i zakres | Brak | Uzgodniony wzorzec wyniku i pełna lista wejść do backendu. |
| E1. Kontrakty i składanie trybów | E0 | Komponenty mają operacje niezależne od HTTP; demo uruchamia się bez API. |
| E2. Rdzeń, parser i Worker | E0, kontrakty E1 | Lokalny podgląd zgodny z obecnym importerem i lokalna analiza sesji. |
| E3. IndexedDB | E1, model zapisu E2 | Trwały, atomowy zapis oraz odczyt wybranego zakresu. |
| E4. Import i pierwszy widok | E1–E3 | Import → wybór → zapis → „Koszt i przebieg” → odświeżenie. |
| E5. Pozostałe widoki i operacje | E4 | Podsumowanie, mapa, raw, poradnik, eksport i usuwanie działają lokalnie. |
| E6. Dostępność i onboarding | Podstawy w E1, finalizacja po E5 | Wszystkie wejścia do funkcji backendowych obsłużone, kompletna instrukcja plikowa. |
| E7. Build i GitHub Pages | Konfiguracja w E1, gotowe E4–E6 | Artefakt statyczny i workflow publikacji działające z podkatalogu. |
| E8. Odbiór wydania | E0–E7 | Testy przeglądarkowe, aktualne dokumenty i sprawdzone demo. |

Pierwszy kamień milowy to E4 wraz z podstawową obsługą dostępności z E1.
Pozwala ocenić prawdziwy import i ponowne otwarcie danych przed przenoszeniem
pozostałych ekranów. Drugi kamień milowy to E5–E6, a trzeci to E7–E8.
Prace nad JVM nie są zależnością żadnego z tych kamieni milowych.

## E0. Ustalenie regresji i punktów integracji

- [x] Zinwentaryzować wywołania `ScannerApiService` oraz bezpośredni `fetch`,
  nawigację do eksportu i efekty startowe serwisów. Każdej operacji przypisać:
  lokalna, statyczny zasób albo pełna wersja.
- [x] Zapisać oczekiwane wyniki wspólnych fixture'ów jako dane testowe dostępne
  dla testów Java i TypeScript. Zachować jedno źródło JSONL; uniknąć ręcznych
  kopii plików wejściowych w obu zestawach testów.
- [x] Dodać warianty brakujących pomiarów i treści, niejednoznacznych oraz
  cyklicznych powiązań, wielokrotnej selekcji i konfliktu z istniejącym zapisem.
- [x] Ustalić deterministyczny porządek kandydatów i odczytów. W porównaniach
  pominąć lokalne klucze bazy i czas importu; porównać tożsamość domenową,
  relacje, wartości, pokrycie i zachowany raw.

Wzorce są opisane w [katalogu fixture'ów](../src/test/resources/fixtures/README.md).
`copilot-file-v1.jsonl` daje dwie główne rozmowy, z których jedna ma dokładnie
powiązanego subagenta. `copilot-file-detached-v1.jsonl` daje jedną główną rozmowę:
2 rundy główne, 1 subagenta z 2 rundami, 1 wywołanie pomocnicze, 10 spanów
wybranego zakresu, 6 spanów nieprzypisanych i 3 pomijane rekordy niespanowe.
Są to oczekiwania syntetycznego fixture'u, nie uniwersalne liczniki plików Copilot.

**Odbiór:** istnieje porównywalny wzorzec, który wykryje ponowne pokazanie
`backgroundTodoAgent`, `progressMessages` lub technicznych trace'ów jako rozmów.
Różnice obecnej Javy i TypeScript są wyjaśnione przed zmianą reguł.

## E1. Oddzielenie operacji od transportu

Poniższe nazwy są proponowanymi elementami implementacji. Wydzielić kontrakt
`ScannerDataGateway`, lokalny `SessionRepository`, konfigurację trybu oraz
`FeatureAvailability`. Typy kontraktów nie zależą od IndexedDB i SQL.

| Operacja | Adapter demo | Adapter pełnej wersji |
|---|---|---|
| Lista i szczegóły sesji | IndexedDB | Istniejący REST Spring |
| Podgląd i zapis importu | Worker oraz transakcja IndexedDB | Obecny podgląd i zapis jednej rozmowy przez REST |
| Analiza oraz źródła mapy | Lokalny rdzeń i zapisany zakres powiązań | Obecne odczyty analityczne Spring |
| Eksport | Dane do pobrania jako plik w przeglądarce | Dane lub pobranie obsługiwane przez adapter HTTP |
| Usuwanie | Transakcja IndexedDB | Obecny REST |
| Katalog technik | Zasób buildu | Obecny transport do tego samego źródła treści |
| Status odbiornika, AI, Standaryzacja | Kontrola dostępności przed uruchomieniem | Osobne usługi backendowe |

- [x] Przenieść zależność komponentów od transportu na kontrakt operacji.
  DTO wspólne pozostają typowane; status lokalnego magazynu nie udaje statusu
  odbiornika ani domyślnej serwerowej retencji.
- [x] Składać adaptery przez providery Angular na podstawie konfiguracji buildu.
  Warunki trybu nie trafiają do reguł domenowych i poszczególnych obliczeń.
- [x] Zachować dotychczasowy wariant pełnej aplikacji z adapterem HTTP.
  Wielokrotną selekcję włączyć jako możliwość adaptera lokalnego; nie wykonywać
  sekwencji pojedynczych zapisów HTTP przedstawianej jako transakcja.
- [x] Wprowadzić typowane błędy operacji, np. błędny plik, konflikt, brak miejsca,
  niedostępny magazyn, niezgodny schemat i anulowanie. Tekst po polsku należy do UI.
- [x] Już teraz wyłączyć w demo start pollingu, odczyt historii Standaryzacji,
  inicjalizację AI i backendowe fallbacki ładowania. Niedostępne funkcje blokować
  przed utworzeniem komponentów uruchamiających te efekty.
- [x] Dodać konfigurację uruchomienia demo bez proxy i stronę startową niewymagającą
  danych. Odczyt listy oraz import podłączyć do adaptera lokalnego w E3–E4.

**Odbiór:** demo otwiera stronę startową przy wyłączonym Spring Boot i nie wykonuje
żądań `/api` ani `/v1`. Testy adaptera HTTP nadal potwierdzają obecne endpointy.

## E2. Czysty rdzeń, parser JSONL i Web Worker

Proponowane miejsca to `frontend/src/scanner-core/` dla czystego kodu i
`frontend/src/app/adapters/browser/` dla integracji przeglądarkowej. Rdzeń nie
importuje Angulara, DOM, Worker API, HTTP ani mechanizmów przechowywania.

- [x] Wydzielić istniejące czyste funkcje interpretacji z `core` oraz obliczenia
  z serwisów analizy. Serwisy Angular zostają cienkimi adapterami do rdzenia.
  Zachować aktualne formuły, granice interakcji i rozdział głównych/pomocniczych
  wywołań; nie przenosić klasyfikacji AI do deterministycznej mapy.
- [x] Zaimplementować odczyt ReadableSpan JSONL: ścisłe UTF-8, BOM, LF/CRLF,
  puste linie, walidację wymaganych pól i numer błędnej linii. Utrzymać odrzucanie
  zduplikowanych kluczy JSON i dodatkowej treści po obiekcie; zwykłe `JSON.parse`
  samo nie zapewnia całego kontraktu obecnego importera.
- [x] Rozdzielić rekordy spanów od pomijanych logów/metryk. Zachować oryginalne
  linie, nieznane pola, resource, scope, events, links i nieznane atrybuty.
  Uszkodzony opcjonalny atrybut tekstowy pozostaje zachowanym raw.
- [x] Zachować precyzję timestampów nanosekundowych i dużych liczb na granicy DTO.
  Nie opierać tożsamości ani obliczeń dokładnych na zaokrąglonym `Date` lub
  utracie cyfr podczas parsowania. Reprezentacja musi nadawać się do serializacji
  i późniejszego przekazania do JVM.
- [x] Przenieść reguły własności sesji, kandydatów i dokładnych powiązań importu.
  Uwzględnić mieszane identyfikatory dziecka i rodzica, brak rodzica spanu,
  kolejność rekordów, jednoznaczne dziedziczenie i fallback `trace:<traceId>`.
  Wspólny czas lub resource `session.id` nie dowodzi powiązania importowego.
- [x] Zbudować normalizację sesji/spanów/messages oraz model zapisu wybranego
  zakresu. Oddzielić OTel `spanId` od lokalnego liczbowego klucza spanu, do którego
  odwołuje się `MessageRecord.spanId`. Nadawanie kluczy magazynu i czasu importu
  pozostaje poza czystymi regułami.
- [x] Uruchomić parser i ciężką analizę w Workerze przez wersjonowane komunikaty:
  podgląd, przygotowanie wybranego zakresu, analiza i zwolnienie podglądu.
  Błędy mają kody i kontekst linii, bez drukowania przechwyconej treści.
- [x] Utrzymywać uchwyt podglądu z wersją parsera i referencją do konkretnego
  odczytanego pliku. Zapis akceptuje wyłącznie kandydatów z tego podglądu.
  Anulowanie i kolejny import zwalniają poprzedni plik oraz stan Workera.
- [x] Ustalić jeden konfigurowalny limit rozmiaru pliku i przetestować jego granice.
  Ograniczyć zbędne kopie całego payloadu; postęp dotyczy faktycznie przetworzonych
  danych. Worker musi pozwalać anulować długą operację bez zamrożenia UI.

**Odbiór:** oba fixture'y oraz warianty E0 dają zgodny podgląd i normalizację
w Javie oraz TypeScript. Identyczne spany są liczone raz; konflikt `(traceId,
spanId)` i błędny plik kończą operację przed zapisem. Anulowany Worker nie może
później nadpisać stanu nowego importu.

Podczas demo referencyjna implementacja Java nadal działa. Jest to przejściowe
utrzymanie dwóch implementacji dla weryfikacji zgodności. Nowe reguły demo mają
jedno miejsce w rdzeniu. Zastąpienie logiki Java nastąpi po prototypie GraalJS
i testach zgodności, zgodnie z architekturą docelową.

## E3. Persystencja IndexedDB

- [x] Zaprojektować wersjonowany schemat: sesje, spany, wiadomości, sygnały raw,
  relacje oraz metadane importu. Indeksy obejmują tożsamość rozmowy, `(traceId,
  spanId)` i odczyty zakresu sesji. Zachować wersję parsera i modelu analitycznego;
  pochodny cache jest odtwarzalny, a raw pozostaje źródłem.
- [x] Zaimplementować `SessionRepository` z otwarciem bazy, listą, szczegółami,
  odczytem powiązanego zakresu, zapisem, eksportem i usuwaniem. Komponenty nie
  odczytują object store bezpośrednio.
- [x] Przygotować dane w Workerze przed transakcją. W jednej transakcji zapisać
  wszystkie wybrane główne rozmowy i ich potwierdzone poddrzewa oraz dane
  pomocnicze. Wspólne spany i sygnały zapisać raz, z właściwymi referencjami.
- [x] Ponownie sprawdzić konflikty podczas zatwierdzenia. Podgląd nie stanowi
  blokady bazy; import w innej karcie może zmienić stan. Unikalne indeksy
  i transakcja chronią przed wyścigiem oraz częściowym zapisem.
- [x] Wyłączyć z zapisu raw niewybranych rozmów, nieprzypisanych spanów oraz
  pomijanych rekordów. Nie utrwalać całego oryginalnego pliku dla wygody eksportu.
- [x] Obsłużyć `QuotaExceededError`, niedostępność IndexedDB, abort transakcji
  i blokadę zmiany wersji przez inną kartę. Sukces UI następuje po zakończeniu
  transakcji, nie po pierwszym żądaniu dodania rekordu.
- [x] Przygotować niedestrukcyjną migrację schematu oraz test istniejących danych.
  Nowa wersja nie czyści bazy automatycznie. Nieobsługiwany schemat ma jawny błąd.
- [x] W usuwaniu respektować referencje współdzielonego zakresu. Usunięcie jednej
  głównej rozmowy nie usuwa dowodu nadal potrzebnego innej. Całościowe usunięcie
  obejmuje raw, wiadomości, relacje i pochodne dane demo.

**Odbiór:** realna przeglądarka odczytuje te same sesje po przeładowaniu aplikacji.
Konflikt jednej z kilku zaznaczonych rozmów, błąd miejsca lub abort nie zapisują
żadnej części operacji i nie zmieniają wcześniejszych danych. Test obejmuje także
dwie karty i ponowne otwarcie bazy po migracji.

## E4. Wybór wielu sesji i pierwszy kompletny przepływ

- [x] Podłączyć lokalny podgląd do obecnego wejścia importu. Modal otwiera się
  również dla jednej rozmowy; dla braku kandydatów pokazuje wyjaśnienie i liczniki.
- [x] W demo zastąpić radio wyborem checkbox. Rozdzielić liczniki rund głównych,
  subagentów i wywołań pomocniczych; model i czas karty pochodzą z głównej rozmowy.
  Wyświetlić pominięte rekordy, identyczne duplikaty i nieprzypisane spany.
- [x] Domyślnie wymagać jawnego zaznaczenia; przycisk importu jest nieaktywny
  bez wyboru. Już zapisane lub kolidujące zakresy pozostają nieaktywne.
  Przy kilku zaznaczeniach podsumowanie liczy unię zapisywanych spanów.
- [x] Anulowanie, Escape i backdrop kończą podgląd bez zapisu. Po rozpoczęciu
  transakcji UI jednoznacznie pokazuje trwający zapis; zapobiec podwójnemu submit.
- [x] Po zatwierdzeniu odświeżyć lokalną listę, pokazać wynik operacji i otworzyć
  pierwszą zaznaczoną rozmowę według kolejności modalu. Pozostałe zapisane rozmowy
  są dostępne na liście; subagenci pozostają w zakresie głównej rozmowy. Na etapie
  E4 otwierać „Koszt i przebieg”; po E5 domyślnym wejściem pozostaje Podsumowanie.
- [x] Podłączyć lokalny `SessionDetail` i powiązane dane do analizy oraz widoku
  „Koszt i przebieg”, włącznie z obecnymi panelami rund i subagentów.
- [x] Zastąpić opis przesyłania pliku informacją o lokalnym przetwarzaniu
  i zapisie w tej przeglądarce. Zachować dostępność klawiatury i przywracanie fokusu.

**Odbiór pierwszego kamienia milowego:** z wyłączonym backendem zaimportować
jedną i kilka rozmów, otworzyć koszty/rundy, odświeżyć stronę i ponownie wejść
w szczegóły. Fixture z jedną główną rozmową nie oferuje technicznych trace'ów.
Anulowanie i ponowny import tego samego pliku zachowują dotychczasową bazę.

## E5. Pozostałe zakładki, katalog i zarządzanie danymi

- [x] Podsumowanie zasilać lokalnymi metadanymi i analizą pokrycia. Nie przedstawiać
  zaimportowanego stanu jako aktywnego połączenia z IDE.
- [x] Mapę pracy zasilać zapisaną unią głównej rozmowy i potwierdzonych relacji.
  Zastąpić odczyt `/workflow-sources` lokalną operacją o równoważnym zakresie;
  nie wczytywać wszystkich sesji z bazy w każdym przełączeniu zakładki.
- [x] Dane techniczne podłączyć do lokalnych spanów/messages/signals. Zachować
  drzewo, filtry, raw, nieznane pola i szczegóły źródła. Nie ukrywać długiej treści
  przez ciche skrócenie danych.
- [x] Dostarczyć katalog technik jako zasób generowany lub kopiowany w buildzie
  z obecnego źródła JSON. Nie tworzyć osobnej ręcznie utrzymywanej wersji dla demo.
  Statyczny poradnik działa; wejścia do doradztwa przechodzą kontrolę dostępności.
- [x] Zmienić eksport z nawigacji do URL backendu na operację pobrania pliku
  realizowaną przez adapter. Zachować obecny kontrakt eksportu Scanner i materiał
  wybranego zakresu; zwalniać użyte object URL. Import nadal przyjmuje Copilot
  JSONL, więc UI nie obiecuje obsługi eksportu Scanner jako wejścia importu.
- [x] Podłączyć potwierdzane usunięcie wybranej sesji i całej lokalnej bazy;
  poprawnie zamknąć panele, zmienić trasę i odświeżyć listę. Błąd nie pokazuje sukcesu.
- [x] Unieważniać wynik analizy po zmianie zakresu lub wersji rdzenia. Przełączenie
  sesji nie może wyświetlać wyniku opóźnionego zadania dla poprzedniej sesji.

**Odbiór:** wszystkie cztery lokalne zakładki i ich panele działają po restarcie
strony, bez fallbacku do HTTP. Eksport zawiera właściwy zakres, a usuwanie nie
narusza danych pozostałych sesji. Brak metryki nadal różni się od wyemitowanego zera.

## E6. Dostępność funkcji i onboarding plikowy

- [x] Utrzymywać jedną macierz możliwości i wspólny modal Material. Tytuł:
  „Dostępne w pełnej wersji”. Treść: „Ta funkcja jest dostępna w pełnej wersji
  Agent Scanner. W demo możesz importować i przeglądać sesje lokalnie.”
- [x] Objąć kontrolą zakładkę AI Hub, przyciski rozmowy/klasyfikacji/doradztwa,
  dodawanie repozytorium, zapisane trasy Standaryzacji, ustawienia odbiornika
  oraz pauzę. Sprawdzić również wejścia z paneli rund, mapy i poradnika.
- [x] Chronić bezpośrednie trasy przed montowaniem backendowych komponentów.
  Kliknięcie AI Hub pozostawia aktualny lokalny widok i otwiera modal; bezpośredni
  URL niedostępnej zakładki wraca do podsumowania sesji, a trasy repozytoriów
  do strony startowej. Modal pojawia się raz dla danej nawigacji.
- [x] W topbarze pokazać status lokalnego zapisu/importu zamiast statusu odbiornika.
  Nie ustawiać fikcyjnych liczników logów/metryk ani retencji serwerowej.
- [x] Na stronie startowej umieścić konfigurację eksportera plikowego, kroki
  wczytania pliku, opis wyboru rozmów i informację o lokalnym przetwarzaniu.
  Przykładowa ścieżka jest edytowana przez użytkownika w VS Code.

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": "C:/Users/<użytkownik>/copilot-otel.jsonl",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}
```

**Odbiór:** każde backendowe wejście, także przez URL, pokazuje ustalony komunikat
bez odczytu API i bez inicjalizacji AI. Test startu oraz dłuższego pozostania
na stronie wykrywa automatyczne żądania. Brak sesji lub przechwyconej treści ma
własny stan UI. Ogląd desktopowy i wąski potwierdza modal, import oraz panele.

## E7. Build statyczny i publikacja GitHub Pages

- [x] Dodać konfigurację Angular `demo` z lokalnymi providerami, optymalizacją
  produkcyjną i osobnym katalogiem wyjściowym, proponowane `frontend/dist/demo`.
  Zachować build do Spring Boot. Wyjście i generowane zasoby objąć `.gitignore`.
- [x] Dodać planowane skrypty `start:demo` oraz `build:demo`. Pierwszy uruchamia
  demo bez proxy, drugi buduje pełny katalog do hostingu statycznego.
- [x] Włączyć routing hash wyłącznie w demo. Parametryzować `base-href` zgodnie
  z URL Pages; sprawdzić zarówno origin root, jak i podkatalog projektu.
- [x] Sprawdzić ścieżki lazy chunków, Workera, fontów, ikon i katalogu technik.
  Zasoby mają działać z podkatalogu bez odwołań do localhost lub ścieżek serwera.
- [x] Przygotować workflow `.github/workflows/demo-pages.yml`: instalacja z lockfile,
  kontrola dokumentów, właściwe testy, build demo, weryfikacja artefaktu,
  publikacja artefaktu statycznego i wdrożenie przez GitHub Pages.
- [x] Oddzielić walidację zmian/PR od publikacji; PR przechodzi testy i build,
  publikacja działa dla uzgodnionej gałęzi wydania i ręcznego uruchomienia.
  Ustalić rzeczywisty URL i gałąź na podstawie repozytorium, bez zgadywania ownera.
- [x] Workflow pakuje wyłącznie wyjście Angular. Fixture'y testowe, lokalne pliki
  telemetryczne, baza oraz sekrety nie trafiają do publikowanego artefaktu.
  Włączyć GitHub Pages ze źródłem GitHub Actions w ustawieniach repozytorium.

Mechanikę określają [konfiguracja Angular](https://angular.dev/tools/cli/deployment),
[routing hash](https://angular.dev/api/router/withHashLocation) i
[workflow Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Dokładne wersje narzędzi i akcji CI ustalić podczas implementacji z ich oficjalnej
dokumentacji; zmiany zależności obejmują manifest oraz lockfile.

**Odbiór:** gotowy katalog działa przez zwykły serwer plików przy wyłączonym
backendzie. Na URL Pages działają start, import, Worker, katalog, lazy zakładki
i odświeżenie `/#/sessions/...` w obrębie właściwej ścieżki projektu. Dane
pozostają przypisane do originu; publikacja nowego buildu nie czyści IndexedDB.

## E8. Testy wydania i aktualizacja dokumentacji

- [x] Dodać automatyczny scenariusz w rzeczywistej przeglądarce uruchamiany na
  statycznym artefakcie, proponowany skrypt `test:demo:e2e`. Sam test komponentów
  i atrapa IndexedDB nie potwierdzają persystencji ani ścieżek Workera.
- [x] W scenariuszu rejestrować żądania sieciowe i kończyć test błędem przy każdej
  próbie `/api`, `/v1` lub wysyłki payloadu poza lokalne przetwarzanie. Statyczne
  pobranie zasobów aplikacji jest oczekiwanym ruchem hostingu.
- [x] Pokryć przypadki z poniższej macierzy, włącznie z ponownym uruchomieniem
  strony i testem spod podkatalogu. Użyć syntetycznych danych; raporty nie zawierają
  prawdziwego pliku użytkownika ani przechwyconej treści.
- [x] Uruchomić właściwe testy frontendowe, build pełnej aplikacji oraz demo.
  Przy zmianie zależności lub integracji buildu także pełny Maven; przy zmianie
  Javy/DTO również regresje backendu. Nie uruchamiać modeli w testach.
- [x] Zaktualizować właściwe kontrakty wraz z kodem: frontend dla zachowania,
  telemetrię dla uzasadnionej zmiany reguł, konfigurację dla trybów, poradnik
  dla importu/IndexedDB i rozwój dla nowych komend testowych. Status architektury
  docelowej powinien wskazywać, które elementy zostały wdrożone.
- [x] Zweryfikować opublikowany URL, działanie po odświeżeniu i informacje
  o prywatności. Zamknąć checklistę wydania dopiero po tym sprawdzeniu.

| Scenariusz | Oczekiwany dowód |
|---|---|
| Start i oczekiwanie na stronie | Brak żądań API i efektów inicjalizacji AI. |
| Fixture z rozmową i technicznymi trace'ami | Jedna kandydatura, osobne liczniki główne/pomocnicze i poprawny zakres raw. |
| Wybór jednej z wielu rozmów | W bazie i raw brak niezaznaczonej rozmowy. |
| Wybór kilku rozmów | Jeden atomowy zapis, wspólne rekordy policzone raz, wszystkie wybrane sesje dostępne. |
| Anulowanie podglądu | Brak nowego zapisu i zwolnienie stanu pliku. |
| Zły UTF-8, zły JSON, konflikt duplikatów, limit pliku | Błąd przed zapisem z użytecznym kontekstem, wcześniejsze dane zachowane. |
| Ponowny import lub konflikt między podglądem a zapisem | Jawny konflikt bez nadpisania i częściowego importu. |
| Brak miejsca, abort, migracja i dwie karty | Zachowana baza, jednoznaczny wynik operacji, obsłużona blokada wersji. |
| Reload i bezpośredni URL lokalnej zakładki | Odczyt IndexedDB i poprawny widok z trasy hash. |
| Brak pomiaru/treści versus wyemitowane zero | Jawne braki, brak fałszywych metryk i brak modalu dostępności. |
| Koszty, mapa i panele | Zgodne relacje i sumy, brak podwójnego liczenia poddrzew. |
| AI/OTLP/Standaryzacja przez przycisk i URL | Jeden modal, brak utworzenia backendowego komponentu i żądań. |
| Eksport i usunięcie jednej/całości | Właściwy zakres dowodu, pozostałe sesje działają, usunięte dane nie wracają po reload. |
| Publikacja w podkatalogu | Działają zasoby, Worker, lazy loading, poradnik i odświeżenie widoku. |

Sprawdzenia repozytorium z [kontraktu rozwoju](rozwoj.md#weryfikacja-zmian)
pozostają obowiązujące. Skrypty demo i workflow opisane w planie są wdrożone.
Każdy etap zapisuje w zmianie wynik weryfikacji i ewentualne ograniczenia, bez
utrzymywania w dokumentacji chwilowych liczników testów czy rozmiarów bundla.

## Ryzyka i sposób ich zamknięcia

| Ryzyko | Wymagana odpowiedź |
|---|---|
| Regresja korelacji po przeniesieniu z Javy | Wspólne fixture'y i porównanie tożsamości, relacji, raw oraz liczników przed podłączeniem UI. |
| Ukryty odczyt backendu w istniejącym komponencie | Macierz wejść E0, składanie providerów i test rzeczywistych żądań od startu aplikacji. |
| Utrata precyzji lub materiału dowodowego | Jawne typy, raw, testy dużych wartości i nanosekund; format DTO przygotowany również pod JVM. |
| Częściowy import wielu rozmów | Przygotowanie przed transakcją, ponowna kontrola konfliktów i jeden commit wszystkich wybranych zakresów. |
| Zbyt duży plik lub długi import | Limit, Worker, ograniczenie kopii, anulowanie i syntetyczny test obciążeniowy przy granicy limitu. |
| Utrata lokalnych danych | Obsługa błędów i migracji, czytelna informacja o trwałości, lokalny eksport i brak automatycznego czyszczenia. |
| Różnica hostingu Spring i Pages | Oddzielne konfiguracje oraz test artefaktu z hash routingiem i podkatalogiem. |
| Trwała duplikacja logiki | Nowe reguły wyłącznie w rdzeniu; późniejszy prototyp JVM i wymiana reguł Java etapami po potwierdzeniu zgodności. |

## Checklista zamknięcia i dalszy etap Spring Boot

- [x] E0 — wzorce semantyki i inwentaryzacja zależności.
- [x] E1 — wspólne operacje, adapter HTTP i uruchomienie demo bez API.
- [x] E2 — czysty rdzeń, lokalny parser, Worker i zgodne regresje.
- [x] E3 — transakcyjny IndexedDB, migracje i obsługa błędów.
- [x] E4 — kompletny import z wielokrotnym wyborem i pierwszy widok po reload.
- [x] E5 — wszystkie lokalne zakładki, poradnik, eksport i usuwanie.
- [x] E6 — kompletna dostępność funkcji oraz onboarding plikowy.
- [x] E7 — artefakt i workflow GitHub Pages.
- [x] E8 — odbiór przeglądarkowy, dokumentacja i sprawdzony URL demo.

[Demo na GitHub Pages](https://herald-assistant.github.io/agent-scanner/) zostało
odebrane po [pomyślnym wdrożeniu](https://github.com/herald-assistant/agent-scanner/actions/runs/36950384170).
Ten sam scenariusz [testów przeglądarkowych](../frontend/e2e/demo.test.mjs)
potwierdził na publicznym adresie import, trwałość danych po odświeżeniu,
lokalne zakładki i brak wywołań backendu. Workflow publikuje wyłącznie sprawdzony
artefakt Angular; dane testowe i dane użytkownika nie są częścią publikacji.

Po wydaniu demo kolejny plan obejmie dobór wersji Java/Spring/GraalJS, prototyp
uruchomienia tego samego rdzenia w JVM, adapter bazy klienta i OTLP oraz odczytowe
narzędzia MCP dla jawnych funkcji AI. Kontrakty i fixture'y z demo są punktem
wejścia; komponenty Angular korzystają nadal z tych samych operacji aplikacyjnych.
Nie zakładamy automatycznej synchronizacji danych IndexedDB z bazą klienta.
