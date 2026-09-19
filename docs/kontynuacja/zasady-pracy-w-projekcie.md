# Zasady pracy w projekcie

Stan dokumentu: 2026-09-06.

Ten dokument jest polskim przewodnikiem operacyjnym. Wiążące instrukcje dla
agenta znajdują się w [`AGENTS.md`](../../AGENTS.md). W razie różnicy pierwszeństwo
ma aktualne żądanie użytkownika, następnie `AGENTS.md`, potem ten dokument i
konwencje najbliższego kodu.

## Przed rozpoczęciem zmiany

1. Uruchom `git status --short`.
2. Załóż, że istniejące niezacommitowane zmiany należą do użytkownika lub
   wcześniejszej części tej samej pracy.
3. Nie wykonuj `git reset`, `git clean`, masowego formatowania ani zamiany końców
   linii w całym repozytorium.
4. Przeczytaj kod właściciela funkcji i jego testy.
5. Ustal, czy zmiana dotyczy transportu, normalizacji, persystencji, API,
   interpretacji domenowej czy samej prezentacji.
6. Jeżeli zmienia znaczenie danych, najpierw sprawdź raw telemetry lub anonimowy
   fixture emitera.

## Granice warstw

| Problem | Właściciel |
|---|---|
| Content type, gzip, limity requestu OTLP | `OtlpController` |
| Parse protobuf/JSON, ekstrakcja stabilnych pól | `OtlpIngestionService` |
| SQL, retencja, merge sesji | `ScannerStore` |
| DTO i kontrakt HTTP | `ApiView`, kontrolery API |
| Interpretacja całej sesji i epizodów | serwisy `core` Angulara |
| Rekonstrukcja subagentów | `session-episodes.ts`, `WorkflowAnalysisService` |
| Parse odpowiedzi i tool calli | `model-response.ts` |
| Zakres wysyłany do AI | `flow-tool-catalog.ts` |
| Prompt i walidacja AI | backendowy `ToolClassificationService` |
| Estymacja credits kategorii | `action-credit-attribution.ts` |
| Hierarchia i interakcje mapy | `WorkflowViewComponent` |
| Faktograficzny panel rundy | `RoundDetails*` |

Nie przenoś provider-specific parsing do template. Nie każ backendowi emitować
polskich etykiet prezentacyjnych. Nie dodawaj logiki domenowej do `AppComponent`,
jeżeli ma już naturalnego właściciela w `core` lub komponencie funkcji.

## Reguły backendu

### OTLP

- Zachowuj pełny raw sygnał i nie odrzucaj nieznanych atrybutów.
- Limit dotyczy rozpakowanego payloadu; nie dekompresuj do nieograniczonego bufora.
- Pauza potwierdza poprawny request, ale nie zapisuje go. Import omija pauzę.
- Wadliwy opcjonalny atrybut nie może odrzucić całego batcha.
- Tożsamość sesji ustalaj per span, a nie przez kolejność elementów batcha.

### SQL i baza

- Używaj zapytań parametryzowanych.
- Zachowuj kaskadowe usuwanie raw i znormalizowanych rekordów.
- Nie traktuj `IF NOT EXISTS` jako migracji istniejącej kolumny.
- Przy zmianie agregacji sesji sprawdź, czy metryka providera jest narastająca czy
  per request i dodaj fixture wielobatchowy.
- Breaking change eksportu wymaga nowej wersji formatu i testu importu.

### API

- Synchronizuj DTO Java z interfejsami TypeScript.
- Błędy użytkownika zwracaj po polsku, bez stack trace i surowych sekretów.
- Waliduj limity przed uruchomieniem AI.
- Nie dodawaj płatnej analizy do GET-u, pollingu, startu ani zwykłego testu.

### Copilot SDK

- Klient klasyfikacji jest jednorazowy i tekstowy.
- Tools, MCP, skille, pluginy, instrukcje repozytorium, pamięć i operacje Git
  pozostają wyłączone.
- Token jest wyłącznie po stronie backendu i nie trafia do logów ani response.
- Model musi pochodzić z listy dostępnej dla skonfigurowanego konta.
- Zachowuj ścisłą walidację kompletności odpowiedzi i wersję promptu.
- Zmiana semantyki promptu wymaga zmiany wersji/hash i testów walidatora.

## Reguły frontendu

### Angular

- Komponenty standalone używają `ChangeDetectionStrategy.OnPush`.
- Stosuj `input()`, `output()`, `signal()`, `computed()` i `inject()`.
- Zachowuj strict TypeScript i strict templates; nie wprowadzaj `any`.
- Używaj wbudowanych `@if` i `@for`.
- Signal input jest tylko do odczytu; nie przypisuj do niego i nie twórz two-way
  bindingu bez jawnego outputu.
- Parsuj i sortuj dane raz na granicy analizy. Dla często czytanych atrybutów
  zachowuj `WeakMap` cache.

### Wzorce interakcji

- Ikona oka otwiera panel inspekcji.
- Chevron rozwija treść w miejscu.
- Ikonowy button ma `aria-label` i, gdy pomaga, Material tooltip.
- Wszystkie tooltipy realizuje `MatTooltip`.
- Szczegóły rund, subagentów i auxiliary calls korzystają ze wspólnego prawego
  aside, zamykanego przyciskiem, Escape lub backdropem.
- Panel przywraca fokus do kontrolki otwierającej.
- Duże raw dane mają własny ograniczony scroll container.

### Hierarchia UI

- Najpierw pokaż cel i przepływ, później liczby oraz raw dane.
- Nie duplikuj tej samej metryki w kilku sąsiednich sekcjach.
- Nie pokazuj implementacyjnego ID, jeśli nie pomaga w audycie.
- Brak pomiaru prezentuj jako `—` albo jasny komunikat, nie `0`.
- Przybliżenie ma znak `≈`.
- Credits mają kolor ciepły/amber i nazwę `Credits`, bez waluty.
- Nowy input jest limonkowy, cache read turkusowy, output ma osobny kolor,
  cache write fioletowy, potwierdzony błąd czerwony.

### Mapa pracy

- Tryb `Fakty` musi działać bez konfiguracji AI.
- Przełącznik `Kategorie / Fakty` nie uruchamia requestu.
- Kategorie zmieniają podpisy i agregaty, ale nie modyfikują raw przebiegu.
- Podział kategorii jest statycznym procentowym zestawieniem.
- Zagregowane fazy są nieinteraktywne i wskazują rundy do odnalezienia na mapie.
- Szczegółowy diagram jest osobną sekcją, początkowo rozwiniętą.
- Zawijane karty zachowują strzałki skierowane w prawo; nie dodawaj numeracji faz.
- Kliknięcie rundy otwiera uniwersalny, faktograficzny panel `M → A → M`.

## Reguły semantyczne

- Fakty, deterministyczne formuły i AI muszą być wizualnie oraz pojęciowo
  rozdzielone.
- Nie klasyfikuj celu zadania zamiast widocznego żądania modelu.
- Nie używaj wyniku wykonania do zmiany kategorii wcześniejszej odpowiedzi.
- Nie przesuwaj credits następnej rundy do wcześniejszej jako faktu.
- Nie sumuj poddrzewa subagenta drugi raz.
- Nie utożsamiaj narzędzia uniwersalnego z nieefektywnością.
- Nie utożsamiaj `fit=DIRECT` z jakością albo oszczędnością.
- Nie przypisuj subagenta po nazwie lub czasie, gdy brakuje jednoznacznego ID.
- Nie oznaczaj błędu na podstawie nietypowego kosztu, czasu albo zachowania.

Szczegółowe formuły są w
[semantyce telemetrii](semantyka-telemetrii-i-zasady-interpretacji.md).

## Testy

### Kiedy wystarcza test frontendowy

Zmiana prezentacji lub czysto frontendowej interpretacji wymaga odpowiedniego
testu komponentu albo modułu `core` oraz produkcyjnego buildu:

```powershell
cd frontend
npm test -- --watch=false
npm run build
```

Nie dodawaj testu, który tylko powtarza prostą regułę CSS. Dodaj test, gdy zmiana
dotyczy kolejności sekcji, brakujących danych, agregacji, nawigacji lub warunku
widoczności.

### Kiedy potrzebny jest backend

Zmiana ingestu, API, SQL, walidacji AI lub konfiguracji wymaga:

```powershell
mvn "-Dskip.frontend=true" test
```

Zmiana zależności, Maven frontend plugin albo paczkowania wymaga:

```powershell
mvn clean package
```

Na PowerShell cytuj argument Maven `-D...`. Produkcyjny build Angulara zapisuje
pliki do `target/classes/static`; nie commituj wygenerowanego outputu.

## Fixture'y

- Używaj syntetycznych danych jako domyślnego kontraktu.
- Regresję konkretnego providera zapisuj jako wersjonowany, anonimowy fixture.
- Zachowaj strukturę spanów i atrybutów potrzebną do reprodukcji.
- Usuń prompt, kod, repo URL, nazwy użytkowników, ścieżki domowe, ID, sekrety i
  unikalne timestampy.
- Opisz pochodzenie i istotny kształt w `src/test/resources/fixtures/README.md`.
- Test powinien wykazać raw preservation, normalizację, grupowanie oraz metryki.

## Prywatność

- Każdy payload, prompt, argument i wynik narzędzia traktuj jako poufny.
- Nie drukuj realnej telemetrii w outputach testów.
- Nie commituj `config/application.properties`, tokena ani bazy H2.
- Import i eksport mogą zawierać tę samą treść co raw telemetry; zachowuj
  ostrzeżenia w UI.
- Nie dodawaj chmurowego storage, analytics ani dodatkowej wysyłki bez jawnej
  decyzji użytkownika i modelu prywatności.

## Typowe pułapki

### `npm ci` zwraca `EPERM` na Windows

Plik natywnego modułu może być otwarty przez działający dev server, test runner,
IDE lub antywirusa. Ustal proces blokujący i zamknij go przed ponownym `npm ci`.
Nie usuwaj rekursywnie katalogów na podstawie niesprawdzonej ścieżki.

### Copilot CLI zwraca `Unhandled method connect/runtime.shutdown`

Sprawdź zgodność Copilot CLI z SDK 1.0.11 i konfigurację ścieżki. Aktualna
implementacja korzysta z właściwego startu klienta oraz `forceStop()` przy
sprzątaniu. Nie wracaj do ręcznego RPC ani nie ignoruj błędu autoryzacji.

### Dokumentacja i UI się rozjeżdżają

Nazwy przycisków i kolejność sekcji zmieniały się podczas iteracji. Przed zmianą
tekstu porównaj dokument z aktualnym template i zaktualizuj wszystkie bieżące
źródła dokumentacji. Historyczny dokument deterministycznych profili nie opisuje
obecnych etykiet kategorii.

## Definition of done

Zmiana jest gotowa, gdy:

- zachowuje zasadę dowód przed wnioskiem;
- znajduje się w prawidłowej warstwie;
- nie zmienia po cichu API, retencji ani formatu eksportu;
- brak danych pozostaje jawny;
- UI jest po polsku, dostępne i spójne wizualnie;
- właściwe testy i build przechodzą;
- dokumentacja opisuje aktualne zachowanie;
- diff nie zawiera sekretów, realnej telemetrii ani wygenerowanych artefaktów.
