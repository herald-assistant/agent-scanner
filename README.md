# Agent Scanner

Agent Scanner jest lokalnym odbiornikiem i przeglądarką telemetrii OpenTelemetry
emitowanej przez agentów GitHub Copilot w VS Code.

Aplikacja nie jest proxy dla modelu, nie skanuje repozytorium i nie rekonstruuje
danych, których runtime nie wyemitował. Zachowuje natomiast surowy sygnał OTLP,
aby każdą wartość prezentowaną w UI dało się porównać ze źródłem.

## Szybki start

Wymagane do budowania całej aplikacji są JDK 17+ i Maven. Maven pobiera własny
Node.js 22.22.3 i npm na potrzeby produkcyjnego buildu frontendu.

```powershell
mvn clean package
java -jar target/agent-scanner.jar
```

Po uruchomieniu otwórz `http://localhost:8081`.

## Podłączenie GitHub Copilot

Scanner przyjmuje OTLP/HTTP pod adresem `http://localhost:8081`. W VS Code należy
włączyć przechwytywanie treści, jeżeli UI ma pokazywać prompty, odpowiedzi modelu,
definicje narzędzi oraz argumenty tool calli.

### VS Code

1. Naciśnij `Ctrl+Shift+P`.
2. Uruchom `Preferences: Open User Settings (JSON)`.
3. Wstaw poniższe właściwości do istniejącego głównego obiektu JSON.
4. Przeładuj okno VS Code i rozpocznij nową interakcję z agentem Copilot.

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.protocol": "http/protobuf",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:8081",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}
```

To jest kompletny, poprawny obiekt JSON. Jeżeli `settings.json` ma już inne
właściwości, przenieś do niego same pary klucz–wartość bez tworzenia drugiego
obiektu głównego.

### Sprawdzenie połączenia

Po wykonaniu nowej interakcji status w nagłówku zmieni się na „Ostatnio odebrano
telemetrię”, a sesja pojawi się na liście. Ten status oznacza, że Scanner ma w
bazie co najmniej jeden odebrany sygnał; nie jest testem żywego połączenia z IDE.

Stan odbiornika można również sprawdzić przez API:

```powershell
Invoke-RestMethod http://localhost:8081/api/status
```

## Jak czytać dane

Szczegółowa propozycja deterministycznej klasyfikacji faz pracy, stanu kontekstu,
anomalii i profili subagentów znajduje się w dokumencie
[Deterministyczna klasyfikacja faz pracy i profili subagentów](docs/deterministyczna-klasyfikacja-faz-i-subagentow.md).

- **Sesja** jest grupowana po `gen_ai.conversation.id`.
- **Interakcja użytkownika** odpowiada osobnemu trace'owi i zwykle zaczyna się od
  spanu `invoke_agent`.
- **Runda** jest jednym spanem `chat`: agent wysyła request do modelu, model zwraca
  tekst i opcjonalne żądania narzędzi, a wyniki narzędzi mogą wejść do kolejnej
  rundy.
- **Subagent** może mieć własną sesję i własne wywołania modelu. Scanner wiąże go
  z tool callem uruchamiającym za pomocą `gen_ai.tool.call.id`, jeśli taki związek
  został wyemitowany.

Najważniejsze metryki:

- `input` — cały input naliczony dla requestu;
- `cache read` — część inputu odczytana z cache;
- `nowy input` — `max(0, input - cache read)`;
- `cache write` — wyłącznie wartość jawnie wyemitowana przez runtime;
- `output` — tokeny odpowiedzi modelu, w tym decyzje o użyciu narzędzi zgodnie z
  raportowaniem providera;
- `reasoning` — osobna metryka telemetryczna; UI nie dodaje jej ponownie do
  outputu. Tooltip pokazuje `copilot_chat.reasoning_content`, jeśli provider
  wyemitował użyteczną treść; znacznik szyfrowania lub brak pola jest opisany jako
  brak dostępnej treści, bez rekonstruowania rozumowania;
- `TTFT` — czas do pierwszego tokenu;
- `credits` — `copilot_chat.copilot_usage_nano_aiu / 1 000 000 000`; jest to
  zużycie GitHub Copilot AI credits, nie kwota pieniężna.

Ręczne kompaktowanie VS Code może zostać wyemitowane w osobnym trace jako
`summarizeConversationHistory-full`. Scanner przypisuje takie wywołanie do rozmowy
przede wszystkim po jej dokładnym identyfikatorze obecnym w inputcie kompaktora.
Jeśli późniejszy request nie został jeszcze wyemitowany, kompaktowanie nadal jest
widoczne na końcu osi wraz z pełnym kosztem. Kliknięcie zwartej belki otwiera prawy
panel, w którym „Co zlecono modelowi” obejmuje zarówno systemowe zasady i format
rezultatu, jak i polecenie konkretnego kompaktowania oraz dodatkową instrukcję
użytkownika. Dalej dostępne są messages, tools, wynik oraz — gdy da się to
potwierdzić — jego użycie w kolejnym requeście. Model użyty do kompaktowania jest
widoczny na belce i w panelu; brak nazwy pozostaje oznaczony jako brak danych.
Koszt nie jest dodawany do głównych rund.

Górny bilans `Cała sesja` sumuje rozłącznie agenta głównego, jednoznacznie
powiązanych subagentów oraz kompaktowania. Pod nim znajduje się początkowo zwinięte
`Rozliczenie kosztu`: agent główny, kolejne subagenty i kolejne kompaktowania mają
te same kolumny `Nowy input`, `Input z cache`, `Cache write`, `Output`, `Czas modeli`
i `Credits`. Czas całej sesji wraz z przerwami pozostaje osobno w nagłówku.

Bezpośrednio pod bilansem znajduje się globalne zestawienie **Potencjalne
usprawnienia · bez AI**. Dla głównego agenta i dokładnie powiązanych subagentów
rozdziela narzędzia na zakładki `Niewykorzystane` i `Wykorzystane`. Pokazuje nazwę
narzędzia, liczbę requestów z przechwyconą definicją, liczbę użyć oraz orientacyjną
liczbę tokenów treści definicji i żądań `M → A`. Dla wyników odnalezionych po
dokładnym call ID pokazuje osobno pierwszy odbiór `A → M`, liczony raz dla każdego
wywołania, oraz późniejsze wystąpienia przed najbliższym kompaktowaniem sesji.
Ich udział w cache read jest szacowany dla każdego późniejszego requestu jako
`≈ tokeny wyniku × wyemitowany cache read / wyemitowany input łącznie`. Pokrycie
metryką jest widoczne, a jej brak pozostaje znakiem `—`. Narzędzie jest
oznaczone jako niewykorzystane tylko wtedy, gdy output wszystkich requestów, w
których bezpośrednio zaobserwowano jego definicję, został przechwycony. Niepełne
pokrycie pozostaje nieustalone. Nie ma kolumny sumującej wywołania i wyniki, ponieważ
ukrywałaby większą wagę outputu. Kolejność ustala wyłącznie pomocniczy wskaźnik:
`≈ tokeny inputu + 10 × ≈ tokeny outputu`; definicje, pierwszy odbiór wyników i
osobna estymacja późniejszego cache są w nim inputem, a żądania narzędzia zwrócone
przez model — outputem. Zakładka niewykorzystanych wyjaśnia, że przesłane
definicje są częścią inputu uwzględnianego w zużyciu GitHub Copilot AI credits,
oraz wskazuje konsolę pracy z agentem w VS Code i listy `tools`/toolsetów w
konfiguracji agenta jako miejsca do przeprowadzenia eksperymentu. Estymacja definicji
liczy każde przechwycone przesłanie i używa proporcji jej znaków w requestcie do
wyemitowanego `input_tokens`; przy braku pełnych danych przechodzi na kalibrację
modelu, a ostatecznie `4,25 znaku/token`. Pokazana liczba jest już sumą estymacji
ze wszystkich rund, w których definicja była dostępna, i nie wymaga ponownego
mnożenia przez liczbę rund. Wartość ma kolor cache read, ponieważ
powtarzane definicje są obszarem do sprawdzenia, ale telemetria nie dowodzi, że
provider umieścił konkretną definicję w cache. Także estymacja późniejszych wyników
nie dowodzi, że provider umieścił konkretny fragment w cache. Wszystkie wartości per
tool mają znak `≈`: służą
do wskazania miejsc, gdzie warto sprawdzić ograniczenie zestawu narzędzi, skrócenie
wyniku albo bardziej celowaną alternatywę, ale nie dowodzą oszczędności i nie są
rachunkiem providera. Karta jest początkowo zwinięta. Po rozwinięciu wszystkie
wiersze używają tej samej białej ikony narzędzia, a stan `Niewykorzystane` wyróżnia
czerwony pill zamiast ikony wyłącznika. Kliknięcie nazwy lub ikony otwiera modal
wszystkich przechwyconych wersji definicji. Modal pokazuje opis, typ i wymaganie
każdego parametru oraz wartości enum; pełny kanoniczny JSON pozostaje dostępny w
zwijanej sekcji. Narzędzie znane wyłącznie z wywołania pokazuje jawny brak definicji.
Dla wykorzystanych narzędzi osobna kolumna pokazuje liczbę potencjalnych powtórzeń:
każde kolejne wywołanie tej samej nazwy z identycznymi, kanonicznie porównanymi
parametrami w całej powiązanej sesji. Granic agentów ani kompaktowania nie traktujemy
jako resetu porównania, a wywołania bez przechwyconych parametrów są pomijane. Wartość ponad
zero jest czerwona. Modal rozbija ją na przypadki między strumieniami agentów i po
kompaktowaniu oraz na rozłączne stany rezultatu: identyczny, inny lub nieprzechwycony,
ustalane tylko z jednoznacznego call ID. Pokazuje też etykiety rund `M…` i `S…:M…`.
Przy porównaniu pojedyncza transportowa tablica części tekstowej jest równoważna
temu samemu stringowi; sama treść, kolejność linii i pozostałe struktury nie są
normalizowane. Dla każdego powtarzanego zestawu modal pokazuje również pełne
kanoniczne parametry wejściowe, rundę pierwszego wywołania, rundy powtórzeń i ich
liczbę; długi JSON pozostaje przewijalny, bez ukrytego skracania.
To wskazówki do sprawdzenia przyczyny, nie dowód zbędnego wywołania.

Jeżeli co najmniej jedna runda na prezentowanej liście zawiera jawną metrykę
`cache write`, belki wszystkich rund pokazują jej osobną kolumnę obok outputu.
Dla rund bez tej metryki widoczny jest znak `—`, a nie domniemane zero.

Brak wartości oznacza „brak danych w telemetrii”, a nie zero ani potwierdzenie,
że dana funkcja nie była użyta. Alert błędu pojawia się wyłącznie wtedy, gdy
problem da się potwierdzić na podstawie statusu spanu, zdarzenia błędu albo
ustrukturyzowanego wyniku narzędzia.

## Techniki optymalizacji bez AI

Przycisk **Techniki optymalizacji** w górnym pasku otwiera lokalny poradnik w
wspólnym prawym panelu. Nie wymaga wybranej sesji, konfiguracji GitHub Copilot ani
wywołania modelu. Wersjonowany katalog zawiera pełne 16 technik T01–T16: od
doprecyzowania celu, zakresu i formatu wyniku, przez research, narzędzia, skille,
reguły, zmiany, walidację i delegowanie, po zarządzanie kontekstem oraz porównanie
wariantów na podobnych zadaniach.

Każda technika zaczyna od konkretnego problemu kosztowego, oczekiwanego rezultatu
i sposobu sprawdzenia go na porównywalnych zadaniach. Rozbudowany przykład
„obecnie / wariant do przetestowania” pokazuje gotową zmianę sposobu pracy bez
wymagania znajomości przepływu Agent–model. Poradnik pokazuje też warunki użycia
i ostrożności, pierwszy eksperyment, prostszy wariant, nakład oraz obowiązki
utrzymania. **Skopiuj plan próby** zapisuje do schowka problem, oczekiwany rezultat,
przykład, kroki, bramki jakości i kryteria porównania;
nie zmienia projektu. Katalog jest wersjonowany w
`src/main/resources/optimization/techniques-v1.json` i dostępny lokalnie pod
`GET /api/optimization/techniques`.

Po zapisanej analizie kategorii przycisk **Poznaj techniki** otwiera ten sam
poradnik w zakresie wybranej kategorii albo fazy. Panel pokazuje credits, udział,
pokrycie pomiaru i pochodzenie wartości; `≈` nadal oznacza lokalną estymację
atrybucji. Kompaktowanie ma osobne wejście dostępne również bez klasyfikacji AI i
pokazuje wyemitowane credits oraz tokeny wejścia/wyjścia. Dobór maksymalnie trzech
technik jest deterministyczny, nie uruchamia modelu i nie wysyła danych sesji.
Kontekstowy poradnik wskazuje też konkretne rundy lub wywołania kompaktowania.
Kliknięcie dowodu otwiera istniejący panel faktograficzny, a **Wróć do techniki**
przywraca poradnik bez utraty wybranej techniki, rozwiniętych sekcji i scrolla.

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

## Mapa pracy

Zakładka **Mapa pracy** zaczyna od wyemitowanego zlecenia i przepływu rund:
narzędzi, delegacji, potwierdzonych błędów i pomiarów kontekstu/tokenów/credits.
Początkowo nie prezentuje klasyfikacji wynikającej z proporcji input/output.

Menu **Analiza przepływu** udostępnia przycisk **Przeanalizuj działania modelu** oraz
podgląd **Zakres analizy**. Analiza zbiera żądania narzędzi z odpowiedzi modelu całego
powiązanego drzewa sesji, deduplikuje pełne definicje i wysyła pojedynczy prompt
przez GitHub Copilot Java SDK. Różne wersje definicji pod tą samą nazwą pozostają
rozdzielone. Żądania bez definicji nadal podlegają ocenie akcji, ale ich specjalizacja pozostaje nieustalona.

AI ocenia możliwości definicji oraz konkretne akcje żądane w odpowiedzi modelu:
wyszukiwanie, odczyt, zmianę/zapis, zapis pośredni/końcowy, weryfikację, delegację,
zarządzanie kontekstem lub odpowiedź. Cel „analiza architektury” nie zamienia
żądania odczytu w kategorię „analiza”. Każda runda zachowuje wszystkie akcje
swoich żądań; sąsiednie identyczne zbiory akcji tworzą segmenty. Profil subagenta
zestawia akcje jego własnych rund. Argumenty są skrócone do 100 znaków na wartość,
tekst odpowiedzi do 1000, a cel do 4000 znaków. Cel służy tylko ocenie dopasowania.
Wykonania i późniejsze wyniki nie określają klasyfikacji odpowiedzi. Brak treści
odpowiedzi pozostaje nieustalony. Ocena AI nie dowodzi efektywności ani sukcesu.
Liczby, błędy i relacje nadal pochodzą z telemetrii. Radio **Kategorie / Fakty**
przełącza wyłącznie sposób prezentacji i nigdy nie wywołuje AI.
Najechanie na przycisk klasyfikacji pokazuje przybliżoną liczbę tokenów wysyłanych
do modelu, oczekiwany rozmiar odpowiedzi i jej dłuższy wariant. Estymacja
korzysta z liczby znaków podzielonej przez cztery i nie zastępuje licznika dostawcy.

Odczyt i wyszukiwanie są jedną kategorią `Pozyskanie danych`. Mapa układa pracę jako
interakcję, pierwsze wywołanie modelu, cykle `M → A → M` i końcową odpowiedź.
Delegacja pozostaje narzędziem rodzica: przebieg subagenta i jego zwrot są częścią
tego samego cyklu.
Panel łączy żądanie z wykonaniem oraz pierwszym odbiorem wyniku
po dokładnym call ID; dalsze wystąpienia oznacza jako zachowaną historię.
Nad mapą znajduje się procentowy podział odpowiedzi modelu według kategorii.
Najpierw pokazuje dominujący obszar zużycia credits i kierunek do sprawdzenia,
a dalej statyczny ranking kategorii. Kategorie są wieloetykietowe, dlatego liczba
odpowiedzi w kategoriach może się nakładać.
Credits pozostają przy rzeczywistych wywołaniach modeli i nie są grupowane ani
przesuwane do kategorii akcji jako fakty. UI pokazuje osobno estymację `≈`: dzieli
credits wywołania między input i output według wyemitowanych tokenów. Pełną część
outputu przypisuje kategoriom żądań bieżącej odpowiedzi, a pełną część inputu
kategoriom dokładnie powiązanych wyników. Przy wielu elementach lokalny szacunek
tokenów wyznacza względne wagi. Część bez dowodu kategorii pozostaje jako „Poza
kategoriami”, dzięki czemu podział uzgadnia się z sumą credits objętych analizą.
Podział credits, zagregowana sekwencja faz i szczegółowy graf wywołań modeli oraz
subagentów są osobnymi sekcjami w tej kolejności. Szczegółowy graf zaczyna
rozwinięty i można go ukryć. Wersja `model-actions-v5` wymaga jednego ponownego
wyznaczenia analizy po aktualizacji; poprzednie etykiety pozostają pod dawnym hashem.

Wymagania opcjonalnej analizy: Copilot CLI `1.0.55` lub nowszy, token użytkownika
z dostępem do Copilota i ID modelu zwróconego przez to konto. SDK jest przypięte
do `1.0.11`; korzysta z trybu
bez narzędzi i skilli. Skopiuj
[`config/application.properties.example`](config/application.properties.example)
do ignorowanego przez Git `config/application.properties`, uzupełnij
`agent-scanner.ai.github-token`, `agent-scanner.ai.model` i ewentualnie
`agent-scanner.ai.cli-path`, po czym uruchom aplikację ponownie.
Brak konfiguracji nie blokuje odbiornika ani widoku faktów.

Kliknięcie analizy przesyła definicje, zlecenia, skrócone argumenty wykonań oraz
fragment odpowiedzi modelu z każdej rundy, ograniczony do 1000 znaków, do GitHub
Copilot i może zużyć limit konta. Zachowujemy wszystkie właściwości obiektu argumentów;
wartość tekstowa powyżej 100 znaków ma 50 początkowych znaków, `...` i 47 końcowych.
Wyniki narzędzi nie są częścią tego promptu.
Podgląd pozwala sprawdzić wysyłany zakres. Zwalidowany wynik jest zapisywany w H2
dla sesji i skrótu wersji reguł, modelu oraz zakresu analizy. Ponowne wejście do mapy
odczytuje go lokalnie bez uruchamiania Copilota. Zmiana zakresu albo modelu wymaga
nowej analizy. Wynik usuwa się kaskadowo z sesją; nie zmieniamy surowej telemetrii
ani formatu eksportu.

Mapa i koszt/przebieg odtwarzają epizody z raw identyfikatorów oraz drzewa spanów,
również gdy starsza normalizacja rozdzieliła epizod pomiędzy rekordy sesji.
Reguła `copilot-episode-v1` wymaga zgodności jawnych chat/parent chat ID z delegacją
i jej relacji w drzewie. Nie wymaga ponownego importu. Suma credits obejmuje
główny epizod i dokładnie powiązane dzieci. Kolizje i cykle nie otrzymują atrybucji.
Oś opisuje kolejność; szerokość nie oznacza czasu. Szczegółowe pomiary i payloady
startują zwinięte, a poziomy obszar mapy można przewijać przeciągając jego tło.

Przycisk **Zapytaj o rundy** pozwala wskazać początek i koniec jednego ciągłego
odcinka tej samej interakcji i agenta. Pasek wyboru pokazuje zakres, liczbę rund,
sumę znanych credits i pokrycie. **Przejdź do rozmowy** otwiera dedykowany modal z
lokalnie zamrożonym materiałem, początkowym zleceniem, orientacyjnym rozmiarem i
wyborem modelu dostępnego dla konta Copilot. Szacunek tokenów nie blokuje wysyłki;
o dopuszczalnym rozmiarze decyduje rzeczywiste okno wybranego modelu.

Pierwsze jawnie wysłane pytanie tworzy sesję rozmowy GitHub Copilot SDK, a każde
dopytanie wznawia tę samą sesję. Historia i migawka pozostają zapisane lokalnie;
zamknięcie modalu nie gubi rozmowy. Narzędzia, skills, MCP, pamięć, dostęp do repo
i discovery są wyłączone. Odpowiedź oznacza osobno wyjaśnienia oparte na
referencjach, hipotezy i wiedzę ogólną. Sam wybór zakresu, otwarcie modalu,
starter pytania oraz odczyt historii nie uruchamiają modelu.

Kontrakt, kategorie, ograniczenia i konfiguracja:
[Klasyfikacja narzędzi AI](docs/klasyfikacja-narzedzi-ai.md).
Playbook integracji: [Copilot SDK Java](docs/github-copilot-sdk-local-java-spring-ai.md).
Kompletny kontekst do dalszego rozwoju: [Kontynuacja projektu](docs/kontynuacja/README.md).

## Co zawiera projekt

- odbiornik OTLP/HTTP JSON i protobuf: `POST /v1/traces`, `/v1/metrics`, `/v1/logs`;
- obsługę nieskompresowanych i gzipowanych payloadów;
- zachowanie oryginalnego protobufu oraz jego pełnej reprezentacji JSON;
- normalizację sesji, spanów, tokenów, wiadomości, narzędzi i błędów;
- plikową bazę H2 w `./agent-scanner-data`;
- odświeżanie statusu i sesji przez polling;
- eksport/import sesji, pauzę odbiornika, retencję i pełne czyszczenie;
- frontend Angular 22 z Angular Material, osadzany w wykonywalnym JAR-ze;
- test kontraktowy przepływu OTLP → H2 → REST API;
- widok kosztu i przebiegu, interaktywną mapę pracy oraz surowe dane techniczne.

## Architektura

```text
GitHub Copilot w VS Code
            │ OTLP/HTTP
            ▼
       OtlpController
            │ decode JSON/protobuf/gzip + limit payloadu
            ▼
    OtlpIngestionService
            │ zachowanie raw + normalizacja
            ▼
       ScannerStore ───── H2
            │
            ▼
 SessionReconstructionService
            │ wersjonowane fakty sesji i rund
            ▼
   ScannerApiController
            │ REST /api
            ▼
 Angular: API service → formatowanie prezentacyjne → komponenty widoków
```

Szczegółowe reguły architektury, semantyka domenowa i zasady wprowadzania zmian
znajdują się w [`AGENTS.md`](AGENTS.md).

## API

| Metoda i ścieżka | Znaczenie |
|---|---|
| `POST /v1/traces` | odbiór trace'ów OTLP |
| `POST /v1/metrics` | odbiór metryk OTLP |
| `POST /v1/logs` | odbiór logów OTLP |
| `GET /api/status` | status, liczba sygnałów i ustawienia retencji |
| `GET /api/config` | konfiguracja VS Code i ostrzeżenie prywatności |
| `GET /api/optimization/techniques` | wersjonowany lokalny katalog technik, bez wywołania AI |
| `POST /api/ai/optimization-advice/prepare?sessionId={id}` | lokalna walidacja źródeł raw/normalized i zamrożenie podglądu; bez wywołania AI |
| `GET /api/ai/optimization-advice/status` | konfiguracja modelu i wspólny stan wykonania; bez wywołania AI |
| `POST /api/ai/optimization-advice/cached?sessionId={id}` | lokalny odczyt rekomendacji dla dokładnej zweryfikowanej migawki |
| `POST /api/ai/optimization-advice?sessionId={id}` | jawne uruchomienie doradztwa dla `previewId` |
| `GET /api/ai/session-chats/models` | modele i limity kontekstu dostępne dla konta Copilot; bez inferencji |
| `POST /api/ai/session-chats?sessionId={id}` | zamrożenie całej sesji i opcjonalnego punktu startowego; bez inferencji |
| `GET /api/ai/session-chats?sessionId={id}` | lokalna lista rozmów o sesji |
| `GET /api/ai/session-chats/{id}?sessionId={id}` | bootstrap, historia, użyte narzędzia i dowody jednej rozmowy |
| `POST /api/ai/session-chats/{id}/turns?sessionId={id}` | jawne pytanie lub dopytanie w trwałej sesji SDK |
| `DELETE /api/ai/session-chats/{id}?sessionId={id}` | usunięcie rozmowy, audytu i lokalnego stanu SDK |
| `GET /api/sessions` | lista znormalizowanych sesji |
| `GET /api/sessions/{id}` | sesja, spany, wiadomości i surowe sygnały |
| `GET /api/sessions/{id}/analysis` | wersjonowana rekonstrukcja sesji, interakcji, rund, narzędzi i powiązanych epizodów (`session-reconstruction-v1`) |
| `GET /api/sessions/{id}/workflow-sources` | źródła dokładnie powiązane z Mapą pracy, ładowane dopiero po otwarciu zakładki |
| `GET /api/sessions/{id}/analysis-data/overview` | lekkie podsumowanie sesji i pokrycie danych |
| `GET /api/sessions/{id}/analysis-data/configuration` | instrukcje, skille, custom agents, MCP i narzędzia widoczne w telemetrii |
| `GET /api/sessions/{id}/analysis-data/{interactions\|rounds\|round-evidence\|subagents\|cost\|search}` | celowane odczyty tego samego modelu faktów, którego używają narzędzia AI |
| `GET /api/sessions/{id}/export` | eksport sesji w formacie wersjonowanym |
| `POST /api/sessions/import` | import eksportu Agent Scanner v1 |
| `POST /api/pause` | wstrzymanie lub wznowienie zapisu nowych sygnałów |
| `DELETE /api/sessions/{id}` | usunięcie sesji i powiązanych sygnałów |
| `DELETE /api/data` | usunięcie wszystkich danych |
| `GET /api/ai/tool-classification/status` | gotowość konfiguracji AI, model i zajętość; bez tokena |
| `POST /api/ai/tool-classification/cached?sessionId={id}` | odczyt zapisanej klasyfikacji dla identycznego zakresu |
| `POST /api/ai/tool-classification` | klasyfikacja możliwości definicji i akcji żądanych w odpowiedziach modelu |

## Development

Domyślny zestaw ikon `material-symbols-outlined` jest rejestrowany globalnie w
`frontend/src/app/app.config.ts`. Provider nie może być ograniczony do komponentu
strony, ponieważ dynamiczne overlaye `MatDialog` korzystają z głównego injectora;
w przeciwnym razie nazwy ligatur, takie jak `close` lub `smart_toy`, pojawiają się
jako ucięty tekst.

### Backend bez przebudowy Angulara

```powershell
mvn "-Dskip.frontend=true" spring-boot:run
```

### Frontend z proxy do backendu

```powershell
cd frontend
npm ci --no-fund --no-audit
npm start
```

Angular działa wtedy pod adresem wskazanym przez CLI, a `/api` i `/v1` są
przekazywane do `http://localhost:8081` przez `frontend/proxy.conf.json`.

### Testy i build

```powershell
# testy backendu bez uruchamiania buildu frontendu
mvn "-Dskip.frontend=true" test

# testy frontendu
cd frontend
npm test -- --watch=false

# produkcyjny frontend do target/classes/static
npm run build

# pełny, wykonywalny artefakt
cd ..
mvn clean package
```

## Konfiguracja aplikacji

| Zmienna | Domyślna wartość | Znaczenie |
|---|---:|---|
| `PORT` | `8081` | wspólny port UI, REST API i OTLP/HTTP |
| `AGENT_SCANNER_DB_URL` | `jdbc:h2:file:./agent-scanner-data/agent-scanner` | lokalizacja plikowej bazy H2 |
| `AGENT_SCANNER_RETENTION_DAYS` | `30` | retencja sygnałów w dniach |
| `AGENT_SCANNER_MAX_PAYLOAD_BYTES` | `67108864` | limit rozpakowanego payloadu oraz importu |

Retencja uruchamia się pięć minut po starcie, a następnie raz na dobę. Import
akceptuje wyłącznie eksport `agent-scanner-session` w wersji `1` i odrzuca sesję
o istniejącym `conversationId`.

## Prywatność i bezpieczeństwo

`captureContent=true` może zapisywać lokalnie kod, prompty, instrukcje, ścieżki,
komendy, argumenty i wyniki narzędzi. Dane trafiają do lokalnej bazy H2 i nie są
przesyłane dalej przez Scanner. UI pozwala usunąć pojedynczą sesję lub całą bazę.

Przed dodaniem rzeczywistego payloadu do testów trzeba usunąć repozytoria,
identyfikatory, prompty, kod, ścieżki użytkownika, tokeny i inne sekrety. Preferuj
syntetyczne fixture'y.

## Granice wiarygodności

Widok techniczny i surowe sygnały są źródłem prawdy. Widoki przyjazne użytkownikowi
są deterministyczną interpretacją dostępnych atrybutów. Projekt celowo:

- nie estymuje brakującego `cache write`;
- nie przypisuje pojedynczego request-part definitywnie do cache; zestawienie tooli
  pokazuje wyłącznie oznaczoną `≈` estymację późniejszych, dokładnie powiązanych
  wyników na podstawie jawnej proporcji cache całego requestu;
- nie traktuje liczby znaków jako dokładnej liczby tokenów;
- nie uznaje ponownego wysłania instructions za błąd bez jednoznacznego sygnału;
- nie pokazuje „połączenia aktywnego” tylko dlatego, że wcześniej odebrano dane.

Fixture w `src/test/resources/fixtures` jest syntetycznym kontraktem, a nie dowodem
kształtu payloadu każdej wersji Copilota. Różnice providerów należy najpierw
sprawdzić w raw OTLP, a następnie utrwalić w zanonimizowanym teście regresyjnym.

## Dokumentacja źródłowa

- [VS Code: Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [GitHub Copilot OpenTelemetry concepts](https://docs.github.com/en/copilot/concepts/agents/opentelemetry)
- [OTLP specification](https://opentelemetry.io/docs/specs/otlp/)
- [VS Code: Diagnose prompt caching with Cache Explorer](https://code.visualstudio.com/docs/agents/agent-troubleshooting/cache-explorer)
