# Plan wydzielenia AI Hub i uproszczenia Mapy pracy

Stan dokumentu: 2026-09-20.  
Status: zaimplementowany.  
Zakres: frontend, kontrakt REST rozmów, backend rozmów, trwałość danych i testy.

## 1. Decyzja produktowa

Widok sesji otrzymuje osobną zakładkę `AI Hub`, umieszczoną pomiędzy
`Mapa pracy` i `Dane techniczne`.

Docelowy podział odpowiedzialności:

| Zakładka | Odpowiedzialność |
|---|---|
| `Podsumowanie` | adopcja agenta AI i konfiguracja wykryta w telemetrii |
| `Koszt i przebieg` | faktyczne koszty, rundy, narzędzia i przebieg interakcji |
| `Mapa pracy` | wyłącznie deterministyczna mapa sesji z warstwami `Kontekst`, `Tokeny`, `Credits` |
| `AI Hub` | jawnie uruchamiana analiza AI oraz rozmowy o całej sesji |
| `Dane techniczne` | surowe i znormalizowane dane techniczne |

Z `Mapy pracy` znikają:

- przełącznik `Kategorie / Fakty`;
- uruchamianie klasyfikacji AI;
- kategorie AI na węzłach mapy;
- `PODZIAŁ CREDITS WEDŁUG KATEGORII`;
- cały `ZAGREGOWANY PRZEBIEG`;
- akcje `Zapytaj o sesję`, `Zapytaj o rundy` i `Poprzednie rozmowy`;
- tryb zaznaczania zakresu rund;
- profile kategorii agentów i subagentów;
- komunikaty o stanie klasyfikacji AI w stopce mapy.

`ZAGREGOWANY PRZEBIEG` zostaje usunięty z produktu, a nie przeniesiony.

## 2. Docelowy wygląd AI Hub

`AI Hub` jest stroną wewnątrz sesji, nie kolejnym wariantem mapy. Składa się z
dwóch niezależnych sekcji.

### 2.1. AI Quick Analysis

Sekcja przejmuje obecne oszacowanie `PODZIAŁ CREDITS WEDŁUG KATEGORII`.

Stan przed analizą:

- krótka informacja, jakie dane zostaną wysłane;
- model używany do klasyfikacji;
- estymacja wielkości requestu i odpowiedzi;
- informacja, że operacja zużywa limit konta;
- przycisk `Uruchom Quick Analysis`;
- ewentualny zapisany wynik jest odczytywany lokalnie i nie uruchamia modelu.

Stan po analizie:

- `Gdzie zużyto credits?`;
- pokrycie klasyfikacji i pomiarów credits;
- lista kategorii posortowana według oszacowanego udziału;
- jawne `≈` dla estymowanego przypisania credits;
- osobna, nieestymowana pozycja kompaktowania, jeśli wystąpiło;
- przejście do faktycznych dowodów rundy;
- dotychczasowe akcje `Poznaj techniki`, jeśli mają zweryfikowany kontekst.

Nie pokazujemy:

- zagregowanych faz;
- profili agentów;
- kategorii naniesionych na diagram;
- kopii całej mapy pracy.

Jeżeli sesja zawiera wiele interakcji, `AI Quick Analysis` ma własny jawny
selektor interakcji. Nie może polegać na ukrytym stanie pozostawionym w zakładce
`Mapa pracy`.

### 2.2. AI Chat

Sekcja pokazuje:

- krótki opis dostępu analityka: cała zapisana sesja, tylko odczyt;
- `Nowa rozmowa`;
- `Kontynuuj ostatnią rozmowę`, jeśli istnieje;
- `Poprzednie rozmowy` z licznikiem;
- model ostatniej rozmowy i czas ostatniej aktywności jako dane pomocnicze.

`Nowa rozmowa` otwiera obecny duży modal chatu. `Poprzednie rozmowy` otwiera
istniejący osobny modal historii. Wybranie rekordu historii otwiera od razu
konkretną rozmowę.

Otwarcie zakładki, historii albo pustego modala nie uruchamia inferencji.
Inferencja następuje dopiero po jawnej wysyłce pierwszej wiadomości.

## 3. Usunięcie focus z rozmów

Focus wskazanych rund zostaje całkowicie usunięty z interfejsu i kontraktu.

Użytkownik może napisać w pierwszej wiadomości na przykład:

```text
Przeanalizuj, dlaczego między M3 i M6 agent wykonał tyle odczytów.
```

AI ma dostęp do całej zamrożonej sesji i może przez narzędzia Scannera odnaleźć
wskazane rundy oraz potrzebny wcześniejszy kontekst.

Do usunięcia:

- `SessionChatFocus` w modelu TypeScript;
- `focus` z `SessionChatView`;
- `focusRoundRefs`, `focusLabel` i `actorLabel` z danych modala;
- parametr `roundRefs` w `createSessionChat`;
- `SessionChat.Focus` w backendzie;
- focus z requestu tworzenia rozmowy;
- focus z bootstrapu i promptu;
- `focus_json` z rekordu i tabeli `session_chat`;
- teksty `Punkt startowy` i `bez wskazanych rund`;
- wszystkie testy wyboru ciągłego zakresu dla rozmowy.

Nowy request:

```http
POST /api/ai/session-chats?sessionId=321
Content-Type: application/json

{
  "model": "gpt-5.3-codex"
}
```

Nowy response nie zawiera pola `focus`. Nie utrzymujemy równoległego starego
kontraktu ani numeru wersji tylko dla tej zmiany.

Istniejące rozmowy zachowują tury, model, cutoff i identyfikator sesji SDK.
Wymagana jest jawna migracja H2 usuwająca `focus_json`; nie polegamy wyłącznie na
`CREATE TABLE IF NOT EXISTS`. Migracja ma działać zarówno dla istniejącej bazy,
jak i dla nowej instalacji.

## 4. Docelowa architektura frontendu

```text
SessionPageComponent
  ├─ WorkflowViewComponent
  │    └─ wyłącznie faktyczna mapa i warstwy pomiarowe
  │
  └─ AiHubComponent
       ├─ AiQuickAnalysisComponent
       │    └─ klasyfikacja + podział credits
       └─ AiChatLauncherComponent
            ├─ SessionChatDialogComponent
            └─ SessionChatHistoryDialogComponent
```

### 4.1. SessionPageComponent

Zmiany:

- rozszerzyć `Tab` o `'ai-hub'`;
- dodać przycisk `AI Hub` między mapą i danymi technicznymi;
- wywoływać przygotowanie wspólnego modelu workflow po wejściu do `workflow`
  albo `ai-hub`;
- zachować jeden cache `workflowState` dla obu zakładek;
- renderować `AiHubComponent` tylko dla aktywnej zakładki;
- przenieść nawigację do dowodów poza instancję widoku mapy, ponieważ mapa nie
  jest zamontowana podczas pracy w AI Hub;
- nie uruchamiać klasyfikacji ani pobierania historii przy wejściu na inne
  zakładki.

Metodę `loadWorkflow` warto przemianować na `loadSessionGraph` albo
`loadWorkflowAnalysis`, ponieważ przygotowany model będzie zasilał dwa widoki.

### 4.2. WorkflowViewComponent po odchudzeniu

Komponent zachowuje:

- mapę głównego agenta i subagentów;
- wybór interakcji;
- warstwy `Kontekst`, `Tokeny`, `Credits`;
- nawigację poziomą dużej mapy;
- faktyczne otwieranie rund, startu interakcji, odpowiedzi i kompaktowania;
- deterministyczne etykiety oparte na narzędziach i telemetrii;
- informacje o pokryciu i brakach danych.

Komponent traci:

- `ToolClassificationService`;
- `aiVisible`, `viewChosen`, `hasAiResult`, `aiResult` i `classifying`;
- `setAnalysisView` i `classifyTools`;
- `roundActions`, `agentProfiles`, `actionSummary` i `creditCategories`;
- `aggregatedPhases` oraz zależne typy i metody;
- `roundRangeMode`, anchor, end i wszystkie metody wyboru zakresu;
- otwieranie chatu i historii;
- emisję porad dla kategorii oraz faz;
- klasy AI i opisy kategorii na węzłach;
- warunkowe zwijanie diagramu po analizie;
- zależności od `workflow-phases.ts`, jeśli po usunięciu faz nie mają innych
  konsumentów.

Po zmianie znaczenie węzłów nie zależy od wcześniejszej analizy AI. Ta sama sesja
zawsze renderuje tę samą mapę.

### 4.3. AiHubComponent

Nowy komponent jest właścicielem:

- wyboru interakcji dla Quick Analysis;
- budowania katalogu danych do klasyfikacji;
- odczytu zapisanego wyniku klasyfikacji;
- uruchamiania klasyfikacji po jawnej akcji;
- estymacji credits według kategorii;
- stanów loading/error/empty;
- otwierania nowej rozmowy;
- odczytu lekkiego podsumowania historii rozmów;
- otwierania historii i wybranej rozmowy.

Nie należy kopiować całego obecnego `WorkflowViewComponent`. Logikę czystą trzeba
wydzielić przed przeniesieniem prezentacji.

### 4.4. Czysta logika Quick Analysis

Do osobnego modułu, np. `core/ai-quick-analysis.ts`, przenieść:

- mapowanie kategorii na rundy;
- `estimateActionCredits` i przygotowanie wierszy prezentacyjnych;
- wyliczenie pokrycia;
- sumowanie kompaktowań;
- wybór największego obszaru;
- DTO dla listy kategorii.

Funkcje mają być czyste, bez Angulara, dialogów i tekstu zależnego od DOM. Dzięki
temu Quick Analysis można testować fixture'ami bez renderowania mapy.

`ToolClassificationService` pozostaje współdzielonym cache i klientem operacji
AI. Jego wynik nie może wpływać na `WorkflowViewComponent`.

## 5. Nawigacja do dowodów i porad

Obecnie część nawigacji działa przez metodę instancji `WorkflowViewComponent`.
Po rozdzieleniu zakładek to sprzężenie przestaje być poprawne.

Należy wydzielić wspólną warstwę, np. `SessionEvidenceNavigationService`, która:

- otrzymuje bieżący `WorkflowAnalysis`, kompaktowania i wiadomości;
- otwiera istniejący `RoundDetailsPanelService`;
- obsługuje referencje rund i kompaktowań;
- zachowuje poprzedni/następny element;
- jest używana przez Mapę pracy i AI Hub;
- nie zależy od obecności któregoś komponentu w DOM.

Alternatywnie właścicielem może zostać `SessionPageComponent`, ale serwis daje
czytelniejszą granicę i łatwiejsze testy.

Poradnik `Poznaj techniki` dla kategorii pozostaje dostępny z Quick Analysis.
Poradnik dla usuniętych faz zostaje usunięty razem z fazami. Poradnik dla
kompaktowania można pokazać przy pozycji `Kompaktowanie kontekstu` w Quick
Analysis albo pozostawić w globalnym katalogu technik; nie wraca na mapę.

## 6. Backend rozmów po usunięciu focus

### 6.1. Controller i DTO

- request utworzenia rozmowy zawiera wyłącznie model;
- walidacja nie oczekuje `focus.roundRefs`;
- widok rozmowy nie zwraca focus;
- lista rozmów dostarcza dane potrzebne AI Hub: id, model, timestamps, liczba tur,
  ostatnie pytanie, status ostatniej tury i informacja o nowszej telemetrii;
- jeżeli obecny endpoint listy jest zbyt ciężki, dodać lekki DTO listy, ale nie
  drugi semantycznie równoległy mechanizm rozmów.

### 6.2. SessionChatService

- zawsze tworzy zakres całej sesji do `cutoffSignalId`;
- bootstrap nie zawiera wskazanych rund;
- pierwsze pytanie użytkownika jest jedynym źródłem szczególnego obszaru uwagi;
- narzędzia Scannera pozostają ograniczone do zamrożonego scope;
- kontynuacja rozmowy zachowuje ten sam cutoff i sesję Copilot SDK;
- usunięcie rozmowy nadal usuwa tury, audit narzędzi i lokalny stan SDK.

### 6.3. Prompt

System prompt ma wyjaśniać:

- gdzie znaleźć overview, interakcje, rundy, konfigurację i koszty;
- że użytkownik może odwoływać się do `I1`, `M3`, subagenta lub kompaktowania;
- że takie oznaczenie trzeba rozwiązać przez narzędzia Scannera;
- że odpowiedź może wyjść poza wymienione przez użytkownika rundy, jeżeli
  przyczyna znajduje się gdzie indziej;
- że dowody muszą używać wyłącznie kanonicznych `evidenceRef` zwróconych przez
  narzędzia.

Prompt nie zawiera sekcji `focus`, `selected rounds` ani `starting point`.

### 6.4. Persistence

Z `session_chat` usunąć `focus_json` i odpowiadające pole rekordu Javy.

Migracja:

1. wykryć obecność kolumny;
2. usunąć ją przez jawny krok migracyjny;
3. zachować pozostałe rekordy rozmów;
4. zaktualizować insert, select i mapper;
5. przetestować start na starej i pustej bazie.

Nie tworzymy wersji `v2`, adaptera starego requestu ani fallbacku w Angularze.

## 7. Usunięcie Zagregowanego przebiegu

Do usunięcia należy nie tylko HTML, ale cały nieużywany łańcuch:

- `GroupedWorkflowPhase`, `WorkflowPhaseCompactionInput` i lokalny
  `AggregatedPhase`;
- `groupWorkflowPhases` oraz jego testy, jeśli nie ma innych konsumentów;
- `aggregatedPhases`, `phaseToolShares`, `phaseGuidanceTopics` i pomocnicze
  formatery;
- CSS `.phase-*` i `.aggregated-*`;
- testy widoku faz;
- generowanie preview optymalizacji z rodzaju `PHASE`;
- typ `PHASE` w kontraktach guidance, jeżeli po wyszukaniu nie ma innego
  konsumenta;
- teksty dokumentacji opisujące fazy jako element UI.

Przed usunięciem każdego współdzielonego typu wykonać `rg`, aby nie usunąć
mechanizmu używanego przez inne funkcje optymalizacji.

## 8. Ładowanie i wydajność

- `Mapa pracy` i `AI Hub` korzystają z jednego przygotowanego
  `WorkflowAnalysis` w `SessionPageComponent`;
- przełączanie między tymi zakładkami nie pobiera ponownie dużego `/analysis`;
- wejście do AI Hub odczytuje cached classification i lekki indeks rozmów
  równolegle;
- nie pobieramy treści wszystkich tur historii przed wyborem rozmowy, jeśli lista
  okaże się duża;
- pełna rozmowa jest pobierana dopiero po `Kontynuuj` albo wyborze z historii;
- wejście na Mapę pracy nie wykonuje żadnego requestu do `/api/ai/*`;
- wejście do AI Hub nie uruchamia modelu;
- klasyfikacja i wysłanie wiadomości mają niezależne stany pending i niezależne
  błędy.

Jeżeli aktualne `GET /api/ai/session-chats` zwraca komplet wszystkich tur, plan
obejmuje rozdzielenie:

```http
GET /api/ai/session-chats?sessionId=321        # lekki indeks
GET /api/ai/session-chats/{id}?sessionId=321   # pełna rozmowa
```

## 9. Kolejność implementacji

### Etap 1 — kontrakty i wspólny model

1. Dodać `ai-hub` do typu zakładek i nawigacji.
2. Zapewnić wspólne, leniwe ładowanie `WorkflowAnalysis` dla mapy i AI Hub.
3. Wydzielić czyste obliczenia Quick Analysis z widoku mapy.
4. Dodać testy czystych obliczeń przed zmianą HTML.

### Etap 2 — AI Hub

1. Utworzyć `AiHubComponent`.
2. Przenieść trigger klasyfikacji, cached result i podział credits.
3. Dodać selektor interakcji.
4. Przenieść nawigację do dowodów i `Poznaj techniki`.
5. Dodać sekcję AI Chat z akcjami nowej, ostatniej i poprzednich rozmów.

### Etap 3 — czysta Mapa pracy

1. Usunąć kontrolki i rendering klasyfikacji.
2. Usunąć rozmowy oraz wybór zakresu rund.
3. Usunąć `ZAGREGOWANY PRZEBIEG` i martwą logikę.
4. Zostawić trzy warstwy pomiarowe i faktyczne szczegóły węzłów.
5. Potwierdzić, że mapa nie wykonuje wywołań AI.

### Etap 4 — chat bez focus

1. Uprościć modele TypeScript i dane dialogu.
2. Uprościć request REST.
3. Usunąć focus z backendowego modelu, promptu i serwisu.
4. Dodać migrację kolumny `focus_json`.
5. Uprościć historię rozmów.
6. Usunąć testy i teksty związane z punktem startowym.

### Etap 5 — porządki i dokumentacja

1. Usunąć nieużywane typy faz, CSS i fixture'y.
2. Zaktualizować `AGENTS.md`, README i dokumentację kontynuacji.
3. Zaktualizować plan rozmowy o sesji: cała sesja bez focus.
4. Zweryfikować brak starych nazw przez `rg`.

## 10. Plan testów

### 10.1. Frontend unit tests

- kolejność zakładek zawiera `Mapa pracy → AI Hub → Dane techniczne`;
- wejście do mapy nie pokazuje żadnej akcji AI;
- mapa pokazuje dokładnie trzy warstwy;
- wynik klasyfikacji nie zmienia etykiet ani ikon mapy;
- AI Hub odczytuje cached result bez inferencji;
- Quick Analysis uruchamia model wyłącznie po kliknięciu;
- podział credits zachowuje dotychczasowe formuły i pokrycie;
- `ZAGREGOWANY PRZEBIEG` nie występuje w DOM;
- AI Hub otwiera nową rozmowę bez focus;
- AI Hub pokazuje ostatnią rozmowę i historię;
- wybór historii pobiera i otwiera pełną rozmowę;
- otwarcie historii nie uruchamia inferencji;
- dowód kategorii otwiera właściwą rundę lub kompaktowanie.

### 10.2. Backend unit/integration tests

- create chat przyjmuje tylko model;
- zapis rozmowy nie zawiera focus;
- bootstrap obejmuje całą sesję do cutoff;
- pytanie zawierające `M3` może spowodować odczyt tej rundy przez narzędzie;
- odpowiedź przywołuje wyłącznie kanoniczne evidence refs;
- lista rozmów jest lekka i nie zawiera pełnej treści tur, jeśli wprowadzimy DTO
  indeksu;
- pełny endpoint zwraca tury dopiero dla wybranej rozmowy;
- migracja zachowuje istniejące rozmowy i usuwa `focus_json`;
- nowa baza uruchamia się bez dodatkowych kroków;
- usunięcie sesji nadal kaskadowo usuwa rozmowy.

### 10.3. Testy regresji

- pełny `npm test -- --watch=false`;
- produkcyjny `npm run build`;
- pełny `mvn -q test`;
- ręczne sprawdzenie na sesji bez klasyfikacji, z cached classification, z wieloma
  interakcjami, subagentem i kompaktowaniem;
- sprawdzenie, że samo przechodzenie po zakładkach nie zużywa credits.

## 11. Kryteria odbioru

Zmiana jest zakończona, gdy:

1. `AI Hub` znajduje się między Mapą pracy i Danymi technicznymi.
2. Mapa pracy jest identyczna niezależnie od obecności zapisanej klasyfikacji AI.
3. Mapa pokazuje wyłącznie fakty i przełączniki `Kontekst`, `Tokeny`, `Credits`.
4. Na mapie nie ma triggerów AI, kategorii, chatu ani wyboru rund do rozmowy.
5. `ZAGREGOWANY PRZEBIEG` oraz jego martwy kod zostały usunięte.
6. AI Quick Analysis w AI Hub zachowuje dotychczasowy podział credits i coverage.
7. Uruchomienie Quick Analysis wymaga jawnej akcji użytkownika.
8. AI Chat jest dostępny wyłącznie z AI Hub.
9. Nowa rozmowa zawsze dotyczy całej zamrożonej sesji.
10. Focus nie występuje w UI, REST, promptach, modelach ani bazie.
11. Zakres uwagi może zostać opisany naturalnie w pierwszej wiadomości.
12. Historia rozmów otwiera wybraną rozmowę bez inferencji.
13. Nawigacja do dowodów działa bez zamontowanego widoku mapy.
14. Otwarcie Mapy pracy albo AI Hub nie uruchamia modelu.
15. Wszystkie testy i buildy przechodzą, a dokumentacja opisuje nowy podział.

## 12. Elementy wymagające świadomego zachowania

- klasyfikacja AI pozostaje wynikiem wcześniejszej inferencji i musi być tak
  oznaczona;
- credits kategorii pozostają estymacją `≈`, nie kosztem kategorii;
- kompaktowanie zachowuje wyemitowane credits i pozostaje poza klasyfikacją;
- raw telemetry pozostaje źródłem audytowym;
- AI Chat nadal nie otrzymuje dostępu do repozytorium ani narzędzi analizowanej
  sesji;
- modal chatu zachowuje dużą powierzchnię, przypięty composer, autosize 1–4 i
  lokalną gęstość Material;
- usunięcie focus nie zmienia cutoff ani zasad redakcji danych.
