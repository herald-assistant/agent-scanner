# Standaryzacja — działanie i wymagania

Status: działający widok repozytorium i wymagania referencyjne; źródła sprawdzone 2026-09-22.

[Dokumentacja](README.md)

## Działanie obecnej wersji

Standaryzacja jest widokiem repozytorium, niezależnym od sesji. W lewym panelu
pod sesjami znajduje się zwijana sekcja `Repozytoria`, a w niej bezpośrednio
klikalne karty wykonanych analiz, stylizowane jak sesje. Karty nie rozwijają
się; lista pokazuje 5 najnowszych analiz, a „Pokaż więcej” kolejne porcje po 5.
Przycisk dodawania przy nagłówku listy rozpoczyna nową analizę. Historia jest dostępna
także po odświeżeniu aplikacji. Stare trasy `/standardization` i
`/sessions/:id/standardization` prowadzą do nowego widoku `/repositories/new`.

Nagłówek zapisanej analizy ma ikonowe przyciski w takim samym układzie i stylu
jak sesja: eksport do JSON, usunięcie oraz zamknięcie widoku. Zastępują dawne
`Nowa analiza` i `Do sesji`. Kosz wymaga potwierdzenia i usuwa wyłącznie wybraną
analizę wraz z wynikiem AI oraz zamaskowaną migawką; pozostałe analizy pozostają.
Po usunięciu odświeża się historia i otwiera ekran początkowy. Usunięcie ostatniej
analizy usuwa również pusty wpis repozytorium. Zamknięcie widoku nie usuwa danych.
Na ekranie nowej analizy dostępne jest zamknięcie; podczas przygotowania lub
wykonywania analizy przycisk jest nieaktywny.

1. Użytkownik wskazuje katalog. Przeglądarka odnajduje konfiguracje pięciu
   kategorii i bezpośrednio podlinkowane materiały tekstowe w ich katalogach.
   Odczytywalne pliki są domyślnie zaznaczone; każdy można odznaczyć i podejrzeć.
2. Zamaskowane pliki i zaznaczenia są zapisywane jako wejście do analizy:
   w IndexedDB w demo, w bazie H2 w pełnej wersji. Podgląd można ponownie otworzyć
   z listy repozytoriów, także po odświeżeniu i bez dostępu do folderu.
   Nie zawiera wyniku AI. W demo dopiero przycisk **Uruchom analizę** otwiera
   komunikat „Dostępne w pełnej wersji”; podgląd, filtry i wybór plików działają lokalnie.
3. W pełnej wersji **Uruchom analizę** otwiera modal. Dopiero ten modal pobiera
   rzeczywisty katalog modeli Copilot i wymagania oraz pozwala wybrać model.
   Zamknięcie modalu nie przygotowuje pakietu ani nie uruchamia AI. Tryb oceny `AUTO`
   rozpoznaje rodzaj konfiguracji z lokalizacji i treści; nie wymaga wskazania
   środowiska ani wersji klienta. Model nie jest wywoływany przy otwarciu zakładki.
4. Potwierdzenie **Uruchom analizę** w modalu przygotowuje pakiet z zaznaczonych
   plików zapisanej migawki. Backend sprawdza limity, wykonuje podstawowe kontrole
   struktury, zamraża powiązanie wejścia i uruchamia wybrany model. Wynik jest
   przypisany do tego samego repozytorium oraz konkretnej migawki wejściowej.
   Zmiana wejścia użytego już do przygotowania AI tworzy nową migawkę;
   wcześniejsze wejście pozostaje niezmienne. Nie ma osobnej karty podglądu pakietu.
5. Pakiet zawiera pełne
   dokumenty odpowiednich kategorii oraz 6 kryteriów merytorycznych na kategorię
   — łącznie katalog ma 30 kryteriów. Pomocnicze materiały konfiguracji pomagają
   ocenić jej organizację; nie otrzymują własnej oceny zgodności.
6. Podsumowanie pokazuje liczby ocen i braki odpowiedzi. Przy pliku dostępne są
   zgodności, obszary do dopracowania, braki dowodów i reguły nieadekwatne,
   razem z uzasadnieniami, propozycją poprawy, cytatami i źródłami GitHub.
   Osobna lista wyróżnia problemy odnoszące się do kilku plików.

Po wskazaniu folderu aplikacja automatycznie odczytuje rozpoznane konfiguracje,
domyślnie zaznacza je i zapisuje zamaskowaną migawkę. Model używa zapisanych treści
po potwierdzeniu **Uruchom analizę** w modalu; nie odczytuje plików ponownie z dysku.
Model nie ma samodzielnego dostępu do lokalnego dysku
użytkownika. Przed kliknięciem można odznaczyć i obejrzeć każdy plik.
Automatyczne wykrycie przez Scanner nie potwierdza aktywacji pliku w Copilot.

GitHub rozróżnia sposób aktywacji mechanizmów: instrukcje stosują się
automatycznie w swoim zakresie, skills są dobierane do zadania przez Copilot,
prompty wywołuje użytkownik, agenci mogą być wybrani ręcznie lub przez model
zależnie od klienta i ustawień, a MCP udostępnia skonfigurowane narzędzia.
Tryb `AUTO` ocenia te różnice warunkowo i nie wymaga, by każdy plik był zawsze
wstrzykiwany do kontekstu modelu. Podstawa:
[porównanie mechanizmów GitHub Copilot](https://docs.github.com/en/copilot/reference/customization-cheat-sheet).

Ocena obejmuje odpowiedzialność mechanizmów (instructions, skills, agents,
prompts, MCP), zakres stosowania, nagłówki i metadane, poprawne założenia
o działaniu Copilot, nadmiarowe treści, duplikację oraz utrzymanie konfiguracji
w czasie. Każda kategoria ma obowiązkowe kryterium **AS-W: uniwersalność
względem technologii i architektury**. Reguły wspólne mają być przenośne;
specjalizacja musi wynikać z jawnego celu i uzasadnionego zakresu, np. opisu
skilla, `applyTo` lub warunku w treści. Sama nazwa technologii w przykładzie
nie dowodzi naruszenia. Uzasadnienie AI ma omówić oba wymiary uniwersalności.

Obowiązkowość AS-W jest polityką tego narzędzia, a nie nakazem GitHub.
Podstawa kryterium jest widoczna przy ocenie. Backend odrzuca `NOT_APPLICABLE`
dla AS-W; brak dowodów nadal może dać `INSUFFICIENT_EVIDENCE` z wyjaśnieniem.
Ocena opisuje błędne założenia i ich skutki w konfiguracji, nie kompetencje autora.

Backend odrzuca nieznane identyfikatory, źródła spoza reguły, niepoprawne cytaty
i powtórzone oceny. Częściowa odpowiedź nie staje się pełnym zaliczeniem;
nieocenione kryteria i odrzucone rekordy są jawne. Walidacja kontraktu potwierdza
pochodzenie dowodów, nie prawdziwość rozumowania modelu. UI wyraźnie oznacza ocenę
AI i nie wylicza pozornego procentu zgodności.

Kontrole lokalne obejmują podstawową strukturę JSON/JSONC, bezpieczne parsowanie
YAML, granice nagłówka, tekstowe klucze, typy wybranych pól i pustą treść.
Wymagane metadane zależą od mechanizmu i profilu: m.in. `name`/`description`
skills, `description` agentów GitHub w CLI/cloud oraz `applyTo` instrukcji
ścieżkowych w CLI/cloud/review. Sprawdzane są również wybrane listy, pola logiczne
i `handoffs` VS Code. Ograniczenia nazw i opisów skills oraz zgodność nazwy
z katalogiem są ostrzeżeniami z oznaczeniem SPEC; długości liczone są w punktach
kodowych Unicode. Nieznane pola i rozbieżności klientów pozostają informacją.
Brak H1 ani opcjonalnego frontmatter w VS Code nie jest automatycznym błędem.
Wersja parsera YAML jest przypięta w [pom.xml](../pom.xml); zawiera
[poprawkę odczytu Unicode na granicy bufora](https://github.com/snakeyaml/snakeyaml/blob/master/src/changes/changes.xml)
sprawdzaną testem regresyjnym długości metadanych skills.

**Nie jest to pełny silnik wszystkich reguł referencyjnych**: aplikacja nie
odtwarza całego schematu rozszerzeń, dopasowania globów, hierarchii instrukcji,
ustawień konta, dostępności modeli/narzędzi ani faktycznego uruchomienia klienta.
Dla `.claude/agents` i promptów poza VS Code Local sprawdzana jest składnia YAML,
bez narzucania schematu pól innego formatu lub klienta. Model ma uwzględniać
profil i oznaczać brak dowodów zamiast potwierdzać działanie.

## Lokalny raport konfiguracji i PDF

Po wczytaniu katalogu strona pokazuje podsumowanie repozytorium oraz rozwijane
sekcje instrukcji, skills, agentów, MCP, promptów, materiałów i ustawień AI w IDE.
Sekcje odsłaniają elementy, ich zadeklarowane metadane i podgląd źródłowych plików.
Inwentaryzacja obejmuje wszystkie znalezione konfiguracje niezależnie od zaznaczeń
wejścia AI. Serwery MCP liczymy jako deklaracje, osobno od liczby plików konfiguracji.
Brak pliku przy odczycie częściowym pozostaje brakiem potwierdzenia.
Raport nie potwierdza instalacji, aktywacji ani wykorzystania mechanizmu w sesjach.

Podsumowanie Git odczytuje tylko `config`, `HEAD`, `packed-refs` i `refs/heads`
z katalogu `.git` w wybranym korzeniu. Zachowuje oczyszczony adres `origin`,
gałąź i identyfikator commita; nie zachowuje surowej konfiguracji Git ani
poświadczeń i parametrów adresu. Nie czyta obiektów, indeksu, logów ani historii.
Plik `.git` wskazujący poza wybrany katalog nie powoduje rozszerzenia dostępu.
Niedostępne metadane pozostają jawnie nieustalone. Commit identyfikuje checkout,
a migawka raportu zawiera faktycznie odczytane treści, także lokalnie zmienione.

Raport odczytuje `.vscode/settings.json`, `.vscode/extensions.json` i główne
pliki `*.code-workspace`. Pokazuje rozpoznane ustawienia AI i rekomendacje
rozszerzeń; rekomendacja nie dowodzi instalacji. Nieznane pola zachowuje w źródle.
Dla JetBrains odczytuje `.aiassistant/rules/*.md`, `.aiignore` i `.noai`.
W `.idea/*.xml` zachowuje wyłącznie komponenty, których nazwa jawnie zawiera
AI Assistant, GitHub Copilot lub Junie; jest to rozpoznanie nazwy, nie walidacja
schematu wtyczki. Reszta pliku, w tym osobiste dane `workspace.xml`, jest pomijana.
Nieudana inspekcja pliku XML lub przekroczenie limitu plików oznacza odczyt
częściowy; nie stanowi dowodu braku konfiguracji AI.
Ustawienia osobiste poza folderem repozytorium pozostają poza zakresem.

Metadane Git i do 300 plików raportu po 128 KiB są zachowywane w istniejącej
migawce w IndexedDB lub H2. Wspólny limit body zapisu pozostaje 8 MiB.
Pliki IDE są osobnym materiałem raportu i nie trafiają do pakietu AI.
Stare migawki bez nowych pól nadal się otwierają; braków nie uzupełniamy domysłami.

Przycisk **Pobierz raport PDF** tworzy dokument z tego samego modelu raportu,
z pełnymi szczegółami także zwiniętych sekcji, klikalnym podsumowaniem,
zakładkami i numeracją stron. PDF ma kompozycję wydawniczą: zieloną geometrię
wektorową przy krawędziach, limonkowy akcent aplikacji i otwarte układy tekstowe.
Pierwsza strona podsumowuje osobno każdą kategorię mechanizmów i konfiguracji IDE
w dwukolumnowym indeksie z ikonami, bez wypełnionych kart. Cały obszar pozycji
znalezionej kategorii prowadzi do szczegółów, również ikona i odstępy wokół tekstu.
Sekcje szczegółów mają kolejną numerację, a pola prezentowane są jako etykiety
i wartości bez siatki tabel; krótkie pola są zestawiane parami, dłuższe zajmują
pełną szerokość i mogą przechodzić na kolejne strony. Nagłówek podaje datę
wygenerowania raportu, a dane
`ORIGIN`, `COMMIT` i `BRANCH` są prezentowane w kolejnych wierszach.
Logo i nazwa Agent Scanner są częścią kompozycji pierwszej strony. Kolejne mają
dyskretny nagłówek po prawej: `RAPORT REPOZYTORIUM · nazwa repozytorium`.
Stopka zawiera wyłącznie numerację stron; stałe marginesy oddzielają nagłówek
i stopkę od treści, bez dodatkowej linii nad stopką.
Podział stron jest sprawdzany lokalnie przed eksportem. Kategoria zaczynająca się
w dolnej części strony i przechodząca na następną zostaje przeniesiona na nową
stronę; dłuższe sekcje mogą swobodnie przechodzić dalej. Strony kontynuacji mają
dyskretne przypomnienie `nazwa kategorii · ciąg dalszy` nad treścią. Pozycje są
odczytywane z układu PDF, a dodatkowy pomiar nie wykonuje żadnych żądań sieciowych.
Zieleń buduje identyfikację raportu, nie stanowi oceny jakości ani poziomu adopcji.
Raport na stronie i PDF nie eksponują ogólnych liczników plików; pominięcia pozostają
przy źródłach. Nie ma osobnego bloku zakresu odczytu. Wartości tablic i obiektów
są prezentowane jako zwarty JSON, z odstępami po przecinkach i dwukropkach;
nie zmienia to źródła, treści łańcuchów ani precyzji liczb JSON.
`pdfmake` oraz fonty Roboto i Source Code Pro z polskimi znakami
są pakowane w aplikacji i ładowane dopiero po kliknięciu. Generowanie nie wykonuje
żądań API, nie używa CDN, usług AI ani serwera PDF; dane nie opuszczają przeglądarki.
PDF pod metadanymi pokazuje początek zapisanej treści każdego pliku na stonowanym
zielonym tle. Fragment ma do 500 widocznych znaków Unicode i 12 logicznych wierszy
lub bloków. Skrót kończy się na pełnym zdaniu, punkcie listy lub linii kodu;
nie pozostawia samotnego nagłówka ani początku następnego akapitu. Jeżeli już
pierwsze zdanie lub linia przekracza limit, pozostaje fragment na granicy słowa.
O skróceniu informuje etykieta `FRAGMENT TREŚCI · SKRÓCONO`, bez osobnego wiersza
z wielokropkiem. Rozpoznany, poprawny frontmatter jest
pomijany tylko w podglądzie, a źródło pozostaje bez zmian. Markdown zachowuje
akapity, listy, pogrubienia, kursywę, cytaty i kod. Nagłówki źródła są mniejsze
od nazwy pliku; kod używa lokalnie dołączonej czcionki monospace. Tabele mają
zwartą prezentację tekstową, obrazy i HTML są pomijane z informacją w podglądzie.
JSON, XML i pliki tekstowe zachowują treść oraz precyzję liczb. Dla kilku deklaracji
MCP z jednego pliku fragment źródła występuje raz. Surowe deklaracje XML i wzorce
`.aiignore` nie są powtarzane jako pola nad podglądem tej samej treści. Plik pusty
lub zawierający tylko metadane otrzymuje krótką informację bez pustego bloku tła.

Pod fragmentem znajduje się link **Szczegóły w repozytorium**, gdy adres `origin`
wskazuje rozpoznany GitHub.com lub GitLab.com i znany jest commit lub branch.
Obsługiwane są adresy HTTPS oraz Git/SSH; link HTTPS wskazuje najpierw znany branch,
a tylko przy braku jego nazwy poprawny identyfikator commita. Lokalny commit może
nie być opublikowany w `origin`, dlatego nie zastępuje znanej gałęzi w odnośniku.
Pole `COMMIT` w metadanych raportu nadal opisuje odczytany checkout. Odnośnik do
gałęzi prowadzi do jej aktualnej treści, która może różnić się od zapisanej treści
raportu. Nazwa gałęzi i segmenty ścieżki pliku są kodowane w URL.
Dla innych hostingów lub brakujących metadanych pozostaje ścieżka bez zgadywanego
linku. Generowanie nie sprawdza dostępności sieciowej pliku. Uwaga na pierwszej
stronie wyjaśnia, że lokalne zmiany i nieopublikowane pliki mogą być niedostępne
pod adresem repozytorium. Budowa odnośnika opiera się na formacie
[permalinków GitHub](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files)
i [odnośników GitLab](https://docs.gitlab.com/user/project/repository/files/#create-permalinks).
Podgląd pełnego źródła pozostaje dostępny na stronie. Rozpoznane sekrety są
maskowane przed zapisem, w raporcie i eksporcie. Nie ma osobnego eksportu HTML.

Implementacja: [model raportu](../frontend/src/app/core/repository-report.ts),
[odczyt metadanych](../frontend/src/app/core/repository-report-files.ts),
[widok](../frontend/src/app/features/standardization/repository-report.component.ts),
[PDF](../frontend/src/app/core/repository-report-pdf.ts).

## Odczyt, limity i prywatność implementacji

Preferowany jest odczyt przez `showDirectoryPicker` z uprawnieniem tylko do
czytania. Przeglądarki bez tej funkcji używają wyboru katalogu przez
[webkitdirectory](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory).
Backend przyjmuje treści z przeglądarki, nie dowolną ścieżkę lokalnego dysku.
Pakiet zawiera wyłącznie ścieżki względne. Przeglądarkowe API nie pozwala
niezależnie udowodnić `realpath` każdego dowiązania; nie deklarujemy takiej kontroli.
Oba warianty zapisują migawkę wybranego folderu. Po zmianie plików na dysku
należy ponownie wybrać katalog; AI zawsze analizuje zapisane wejście.

Odczyt pomija m.in. obiekty i historię `.git`, zależności, katalogi buildów, wykryte zagnieżdżone
repozytoria, pliki `.env` i odnośniki sieciowe. **Poza zakresem są manifesty
technologii, kod, skrypty, workflow CI, automatycznie dobierane README i dokumentacja
architektury projektu**. Dotyczy to również linków do `pom.xml`, `package.json`,
`build.gradle`, `pyproject.toml` i `Cargo.toml` znalezionych w instrukcjach.
Ich treści nie są odczytywane; odnośnik pozostaje częścią ocenianej konfiguracji.

Materiały pomocnicze mogą mieć rozszerzenie `.md` lub `.txt` i znajdować się
wyłącznie wewnątrz `.github/instructions`, `.github/skills`, `.github/agents`,
`.github/prompts`, `.claude/skills`, `.claude/agents` albo `.agents/skills`.
Przeglądarka dobiera je tylko po bezpośrednim linku z konfiguracji; nie rozwija
kolejnych odnośników z materiału pomocniczego. Backend dodatkowo odrzuca przesłane
pliki spoza dozwolonych kategorii i katalogów. Wybór materiałów na liście
pozostaje niezależny; analiza wymaga co najmniej jednego pliku konfiguracji.

Limity aplikacji wynoszą:
30 000 wpisów drzewa, 20 poziomów, 300 kandydatów, 128 KiB na plik, do 80
zaznaczonych plików i 1 MiB ich treści. Body przygotowania ma limit 8 MiB.
To limity Agent Scanner, nie limity narzucone przez GitHub. Niepełny odczyt
i pominięte pliki są zaznaczone w pakiecie.

Rozpoznane tokeny, klucze prywatne i typowe przypisania sekretów są maskowane
w przeglądarce i ponownie w backendzie. Maskowanie wzorcami nie wykrywa każdego
możliwego sekretu; treść każdego wybranego pliku można sprawdzić przed wysłaniem.
Pliki konfiguracji, odczytywalne materiały i informacje o pominięciach są zapisywane
przed AI. Zapis obejmuje do 300 kandydatów po 128 KiB; w pełnej wersji body zapisu
ma limit 8 MiB. Osobne limity 80 plików i 1 MiB dotyczą zaznaczonego wejścia AI.
Demo używa bazy IndexedDB `agent-scanner-demo-repositories`, schematu 1,
store `snapshots`; nie zapisuje uchwytów dysku ani nie wysyła danych do serwera.
Pełna wersja używa tabel `standardization_input_snapshot` i
`standardization_analysis_input` w H2, zachowując wcześniejsze analizy.
Zapis nie wymaga modelu ani poświadczeń Copilot. Po zakończeniu analizy backend
zapisuje wynik AI i powiązanie z wejściem. Pozwala to później sprawdzić ocenę i cytowane
fragmenty bez ponownego dostępu do katalogu. Nie zapisuje całego repozytorium
ani nie podłącza go na stałe; zapisanego wejścia można użyć bez ponownego wyboru folderu.
Maskowanie wzorcami nie gwarantuje usunięcia wszystkich sekretów, więc wybrane
treści należy sprawdzić przed uruchomieniem. Niezakończony pakiet pozostaje tylko
w pamięci backendu: najwyżej 8 podglądów przez 15 minut, z czyszczeniem przy
operacjach i co minutę. Frontend nie używa localStorage.

W pełnej wersji wybór folderu i zmiana zaznaczeń wysyłają zamaskowaną migawkę
do serwera Agent Scanner. Jeśli serwer działa zdalnie, dane opuszczają komputer
już podczas zapisu wejścia; komunikat przy wyborze folderu podaje miejsce zapisu.
Dopiero potwierdzenie w modalu wysyła zaznaczone treści do Copilot.
Analiza współdzieli pojedynczy slot wykonania AI, pozwala
anulować żądanie i nie ponawia płatnego wywołania automatycznie. Powtórny odczyt
udanego wyniku tego samego podglądu korzysta z pamięci bez następnej inferencji.
Izolowany model nie wykonuje instrukcji, skryptów ani serwerów MCP ocenianego repo.

Implementacja: [backend](../src/main/java/dev/agentscanner/standardization),
[odczyt plików](../frontend/src/app/core/standardization-files.ts),
[stan](../frontend/src/app/core/standardization-state.service.ts),
[widok](../frontend/src/app/features/standardization/standardization.component.ts).
Trasy i błędy opisuje [API](api.md#standaryzacja-repozytorium).

## Cel i granice dokumentu

Widok **Standaryzacja** pozwala użytkownikowi wskazać lokalny katalog
repozytorium, zobaczyć odnalezione konfiguracje GitHub Copilot i ocenić je według
udokumentowanych reguł właściwych dla wybranego środowiska. Wynik ma wyjaśniać,
co znaleziono, gdzie, czego dotyczy reguła i na jakiej podstawie powstała uwaga.
Zakres obejmuje zarówno lokalne sprawdzenie struktury, jak i uruchamianą
przez użytkownika **ocenę merytoryczną AI**. Model otrzymuje wybrane pliki
konfiguracji oraz wersjonowane kryteria oparte na dokumentacji GitHub Copilot
i jawnych zasadach AS. Ocenia sens, podział odpowiedzialności, przenośność,
spójność i utrzymanie konfiguracji. Poprawność komend, zależności i zgodność
z rzeczywistą architekturą kodu pozostają poza zakresem.

Standaryzacja rozszerza aplikację o jawny odczyt konfiguracji repozytorium,
nie o analizę jakości całego kodu. Wybór katalogu jest niezależny od sesji
telemetrii. Właścicieli tej funkcji opisuje [architektura](architektura.md).

## Dokumenty kategorii

| Kategoria | Przedmiot i dokument wymagań |
|---|---|
| Instructions | [Instrukcje](standaryzacja-instrukcje.md): reguły ogólne, ścieżkowe, `AGENTS.md`, zakres i pierwszeństwo. |
| Skills | [Umiejętności](standaryzacja-skills.md): katalogi z `SKILL.md`, metadane, materiały i aktywacja. |
| Custom agents | [Agenci](standaryzacja-agenci.md): profile, narzędzia, środowiska i delegowanie. |
| MCP tools | [MCP](standaryzacja-mcp.md): konfiguracje serwerów, filtry narzędzi i sekrety. |
| Prompts | [Prompty](standaryzacja-prompty.md): pliki `*.prompt.md`, kontekst, parametry i ograniczenia klientów. |

Każdy dokument kategorii zawiera osobne kryteria merytoryczne dla AI,
wymagane dowody i przykłady oceny. [Walidacja AI](standaryzacja-ai.md)
określa wspólny przebieg, pakiet plików i reguł, format uzasadnienia,
sprawdzenie odpowiedzi oraz prywatność. Zakres dostępnej implementacji opisano
poniżej; dalsze sekcje i dokumenty kategorii pozostają katalogiem wymagań.

Rozróżnienie mechanizmów jest istotne: instrukcje dostarczają reguł w swoim
zakresie, skill dostarcza procedury dobieranej do zadania, agent określa rolę
i narzędzia, prompt jest wywoływanym szablonem, a MCP podłącza możliwości
zewnętrznego serwera. Subagent jest wykonaniem w osobnym kontekście, a nie
szóstym obowiązkowym plikiem. Źródło:
[porównanie mechanizmów Copilot](https://docs.github.com/en/copilot/reference/customization-cheat-sheet).

GitHub dokumentuje opcjonalne mechanizmy dostosowania. Nie wynika z tego obowiązek
utworzenia wszystkich pięciu katalogów, używania każdego mechanizmu ani
kopiowania przykładowej konfiguracji do każdego projektu. Zalecenia dotyczące
doboru mechanizmu opisuje także
[porównanie funkcji CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features).

## Mapa lokalnych artefaktów

Poniżej zestawiono możliwe lokalizacje projektowe. Dobór plików zależy od
używanych mechanizmów i profili; warianty alternatywne opisują dokumenty kategorii.
Układ nie wyznacza minimalnej liczby wymaganych plików.

```text
<repozytorium>/
├── .github/
│   ├── copilot-instructions.md
│   ├── instructions/<nazwa>.instructions.md
│   ├── skills/<nazwa>/SKILL.md
│   ├── agents/<nazwa>.agent.md
│   ├── prompts/<nazwa>.prompt.md
│   └── mcp.json                         # konfiguracja projektu CLI
├── .vscode/mcp.json                     # konfiguracja VS Code
├── .mcp.json                            # konfiguracja CLI / Agent Host
└── AGENTS.md                            # instrukcje obsługujących je agentów
```

To mapa rozpoznawania, nie propozycja automatycznego wygenerowania wszystkich
tych plików. W szczególności serwery MCP dla GitHub.com mają osobne ustawienia
usługi, a obsługa plików promptów zależy od klienta.

## Różnice między klientami

Zakładka używa trybu `AUTO` i nie prosi o wybór klienta. Dla reguł zależnych od
środowiska raport podaje warunek: plik może być poprawny w jednym kliencie,
a nieobsługiwany w innym. Sama ścieżka nie dowodzi używanego środowiska.

| Profil | Informacje potrzebne do interpretacji |
|---|---|
| VS Code | Wersja edytora i rozszerzenia, Local agent albo Agent Host, katalog workspace. |
| Visual Studio | Wersja edytora i rozszerzenia, używana funkcja Copilot. |
| JetBrains | IDE, wersja wtyczki, Chat/agent albo code review. |
| Eclipse / Xcode | Konkretny klient i funkcja; nie dziedziczą automatycznie reguł VS Code. |
| Copilot CLI | Wersja CLI i katalog roboczy wewnątrz repozytorium. |
| GitHub.com — Chat | Kontekst repozytorium; ustawienia osobiste i organizacyjne poza lokalnym odczytem. |
| GitHub.com — cloud agent | Gałąź i konfiguracja usługi; nazwa „coding agent” występuje też w starszych materiałach. |
| GitHub.com — code review | Kontekst PR i ustawienia review; osobny profil od review uruchamianego w IDE. |

Wersja klienta pozostaje nieznana. Sam plik `.vscode/mcp.json` nie dowodzi,
że użytkownik korzysta z VS Code. Tabela jest punktem odniesienia dla warunkowych
ustaleń, nie listą opcji w formularzu. Reguły zależne od klienta muszą wskazać,
w jakim środowisku mają zastosowanie.

Punkty odniesienia:
[macierz funkcji](https://docs.github.com/en/copilot/reference/copilot-feature-matrix)
i [szczegółowa macierz instrukcji](https://docs.github.com/en/copilot/reference/custom-instructions-support).
Macierz ogólna nie potwierdza obsługi każdego pola i formatu.

## Pochodzenie i siła reguł

Dokumenty kategorii używają poniższych oznaczeń. Identyfikatory reguł są stabilne
i mają służyć późniejszym testom oraz odwołaniom w raporcie.

| Oznaczenie | Znaczenie |
|---|---|
| GH-W | Udokumentowany przez GitHub warunek formatu lub działania mechanizmu, gdy jest używany. |
| GH-Z | Zalecenie GitHub dotyczące jakości lub sposobu konfiguracji. |
| HOST | Szczegół klienta z jego oficjalnej dokumentacji, np. VS Code. |
| SPEC | Warunek otwartej specyfikacji wskazanej przez GitHub, np. Agent Skills. |
| AS | Wymaganie projektowe Agent Scanner. Nie przedstawiać go jako nakazu GitHub. |
| AS-W | Obowiązkowe kryterium polityki Agent Scanner: uniwersalność względem technologii i architektury adekwatna do celu oraz jawnego zakresu specjalizacji. Ocena AI nie może pominąć go przez `NOT_APPLICABLE`. |

Rodzaj weryfikacji jest osobnym wymiarem:

- **statyczna**: ścieżka, nazwa, struktura, typ pola, referencja, liczba linii;
- **merytoryczna**: odpowiedzialność mechanizmu, zakres, uniwersalność, spójność, zwięzłość i utrzymanie konfiguracji;
- **środowiskowa**: ustawienia klienta, uprawnienia, stan serwera lub rzeczywiste załadowanie.

Sposób uzyskania oceny jest osobnym wymiarem: deterministyczny, AI albo ręczny.
Ocena merytoryczna AI jest jawnym etapem według [osobnych wymagań](standaryzacja-ai.md),
z zachowaniem granic wykonania opisanych w [kontrakcie AI](ai.md#granice-wykonania).
Raport pozwala użytkownikowi sprawdzić i zakwestionować uzasadnienie modelu.
Obecność słowa „test” nie potwierdza jakości instrukcji testowania; poprawny
format pliku nie oznacza poprawnej treści, a opinia AI nie dowodzi działania komendy.

## Wymagania wspólne zakładki

Poniższe reguły STD są decyzjami AS.

| ID | Wymaganie |
|---|---|
| STD-001 | Wybór katalogu i rozpoczęcie analizy są jawne. Raport pokazuje faktyczny korzeń odczytu, czas, tryb `AUTO` i wersję zestawu reguł. |
| STD-002 | Rozpoznać repozytorium i sytuację wyboru podkatalogu. Uwzględnić, że `.git` może być katalogiem albo plikiem worktree. Nie rozszerzać odczytu do rodzica bez pokazania zmienionego zakresu użytkownikowi. |
| STD-003 | Wczytać konfiguracje z lokalizacji opisanych w dokumentach kategorii, także katalogów ukrytych. Zwracać ścieżkę względną, kategorię, rozpoznany format, stan odczytu i metadane. |
| STD-004 | Odróżnić „nie znaleziono” od odmowy dostępu, przerwanego odczytu, błędu kodowania, przekroczonego limitu i nieobsługiwanego formatu. Błąd pojedynczego pliku nie unieważnia pozostałych wyników. |
| STD-005 | Brak opcjonalnej konfiguracji daje informację o braku. Wymagane pola kontrolować dopiero w odnalezionym artefakcie właściwego typu. Własny standard zespołu może wymagać plików, ale musi być opisany oddzielnie. |
| STD-006 | Zachować oryginalną treść i nieznane pola w lokalnej migawce do oceny. Nie przepisywać ani nie „naprawiać” dokumentu podczas parsowania. W raportach i logach stosować ochronę sekretów opisaną niżej. |
| STD-007 | Każda uwaga zawiera ID reguły, warunek klienta, gdy ma znaczenie, wynik, pochodzenie, lokalizację dowodu, wyjaśnienie oraz właściwe źródło. Wskazać linię albo ścieżkę pola; nie przypisywać uwagi całemu repozytorium bez wskazania pliku. |
| STD-008 | YAML/JSON parsować bez uruchamiania kodu, deserializacji obiektów lub rozwijania zmiennych środowiska. Powtórzone klucze i błędna składnia muszą być widoczne; nie rozstrzygać ich cichym „ostatni wygrywa”. |
| STD-009 | Zależności i linki sprawdzać z właściwej bazy ścieżek. Wykrywać cykle. Nie pobierać URL ani nie otwierać zasobów poza zakresem wyłącznie dlatego, że wskazuje je odczytany plik. |
| STD-010 | Treści konfiguracji są danymi, nie poleceniami dla Scannera. Odczyt nie uruchamia skryptów skills, hooków, serwerów MCP, poleceń terminala ani Copilota. |
| STD-011 | Przed odczytem rozwiązać rzeczywistą ścieżkę, także symlink i junction. Cel poza wybranym zakresem oznaczyć jako pominięty. Ograniczyć liczbę plików, rozmiar, czas i głębokość; częściowy wynik musi wskazać pominięcia. |
| STD-012 | Nie przechodzić przez zawartość `.git`, katalogi zależności, output buildu ani odrębne repozytoria/submoduły. Reguły wyłączeń mają być jawne; nie ignorować ukrytych katalogów konfiguracji. |
| STD-013 | Rozpoznawać rzeczywistą pisownię nazw. Na Windows plik o innej wielkości liter może się otworzyć, ale nie dowodzi to przenośności na Linux. Nie normalizować nazwy przed zebraniem dowodu. |
| STD-014 | Wynik opiera się na jednej migawce plików. Zmianę pliku podczas analizy zgłosić; nie łączyć metadanych starej treści z nową. Ponowne sprawdzenie jest jawną akcją. |
| STD-015 | Podgląd Markdown jest bezpiecznym podglądem tekstu: bez wykonywania HTML, skryptów, zdalnych obrazów i automatycznego otwierania linków. |
| STD-016 | Odczyt lokalnego katalogu nie dowodzi konfiguracji konta, polityki organizacji, włączenia funkcji, istnienia sekretu, dostępności modelu ani użycia pliku przez aktywną sesję. |
| STD-017 | Umożliwić jawną ocenę merytoryczną AI dla każdej z pięciu kategorii oraz ich powiązań. Bez jej uruchomienia pokazać, że sprawdzono tylko reguły lokalne. |
| STD-018 | Wysyłać do AI dokładny, wcześniej pokazany pakiet wybranych konfiguracji, ich materiałów i reguł. Wyniki statyczne, ocena AI i ograniczenia pozostają rozróżnialne. |
| STD-019 | Oceniać odpowiedzialność każdego mechanizmu i obowiązkowo uniwersalność względem technologii i architektury. Wskazać nieuzasadnione założenia, właściwe miejsce treści oraz wpływ na utrzymanie; dopuszczać jawnie uzasadnioną specjalizację. |
| STD-020 | Bez wybierania środowiska automatycznie odnajdywać dozwolone pliki konfiguracji po wskazaniu folderu i dołączać domyślnie zaznaczone treści do podglądu. Rozróżniać wykrycie pliku przez Scanner od zastosowania go przez Copilot; nie zakładać automatycznej aktywacji promptów ani użycia każdego agenta i narzędzia MCP. |

Odczyt obejmuje konfiguracje i dozwolone tekstowe materiały pomocnicze opisane
powyżej. Lista materiałów do AI jest widoczna i możliwa do zmiany przed wysłaniem.
Brak manifestu, kodu, CI lub dokumentacji architektury nie jest luką dowodową
w tym audycie i nie uzasadnia żądania dołączenia tych plików. Skrypty skilla
mogą być opisane w jego treści, lecz ich implementacja nie podlega odczytowi
ani ocenie skuteczności.

## Wyniki i kompletność oceny

| Wynik | Znaczenie |
|---|---|
| Zgodne w sprawdzonym zakresie | Konkretna reguła statyczna została spełniona. |
| Błąd | Udowodnione naruszenie jednoznacznego warunku dla rozpoznanego mechanizmu; warunki klienta wskazać osobno. |
| Zalecenie | Niespełniona dobra praktyka; nie oznacza niepoprawnego formatu. |
| Informacja | Fakt, np. mechanizm opcjonalny niewykryty albo pole ignorowane w danym kliencie. |
| Do przeglądu | Potrzebna ocena treści lub świadomy wybór konfiguracji. |
| Nie dotyczy | Reguła nie odnosi się do artefaktu lub udowodnionego zakresu klienta. |
| Niezweryfikowane | Brak danych, niepełny odczyt albo sprawdzenie wymaga środowiska. |
| Nierozstrzygnięte | Oficjalne źródła są sprzeczne lub nie precyzują zachowania. |

Ważność uwagi, jej wynik i pewność to różne pola. Sekret w konfiguracji może
wymagać pilnego działania, mimo że format JSON jest poprawny. Nie wprowadzać
jednego procentu „zgodności z GitHub” bez jawnej metodologii i mianownika.
Raport powinien pokazać liczbę artefaktów, sprawdzonych reguł, pominięć i uwag
w każdej kategorii. „Niezweryfikowane” nie jest zaliczeniem ani błędem.

Ocena AI ma własne, jednoznacznie oznaczone werdykty i pokrycie kryteriów
opisane w [kontrakcie wyniku AI](standaryzacja-ai.md#werdykty-i-dowody).
Nie zastępuje wyniku statycznego ani nie podnosi rekomendacji do wymogu GitHub.
Brak uwag modelu nie daje certyfikatu zgodności całego repozytorium.

Minimalny rekord wyniku: `ruleId`, `rulesetVersion`, `category`, `profile`,
`path`, `location`, `outcome`, `origin`, `verificationKind`, `assessmentMethod`, `message`,
`evidence`, `recommendation`, `sources[]` z URL, datą sprawdzenia i zakresem
źródła. Lista źródeł pozwala zachować obie strony rozbieżności.
To wymagania informacyjne, nie zatwierdzony kontrakt DTO lub publicznego API.

## Prywatność i granica lokalności

Pliki mogą zawierać kod, ścieżki użytkownika, nazwy serwerów i sekrety.
Wymaganiem AS jest odczyt lokalny bez automatycznej wysyłki. Po jawnej analizie
zamaskowana migawka wybranych konfiguracji i wynik są zapisywane w H2;
nie obejmuje to kodu ani wszystkich plików repozytorium. Podejrzane wartości
poufne są maskowane w raporcie i podglądzie.
Nie obiecywać wykrycia wszystkich sekretów. Użytkownik może przygotować podgląd
pakietu, a następnie jawnie zlecić wysyłkę do AI; ta czynność przesyła treść
poza komputer i może zużyć GitHub Copilot AI credits lub limit konta.
Szczegóły określa [prywatność walidacji AI](standaryzacja-ai.md#prywatność-i-wykonanie).
Eksport wybranej zapisanej analizy zawiera wynik AI i zamaskowaną migawkę plików,
także dokładny pakiet wysłany do modelu. Może nadal zawierać poufne treści;
przed udostępnieniem należy go sprawdzić. Nie wywołuje modelu ani nie odczytuje
folderu ponownie. Format `agent-scanner-standardization-analysis` v1 nie jest
obsługiwany przez import sesji. Zbiorczy eksport historii pozostaje osobnym zakresem.

„Lokalny” trzeba zdefiniować w projekcie technicznym: katalog na komputerze
przeglądarki i katalog widoczny dla procesu Spring Boot mogą być różnymi
zasobami. Wybór w UI nie może sugerować dostępu do dysku klienta, jeżeli
odczyt odbywa się na zdalnym backendzie. Należy zaprojektować rzeczywisty
mechanizm wyboru/udostępnienia katalogu, a nie zakładać, że przeglądarka
przekaże użyteczną bezwzględną ścieżkę do dowolnego pliku.

Profile użytkownika, katalog domowy, środowisko CLI, ustawienia GitHub.com
i konfiguracje organizacyjne pozostają poza zakresem samego wyboru repozytorium.
Ewentualne dołączenie ich jako dodatkowych źródeł wymaga jawnego wyboru zakresu.
Odnaleziony odnośnik do nich jest informacją, nie zgodą na odczyt.

## Metoda pracy ze źródłami

Punktem wyjścia jest
[dokumentacja GitHub Copilot](https://docs.github.com/en/copilot/).
Dokumenty kategorii podają konkretne artykuły i sekcje. Uzupełnienia
VS Code i Agent Skills są oficjalnymi źródłami wskazywanymi przez GitHub,
a nie uniwersalnymi wymaganiami wszystkich klientów.

Data analizy: **2026-09-22**. Proponowany identyfikator pierwszego zestawu:
`copilot-standardization-2026-09-22`. Jest to migawka ustaleń dokumentacyjnych,
nie wynik testu Copilota ani numer wersji dostawcy.

Przy aktualizacji:

1. Sprawdzić konkretny artykuł, profil i referencję formatu; przykład nie jest pełnym schematem.
2. Oddzielić nakaz od rekomendacji, funkcji preview i zachowania zależnego od wersji.
3. Zanotować sprzeczność źródeł oraz bezpieczny wynik walidatora. Nie wybierać arbitralnie jednego opisu jako dowodu błędu.
4. Zmienić wersję reguł i odpowiednie przypadki regresji razem, także gdy zmienia się kryterium merytoryczne AI. Wersję promptu analityka utrzymywać osobno.

Szczególnie istotne rozbieżności są zapisane przy
[instrukcjach](standaryzacja-instrukcje.md#rozbieżności-i-ograniczenia),
[agentach](standaryzacja-agenci.md#rozbieżności-i-ograniczenia),
[MCP](standaryzacja-mcp.md#rozbieżności-i-ograniczenia)
i [promptach](standaryzacja-prompty.md#rozbieżności-i-ograniczenia).

## Przekrojowe scenariusze odbioru

To wymagania przyszłych testów, nie testy wykonane w ramach tej analizy.

| Scenariusz | Oczekiwany rezultat |
|---|---|
| Repozytorium bez konfiguracji Copilot | Informacja o niewykrytych mechanizmach; brak pięciu fikcyjnych błędów. |
| Jeden plik obsługuje kilka klientów | Raport wskazuje warunkowe różnice bez uznawania jednego klienta za wybrany. |
| Katalog zawiera plik `.git` worktree | Nie odrzucać tylko dlatego, że `.git` nie jest katalogiem. |
| Nieznane pole frontmatter | Zachować pole; nie oznaczać całego pliku jako błędnego wyłącznie z tej przyczyny. |
| Niedostępny plik lub limit analizy | Częściowy raport z `Niezweryfikowane` i przyczyną. |
| Link/symlink poza korzeń | Brak odczytu celu; widoczne ograniczenie zakresu. |
| Instrukcja „uruchom ten skrypt” w skanowanym pliku | Widoczny tekst bez wykonania. |
| Poprawna konfiguracja MCP | Wyłącznie walidacja deklaracji; brak połączenia i `tools/list`. |
| Poufna wartość w nagłówku MCP | Zamaskowany dowód, bez sekretu w logu i komunikacie parsera. |
| Konflikt oficjalnych źródeł | `Nierozstrzygnięte`, oba źródła i zakres rozbieżności. |
| Zmiana pliku w trakcie skanowania | Brak pozornego wyniku dla spójnej migawki. |
| Ten sam snapshot, tryb AUTO i wersja reguł | Te same wyniki statyczne niezależnie od kolejności enumeracji plików. |
| Poprawny YAML, ale treść agenta przeczy jego opisowi | Walidacja struktury może przejść; po jawnym uruchomieniu AI powstaje osobna uwaga z dwoma fragmentami dowodów. |
| Przygotowanie podglądu AI | Lokalna operacja bez inferencji; widać wybrane pliki, reguły i pominięcia. |
| Konfiguracja linkuje manifest, kod lub dokumentację architektury | Plik docelowy nie jest wczytywany; brak tych danych nie jest błędem konfiguracji. |
| Skill zawiera wyłącznie stałe zasady współpracy | Ocena wskazuje cytaty, odpowiedni zakres instructions i uzasadnienie przeniesienia. |
| Ogólny agent narzuca framework i architekturę bez warunku | Uwaga AS-W o nieuzasadnionych założeniach i sposobie wydzielenia specjalizacji. |
| Jawnie wyspecjalizowany skill | Sprawdzenie spójności opisu, zakresu i treści, bez automatycznej kary za samą specjalizację. |
| Model próbuje oznaczyć AS-W jako `NOT_APPLICABLE` | Rekord odrzucony; kryterium widoczne jako nieocenione. |

## Zakres dalszego rozwoju

Pełna realizacja katalogu kontroli statycznych wymaga m.in. dopasowania globów,
odtwarzania hierarchii instrukcji oraz bardziej szczegółowych warunków wersji
klientów. Obecny zakres i jego ograniczenia opisano na początku dokumentu.
Żaden wynik AI nie zastępuje brakującego pomiaru działania klienta.

Hooks, pluginy, konfiguracja modeli, LSP i przygotowanie środowiska cloud agenta
są tematami sąsiednimi. Przykładowo GitHub opisuje przygotowanie zależności
w `copilot-setup-steps.yml` w
[dobrych praktykach pracy cloud agenta](https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent-to-work-on-tasks/best-practices-for-using-copilot-to-work-on-tasks).
Nie są obowiązkowymi brakami w pięciu zamówionych kategoriach. Raport ma określać
swój zakres, zamiast deklarować pełny audyt całego środowiska Copilot.
