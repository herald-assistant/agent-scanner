# Funkcje AI — kontrakty i runtime

Status: obowiązujący kontrakt.

[Dokumentacja](README.md)

Wiążąca część [AGENTS.md](../AGENTS.md). Ten dokument opisuje istniejące funkcje
AI: klasyfikację, doradztwo i rozmowę. Ustawienia są w [konfiguracji](konfiguracja.md),
a ścieżki HTTP w [API](api.md).

## Spis treści

- [Granice wykonania](#granice-wykonania)
- [Klasyfikacja działań](#klasyfikacja-działań)
- [Doradztwo i podgląd dowodów](#doradztwo-i-podgląd-dowodów)
- [Rozmowa o sesji](#rozmowa-o-sesji)
- [Wersje i cache](#wersje-i-cache)

## Granice wykonania

AI uruchamia się wyłącznie po jawnej akcji użytkownika. Otwarcie AI Hub,
odczyt cache, historii albo przygotowanie podglądu nie wywołują modelu.
Katalog modeli korzysta z runtime/usługi bez inferencji. Klasyfikacja, doradztwo
i rozmowa współdzielą `AiExecutionCoordinator`: jeden worker, bez kolejki
płatnych zadań. Zajętość jest jawna. Nie ponawiaj automatycznie płatnych żądań.

`CopilotCompletion` korzysta z GitHub Copilot Java SDK i kontrolowanego procesu
CLI. Klasyfikacja i doradztwo są izolowanymi sesjami tekstowymi: tryb `EMPTY`,
pusta allowlista, odmowa tool hook/permissions oraz wyłączone skille, MCP,
instrukcje repozytorium, discovery, pamięć i Git. Zapis stanu służący wznowieniu
dotyczy wyłącznie rozmowy. Test izolacji sprawdza rzeczywisty `CreateSessionRequest`,
nie tylko konfigurację pośrednią. Runtime używa osobnego katalogu danych.

Token jest backendowy, nie trafia do odpowiedzi ani logów. Dane z telemetrii
są niezaufane; prompt nie zastępuje wyłączenia uprawnień. Rozmowa może używać
wyłącznie ograniczonych odczytów `scanner_*`, opisanych niżej. Treść wysyłana
do modelu opuszcza komputer i może zużywać limit konta Copilot.

Każde wykonanie ma timeout, obsługę przerwania i sprzątanie klienta przez
`forceStop()`. Zwykłe testy i startup nie uruchamiają inferencji. Sam build nie
potwierdza działania tokena ani usługi. Przy błędzie `connect/runtime.shutdown`
sprawdź zgodność CLI/SDK i ścieżkę executable; nie zastępuj lifecycle ręcznym RPC
ani ignorowaniem autoryzacji.

## Klasyfikacja działań

### Przedmiot klasyfikacji

Ocenie podlega **akcja żądana w odpowiedzi modelu (M → A)**. Cel „analiza
architektury” i tool call odczytujący lub wyszukujący treść dają kategorię
pozyskania danych. Wynik wykonania,
następna runda, uruchomiony subagent ani zdarzenie kompaktowania nie służą
do klasyfikacji tej odpowiedzi. Żądanie delegacji jest oceniane również wtedy,
gdy wykonanie lub dziecko nie zostało przechwycone.

Jednoznacznie powiązane wywołania kompaktora pozostają całkowicie poza zapytaniem
AI. Po otrzymaniu klasyfikacji frontend dodaje je lokalnie jako faktyczną kategorię
`Kompaktowanie kontekstu`, korzystając wyłącznie z ich wyemitowanych credits i
położenia na granicy interakcji. W AI Hub jest to osobna pozycja w podziale
credits; nie zmienia kategorii odpowiedzi modelu.

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
w kilku licznikach akcji; to nie jest rozłączny podział rund. Grupowanie
sąsiednich rund z identycznym zbiorem akcji jest deterministycznym modelem faz,
nie warstwą faktograficznej Mapy pracy.
Model faz porządkuje rundy głównego agenta i jednoznacznie powiązanych subagentów.
Sama zmiana agenta nie rozdziela fazy. Zachowuje etykiety rund, sumuje ich pełne
zmierzone credits i pokazuje pokrycie; brak pomiaru pozostaje `—`.

AI Hub prezentuje estymowany udział credits dla wybranej interakcji oraz
pokrycie pomiarów. Nie należy go utożsamiać z odsetkiem odpowiedzi mających daną
kategorię: odpowiedź może mieć wiele akcji, a credits są dzielone według osobnej
formuły opisanej niżej.

### Zakres zapytania

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

### Kategorie i walidacja

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

### Powiązania, cykle i interpretacja credits

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

#### Estymacja przypisania credits do kategorii

AI Hub pokazuje proporcjonalne przypisanie credits kategoriom AI i oznacza je
znakiem `≈`.
Dla wywołania z wyemitowanymi credits `C`, inputem `I` i outputem `O` najpierw
liczymy `C_input = C × I / (I + O)` oraz `C_output = C - C_input`. Nie dodajemy
osobno reasoning ani cache read. Wymagane jest `I + O > 0`.
Jeżeli brakuje inputu, outputu albo credits,
wywołanie pozostaje poza estymacją i zwiększa licznik brakującego pokrycia.

Część wyjściową w całości przypisujemy kategoriom żądań obecnych w odpowiedzi
modelu. Część wejściową pierwszego wywołania modelu głównego w wybranej
interakcji pokazujemy osobno jako estymowaną pozycję `Inicjalna wiadomość`.
Obejmuje ona cały input tego wywołania: tekst użytkownika, instrukcje, definicje
narzędzi i pozostały kontekst startowy; telemetria nie pozwala wydzielić kosztu
samego tekstu użytkownika. Część wejściową kolejnych wywołań w całości
przypisujemy kategoriom wyników odnalezionych
w przechwyconym inpucie po dokładnym call ID. Dzięki temu koszt przetworzenia
wyniku odczytu lub wyszukiwania pojawia się przy tej kategorii w następnym
wywołaniu modelu, a koszt utworzenia żądania zapisu pozostaje w outputcie
bieżącego wywołania. Pierwszy odbiór i dalszą retencję wyniku pokazujemy osobno.

Jeżeli w jednej części występuje kilka żądań lub wyników, ich względne wagi
szacujemy jako `liczba znaków / 4,25`, a następnie normalizujemy tak, aby razem
otrzymały 100% odpowiedniej części credits. Gdy jedno żądanie ma kilka kategorii,
jego udział dzielimy między nie równo; AI nie wyznacza wag kosztowych.

`Poza kategoriami` pozostaje tylko część wywołania agenta, dla której nie ma dowodu
pozwalającego przypisać kategorię, z wyłączeniem osobno pokazanej
`Inicjalnej wiadomości`.
Credits jednoznacznie powiązanych kompaktowań są następnie dodawane do wspólnego
mianownika jako osobna, deterministyczna kategoria. Jej procent nie ma znaku `≈`,
ponieważ jest ilorazem wyemitowanych credits kompaktora i wszystkich znanych
credits zestawienia. Dzięki temu zachodzi: `wyemitowane credits = inicjalna
wiadomość + estymowane kategorie działań + kompaktowanie + poza kategoriami`.
Brak danych nie jest zerem.

Credits wywołań subagentów są rozdzielane według ich własnych sklasyfikowanych
akcji. Przy kategorii delegacji pokazujemy dodatkowo dokładną znaną sumę drzewa
subagenta jako roll-up. Nie dodajemy jej ponownie do sumy kategorii.



### Estymacja tokenów

Tooltip podaje orientacyjny input, typowy output i dłuższy wariant odpowiedzi.
Używa liczby znaków serializowanego zakresu, stałego narzutu promptu, liczby
definicji/żądań/rund i długości uzasadnień. Przeliczenie znaków/4 zaokrąglone
w górę do 100 nie jest gwarantowanym limitem tokenów. Nie obejmuje niewidocznego
narzutu runtime ani ewentualnego reasoning modelu.

Lokalna liczba definicji, agentów, kontekstów, rund, żądań i znaków nie jest bramką
analizy. Jawne skracanie poszczególnych pól pozostaje częścią kontraktu redakcji;
cały poprawny zakres podlega rzeczywistemu oknu kontekstowemu modelu egzekwowanemu
przez dostawcę. Nie zastępuj tego limitu licznikiem znaków.

## Doradztwo i podgląd dowodów

Dla konkretnej fazy albo dokładnie jednego kompaktowania przycisk **Przygotuj
podgląd dla AI** najpierw tworzy lokalną migawkę
`optimization-advice-v1`. Podgląd pokazuje zakres, fingerprint, liczbę źródeł,
fakty, wyliczenia, wcześniejszą klasyfikację, braki, pominięcia, rozmiar oraz
szacowany input. Instrukcje system/developer i jawne reasoning są usuwane, a
rozpoznane tokeny i sekrety redagowane. Można obejrzeć dokładny JSON lub
odświeżyć migawkę. Lokalny endpoint `prepare` sprawdza wersje, techniki,
metryki i przynależność każdego źródła do sesji, potwierdza span w utrwalonym raw
signal oraz hash pełnego rekordu znormalizowanego, po czym zapisuje niezmienny
podgląd na 30 minut. UI wyraźnie odróżnia ten stan od wysłania do AI.

Dla wielorundowej fazy `guidance-evidence-v2` nie kopiuje siedmiu referencji
metrycznych i całej narastającej historii dla każdej rundy. Każda wybrana runda
ma jeden zwarty, backendowo weryfikowany rekord kosztu, a kategoria AI zachowuje
pochodzenie na poziomie pola. Treść pochodzi z reprezentatywnych rund całej fazy
(początek, koniec, najwyższe znane credits oraz najwięcej tooli lub potwierdzony
błąd), definicje są deduplikowane, a manifest grupuje pominięcia według rodzaju.
Liczba rund, obserwacji, referencji, fragmentów ani znaków nie blokuje analizy.
Próbkowanie ogranicza szum, ale jest regułą redakcji, nie bramką wysyłki. Scanner
nie udaje tokenizera przez przeliczanie znaków na twardy limit: dopiero rzeczywiste
okno kontekstowe skonfigurowanego modelu, egzekwowane przez dostawcę, może odrzucić
pełny prompt jako zbyt duży.

Dopiero przycisk **Wyślij do AI** uruchamia osobne doradztwo. Frontend wysyła
wyłącznie `previewId`; backend odczytuje zamrożony pakiet, ponownie sprawdza jego
ważność oraz niezmienność źródeł i wykonuje jedną izolowaną turę bez narzędzi,
skilli, instrukcji repozytorium i pamięci. Wynik wskazuje 1–3 techniki do
przetestowania albo jawnie zwraca brak wystarczających dowodów/brak pasującej
techniki. Każda propozycja pokazuje warunki, mały eksperyment, wdrożenie,
utrzymanie, kontrolę jakości, porównanie przed/po, ograniczenia i linki do
dokładnych rund. Scanner nie obiecuje oszczędności, a koszt własnego wywołania
doradcy pozostaje „brak pomiaru”. Klasyfikacja oraz doradztwo współdzielą jeden
globalny slot inferencji.

Pakiet przechowuje fakty wyemitowane, wyliczenia deterministyczne, wcześniejszą
klasyfikację AI i braki jako różne typy pochodzenia. Wspierający request następnej
rundy jest dołączany wyłącznie poza wybranym zakresem i jawnie oznaczany.
Kompaktowanie dostaje pomiary przed/po tylko po potwierdzonym odbiorze wyniku.
Referencja zawiera raw signal ID, trace/span ID i hash pełnego znormalizowanego
źródła (atrybuty, zdarzenia oraz wiadomości spanu). Backend odrzuca zmianę źródła,
obcą sesję, brak spanu w raw signal, niezgodną metrykę i konflikt wersji. Zwrot
`RAW_AND_NORMALIZED` oznacza lokalną walidację dowodu, a nie wynik inferencji.
Sam podgląd, status i lookup cache nie uruchamiają modelu. Wynik AI zachowuje
wersję promptu `optimization-advice-prompt-v1`, model, request hash i fingerprint.
Stany `INSUFFICIENT_EVIDENCE` oraz `NO_SUITABLE_TECHNIQUE` są poprawnymi
odpowiedziami, nie awariami.


Źródła: [pakiet frontendu](../frontend/src/app/core/optimization/guidance-evidence.ts)
i [backend doradztwa](../src/main/java/dev/agentscanner/ai/advisory).
Współdzielenie slotu, powtórny lookup cache i rewalidacja źródeł obowiązują przed
inferencją i zapisem. Wspierający następny request jest jawnie oznaczony poza
wybranym zakresem. Wynik jest hipotezą eksperymentu, nie pomiarem oszczędności.

## Rozmowa o sesji

```text
AI Hub → „Nowa rozmowa”, „Kontynuuj ostatnią” lub historia
  → cała sesja zamrożona do cutoffSignalId
  → mały bootstrap z backendu
  → wybór modelu z katalogu SDK
  → zapis rozmowy bez inferencji
  → jawne „Rozpocznij rozmowę”
  → przejęcie wspólnego AiExecutionCoordinator
  → pierwsza tura: createSession + bootstrap + pytanie
  → następne tury: resumeSession + nowe pytanie
  → celowane wywołania tylko scanner_* nad wspólnym SessionAnalysisQueryService
  → ścisła walidacja odpowiedzi i evidence ledger
  → ponowna kontrola zamrożonego źródła i zapis odpowiedzi w H2
```

Bootstrap zawiera wyłącznie orientację w sesji i konfiguracji. Interakcję lub rundę
użytkownik wskazuje naturalnym językiem w wiadomości.
Dokładne requesty, odpowiedzi, tool calls, konfiguracja, koszty i subagenci są
pobierani na żądanie przez ograniczone custom tools. Handlery mają scope zamknięty
na serwerze i nie przyjmują `sessionId`. Repozytorium, terminal, built-in tools,
MCP, skille, pamięć, discovery, dostęp do systemu plików hosta i custom agents
obserwowanej sesji są wyłączone. Każde wywołanie i
ograniczony wynik są audytowane, a evidence ref może pojawić się w odpowiedzi
wyłącznie wtedy, gdy bootstrap lub tool faktycznie dostarczył go modelowi.

### Kontrakt HTTP

Pełną listę ścieżek zawiera [API](api.md). Istotne body żądań:

```json
{"model": "ID_MODELU_DOSTEPNEGO_DLA_KONTA"}
```

Tworzy lokalną rozmowę dla `sessionId`, bez inferencji. Tura zawiera pytanie
do 4000 znaków i identyfikator żądania klienta:

```json
{"question": "Co spowodowało wzrost inputu w M3?", "clientRequestId": "00000000-0000-4000-8000-000000000001"}
```

`ChatView` udostępnia między innymi `cutoffSignalId`, `contextHash`, bootstrap,
historię tur, ich wywołania narzędzi oraz `newerTelemetryAvailable`.
Nowe sygnały nie rozszerzają istniejącego chatu. Nie ma `focus`, `focusDigest`
ani osobnego zakresu zaznaczonych rund.

### Narzędzia i granice odczytu

| Narzędzie SDK | Wspólny odczyt `analysis-data` |
|---|---|
| `scanner_get_session_overview` | `overview` |
| `scanner_get_configuration` | `configuration` |
| `scanner_list_interactions` | `interactions` |
| `scanner_list_rounds` | `rounds` |
| `scanner_get_round_evidence` | `round-evidence` |
| `scanner_get_subagent_tree` | `subagents` |
| `scanner_get_cost_summary` | `cost` |
| `scanner_search_session` | `search` |

REST tworzy zakres przy odczycie, a narzędzia rozmowy korzystają z utrwalonego
zakresu chatu. Wspólna usługa nie oznacza, że późniejszy odczyt REST automatycznie
ma ten sam cutoff co wcześniejsza rozmowa.

Odczyty są stronicowane i ograniczone, a pominięcia oraz redakcja są jawne.
Parametry narzędzi nie pozwalają modelowi wybrać obcej sesji. Dokładne limity
i schematy definiują klasy wskazane niżej; nie są obietnicą wysłania całego raw
payloadu w jednym wyniku. Każdy zwrócony wynik jest zapisywany w audycie.

### Walidacja i lifecycle

Odpowiedź ma status `ANSWER`, `CLARIFICATION_NEEDED`, `INSUFFICIENT_EVIDENCE`
albo `OUT_OF_SCOPE`, tekst `answerMarkdown`, dowody, hipotezy, ograniczenia
i propozycje dalszych pytań. Evidence ledger dopuszcza wyłącznie referencje
faktycznie udostępnione modelowi. Wyjaśnienie AI nie staje się polem telemetrii.

Klient i proces CLI są sprzątane po turze; zapisany identyfikator sesji SDK
umożliwia jej wznowienie. Klasyfikacja, doradztwo i rozmowa korzystają ze wspólnego
`AiExecutionCoordinator`. Odczyt historii nie uruchamia modelu. Usunięcie rozmowy
usuwa lokalny audyt i podejmuje próbę sprzątnięcia stanu SDK.

### Źródła w kodzie

- [DTO rozmowy](../src/main/java/dev/agentscanner/ai/sessionchat/SessionChat.java).
- [Lifecycle i audyt](../src/main/java/dev/agentscanner/ai/sessionchat/SessionChatService.java).
- [Schematy i ograniczanie narzędzi](../src/main/java/dev/agentscanner/ai/sessionchat/SessionAnalysisToolFactory.java).
- [Wspólne odczyty i redakcja](../src/main/java/dev/agentscanner/analysis/SessionAnalysisQueryService.java).
- [Walidacja odpowiedzi](../src/main/java/dev/agentscanner/ai/sessionchat/SessionChatAnswerValidator.java).
- [Testy backendu](../src/test/java/dev/agentscanner).

Obowiązuje wyłącznie rozmowa o całej zamrożonej sesji. Usunięty eksperymentalny
kontrakt rozmowy o rundach nie ma obsługi zgodności ani migracji.

## Wersje i cache

| Kontrakt | Identyfikator |
|---|---|
| Klasyfikacja | `model-actions-v5` |
| Pakiet dowodów doradztwa | `guidance-evidence-v2` |
| Żądanie i wynik doradztwa | `optimization-advice-v1` |
| Prompt doradztwa | `optimization-advice-prompt-v1` |
| Bootstrap rozmowy | `session-chat-bootstrap` |
| Narzędzia rozmowy | `session-analysis-tools` |
| Redakcja rozmowy | `guidance-redaction` |
| Prompt rozmowy | `session-analysis-chat-prompt` |

Ostatnie cztery identyfikatory nie mają przyrostka `-v1`; nie dopisuj go na podstawie
konwencji innych kontraktów. Wersje definiują klasy backendu.

Klasyfikacja ma klucz obejmujący sesję i SHA-256 wersji, modelu oraz kanonicznego
requestu. Zmiana definicji, argumentów, celu, rundy lub modelu daje cache miss.
Nie odczytuj `model-actions-v4` ani `workflow-semantics-v3` jako nowych kategorii;
dawne rekordy mogą pozostać pod starym hashem. Doradztwo dodatkowo wiąże wynik
z fingerprintem podglądu i wersją promptu. Zmiana semantyki wymaga wersji/hash
i regresji walidatora. Wyniki są walidowane przed zapisem w H2, pozostają oddzielone
od raw i eksportu v1 oraz usuwają się razem z sesją. Usunięcie klasyfikacji
przyjmuje dokładny request i nie usuwa telemetrii.

Źródła klasyfikacji: [katalog](../frontend/src/app/core/flow-tool-catalog.ts),
[atrybucja](../frontend/src/app/core/action-credit-attribution.ts),
[Quick Analysis](../frontend/src/app/core/ai-quick-analysis.ts),
[walidacja i zapis](../src/main/java/dev/agentscanner/ai/ToolClassificationService.java).
