# Klasyfikacja odpowiedzi modelu — model-actions-v5

Mapa pracy początkowo przedstawia fakty: rundy, wykonania, potwierdzone delegacje,
błędy i wyemitowane pomiary. AI uruchamia wyłącznie przycisk
„Przeanalizuj działania modelu”. Ponowne wejście odczytuje zapisaną analizę;
przełącznik „Kategorie / Fakty” nie uruchamia modelu.

Po włączeniu kategorii ekran najpierw pokazuje dominującą kategorię według
estymacji credits i ostrożny kierunek do sprawdzenia. Niżej znajduje się statyczny
ranking procentowy, zagregowany przebieg głównego agenta i subagentów oraz osobny,
domyślnie rozwinięty szczegółowy graf wywołań, który użytkownik może ukryć.

## Przedmiot klasyfikacji

Ocenie podlega **akcja żądana w odpowiedzi modelu (M → A)**. Cel „analiza
architektury” i tool call odczytujący lub wyszukujący treść dają kategorię
pozyskania danych. Wynik wykonania,
następna runda, uruchomiony subagent ani zdarzenie kompaktowania nie służą
do klasyfikacji tej odpowiedzi. Żądanie delegacji jest oceniane również wtedy,
gdy wykonanie lub dziecko nie zostało przechwycone.

AI zwraca:
- możliwości i specjalizację każdej unikalnej definicji;
- listę akcji, dopasowanie do wyemitowanego celu i uzasadnienie każdego żądania;
- listę akcji rundy oraz dowody obejmujące wszystkie jej żądania.

Backend wymaga, aby akcje rundy były dokładnie sumą zbiorów akcji jej żądań.
Nie wybieramy dominującej intencji. Odczyt i wyszukiwanie tworzą wspólną kategorię,
bo oba doprowadzają dane do następnego rozumowania modelu. Jeden terminal może
żądać pozyskania danych i uruchomienia testu. Tekst objaśniający te polecenia nie dodaje
kolejnej kategorii „odpowiedź”.

Profil subagenta jest lokalnym zestawieniem akcji jego **własnych** rund.
Nie obejmuje rund potomków ani roli domyślonej z celu. Jedna runda może wystąpić
w kilku licznikach akcji; to nie jest rozłączny podział rund. Sąsiednie rundy
o identycznym zbiorze akcji tworzą segment na mapie.

Nad mapą pokazujemy sumę odpowiedzi modelu w każdej kategorii dla aktualnie
widocznego przepływu oraz rozdział na agenta głównego i subagentów. Udział oznacza
odsetek sklasyfikowanych odpowiedzi zawierających daną kategorię. Ponieważ wynik
jest wieloetykietowy, udziały kategorii nie muszą sumować się do 100%.

## Zakres zapytania

`flow-tool-catalog.ts` zbiera żądania z przechwyconych odpowiedzi modelu,
także bez wykonań. Wspólny parser `model-response.ts` obsługuje koperty OTel
(`parts/tool_call`), Chat Completions (`tool_calls/function`), Responses
(`function_call`) i `tool_use`. Nie interpretuje JSON-u w argumentach ani
wynikach jako kolejnych wywołań. Najpierw czyta znormalizowane wiadomości
`output`; raw `gen_ai.output.messages` stanowi fallback. Brak treści nie
jest odtwarzany z `execute_tool`, liczników ani opisu zadania.

Definicja pochodzi z `gen_ai.tool.definitions` bieżącej rundy lub wiadomości
`definition`. Przy braku katalogu stosujemy ostatni wcześniej wyemitowany
katalog tego samego epizodu i trace. Jawnie pusty lub niepoprawny katalog nie
jest zastępowany. Deduplikacja obejmuje cały kanoniczny JSON z posortowanymi
kluczami; kolejność tablic pozostaje znacząca. Zmieniony schemat lub opis
tworzy osobną wersję.

Wysyłamy wyłącznie definicje narzędzi żądanych w odpowiedziach. Brak lub konflikt
definicji daje `toolId: null`: żądanie nadal trafia do AI z nazwą i argumentami,
ale specjalizacja pozostaje nieustalona. Nie twierdzimy, że wszystkie narzędzia
dostępne modelowi zostały przeanalizowane.

Zapytanie obejmuje definicje, lokalne ID agentów/kontekstów/rund, wyemitowane cele,
tekst odpowiedzi do 1000 znaków i argumenty konkretnych żądań. Cel ma limit
4000 znaków i służy wyłącznie ocenie dopasowania. Zachowujemy wszystkie właściwości
i elementy tablic. Wartości tekstowe ponad 100 znaków skracamy rekurencyjnie
do pierwszych 50 + `...` + ostatnich 47 znaków; `argumentsTruncated` jawnie
informuje AI i użytkownika o pominiętym tekście. AI nie powinno dopowiadać
ukrytych poleceń. Ograniczenie może pogorszyć ocenę długich skryptów.

Wyniki narzędzi, pełne requesty, liczniki, potwierdzenia wykonań/błędów oraz
token GitHub nie są wysyłane. „Zakres analizy” pokazuje zakres przed kliknięciem.

## Kategorie i walidacja

Kategorie akcji:
- `ACQUIRE_DATA`: wyszukanie, lokalizacja lub odczyt informacji, treści, katalogu,
  statusu, indeksu albo bazy;
- `MODIFY`: zmiana lub zapis bez dowodu, czy wynik jest pośredni czy końcowy;
- `WRITE_INTERMEDIATE`: jawny zapis wyniku roboczego;
- `WRITE_FINAL`: jawny zapis końcowego artefaktu;
- `VALIDATE`: test, kompilacja, kontrola;
- `DELEGATE`: żądanie delegacji;
- `MANAGE_CONTEXT`: jawne zarządzanie kontekstem/kompaktowanie;
- `RESPOND`: odpowiedź lub komunikat, bez wnioskowania, że kończy zadanie;
- `OTHER`: widoczna inna akcja;
- `UNKNOWN`: niewystarczająca treść.

Bez tool calli AI może zwrócić `RESPOND`, `MANAGE_CONTEXT` lub `UNKNOWN`.
Brak przechwyconego tekstu i calli wymaga `UNKNOWN`. Samo zdarzenie kompaktowania
nie dowodzi treści odpowiedzi, sukcesu ani odrębnego rozliczonego wywołania.

Możliwości definicji pozostają oddzielnym wymiarem: `DATA_ACCESS`, `ANALYSIS`
(analiza wykonywana przez specjalistyczne narzędzie), `MODIFICATION`,
`VALIDATION`, `EXECUTION`, `EXTERNAL`, `COORDINATION`, `OTHER`.
Specjalizacja: `GENERAL_PURPOSE`, `DOMAIN_SPECIFIC`, `TASK_SPECIFIC`, `UNKNOWN`.
Dopasowanie: `DIRECT`, `SUPPORTING`, `WEAK`, `UNKNOWN`; bez celu wymagane
jest `UNKNOWN`. Narzędzie uniwersalne może być dobrze dopasowane.

Backend odrzuca brakujące/powtórzone/obce ID, obce lub zduplikowane kategorie,
niezgodny zbiór akcji rundy, niekompletne dowody, dodatkowe pola, powtórzone
klucze JSON i niepoprawne dopasowanie przy braku celu. Uzasadnienie ma do 600 znaków.
Odpowiedź zawiera `tools`, `assessments`, `rounds`; agentów podsumowujemy
deterministycznie. Nie ponawiamy automatycznie płatnego zapytania.

## Powiązania, cykle i interpretacja credits

`model-action-evidence.ts` lokalnie łączy:
1. żądanie M → A i wykonanie po dokładnym call ID, w tym samym epizodzie i trace;
2. wynik o tym call ID i wszystkie późniejsze inputy modelu, które go zawierają;
3. wykonanie i potwierdzone dziecko według istniejących relacji workflow.

Brak ID, sprzeczne żądania o tym samym ID, wielokrotne wykonania albo niezgodna
nazwa oznaczają brak jednoznacznego powiązania. Nie łączymy wyłącznie po czasie.
Odbiór wyniku może być potwierdzony bez spanu wykonania; sam zapis wyniku wykonania
nie dowodzi, że model go odebrał. Wiele odbiorów może oznaczać zachowanie historii,
nie ponowne wykonanie narzędzia.

Prezentacja układa interakcję jako wejście użytkownika, pierwsze wywołanie modelu,
serię cykli `M → A → M` i końcową odpowiedź. Odpowiedź modelu rozpoczyna cykl:
model żąda akcji, agent wykonuje narzędzie, a wynik może wejść do następnego requestu
modelu. Delegacja jest takim samym tool callem; praca subagenta i jego pełny zwrot
znajdują się wewnątrz cyklu rodzica.

Surowe credits pozostają przy konkretnym wywołaniu modelu, które je wyemitowało.
Kategoria wcześniejszej lub bieżącej odpowiedzi nie staje się przez to źródłem
zmierzonego kosztu. Estymacja opisana niżej przypisuje odpowiedzialność za koszt
wywołań, ale nie odtwarza sposobu naliczania AIU przez dostawcę. Dla powiązanego
wyniku odróżniamy pierwszy potwierdzony odbiór od dalszej obecności w historii.
Powtórzenie wyniku nie dowodzi ponownego wykonania narzędzia; może jednak zwiększać
koszt kolejnych requestów przez obecność w ich kontekście.

### Estymacja przypisania credits do kategorii

Mapa może pokazać proporcjonalne przypisanie, ale zawsze oznacza je znakiem `≈`.
Dla wywołania z wyemitowanymi credits `C`, inputem `I` i outputem `O` najpierw
liczymy `C_input = C × I / (I + O)` oraz `C_output = C - C_input`. Nie dodajemy
osobno reasoning ani cache read. Jeżeli brakuje inputu, outputu albo credits,
wywołanie pozostaje poza estymacją i zwiększa licznik brakującego pokrycia.

Część wyjściową w całości przypisujemy kategoriom żądań obecnych w odpowiedzi
modelu. Część wejściową w całości przypisujemy kategoriom wyników odnalezionych
w przechwyconym inpucie po dokładnym call ID. Dzięki temu koszt przetworzenia
wyniku odczytu lub wyszukiwania pojawia się przy tej kategorii w następnym
wywołaniu modelu, a koszt utworzenia żądania zapisu pozostaje w outputcie
bieżącego wywołania. Pierwszy odbiór i dalszą retencję wyniku pokazujemy osobno.

Jeżeli w jednej części występuje kilka żądań lub wyników, ich względne wagi
szacujemy jako `liczba znaków / 4,25`, a następnie normalizujemy tak, aby razem
otrzymały 100% odpowiedniej części credits. Gdy jedno żądanie ma kilka kategorii,
jego udział dzielimy między nie równo; AI nie wyznacza wag kosztowych.

`Poza kategoriami` pozostaje tylko część wywołania, dla której nie ma dowodu
pozwalającego przypisać kategorię, na przykład input pierwszego wywołania agenta.
Dzięki temu zachodzi: `wyemitowane credits = kategorie + poza kategoriami`.
Brak danych nie jest zerem.

Credits wywołań subagentów są rozdzielane według ich własnych sklasyfikowanych
akcji. Przy kategorii delegacji pokazujemy dodatkowo dokładną znaną sumę drzewa
subagenta jako roll-up. Nie dodajemy jej ponownie do sumy kategorii.

Rekomendacje alternatyw, dostępność/załadowanie skilli i indeksów oraz oszczędności
wymagają kolejnego etapu. Obecna ocena nie dowodzi złego wyboru narzędzia.

## Runtime i konfiguracja

Backend używa `com.github:copilot-sdk-java:1.0.11` z Copilot CLI `1.0.55` lub
nowszym, jednego promptu i jednego
tekstu końcowej odpowiedzi. Nie potrzebuje Spring AI, custom tools, MCP ani skilli.
Stosujemy tryb `EMPTY`, pustą allowlistę, odmowę tool hook/permissions, wyłączone
skills/discovery/memory/session store oraz osobny katalog runtime. SDK mapuje część
opcji konfiguracyjnych na żądanie protokołu; test sprawdza rzeczywisty obiekt
`CreateSessionRequest`, w tym pustą allowlistę i wyłączone discovery.

Skopiuj `config/application.properties.example` do `config/application.properties`
i ustaw `agent-scanner.ai.github-token`, `agent-scanner.ai.model` oraz w razie
potrzeby `agent-scanner.ai.cli-path`. Używaj ścieżki executable, na Windows np.
`C:/tools/copilot/copilot.exe`. Ten lokalny plik jest ignorowany przez Git.
Identyfikator modelu musi pochodzić z listy zwróconej dla danego konta; nazwa
modelu używana przez inną aplikację lub środowisko nie potwierdza dostępności w CLI.
Alternatywy środowiskowe: `COPILOT_GITHUB_TOKEN`, `AGENT_SCANNER_AI_MODEL`,
`AGENT_SCANNER_COPILOT_CLI`. Po zmianie konfiguracji uruchom backend ponownie.

Token i model muszą być jawnie skonfigurowane. Brak konfiguracji nie blokuje
odbiornika OTLP. Standardowy runtime Copilota jest zdalny; kliknięcie przycisku
wysyła opisany zakres danych i może zużyć limit konta. Przechwycone opisy/cel są
niezaufanymi danymi, a prompt nie zastępuje wyłączenia narzędzi w SDK.

Wykonanie ma ograniczony czas i jeden worker bez kolejki płatnych zadań.
Po timeout/błędzie wywoływane jest abort i sprzątanie klienta. Zwalidowany wynik jest
zapisywany w H2 dla sesji oraz skrótu obejmującego wersję reguł, model i kanoniczny
zakres analizy. Ponowne wejście lub odświeżenie widoku wykonuje lokalny odczyt wyniku.
Zmiana treści, modelu albo wersji reguł wymusza nową analizę. Radio
**Kategorie / Fakty** zmienia wyłącznie prezentację. Oceny nie są dopisywane do
surowej telemetrii ani formatu eksportu i usuwają się kaskadowo razem z sesją.

Wersja `model-actions-v5` nie odczytuje analiz `model-actions-v4` ani
`workflow-semantics-v3` jako nowych kategorii. Po aktualizacji potrzebne jest jedno
jawne wyznaczenie klasyfikacji; dawne rekordy pozostają w bazie pod poprzednim hashem.

## Estymacja tokenów

Tooltip podaje orientacyjny input, typowy output i dłuższy wariant odpowiedzi.
Używa liczby znaków serializowanego zakresu, stałego narzutu promptu, liczby
definicji/żądań/rund i długości uzasadnień. Przeliczenie znaków/4 zaokrąglone
w górę do 100 nie jest gwarantowanym limitem tokenów. Nie obejmuje niewidocznego
narzutu runtime ani ewentualnego reasoning modelu.

## API i weryfikacja

- `GET /api/ai/tool-classification/status`: gotowość konfiguracji, model i zajętość;
  bez tokena i bez uruchamiania runtime.
- `POST /api/ai/tool-classification/cached?sessionId={id}`: lokalny odczyt wyniku dla
  identycznego zakresu; `204` oznacza brak zapisanej analizy.
- `POST /api/ai/tool-classification?sessionId={id}`: obiekt `tools` + `agents` +
  `contexts[].rounds[].invocations`;
  asynchroniczna
  odpowiedź HTTP z wersją, modelem, czasem oraz zwalidowanymi wynikami.
- Limity: 200 definicji, 100 agentów i kontekstów, 500 rund na kontekst i 500 żądań na rundę,
  180 000 znaków danych promptu; nie obcinamy
  po cichu przekroczonego zakresu.

Testy syntetyczne pokrywają deduplikację, wersje, brak definicji/celu, oddzielne
zlecenia dziecka, mapowanie UI, błędy i walidację odpowiedzi. Testy zwykłego buildu
nie wykonują płatnego requestu. Test inference wymaga zainstalowanego CLI, tokena
i modelu dostępnego dla konta; sama kompilacja nie potwierdza tej ścieżki.

Playbook runtime: [GitHub Copilot SDK Java](github-copilot-sdk-local-java-spring-ai.md).
