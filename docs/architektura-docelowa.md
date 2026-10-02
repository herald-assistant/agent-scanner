# Architektura docelowa — demo i pełna wersja

Status: wdrożony wariant demo, port danych i czysty rdzeń. Integracja rdzenia z JVM, docelowa baza klienta i MCP pozostają kolejnym etapem.

[Dokumentacja](README.md)

Dokument zapisuje decyzję o wspólnym silniku interpretacji dla demo działającego
w przeglądarce i pełnej instalacji na infrastrukturze klienta. Backend pozostaje
w Spring Boot. [Obecną implementację](architektura.md) oraz obowiązujące zachowanie
opisują dotychczasowe kontrakty; poniższy model określa kierunek ich migracji.

Szczegółową kolejność prac, zależności i kryteria odbioru pierwszego wydania
określa [plan realizacji demo](plan-demo.md).

## Decyzja i zakres produktu

Wspólne pozostają interfejs Angular, kontrakty danych, deterministyczne reguły
interpretacji i fixture'y. Źródła danych, sposób zapisu i funkcje AI mają osobne
adaptery. Celem jest utrzymywanie jednej implementacji każdej reguły domenowej.

Najbliższym celem jest działające demo przeglądarkowe. Projektujemy jego rdzeń
i kontrakty tak, aby późniejsze podłączenie lub rozwinięcie backendu Spring Boot
nie wymagało przebudowy komponentów i ponownego definiowania reguł interpretacji.
Integracja JVM, MCP, docelowa baza klienta i aktualizacja stosu backendowego są
późniejszymi etapami; nie blokują dostarczenia demo.

| Element | Demo | Pełna wersja |
|---|---|---|
| Interfejs | Statyczna aplikacja Angular w przeglądarce | Te same komponenty Angular |
| Telemetria | Import pliku Copilot OTel JSONL i wybór jednej lub kilku rozmów | Import JSONL oraz odbiornik OTLP w Spring Boot |
| Silnik interpretacji | Wspólny `scanner-core` w Web Workerze | Ten sam `scanner-core` przez GraalJS osadzony w JVM |
| Przechowywanie | IndexedDB w przeglądarce; pamięć dla podglądu i obliczeń | Baza danych na infrastrukturze klienta, obsługiwana przez Spring |
| Repozytorium | Rozszerzenie po pierwszym demo: import wybranych konfiguracji i kontrole deterministyczne | Te same kontrole oraz jawna ocena AI |
| AI | Niedostępne | Usługi Spring i narzędzia MCP odczytujące dane klienta |
| Dostarczenie | Build Angular do publikacji na GitHub Pages | Obraz kontenerowy lub kod źródłowy z procesem budowania |

Typ docelowej bazy SQL pozostaje do ustalenia.
Obecna H2 pozostaje obsługiwana podczas migracji. Wybór kolejnego silnika bazy
wymaga osobnego adaptera SQL, migracji schematu i weryfikacji transakcji.

## Wersje platformy i priorytety

Java 17 i obecny Spring Boot opisują dzisiejszą implementację, nie ograniczenie
architektury docelowej. Preferowane są nowsza, wspierana Java LTS oraz nowsza,
wspierana stabilna wersja Spring Boot. Konkretne wersje dobieramy podczas prac
nad backendem, uwzględniając zgodność z GraalJS i pozostałymi zależnościami.

Aktualizacja wersji nie jest teraz najwyższym priorytetem ani warunkiem budowy
demo. Na etapie demo przygotowujemy czysty rdzeń, kontrakty i wspólne fixture'y.
Weryfikacja runtime JVM oraz zmiana manifestów należą do późniejszego etapu.

## Zakres pierwszego demo na GitHub Pages

Rezultatem pierwszego etapu jest produkcyjny build Angular, działający z hostingu
statycznego. Użytkownik wczytuje plik Copilot OTel JSONL, wybiera jedną lub kilka
głównych rozmów w modalu, zapisuje je lokalnie w IndexedDB i otwiera obecne widoki.
Zapisane sesje są dostępne także po odświeżeniu strony. Plik jest analizowany
wyłącznie w przeglądarce, bez wysyłania telemetrii do serwera.

| Obecny obszar | Zachowanie pierwszego demo |
|---|---|
| Podsumowanie | Lokalny model sesji, dane konfiguracji obecne w telemetrii i pokrycie danych. |
| Koszt i przebieg | Emitowane metryki, credits, interakcje, rundy, narzędzia, subagenci i kompaktowanie z lokalnej rekonstrukcji. |
| Mapa pracy | Lokalna analiza i dotychczasowe szczegóły materiału dowodowego. |
| Dane techniczne | Drzewo spanów, zachowane atrybuty, wiadomości i raw wybranego zakresu importu. |
| AI Hub | Widoczne wejście otwiera modal informacyjny; komponent nie inicjuje odczytów backendowych. |
| Poradnik technik | Statyczny katalog dostępny jako zasób aplikacji; doradztwo AI otwiera modal. |
| Standaryzacja wymagająca usług backendu | Modal informacyjny; lokalny przegląd folderu można dodać jako osobny etap. |
| Odbiornik OTLP, jego ustawienia i pauza | Modal informacyjny; onboarding demo prowadzi do eksportu plikowego. |
| Eksport i usuwanie sesji | Operacje lokalne na IndexedDB i plikach pobieranych przez przeglądarkę. |

Dostępność jest oceniana dla operacji, nie na podstawie błędu HTTP. Wspólny modal
Material ma tytuł „Dostępne w pełnej wersji” i opis „Ta funkcja jest dostępna
w pełnej wersji Agent Scanner. W demo możesz importować i przeglądać sesje lokalnie.”
Komunikaty demo nie wspominają o opłatach. Bezpośrednie wejście na trasę wymagającą
backendu również respektuje tę regułę. Brak pomiaru lub treści w telemetrii pozostaje
brakiem danych i nie uruchamia modalu o dostępności funkcji.

Nie ma pollingu `/api/status`, automatycznego odczytu historii AI, katalogu modeli
ani prób pobrania backendowej analizy po otwarciu sesji. Status UI opisuje lokalny
import i zapis, a nie połączenie z odbiornikiem. Statyczne katalogi potrzebne
widokom są dostarczane z buildem, zachowując jedno źródło ich zawartości.

Build demo ma osobną konfigurację i katalog wyjściowy, niezależne od zasobów
pakowanych obecnie do Spring Boot. Dla Pages projektu trzeba ustawić bazową
ścieżkę zgodną z miejscem publikacji. Wariant demo używa routingu z fragmentem
URL (`withHashLocation()`), aby odświeżanie widoku sesji nie wymagało reguł
przekierowania na serwerze. Zasoby i Web Worker działają także w podkatalogu.
[Routing Angular](https://angular.dev/api/router/withHashLocation),
[konfiguracja wdrożenia Angular](https://angular.dev/tools/cli/deployment) i
[workflow GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
określają mechanizm publikacji.

Warunki ukończenia pierwszego demo:

- statyczny build uruchamia się przy wyłączonym backendzie;
- plik z kilkoma rozmowami daje poprawną listę kandydatów i wybór wielu pozycji;
- zatwierdzenie zapisuje wyłącznie wybrane rozmowy i potwierdzony zakres powiązań,
  deduplikując wspólne spany; anulowanie podglądu nie zapisuje danych;
- błędny plik, konflikt istniejących danych lub błąd zapisu nie powodują częściowego importu;
- lista, obecne lokalne zakładki i szczegóły działają po ponownym otwarciu aplikacji;
- eksport i usuwanie działają lokalnie, a brak miejsca jest jawnie obsłużony;
- działania wymagające backendu pokazują modal bez żądań do API;
- test przeglądarkowy sprawdza brak żądań `/api` i `/v1`, utrwalenie w IndexedDB,
  odświeżenie trasy oraz działanie z bazową ścieżką Pages;
- wyniki normalizacji i korelacji odpowiadają syntetycznym fixture'om obecnego importera;
- gotowy katalog statyczny i workflow publikacji przechodzą właściwe testy i build.

## Wspólny rdzeń i granice odpowiedzialności

`scanner-core` to wydzielony pakiet TypeScript kompilowany do JavaScript.
Rdzeń przyjmuje wersjonowane DTO i zwraca deterministyczne wyniki. Nie zależy
od Angulara, DOM, Springa, HTTP, IndexedDB ani SQL. Nie wykonuje inferencji.

Do rdzenia należą:

- normalizacja stabilnych pól i zachowanie nieznanych atrybutów;
- identyfikacja rozmów, epizodów, subagentów i wywołań pomocniczych;
- rekonstrukcja interakcji, rund, narzędzi i potwierdzonych relacji;
- reguły metryk, Copilot AI credits, kompaktowania i pokrycia danych;
- deterministyczne kontrole wybranych konfiguracji repozytorium.

Reguły zachowują [kontrakt telemetrii](telemetria.md): raw pozostaje dowodem,
brak pomiaru jest jawny, a fakty, wyliczenia, estymacje i wyniki AI mają rozróżnione
pochodzenie. Migracja nie wprowadza korelacji na podstawie samego czasu lub wspólnego
okna IDE. Precyzyjne timestampy i wartości całkowite przekraczające bezpieczny zakres
JavaScript wymagają reprezentacji zachowującej dokładność na granicy DTO.

| Warstwa | Odpowiedzialność |
|---|---|
| Adapter wejściowy | Odczyt pliku albo żądania OTLP, dekodowanie formatu, limity i zachowanie raw. |
| `scanner-core` | Interpretacja wspólnego modelu wejściowego i budowa modelu analitycznego. |
| Adapter przechowywania | Transakcje, indeksy, trwały zapis, odczyt, usuwanie i migracje. |
| Odczyty analityczne | Podsumowania, paginacja, filtrowanie i materiał dowodowy w określonym zakresie. |
| Angular | Stan ekranów, formatowanie, polskie etykiety, układ mapy i interakcje użytkownika. |
| Spring Boot | REST, OTLP, persystencja serwerowa, kontrola dostępu, retencja, MCP i wykonanie AI. |

JSONL i OTLP dostarczają wspólny model telemetrii. Odczyt pliku w przeglądarce
i dekodowanie protobuf w Javie mogą mieć różne adaptery, ale reguły tożsamości,
korelacji i agregacji należą do jednej implementacji rdzenia. Kod parsowania
formatu JSONL powinien być współdzielony tam, gdzie nie zależy od środowiska.

Komponenty korzystają z kontraktów operacji aplikacyjnych: podglądu i zatwierdzenia
importu, listy i odczytu sesji, modelu analitycznego, eksportu oraz usuwania danych.
Lokalny adapter realizuje te operacje przez rdzeń i pamięć lub IndexedDB.
Adapter HTTP deleguje je do Spring Boot. Kontrakty mają wersjonowane DTO i
jednoznaczne błędy, niezależne od szczegółów przechowywania. UI nie odczytuje
bezpośrednio IndexedDB ani nie zawiera adresów endpointów w komponentach.

## Wykonanie w przeglądarce i Spring Boot

```text
Demo:
  plik JSONL / wybrane konfiguracje repozytorium
    → adapter wejściowy → scanner-core w Web Workerze
    → pamięć karty / IndexedDB → wspólne widoki Angular

Pełna wersja:
  import JSONL / OTLP → adapter wejściowy Spring
    → scanner-core przez GraalJS w JVM → zapis przez Spring do bazy klienta
    → odczyty analityczne → REST → wspólne widoki Angular
                         → MCP → agent AI
```

Docelowo GraalJS będzie osadzony w procesie backendu. Instalacja nie wymaga
osobnego serwera Node. Node pozostaje narzędziem budowania TypeScript i Angulara.
[GraalVM Polyglot API](https://www.graalvm.org/latest/reference-manual/embed-languages/)
umożliwia wykonywanie JavaScript z aplikacji Java; zgodność wybranej wersji runtime
z projektem musi zostać potwierdzona przed wdrożeniem.

Adapter Spring przekazuje dane do rdzenia i odbiera wyniki. Połączenia z bazą,
uprawnienia oraz transakcje pozostają w Javie. Backend uruchamia dostarczony
pakiet rdzenia; importowane pliki są danymi, a nie kodem wykonywanym przez runtime.
Odczyty REST i MCP korzystają z wyników obliczonych po stronie serwera.

Pakiet rdzenia ma ten sam numer wersji w obu środowiskach. Zależności od API
przeglądarki i operacje wejścia/wyjścia pozostają w adapterze demo. Dostępność
funkcji jest ustalana przy składaniu aplikacji, zamiast rozprowadzania warunków
trybu demo po komponentach i regułach domenowych.

## Lokalne przechowywanie w demo

Pierwsze demo zapisuje wybrane sesje w tej przeglądarce przez IndexedDB.
Pamięć karty służy do podglądu pliku i obliczeń przed zatwierdzeniem. Lokalny zapis
pozwala ponownie otworzyć sesję po odświeżeniu. Demo nie wysyła importowanych
danych do backendu ani do AI. Osobny tryb bez trwałego zapisu pozostaje możliwym
rozszerzeniem za tym samym kontraktem przechowywania.

Zapis obejmuje wybrany zakres raw, model znormalizowany, metadane pochodzenia
oraz wersje parsera, schematu i rekonstrukcji. Wyniki pochodne są odtwarzalne z raw;
zmiana reguł może unieważnić cache, zachowując materiał źródłowy. Zapis wybranej
rozmowy obejmuje tylko jej potwierdzony zakres, zgodnie z zasadami importu.

Adapter IndexedDB zapewnia obsługę migracji, braku miejsca, eksportu i jawnego
usuwania lokalnych danych. Dane są związane z originem i profilem przeglądarki.
Można wystąpić o trwałe przechowywanie przez `navigator.storage.persist()`, ale
eksport pozostaje sposobem wykonania kopii poza przeglądarką.
[Zasady trwałości i limitów](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
oraz [IndexedDB w Web Workerach](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
określają granice platformy.

Adaptery pamięci, IndexedDB i bazy klienta realizują te same operacje aplikacyjne,
ale mają własne transakcje i indeksy. Przejście między wydaniami nie zakłada
automatycznej synchronizacji lokalnej bazy demo z bazą klienta.

## AI i MCP w pełnej wersji

AI jest modułem pełnej wersji, uruchamianym przez Spring Boot po jawnej akcji.
Demo nie zawiera integracji wykonującej AI. Dostęp do operacji pełnej wersji jest
egzekwowany przez backend, niezależnie od widoczności przycisków w UI.

Serwer MCP udostępnia celowane, odczytowe narzędzia analityczne, np.
`scanner_list_rounds`, `scanner_get_round_evidence` i `scanner_get_cost_summary`.
Korzysta z tych samych odczytów i modelu dowodowego co REST. Punktem migracji
jest obecny `SessionAnalysisQueryService`; obecne narzędzia `scanner_*` są
narzędziami Copilot SDK, a adapter serwera MCP pozostaje do wdrożenia.

Narzędzia działają w zakresie uprawnionej sesji i określonej migawki danych.
Backend waliduje parametry, referencje, zakres i limity oraz zapisuje audyt użycia.
Model nie otrzymuje dowolnego dostępu SQL do bazy. Walidacja, redakcja i pochodzenie
wyników zachowują [kontrakt AI](ai.md).
[Kontrakt narzędzi MCP](https://modelcontextprotocol.io/specification/latest/server/tools)
jest podstawą adaptera protokołu.

Lokalizacja bazy i lokalizacja modelu są osobnymi ustawieniami wdrożenia.
Przy zewnętrznym modelu treść zwracana przez narzędzia trafia do jego dostawcy;
lokalna baza sama w sobie nie oznacza lokalnej inferencji.

## Migracja i warunki wdrożenia

Etapy 1–4 są wdrożone w demo. Etapy 5–7 pozostają pracą nad pełną instalacją;
szczegółowy odbiór demo dokumentuje [plan realizacji](plan-demo.md).

1. Oddzielić operacje odczytu i importu od transportu HTTP w UI. Zachować adapter
   obecnego API i przygotować kontrakty dla lokalnego adaptera demo.
2. Wydzielić czysty `scanner-core`, wykorzystując obecną logikę TypeScript.
   Uzupełnić lokalny import JSONL i potrzebną interpretację, porównując wyniki
   z obecną implementacją na syntetycznych fixture'ach. Wyjaśniać rozbieżności
   przed zmianą zachowania; utrzymać dotychczasowy backend podczas budowy demo.
3. Podłączyć Web Worker, adapter IndexedDB, wybór wielu rozmów z pliku,
   ponowne otwieranie, eksport i usuwanie lokalnych danych. Przygotować lokalne
   źródła dla obecnych zakładek i statyczne katalogi dla poradnika.
4. Dodać wspólną obsługę dostępności funkcji, modal pełnej wersji i onboarding
   eksportu plikowego. Przygotować build i workflow GitHub Pages oraz zweryfikować
   działanie przy wyłączonym backendzie. Lokalny import konfiguracji repozytorium
   pozostawić jako osobny etap, który nie blokuje pierwszego demo telemetrii.
5. W etapie backendowym dobrać wspierane wersje Java, Spring Boot i GraalJS oraz
   uruchomić prototyp przeglądarka–JVM na tych samych fixture'ach. Sprawdzić pakowanie
   Spring Boot, precyzję danych, pamięć, czas wykonania i równoległe żądania.
6. Po potwierdzeniu runtime podłączyć wspólny rdzeń do Spring, zachowując
   persystencję i kontrakty odczytu. Przełączać reguły etapami i usuwać zastąpioną
   implementację domenową dopiero po potwierdzeniu zgodności.
7. Dodać adapter MCP i funkcje AI pełnej wersji oraz przygotować dostarczenie instalacji
   klienta jako obraz kontenerowy lub kod źródłowy.

Warunkiem wymiany istniejącej logiki jest zgodność wyników na wspólnych fixture'ach,
obejmujących kilka rozmów, subagentów, techniczne spany, niejednoznaczne powiązania,
różne kolejności i podział dostaw OTLP, braki metryk oraz zachowanie raw.
Zmiana semantyki wymaga osobnego uzasadnienia i regresji według
[zasad rozwoju](rozwoj.md).

GraalJS jest wybranym kierunkiem integracji, a nie potwierdzoną zależnością obecnego
buildu. Jeśli prototyp nie spełni warunków, decyzja o runtime wymaga ponownego
rozpatrzenia przed przełączeniem backendu na wspólny rdzeń. Ten warunek nie blokuje
budowy demo. Wymóg backendu Spring Boot i wspólnej semantyki obu wydań pozostaje
obowiązujący.
