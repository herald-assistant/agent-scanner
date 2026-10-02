# Frontend i zachowanie widoków

Status: obowiązujący kontrakt.

[Dokumentacja](README.md)

Wiążąca część [AGENTS.md](../AGENTS.md). Formuły i powiązania określa
[telemetria](telemetria.md), a zakresy wysyłki oraz walidację [kontrakt AI](ai.md).

## Spis treści

- [Wzorce Angulara](#wzorce-angulara)
- [Tryb demo](#tryb-demo)
- [Właściciele ekranów](#właściciele-ekranów)
- [Material, język i dostępność](#material-język-i-dostępność)
- [Wspólny panel szczegółów](#wspólny-panel-szczegółów)
- [Koszt i kompaktowanie](#koszt-i-kompaktowanie)
- [Narzędzia](#narzędzia)
- [Mapa pracy](#mapa-pracy)
- [Poradnik i AI Hub](#poradnik-i-ai-hub)
- [Konfiguracja i komunikaty](#konfiguracja-i-komunikaty)

## Wzorce Angulara

- Komponenty standalone z `ChangeDetectionStrategy.OnPush`.
- `input()` i `output()` do komunikacji, `signal()`/`computed()` do stanu,
  `inject()` do zależności; w template wbudowane `@if` i `@for`.
- Strict TypeScript i strict templates, bez `any` i niebezpiecznych rzutowań.
- Signal input jest tylko do odczytu: rodzic używa `[messages]="messages()"`,
  dziecko `this.messages()`. Two-way binding wymaga pasującego outputu.
- Interpretacja sesji należy do `scanner-core` i jego serwisów fasadowych,
  operacje do `ScannerDataGateway`, transport HTTP do `ScannerApiService`,
  snackbary do `NotificationService`, a lokalny stan i formatowanie do funkcji.
- `AppComponent` jest korzeniem kompozycji. Nie dodawaj tam interpretacji domenowej
  ani renderowania funkcji, które mają własnego właściciela.
- Wydzielaj komponent dla zachowania, stanu lub powtarzalnego kontraktu wizualnego;
  nie twórz komponentów jedynie przekazujących dane. Pliki `.ts/.html/.css/.spec.ts`
  trzymaj razem.
- Sortuj raz na granicy analizy. Używaj `WeakMap` do często parsowanych atrybutów
  i JSON-u spanu; nie parsuj `attributesJson` ponownie z wyrażeń w template.
- Obecność metryki sprawdzaj w źródłowych atrybutach, nie w znormalizowanym zerze.

## Właściciele ekranów

| Komponent | Odpowiedzialność |
|---|---|
| `TopbarComponent` | Zwijanie/rozwijanie panelu sesji w miejscu znaku aplikacji, status odbiornika, konfiguracja, poradnik technik i pauza. |
| `SessionSidebarComponent` / `SessionImportDialogComponent` | Wybór sesji, ikonowy import Copilot OTel JSONL, modal wyboru jednej rozmowy przez HTTP lub wielu w demo oraz zwijana lista repozytoriów i zapisanych analiz. |
| `CostDashboardComponent` | Bilans sesji i porównywalne rozliczenie wywołań. |
| `ToolOptimizationOverviewComponent` | Globalne zestawienie narzędzi bez AI. |
| `ToolDefinitionDialogComponent` | Wersje definicji i dowody potencjalnych powtórzeń. |
| `InteractionTimelineComponent` | Interakcje, rundy, subagenci, wywołania pomocnicze i alerty. |
| `RoundDetailsDialogComponent` / `RoundDetailsAsideComponent` | Faktyczny materiał wybranej granicy przepływu we wspólnym panelu. |
| `ContextCompactionDetailsComponent` | Instrukcje, request, wynik i potwierdzone skutki kompaktowania. |
| `WorkflowViewComponent` | Faktograficzna mapa, warstwy i otwieranie szczegółów rund. |
| `AiHubComponent` | Quick Analysis, podział credits, poradnik i wejścia do rozmów. |
| `SessionChatDialogComponent` | Nowa lub wznowiona rozmowa, historia, narzędzia i dowody. |
| `OptimizationGuidanceComponent` | Katalog technik, filtrowanie, szczegóły i kopiowanie planu próby. |
| `TechnicalViewComponent` | Filtrowalne drzewo spanów i raw signals. |
| `StandardizationComponent` / `StandardizationFileDialogComponent` | Wybór folderu, plików i modelu, podgląd wysyłki oraz zgodności i zalecenia przy pliku. |

Właścicieli analiz `core`, routingu i ładowania opisuje [architektura](architektura.md).

## Tryb demo

Build `demo` wybiera lokalny gateway, IndexedDB i routing hash. Strona startowa
pokazuje konfigurację eksportera `file`; status opisuje lokalny zapis. Demo nie
odczytuje `/api` ani `/v1`, historii Standaryzacji, cache AI ani katalogu modeli.
Nie pokazuje globalnych liczników logów/metryk ani retencji jako lokalnych pomiarów.

Modal importu wymaga jawnego wyboru checkboxami i pokazuje osobno rundy główne,
subagentów i wywołania pomocnicze. Już zapisane zakresy są nieaktywne. Escape,
backdrop i Anuluj zwalniają podgląd bez zapisu. Długi odczyt można przerwać przez
„Anuluj odczyt”, co kończy Workera. Przy zatwierdzaniu UI pokazuje zapis i blokuje
kolejny import; sukces następuje dopiero po zatwierdzeniu całej transakcji.
Otwiera się Podsumowanie pierwszej wybranej rozmowy według kolejności podglądu.
Pozostałe lokalne zakładki i wspólne panele działają po odświeżeniu strony.

`FeatureAvailability` otwiera jeden modal Material „Dostępne w pełnej wersji”
z treścią „Ta funkcja jest dostępna w pełnej wersji Agent Scanner. W demo możesz
importować i przeglądać sesje lokalnie.” Dotyczy AI Hub, rozmów, klasyfikacji,
doradztwa, Standaryzacji oraz ustawień i pauzy odbiornika. Kliknięcie AI Hub
zachowuje aktualną zakładkę. Bezpośrednia trasa AI wraca do Podsumowania sesji,
a trasa repozytorium do strony startowej, przed montowaniem komponentu.
Brak danych w telemetrii pozostaje stanem danych bez tego modalu.

Eksport pobiera `agent-scanner-session` v1 z zakresem głównym i `relatedDetails`;
object URL zostaje zwolniony. To kopia materiału źródłowego, nie wejście importu
JSONL. Usunięcie sesji lub całości wymaga potwierdzenia i obejmuje lokalny raw.
Poradnik pobiera statyczny katalog z jednego źródła backendowego, kopiowanego
w przygotowaniu buildu. Nie inicjuje doradztwa AI.

## Material, język i dostępność

Używaj `MatDialog`, `MatTooltip`, `MatSnackBar`, `MatIcon` z Material Symbols
i `MatSidenav`. Globalny `MAT_ICON_DEFAULT_OPTIONS` z font set
`material-symbols-outlined` pozostaje w `app.config.ts`, także dla dynamicznych
dialogów. Testy tras i dialogów sprawdzają rozwiązaną klasę font set.

Oko otwiera powierzchnię inspekcji, chevron rozwija treść w miejscu bez dodatkowego
„Pokaż”. Przyciski ikonowe mają `aria-label` i pomocny tooltip Material.
Informacyjne ikony korzystają ze wspólnej `.info-tip`.
Znak aplikacji w topbarze odsłania ikonę zwijania lub rozwijania panelu sesji po
najechaniu i przy fokusie klawiatury; na urządzeniach bez hover ikona jest widoczna.

UI jest po polsku. Zachowuj etykiety `Nowy input`, `Input z cache` / `Cache read`,
`Input łącznie`, `Output`, `Credits`, `Okno przy wysłaniu`,
`Co dokładnie Agent przekazał modelowi` i `Co zwrócił model`.
Nie duplikuj nagłówków ani pomiarów widocznych już na belce rundy.
Tokeny kolorów, typografii, geometrii, fokus i reduced motion określa
[standard stylowania](stylowanie.md); feature CSS odpowiada za układ i wizualizację domeny.

## Wspólny panel szczegółów

Rundy, subagenci, kompaktowanie i wywołania pomocnicze korzystają ze wspólnego
prawego aside. Zamyka się przyciskiem, Escape i backdropem, po czym przywraca
fokus do kontrolki otwierającej. `scrollbar-gutter` stabilizuje szerokość kolumn.
Nagłówek zawiera poprzednią/następną rundę w sekwencji przekazanej przez opener.

Panel pokazuje dokładny początkowy request, cykl `M → A → M` lub końcową odpowiedź,
zależnie od wybranej granicy. Wyniki wykonania pozostają między odpowiedzią
modelu a otrzymującym je requestem; nie są częścią „Co zwrócił model”.
Wynik toola łącz po call ID z nazwą i argumentami wcześniejszego żądania.
Pokazuj jedną płaską kartę; duplikat wiadomości pod `Surowa wiadomość` jest zwinięty.
Nie rekonstruuj brakującej odpowiedzi ze spanów wykonania.

Parametry requestu, metadane przyrostowe i duży raw zaczynają zwinięte.
Pomiń części niewysłane ponownie dzięki zachowaniu stanu odpowiedzi. Nie powielaj
osobnej listy wyników wcześniejszych narzędzi, jeżeli znajdują się już w messages.
Pełny zwrot subagenta, w tym `gen_ai.tool.call.result`, musi pozostać dostępny
w ograniczonym, niezależnie przewijanym kontenerze, bez cichego skracania.
Subagent otrzymuje te same szczegóły rund co główny agent.

## Koszt i kompaktowanie

Zakładki mają kolejność: `Podsumowanie`, `Koszt i przebieg`, `Mapa pracy`,
`AI Hub`, `Dane techniczne`. KPI pozostają w widoku kosztu, bez kopii w danych
technicznych. Wiersz `Cała sesja` jest rozłączną sumą głównego agenta,
jednoznacznie powiązanych subagentów i kompaktowań.

Standaryzacja działa niezależnie od telemetrii wybranej sesji. Pod nagłówkiem
`Repozytoria`, ułożonym jak nagłówek `Sesje`, są bezpośrednio klikalne karty
zapisanych analiz. Lista pokazuje 5 najnowszych analiz i odsłania kolejne po 5;
same karty nie są zwijane. Nagłówek można zwinąć, a przycisk dodawania otwiera
nową analizę. Zakończone analizy są zapisywane lokalnie w H2.
Odczytywalne pliki są domyślnie zaznaczone. Kliknięcie `Uruchom analizę`
przygotowuje zamrożony pakiet i rozpoczyna jawne wywołanie AI bez osobnej karty
podglądu. Przed kliknięciem dostępna jest lista i treść wybranych plików.
Szczegóły i ograniczenia opisuje [kontrakt Standaryzacji](standaryzacja.md).

Zwijane rozliczenie pokazuje agenta głównego, potem subagentów chronologicznie,
a następnie kompaktowania chronologicznie. Wspólne kolumny to nowy input,
cache read, cache write, output, czas modeli i credits. Czas modeli sumuje
wyemitowane czasy wywołań; czas ścienny sesji pozostaje w nagłówku.
Nie dodawaj osobnego zestawu redundantnych kart input/output dla kompaktowania.

Gdy choć jedna runda w widocznej liście emituje cache write, wszystkie belki
pokazują tę kolumnę obok outputu, a brak wartości jako `—`.
Wywołania pomocnicze pod listą interakcji są początkowo zwinięte.

Belka kompaktowania pokazuje model ze spanu albo jawny brak nazwy oraz zmierzone
tokeny, czas i credits, także bez późniejszego requestu. W aside sekcja
„Co zlecono modelowi” łączy systemowe zasady i format, instrukcję kompaktowania
oraz opcjonalną instrukcję użytkownika. Dalej pokazuje messages, definicje i wynik.
Pomiar przed/po wymaga potwierdzonego odbioru wyniku. Sukces lub rehydratacja
wymagają fixture'u emitera; sam spadek inputu nie jest dowodem.

## Narzędzia

Globalny audyt pod bilansem obejmuje głównego agenta i jednoznacznie powiązanych
subagentów. Czysta analiza należy do `tool-usage-analysis.ts`.
Karta zaczyna zwinięta; dostępny chevron rozwija ją w miejscu. Ma zakładki
`Niewykorzystane` i `Wykorzystane`. Stan niewykorzystany wymaga przechwyconego
outputu każdej odpowiedzi, przy której bezpośrednio widziano definicję narzędzia.
Niepełny capture pozostaje nieustalony.

| Kolumna | Reguła |
|---|---|
| Definicja | Każda bezpośrednio przechwycona ekspozycja. Udział znaków definicji w całym przechwyconym requestcie × wyemitowany input; fallback to kalibracja modelu, a potem 4,25 znaku/token. |
| Żądanie M → A | Treść przechwyconych wywołań narzędzia w odpowiedzi modelu; output. |
| Pierwszy wynik A → M | Wynik powiązany dokładnym call ID, liczony raz przy pierwszym odbiorze przez model. |
| Późniejszy cache wyniku | Dla kolejnych przechwyconych odbiorów przed najbliższym kompaktowaniem: estymowane tokeny wyniku × cache read / input danego odbierającego requestu. Pokazuj pokrycie; brak metryki pozostaje `—`. |

Wszystkie estymacje fragmentów mają `≈`, bez przeliczania na credits. Nie dowodzą
umieszczenia konkretnego fragmentu w cache. Pomocnicze sortowanie używa
`(definicja + pierwszy wynik + późniejszy cache) + 10 × żądania M → A`.
Nie pokazuj surowej sumy ani wspólnej kolumny żądania i wyniku.

Definicje używają cyjanu cache read. Tooltip objaśnia obliczenie i fakt, że suma
już obejmuje wszystkie ekspozycje; nie tłumaczy koloru i nie każe mnożyć przez
liczbę rund. Tekst zakładki wyjaśnia udział definicji w inpucie i wskazuje konsolę
agenta VS Code oraz konfigurację `tools`/toolsetów jako miejsca eksperymentu.
Wszystkie wiersze mają tę samą neutralną białą ikonę narzędzia; czerwone wyróżnienie
stanu należy do pilla `Niewykorzystane`, nie do ikony wyłącznika.

Kliknięcie tożsamości toola otwiera modal wszystkich kanonicznych wersji definicji:
opis, parametry najwyższego poziomu, typ, required/optional i enum. Pełny JSON jest
w zwijanej sekcji, także dla nieobsługiwanych pól schematu. Tool widziany tylko
w żądaniu pokazuje jawny brak definicji.

Potencjalnym powtórzeniem jest każde wywołanie po pierwszym z tą samą nazwą
i kanonicznymi, przechwyconymi argumentami w całej powiązanej sesji. Granice
agentów i kompaktowania nie resetują porównania; brak argumentów wyklucza je.
Tabela pokazuje liczbę, czerwoną tylko powyżej zera. Modal rozdziela:

- nakładające się liczniki między agentami i po kompaktowaniu;
- rozłączne stany wyników: identyczny, różny lub nieprzechwycony, tylko według
  dokładnych call-ID receipts;
- każdą powtarzaną sygnaturę: pełne kanoniczne argumenty, pierwszą rundę,
  rundy powtórzeń, etykiety `M…` / `S…:M…` i liczbę powtórzeń.

Normalizuj jedynie równoważną transportową otoczkę pojedynczej części tekstowej;
nie normalizuj treści, kolejności linii ani struktury rezultatu. Długi JSON
pozostaje przewijalny, bez ukrytego skracania. Licznik nie dowodzi nieefektywności.

## Mapa pracy

Mapa pokazuje fakty bez klasyfikacji, zagregowanych faz i kontrolek rozmowy.
Zaczyna od wyemitowanego zlecenia i drogi rund/agentów. Diagram jest początkowo
rozwinięty; tabele liczbowe i raw pozostają zwinięte. Kliknięcie rundy otwiera
wspólny panel faktów. Nie dubluj pomiarów rundy ani ogólnych kart interpretacji
i pokrycia pod diagramem.

Oddzielaj zakres całej powiązanej sesji od wybranej interakcji. Kompaktowanie
nie jest rundą agenta i ma osobny licznik. Dokładnie powiązane kompaktowania
mają cyjanowe przyciski zdarzeń na granicy interakcji. Główna ścieżka zaczyna
się limonkowym przyciskiem interakcji użytkownika; ostatni pomarańczowy `M…`
oznacza odpowiedź końcową bez drugiego węzła zakończenia. Wszystkie te elementy
otwierają istniejące panele requestu, kompaktowania i odpowiedzi.

Subagenci mają stabilne etykiety `Subagent N` i wyemitowaną nazwę jako opis.
Długie mapy obsługują widoczną nawigację poziomą, przeciąganie tła i zwykły scroll.
Krótkie mają stałą szerokość kolumn; nie rozciągaj geometrii, punktów ani tekstu
SVG do szerokości ekranu. Warstwa `Tokeny` pokazuje skumulowane wykresy fresh input,
cache read, output i wyemitowanego cache write jeden nad drugim. Każda metryka
ma własną skalę pionową i wartości przy pomiarach.

## Poradnik i AI Hub

Katalog `techniques-v1` zawiera T01–T16. Jest dostępny z topbara bez sesji
i konfiguracji AI; otwieranie, filtrowanie i kopiowanie planu próby są lokalne.
Treść redakcyjna pozostaje w zasobie JSON, nie w template. Technika zaczyna od
konkretnego problemu, spodziewanego obserwowalnego rezultatu i metody sprawdzenia
przed/po. Praktyczny przykład, warunki, nakład, utrzymanie i jakość są częścią
techniki; propozycja nie gwarantuje oszczędności.

`optimization-technique-matcher.ts` odpowiada za statyczny dobór i deduplikację.
Kategoria lub kompaktowanie otwierają ten sam poradnik z zakresem, pochodzeniem,
credits i pokryciem. Udziały kategorii mają `≈`; kompaktowanie może mieć wejście
bez klasyfikacji. Odnośnik do dokładnej rundy lub kompaktowania otwiera panel
faktów nad poradnikiem. `Wróć do techniki` zachowuje wybór, rozwinięcia i scroll.
Karta fazy sama nie jest kontrolką inspekcji.

AI Hub odczytuje cache i lekki indeks rozmów bez inferencji. Quick Analysis
wybiera interakcję i pokazuje podział credits; rozmowa obejmuje całą zamrożoną
sesję, z rundą wskazaną w wiadomości. Kategorie i techniczne szczegóły atrybucji
nie trafiają do faktograficznego panelu rundy. Kontrakty przygotowania podglądu,
jawnego wysłania, narzędzi analityka i walidacji są w [AI](ai.md).

## Konfiguracja i komunikaty

W pełnej wersji onboarding i konfiguracja VS Code pokazują kompletny poprawny JSON z eksportem
OTel, `http://localhost:8081`, `http/protobuf` i capture content.
Dodanie emitera wymaga instrukcji, zanonimizowanego fixture'u i potwierdzenia
grupowania; sam wspólny OTLP nie potwierdza zgodności.
Błędy przejściowe i wynik importu pokazuj w snackbarach, bez bannerów u góry strony.
Import przyjmuje `.jsonl`/`.ndjson` z eksportera plikowego Copilot. Po odczycie
przez wybrany adapter zawsze otwiera modal, także dla jednej sesji. W pełnej wersji użytkownik wybiera
jedną pozycję i potwierdza zapis; anulowanie, Escape lub backdrop nie zapisują
danych. Podgląd pokazuje identyfikator, czas, model, liczbę rund/spanów,
powiązanych subagentów, obecność treści i istniejące dane. Zapisane pozycje są
nieaktywne. Modal pełnej wersji informuje o przesłaniu pliku do backendu i prywatności zapisu;
modal demo o przetwarzaniu i zapisie tylko w przeglądarce.
Po udanym imporcie odśwież listę sesji i otwórz zaimportowaną sesję.
