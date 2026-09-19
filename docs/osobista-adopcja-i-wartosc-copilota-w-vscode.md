# Osobiste wykorzystanie i wartość GitHub Copilot w VS Code

Stan dokumentu: 2026-09-19.
Status: specyfikacja kierunku produktu; funkcja nie jest jeszcze wdrożona.

## 1. Cel dokumentu

Dokument opisuje plan rozszerzenia Agent Scannera o osobiste, długoterminowe
zestawienie sposobu pracy z GitHub Copilot w VS Code. Zestawienie ma pomóc
użytkownikowi odpowiedzieć na cztery grupy pytań:

1. Z jakich możliwości faktycznie korzystam i jak często?
2. Jak zmienia się mój sposób pracy w kolejnych tygodniach i repozytoriach?
3. Co warto poznać, poprawić albo świadomie ograniczyć?
4. Które modele, narzędzia, skille, serwery MCP i custom agents są dla mnie
   najbardziej użyteczne, niezawodne albo problematyczne?

Dokument jest przygotowany jako mapa dalszych prac. Każda potrzeba ma trwały
identyfikator `PAV-*`, aby w kolejnych zadaniach można było wybrać jeden zakres,
omówić jego semantykę, doprecyzować kontrakt danych, zaprojektować miejsce w UI,
zaimplementować go i przetestować bez ponownego projektowania całej funkcji.

Skrót `PAV` oznacza `Personal Adoption and Value`.

## 2. Jak korzystać z dokumentu w kolejnych zadaniach

Nowy chat powinien zaczynać się od wskazania jednej potrzeby, na przykład:

```text
Kontynuujemy projekt osobistego wykorzystania Copilota według
docs/osobista-adopcja-i-wartosc-copilota-w-vscode.md.
Pracujemy nad PAV-02. Najpierw sprawdź aktualny kod i fixture'y, następnie
doprecyzuj ze mną definicje, mianowniki, stany braku danych oraz miejsce w UI.
Nie implementuj pozostałych potrzeb.
```

Dla wybranej potrzeby należy kolejno:

1. sprawdzić, które wymagane fakty są rzeczywiście obecne w fixture'ach i raw
   OTLP;
2. zakwalifikować każdą wartość jako fakt, deterministyczne wyliczenie,
   deklarację użytkownika albo interpretację AI;
3. ustalić zachowanie dla braku, częściowego pokrycia, konfliktu i danych
   historycznych;
4. zdecydować, czy wynik jest liczony na żądanie, czy utrwalany;
5. doprecyzować miejsce i hierarchię w UI;
6. zapisać kontrakt oraz kryteria odbioru;
7. dopiero wtedy implementować i testować.

W sekcji 26 znajduje się kolejność przyrostów. Nie należy traktować jej jako
nakazu wdrożenia całej funkcji jednym dużym zadaniem.

## 3. Decyzja produktowa

### 3.1. Nie tworzymy jednej oceny

Agent Scanner nie powinien pokazywać pojedynczej oceny typu:

```text
AI adoption: 78/100
```

Taka liczba wymagałaby arbitralnych wag i sugerowałaby, że:

- więcej narzędzi jest zawsze lepsze;
- każdy skill, MCP lub subagent zwiększa dojrzałość;
- długa sesja jest bardziej zaawansowana niż krótka;
- większe zużycie credits oznacza większą wartość;
- częstsze kompaktowanie jest sukcesem;
- wszystkie możliwości pasują do każdego rodzaju pracy.

Żadne z tych twierdzeń nie wynika z telemetrii.

Zamiast jednego wyniku produkt ma pokazywać wielowymiarowy profil:

- aktywność i regularność;
- udział sesji korzystających z poszczególnych mechanizmów;
- szerokość zaobserwowanych możliwości;
- faktyczny sposób używania mechanizmów;
- trendy w czasie;
- zaobserwowaną konfigurację per repozytorium;
- koszt, niezawodność i deklarowaną wartość mechanizmów;
- obszary warte poznania, sprawdzenia albo ograniczenia.

### 3.2. Zakres to VS Code, nie cała adopcja AI

Agent Scanner odbiera telemetrię z GitHub Copilot działającego w VS Code. Widok
nie może udawać globalnego obrazu używania AI przez użytkownika.

W szczególności bez osobnej integracji nie obejmuje:

- GitHub Copilot na `github.com`;
- Copilot code review wykonywanego poza obserwowaną sesją VS Code;
- Copilot cloud agent;
- samodzielnych sesji Copilot CLI poza obserwowanym procesem VS Code;
- aplikacji GitHub Copilot;
- innych produktów i agentów AI;
- ręcznej pracy wykonywanej bez telemetryki;
- jakości końcowego oprogramowania poza dowodami obecnymi w sesji.

Docelowa nazwa widoku powinna brzmieć `Moje wykorzystanie Copilota` albo
`Mój sposób pracy z agentem`. Pod nagłówkiem zawsze powinien znaleźć się zakres:

> Zestawienie obejmuje sesje GitHub Copilot odebrane z VS Code przez Agent
> Scanner. Nie opisuje całej Twojej aktywności AI ani aktywności na GitHub.com.

### 3.3. Użycie mechanizmu nie jest automatycznie sukcesem

Widok ma opisywać użycie, a nie nagradzać komplikowanie pracy. Przykładowo:

- brak subagenta może być właściwy dla małego zadania;
- kilka MCP może rozszerzać możliwości, ale również zwiększać powierzchnię
  konfiguracji i liczbę definicji w kontekście;
- skill może utrwalać skuteczną procedurę albo utrwalać złą procedurę;
- custom agent może poprawiać dopasowanie albo tylko dublować głównego agenta;
- kompaktowanie może uratować długą sesję, ale częste kompaktowanie nie jest
  miarą adopcji;
- większa liczba rund i tool calli może oznaczać bogatszy workflow albo
  niepotrzebne iteracje.

Dlatego dane o możliwościach oraz dane o kondycji przebiegu muszą pozostać
oddzielone.

## 4. Relacja do oficjalnego podejścia GitHuba

GitHub mierzy adopcję organizacyjną przez aktywność, regularność, używane
powierzchnie produktu i fazy w ruchomym oknie 28 dni. Kwalifikujące użycie musi
wystąpić w co najmniej dwóch różnych dniach. Oficjalne fazy GitHuba dotyczą
jednak głównie przechodzenia między powierzchniami produktu: completions, agent
edits, Copilot CLI, cloud agent, code review i Copilot app.

Agent Scanner może przejąć dobre własności metodyki:

- ruchome okno 28 dni jako domyślny okres;
- osobne aktywne dni i liczby sesji;
- wymaganie powtórzenia w różnych dniach przed nazwaniem użycia regularnym;
- trend zamiast stałej odznaki;
- wersjonowanie modelu klasyfikacji;
- jawne pokrycie danych;
- oddzielenie adopcji od wpływu i produktywności.

Nie powinien kopiować faz 1:1. Użytkownik może bardzo intensywnie korzystać w
VS Code ze skilli, MCP, custom agents i rzeczywistych subagentów, a nadal nie
spełniać kryteriów fazy `Multi-agent` GitHuba. Z kolei użycie kilku powierzchni
GitHuba nie dowodzi umiejętnego orkiestrwania agentów.

Źródła referencyjne:

- [GitHub Copilot usage metrics](https://docs.github.com/en/copilot/reference/copilot-usage-metrics);
- [dane i logika AI adoption phases](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics#ai-adoption-phase-fields);
- [interpretacja metryk adopcji](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/interpret-copilot-metrics);
- [ograniczenia porównywania dashboardów i API](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/reconciling-usage-metrics);
- [pomiar wpływu Copilota](https://docs.github.com/en/copilot/tutorials/roll-out-at-scale/measure-copilot-impact);
- [telemetria agentów w VS Code](https://code.visualstudio.com/docs/agents/guides/monitoring-agents).

## 5. Nadrzędne zasady wiarygodności

### 5.1. Dowód przed wnioskiem

Każda prezentowana informacja musi mieć określone pochodzenie:

| Rodzaj | Przykład |
|---|---|
| Fakt telemetryczny | wykonano tool o określonym call ID |
| Deterministyczne wyliczenie | 12 z 40 kwalifikujących się sesji użyło MCP |
| Deklaracja użytkownika | skill był pomocny |
| Interpretacja AI | sesja dotyczyła refaktoryzacji |
| Brak danych | emiter nie pozwala ustalić obecności instrukcji |

Te rodzaje nie mogą być wizualnie ani semantycznie mieszane.

### 5.2. Brak obserwacji nie zawsze oznacza brak mechanizmu

Każdy mechanizm musi obsługiwać co najmniej następujące stany:

```text
USED
  istnieje jednoznaczny dowód użycia

AVAILABLE_NOT_USED
  istnieje dowód ekspozycji lub dostępności, ale brak dowodu wykonania

NOT_OBSERVED
  dane były wystarczające, lecz mechanizmu nie zaobserwowano

UNKNOWN
  telemetria nie pozwala ustalić obecności ani braku

UNSUPPORTED
  dana wersja emitera lub analizatora nie obsługuje obserwacji

CONFLICTED
  dowody są sprzeczne lub korelacja jest niejednoznaczna
```

Nie każdy mechanizm będzie wspierał `AVAILABLE_NOT_USED`. Na przykład wykonanie
toola jest łatwe do potwierdzenia, ale sama dostępność konkretnego skilla może nie
być emitowana.

### 5.3. Mianownik jest częścią wyniku

Procent sesji korzystających z mechanizmu liczymy tylko względem sesji, dla
których obecność lub brak mechanizmu można wiarygodnie ocenić:

```text
sessionShare = usedSessions / eligibleSessions
eligibleSessions = usedSessions + notObservedSessions
```

Sesje `UNKNOWN`, `UNSUPPORTED` i `CONFLICTED` nie trafiają do mianownika. UI musi
równolegle pokazać ich liczbę oraz pokrycie:

```text
Skille: 28% · 14 z 50 ocenialnych sesji
Pokrycie: 50 z 56 sesji
```

### 5.4. Jedna sesja jest liczona raz

Zbiorcze statystyki sesji dotyczą głównego, widocznego użytkownikowi przebiegu
wraz z jednoznacznie powiązanymi epizodami subagentów. Nie wolno liczyć osobnego
historycznego rekordu dziecka jako dodatkowej sesji użytkownika, jeżeli jest on
częścią tego samego drzewa.

Analogicznie:

- jeden exact call ID jest jednym wykonaniem;
- pierwszy odbiór wyniku jest liczony raz;
- późniejsza retencja wyniku nie jest kolejnym wykonaniem;
- ten sam raw batch zaimportowany ponownie nie może zwiększać statystyk;
- niejednoznacznie połączone epizody pozostają poza wynikiem wymagającym pewnego
  przypisania.

## 6. Jednostki analizy

### 6.1. Sesja użytkownika

Podstawową jednostką procentów jest logiczna sesja rekonstruowana przez istniejący
kontrakt `copilot-episode-v1`, a nie pojedynczy span, request ani historyczny wiersz
sesji.

Sesja przechowuje między innymi:

- początek i koniec;
- repozytorium, jeśli wyemitowane;
- źródło danych: lokalne, importowane lub przyszłe;
- głównego agenta;
- powiązane interakcje;
- powiązane subagenty;
- zaobserwowane mechanizmy;
- pokrycie danych per mechanizm;
- wersję analizatora.

### 6.2. Obserwacja mechanizmu

Jedna obserwacja opisuje mechanizm w kontekście sesji:

```text
session
mechanism kind
canonical mechanism identity
state
first/last timestamp
execution count
distinct interaction count
exact evidence references
coverage
deterministic error count
measured tokens/credits/duration where applicable
```

### 6.3. Dzień aktywności

Dzień wynika z lokalnej strefy czasu użytkownika wybranej dla zestawienia. Należy
zapisać strefę lub jednoznacznie dokumentować, że agregacja używa strefy aplikacji.
Zmiana strefy nie może po cichu przepisywać utrwalonej historii bez wersjonowania.

### 6.4. Repozytorium

Repozytorium jest używane tylko wtedy, gdy telemetria zawiera wiarygodny
identyfikator. Należy ustalić kanoniczną postać remote URL bez sekretów i
poświadczeń. Sesje bez repozytorium pozostają w grupie `Repozytorium nieustalone`.

### 6.5. Mechanizm i jego dostawca

Mechanizm ma typ i kanoniczną tożsamość:

```text
MODEL
TOOL
SKILL
MCP_SERVER
MCP_TOOL
CUSTOM_AGENT
SUBAGENT
PLUGIN
INSTRUCTION_SOURCE
```

`provider` nie może być zgadywany z nazwy. Jeżeli telemetria nie podaje dostawcy,
UI pokazuje `Dostawca nieustalony`.

## 7. Taksonomia informacji

### 7.1. Możliwości użytkowe

To mechanizmy, których wykorzystanie można pokazywać w profilu:

1. praca z agentem;
2. wykonania narzędzi;
3. edycje kodu wykonywane przez agenta, o ile są jawnie emitowane;
4. terminal i komendy, o ile ich typ można potwierdzić;
5. walidacja, wyłącznie gdy widoczne dane pozwalają deterministycznie rozpoznać
   test, build lub lint;
6. skille;
7. MCP i konkretne narzędzia MCP;
8. custom agents;
9. plugin agents, jeżeli typ jest emitowany;
10. subagenci;
11. zagnieżdżona delegacja;
12. równoległe gałęzie pracy, tylko gdy struktura lub czasy stanowią dowód;
13. różne modele, bez założenia, że większa liczba modeli jest lepsza.

Każda pozycja wymaga osobnego audytu fixture'ów przed implementacją. Nazwa toola
nie jest wystarczającym dowodem semantycznej kategorii, jeżeli nie istnieje
stabilny atrybut albo przetestowany, jednoznaczny format.

### 7.2. Mechanizmy operacyjne — poza adopcją

Poniższe dane są ważne, ale nie podnoszą poziomu wykorzystania:

- kompaktowanie kontekstu;
- cache read i cache write;
- kontekst zajęty przy wysłaniu;
- auxiliary model calls;
- błędy;
- anulowania;
- ponowienia;
- powtarzane tool calle;
- długie wyniki utrzymywane w kontekście;
- brakujące odpowiedzi lub niepełne pokrycie;
- liczba rund;
- liczba tokenów i credits.

Należą do sekcji `Kondycja przebiegów`, `Koszt` albo `Jakość danych`, a nie do
oceny wykorzystanych możliwości.

### 7.3. Konfiguracja i ekspozycja

Osobno pokazujemy elementy konfiguracji, które zostały jawnie zaobserwowane:

- instrukcje globalne, repozytoryjne lub agentowe, jeżeli źródło jest emitowane;
- definicje narzędzi przekazane modelowi;
- widoczną nazwę lub typ custom agenta;
- widoczny skill;
- widoczny serwer MCP albo jego stabilny hash;
- wersje definicji;
- zaobserwowany model i limit kontekstu.

Pierwszy przyrost nie uzyskuje dostępu do plików repozytorium. Dostępność
rekonstruuje wyłącznie z treści system instructions, input messages i definicji
narzędzi rzeczywiście przekazanych modelowi. Parser może rozpoznać typ instrukcji,
skilla lub custom agenta tylko wtedy, gdy runtime zachował nazwę, stabilną sekcję,
jednoznaczną treść albo inną przetestowaną proweniencję. Samo podobieństwo tekstu
nie wystarcza. UI używa wtedy etykiety `Rozpoznano w kontekście modelu`, a nie
twierdzenia o odczytaniu pliku z dysku.

## 8. PAV-01 — ślad możliwości pojedynczej sesji

### Potrzeba użytkownika

Po otwarciu sesji użytkownik chce szybko zobaczyć, z jakich mechanizmów korzystał,
bez analizowania drzewa spanów.

### Minimalny zakres

Domyślna zakładka `Podsumowanie` zawiera:

- rozpoznane instrukcje repozytoryjne i agentowe;
- capabilities widoczne w system instructions albo definicjach tooli;
- narzędzia;
- skille;
- MCP;
- custom agents;
- subagentów;
- zagnieżdżoną delegację;
- stan danych dla każdego mechanizmu;
- liczby wykonań i dokładne dowody;
- odnośniki do istniejącej osi czasu lub mapy pracy.

Każdy mechanizm ma osobne stany `Widoczne modelowi` i `Użyte w sesji`. Dla
instrukcji odpowiednikiem wykonania jest `Zastosowane w requestach`; nie należy
udawać tool calla. Przykład:

```text
Podsumowanie możliwości sesji

Mechanizm              Widoczne modelowi       Użyte w sesji
Instructions           2 źródła rozpoznane     Zastosowane
Narzędzia              41 definicji            37 wykonań
Skille                 5 rozpoznanych          2 skille · 4 wywołania
MCP                    2 serwery                1 serwer · 7 tool calli
Custom agents          3 rozpoznane            1 agent · 1 uruchomienie
Subagenci              Nie ustalono             2 epizody · głębokość 1

Pokrycie telemetryczne  Pełne dla 5 z 6 obszarów
```

### Semantyka

- `Narzędzia` liczą wykonania, nie definicje.
- `Skille` wymagają jawnego atrybutu lub przetestowanego typu wykonania.
- `MCP` liczy faktyczne wykonania narzędzi, nie samo połączenie serwera.
- `Custom agent` wymaga jawnego typu lub stabilnej tożsamości agenta.
- `Subagent` korzysta z istniejących exact-call-ID relacji i rekonstrukcji
  epizodów.
- `Głębokość` opisuje graf, nie jakość.

### Kandydackie miejsce w UI

`Podsumowanie` jest nową pierwszą i domyślną zakładką po wejściu w sesję:

```text
Podsumowanie | Koszt i przebieg | Mapa pracy | Dane techniczne
```

Pokazuje globalne fakty sesji, macierz `widoczne / użyte`, jakość pokrycia oraz
odnośniki do dokładnych dowodów w istniejących widokach. Nie dubluje szczegółowej
osi przebiegu ani mapy pracy.

### Pytania do doprecyzowania

- Czy `Nie zaobserwowano` pokazywać dla wszystkich mechanizmów, czy tylko dla
  wybranego katalogu podstawowego?
- Czy custom agent główny i custom agent uruchomiony jako dziecko mają wspólną
  pozycję?
- Jak prezentować wiele wersji tej samej definicji w jednej sesji?

### Kryteria odbioru

- każde `użyto` prowadzi do dokładnego dowodu;
- brak danych nigdy nie staje się zerem;
- subagent nie jest liczony podwójnie;
- kompaktowanie nie pojawia się jako możliwość;
- komponent nie interpretuje raw JSON w template.

## 9. PAV-02 — procent sesji korzystających z mechanizmów

### Potrzeba użytkownika

Użytkownik chce zobaczyć, jaki udział jego sesji korzysta z poszczególnych
mechanizmów i jak często pracuje bez nich.

### Widok podstawowy

| Mechanizm | Z użyciem | Bez użycia | Nieustalone | Pokrycie |
|---|---:|---:|---:|---:|
| Narzędzia | 83% | 17% | 0 | 56/56 |
| Skille | 28% | 72% | 6 | 50/56 |
| MCP | 19% | 81% | 4 | 52/56 |
| Custom agents | 14% | 86% | 0 | 56/56 |
| Subagenci | 22% | 78% | 0 | 56/56 |
| Zagnieżdżona delegacja | 4% | 96% | 0 | 56/56 |

Procenty dotyczą sesji ocenialnych. Kolumna `Nieustalone` zawiera liczbę sesji
wyłączonych z mianownika.

### Interakcja

Kliknięcie każdej liczby otwiera listę sesji z aktywnymi filtrami:

- `Z użyciem`;
- `Bez użycia`;
- `Nieustalone`.

Filtr musi zachować okres, repozytorium i pozostałe kryteria zestawienia.

### Filtry czasu

Pierwsza wersja powinna obsługiwać:

- 7 dni;
- 28 dni — domyślnie;
- 90 dni;
- cały dostępny okres;
- opcjonalny własny zakres później.

### Dodatkowe miary

Obok udziału sesji warto pokazać:

- liczbę aktywnych dni z mechanizmem;
- datę pierwszej obserwacji;
- datę ostatniej obserwacji;
- liczbę repozytoriów z obserwowanym użyciem;
- medianę wykonań w sesji używającej mechanizmu.

### Pytania do doprecyzowania

- Czy `sesja` oznacza rozmowę/conversation, czy pojedynczą interakcję użytkownika?
  Rekomendacja: sesja logiczna, a interakcje jako późniejszy drill-down.
- Jak traktować sesje importowane?
- Czy bardzo krótkie lub techniczne sesje mają być osobną populacją?
- Czy użytkownik może wybrać mianownik: wszystkie sesje albo tylko sesje
  agentowe?

### Kryteria odbioru

- mianownik jest widoczny i audytowalny;
- suma `z użyciem + bez użycia` odpowiada populacji ocenialnej;
- nieustalone sesje są zachowane;
- drill-down odtwarza dokładnie licznik z agregatu;
- jedna logiczna sesja jest liczona raz.

## 10. PAV-03 — trendy i regularność

### Potrzeba użytkownika

Użytkownik chce zobaczyć, czy mechanizmy pojawiają się jednorazowo, czy stają się
częścią jego zwykłego sposobu pracy.

### Proponowane dane

- aktywne dni w każdym tygodniu;
- sesje na tydzień;
- udział sesji z mechanizmem w kolejnych tygodniach;
- pierwsze i ostatnie użycie;
- serie użycia w co najmniej dwóch różnych dniach;
- zmiana względem poprzedniego porównywalnego okresu.

### Słownictwo

Pierwsza wersja powinna preferować liczby zamiast arbitralnych etykiet:

```text
Skille: użyte w 8 sesjach w 4 różnych dniach
```

Jeżeli wprowadzimy etykiety, minimalny model może być następujący:

| Etykieta | Warunek |
|---|---|
| Zaobserwowano | co najmniej jedna sesja |
| Powtórzone | użycie w co najmniej dwóch różnych dniach w oknie 28 dni |
| Regularne | definicja pozostaje do uzgodnienia i wersjonowania |

Nie należy definiować `Regularne` tylko przez liczbę wywołań, ponieważ jedna
długa sesja może wygenerować setki calli.

### Prezentacja zmiany

Zmiana udziału sesji powinna pokazywać oba mianowniki:

```text
MCP
poprzednie 28 dni: 5/31 sesji (16%)
obecne 28 dni:     9/38 sesji (24%)
zmiana: +8 pp
```

Nie należy sugerować poprawy przez zielony kolor tylko dlatego, że udział wzrósł.
Wzrost jest neutralną zmianą sposobu pracy.

### Kryteria odbioru

- okresy porównawcze nie nakładają się, chyba że UI jawnie opisuje rolling trend;
- zmiana procentowa nie ukrywa zmian mianownika;
- pojedynczy dzień z wieloma sesjami nie udaje regularności wielodniowej;
- zmiana strefy czasu ma zdefiniowane zachowanie.

## 11. PAV-04 — najczęściej wykorzystywane mechanizmy

### Potrzeba użytkownika

Użytkownik chce szybko zobaczyć elementy, na których faktycznie opiera swoją
pracę, oraz odróżnić szeroko używany mechanizm od wielu wywołań w jednej sesji.

### Zakres list

- top 5 modeli;
- top 5 custom agents;
- top 5 skilli;
- top 5 serwerów MCP;
- top 10 narzędzi MCP;
- top 10 wszystkich narzędzi.

### Minimalne kolumny

Każda lista powinna rozdzielać:

- liczbę sesji;
- udział ocenialnych sesji;
- liczbę wykonań;
- liczbę aktywnych dni;
- ostatnie użycie;
- pokrycie danych.

Przykład:

| Skill | Sesje | Udział | Wywołania | Dni | Ostatnio |
|---|---:|---:|---:|---:|---|
| `investigate-code` | 17 | 34% | 31 | 9 | 18.09 |
| `implement-change` | 12 | 24% | 19 | 7 | 17.09 |

### Sortowanie

Domyślnym rankingiem jest liczba sesji, następnie liczba aktywnych dni, a dopiero
potem liczba wykonań. Użytkownik może przełączyć sortowanie na:

- najczęściej wykonywane;
- najszerzej używane w sesjach;
- najnowsze;
- najbardziej niezawodne;
- najlepiej ocenione przez użytkownika;
- wymagające uwagi.

Te sortowania nie mogą korzystać z ukrytej wspólnej punktacji.

### Tożsamość i aliasy

Przed implementacją należy ustalić:

- czy wielkość liter ma znaczenie;
- jak kanonizować nazwy;
- jak traktować zmianę wersji definicji;
- czy ten sam tool lokalny i MCP o tej samej nazwie są różnymi elementami;
- jak prezentować serwer MCP dostępny wyłącznie jako hash;
- jak rozpoznać zmianę nazwy bez zgadywania.

Rekomendacja: brak automatycznego łączenia różnych identyfikatorów. Użytkownik
może później utworzyć lokalny alias, który zachowuje źródłowe tożsamości.

### Kryteria odbioru

- jedno wywołanie ma jeden mechanizm i jeden exact call ID;
- lista pokazuje sesje i wywołania osobno;
- top `N` nie sugeruje braku aktywności poza listą;
- element o brakującej nazwie pozostaje w `Nieustalone`, zamiast znikać;
- kliknięcie prowadzi do listy sesji i dowodów.

## 12. PAV-05 — konfiguracja i wykorzystanie per repozytorium

### Potrzeba użytkownika

Użytkownik chce zobaczyć, w których repozytoriach korzysta z instrukcji, skilli,
custom agents, MCP i innych elementów konfiguracji.

### Trzy poziomy dowodu

Należy bezwzględnie rozdzielić:

1. `Rozpoznane w kontekście` — element został zidentyfikowany w system
   instructions, input messages albo katalogu capabilities przekazanym modelowi;
2. `Widoczne w sesji` — element został przekazany modelowi lub opisany w
   telemetrii;
3. `Użyte` — istnieje wykonanie albo inne jednoznaczne użycie.

W pierwszym przyroście wszystkie trzy poziomy pochodzą wyłącznie z telemetrii.
Poziom 1 jest wnioskiem z treści faktycznie przekazanej modelowi, a nie wynikiem
skanowania plików. Jeżeli runtime nie zachował rozpoznawalnej nazwy, sekcji lub
treści, stan pozostaje `Nie ustalono`.

### Proponowana macierz

| Repozytorium | Sesje | Instructions | Skille użyte | Custom agents | MCP | Pokrycie |
|---|---:|---|---:|---:|---:|---|
| `payments-api` | 24 | Zaobserwowano | 4 | 2 | 3 | Pełne |
| `web-portal` | 17 | Brak dowodu | 1 | 0 | 2 | Częściowe |
| `legacy-core` | 8 | Nie ustalono | — | 1 | 0 | Ograniczone |

### Prawidłowe etykiety

Preferowane:

- `Repozytoria z zaobserwowanym użyciem skilli`;
- `Instrukcje widoczne w requestach sesji`;
- `Custom agents użyci w sesjach repozytorium`;
- `Nie można ustalić konfiguracji na podstawie telemetrii`.

Zabronione bez dodatkowego źródła:

- `Repozytorium ma 4 skille`;
- `Brak copilot-instructions.md`;
- `Repozytorium nie jest skonfigurowane`;
- `MCP jest zainstalowany w repozytorium`.

### Widok repozytorium

Po wejściu w repozytorium użytkownik widzi:

- liczbę i trend sesji;
- wykorzystywane modele;
- wykorzystywane skille;
- custom agents;
- serwery i narzędzia MCP;
- zwykłe tools;
- instrukcje i definicje widoczne w requestach;
- sesje bez kompletnej telemetrii;
- kondycję kontekstu i kompaktowania osobno;
- linki do dokładnych sesji.

### Granica źródła danych

W tym strumieniu produktu nie planujemy audytu plików ani mapowania remote na
lokalny katalog. Eksperymenty w `playground/` mają ustalić, które instrukcje,
skills i custom agents da się stabilnie rozpoznać w system instructions oraz
definicjach tooli i jak różni się to od ich faktycznego wykonania.

### Kryteria odbioru

- repo bez wiarygodnego ID nie jest łączone po podobnej nazwie;
- UI odróżnia konfigurację, ekspozycję i wykonanie;
- brak capture content nie udaje braku instrukcji;
- nazwa repo nie jest wysyłana na zewnątrz;
- kliknięcie agregatu pokazuje jego sesje źródłowe.

## 13. PAV-06 — kondycja przebiegów, w tym kompaktowanie

### Potrzeba użytkownika

Użytkownik chce rozpoznać wzorce mogące wymagać uwagi, ale nie powinny być
nagradzane jako adopcja.

### Kompaktowanie

Sekcja `Kompaktowanie kontekstu` pokazuje:

- udział sesji z co najmniej jednym kompaktowaniem;
- sesje bez kompaktowania;
- sesje o nieustalonym pokryciu;
- łączną liczbę wywołań kompaktujących;
- medianę i maksimum kompaktowań w sesji;
- liczbę sesji z wielokrotnym kompaktowaniem;
- wyemitowane tokeny, czas i credits kompaktowania;
- zajęcie kontekstu przed wywołaniem, jeśli możliwe;
- potwierdzenie późniejszego użycia rezultatu;
- model kompaktowania lub jawny fallback `nie wyemitowano`.

Kompaktowanie ma neutralny kolor i komunikat:

> Kompaktowanie jest mechanizmem zarządzania długą historią. Jego obecność ani
> brak nie stanowią samodzielnie oceny jakości sesji.

### Pozostałe sygnały kondycji

- potwierdzone błędy narzędzi;
- anulowania;
- powtarzane wywołania z identycznymi argumentami;
- brak odpowiedzi modelu;
- duże, długo utrzymywane wyniki;
- wysoka presja kontekstu;
- udział cache read;
- cache write, tylko gdy wyemitowany;
- auxiliary calls;
- nierozwiązane relacje call ID;
- sesje o słabym pokryciu.

### Prezentacja

Sygnały nie mają wspólnego `health score`. UI pokazuje osobne trendy i prowadzi
do sesji. Czerwony pozostaje zarezerwowany dla potwierdzonego błędu lub
jednoznacznie negatywnego feedbacku użytkownika, nie dla samej wysokiej liczby.

### Kryteria odbioru

- kompaktowanie nie wpływa na profile możliwości;
- brak kompaktowania nie jest sukcesem;
- wykrywanie błędów używa istniejących deterministycznych reguł;
- cache nie jest przypisywany dokładnej części requestu bez dowodu;
- każda obserwacja ma zakres i pokrycie.

## 14. PAV-07 — wartość modeli

### Potrzeba użytkownika

Użytkownik chce wiedzieć, z których modeli korzysta, jaki mają koszt i zachowanie
oraz które sprawdzają się w jego pracy.

### Fakty i wyliczenia

Per model można pokazać:

- sesje i wywołania;
- aktywne dni i repozytoria;
- input, cache read, cache write, output i reasoning, gdy wyemitowane;
- credits;
- czas odpowiedzi i TTFT;
- potwierdzone błędy;
- liczbę żądań narzędzi w przechwyconych odpowiedziach;
- udział wywołań bez kompletnego response;
- kontekst przy wysłaniu;
- typ roli: główny agent, subagent, auxiliary albo kompaktowanie;
- deklarowany feedback użytkownika.

### Czego nie wolno wnioskować automatycznie

- mniejsza liczba credits nie dowodzi lepszego modelu;
- szybsza odpowiedź nie dowodzi lepszej jakości;
- więcej tool calli nie dowodzi większej skuteczności;
- różne modele mogą obsługiwać różne zadania;
- porównanie różnych sesji nie jest eksperymentem kontrolowanym;
- reasoning tokens nie są miarą inteligencji ani jakości.

### Kandydackie widoki

1. `Najczęściej używane modele` — wolumen i udział sesji.
2. `Koszt i czas` — zmierzone wartości bez rankingu jakości.
3. `Moja ocena` — deklaracje użytkownika z minimalną próbą.
4. `Porównywalne próby` — przyszłe, tylko dla świadomie oznaczonych podobnych
   zadań lub eksperymentów.

### Kryteria odbioru

- requested i response model nie są bezrefleksyjnie łączone;
- kompaktowanie i auxiliary calls można odfiltrować;
- brak modelu pozostaje jawnym `nie wyemitowano`;
- wartość użytkownika jest oddzielona od telemetryki;
- UI ostrzega przed porównywaniem niepodobnych zadań.

## 15. PAV-08 — wartość MCP, tooli, skilli i custom agents

### Potrzeba użytkownika

Użytkownik chce przygotować konkretny feedback dla twórcy mechanizmu: jak często
go używa, gdzie działa dobrze, gdzie zawodzi i jaki wpływ ma na przebieg.

### Wspólne wymiary

Dla każdego mechanizmu, zależnie od dostępności danych:

- liczba sesji;
- udział sesji;
- aktywne dni;
- liczba wykonań;
- liczba repozytoriów;
- czas wykonania;
- potwierdzone błędy;
- brakujące rezultaty;
- pierwsze i ponowne użycia wyniku w kontekście;
- potencjalne powtórzenia z identycznymi argumentami;
- credits wywołań modelu, na których mechanizm został zażądany — wyłącznie jako
  kontekst, nie koszt przypisany mechanizmowi;
- feedback użytkownika;
- przykładowe sesje i rundy.

### MCP server

Pokazujemy osobno:

- serwer;
- konkretne narzędzia serwera;
- liczbę sesji i calli;
- udział błędów;
- czas wykonania;
- nieodebrane wyniki;
- wielkość przechwyconych rezultatów;
- powtórzenia;
- repozytoria i typy zadań, jeśli typ zadania pochodzi z jawnego źródła.

Samo połączenie lub ponowne połączenie MCP nie jest wykonaniem narzędzia.

### Tool

Wykorzystujemy istniejące zestawienie definicji, żądań, wyników i duplikatów.
Widok osobisty dodaje trend między sesjami oraz feedback. Nie tworzy drugiego,
sprzecznego analizatora tooli.

### Skill

Możliwe dane:

- sesje i wywołania;
- agent, który uruchomił skill;
- toole wykonane wewnątrz obserwowalnego zakresu, jeśli relacja jest pewna;
- błędy;
- credits i rundy całego zakresu, bez przypisywania ich skillowi jako kosztu;
- deklarowana przydatność;
- repozytoria;
- powtarzalność korzystania.

Nie wolno twierdzić, że skill spowodował oszczędność bez porównywalnej próby.

### Custom agent

Możliwe dane:

- sesje jako agent główny i jako dziecko;
- uruchomienia;
- modele;
- tool calle;
- skille i MCP;
- subagenci;
- błędy;
- tokeny i credits własnych wywołań;
- deklarowana przydatność;
- powtarzające się rodzaje zadań, tylko gdy klasyfikacja ma jawne pochodzenie.

### Widoki wartości

Nie tworzymy jednego rankingu. Użytkownik może wybrać:

- `Najczęściej używane`;
- `Najwięcej sesji`;
- `Najlepiej ocenione`;
- `Najbardziej niezawodne`;
- `Najwolniejsze`;
- `Najwięcej błędów`;
- `Najwięcej powtórzeń`;
- `Wymaga feedbacku`.

Każdy widok ma własną, prostą formułę i jawny mianownik.

## 16. PAV-09 — jawny feedback użytkownika

### Potrzeba użytkownika

Telemetria pokazuje zachowanie, ale nie mówi, czy rezultat był użyteczny. Agent
Scanner powinien umożliwić zapis lokalnej oceny mechanizmu powiązanej z dowodem.

### Zakres feedbacku

Feedback może dotyczyć:

- całej sesji;
- modelu;
- serwera MCP;
- narzędzia MCP;
- lokalnego toola;
- skilla;
- custom agenta;
- konkretnego wykonania lub rundy.

### Proponowany kontrakt

```ts
type FeedbackTargetKind =
  | 'SESSION'
  | 'MODEL'
  | 'MCP_SERVER'
  | 'MCP_TOOL'
  | 'TOOL'
  | 'SKILL'
  | 'CUSTOM_AGENT';

type Helpfulness = 'HELPFUL' | 'MIXED' | 'NOT_HELPFUL' | 'NOT_SURE';

type FeedbackReason =
  | 'ACCURACY'
  | 'RELEVANCE'
  | 'RELIABILITY'
  | 'LATENCY'
  | 'RESULT_SIZE'
  | 'ERGONOMICS'
  | 'DOCUMENTATION'
  | 'SETUP_OR_AUTH'
  | 'COST_OR_CREDITS'
  | 'WORKFLOW_FIT'
  | 'OTHER';

interface MechanismFeedback {
  id: string;
  targetKind: FeedbackTargetKind;
  canonicalTargetId: string;
  sessionRef: string | null;
  evidenceRefs: string[];
  helpfulness: Helpfulness;
  reasons: FeedbackReason[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
```

To jest kontrakt koncepcyjny, nie gotowy publiczny typ API.

### Interakcja

Ocena nie powinna przeszkadzać w przeglądaniu sesji. Kandydacki wzorzec:

- akcja `Oceń przydatność` w szczególe mechanizmu;
- cztery neutralne odpowiedzi;
- opcjonalne powody;
- opcjonalna notatka;
- podgląd danych, które zostaną dołączone do lokalnego feedbacku;
- brak automatycznego wysyłania do dostawcy.

### Minimalna próba

Zbiorcza ocena pokazuje liczbę odpowiedzi:

```text
Pomocny w 8 z 10 ocenionych sesji
Oceniono 10 z 27 sesji z użyciem
```

Nie pokazujemy procentu bez licznika. Przy małej próbie UI używa etykiety
`Mało ocen` zamiast rankingu.

### Edycja i usuwanie

Feedback należy do użytkownika. Musi można go:

- zmienić;
- usunąć;
- wyeksportować;
- usunąć razem ze wszystkimi danymi;
- opcjonalnie zachować po automatycznej retencji raw, z jawną informacją, że
  dowód źródłowy już wygasł.

## 17. PAV-10 — raport feedbacku dla dostawcy

### Potrzeba użytkownika

Użytkownik chce przekazać autorowi modelu, MCP, toola, skilla lub custom agenta
konkretny i bezpieczny raport zamiast ogólnego komentarza `działa słabo`.

### Zawartość raportu

Raport może zawierać:

- nazwę i typ mechanizmu;
- obserwowany okres;
- wersję definicji, jeśli znana;
- liczbę sesji i wykonań;
- liczbę aktywnych dni;
- zmierzone czasy;
- potwierdzone błędy i ich typy;
- pokrycie rezultatów;
- powtarzane wywołania;
- rozkład lokalnych ocen;
- zredagowane notatki użytkownika;
- wybrane, jawnie zatwierdzone przykłady;
- ograniczenia pomiaru.

### Format

Pierwsza wersja może generować lokalny Markdown i JSON:

```text
Mechanizm: jira-mcp / get_issue
Okres: 2026-08-23 – 2026-09-19

Użycie:
- 9 sesji
- 22 wykonania
- 7 aktywnych dni

Niezawodność:
- 18 potwierdzonych sukcesów
- 2 potwierdzone błędy
- 2 wyniki nieprzechwycone — stan nieustalony

Feedback:
- Helpful: 6
- Mixed: 2
- Not helpful: 1
- Not sure: 0

Najczęstsze powody:
- latency: 3
- result size: 2

Ograniczenia:
- raport obejmuje wyłącznie sesje VS Code odebrane przez Agent Scanner
- brakujące wyniki nie zostały uznane za błędy
```

### Prywatność

Eksport nie może domyślnie zawierać:

- promptów;
- kodu;
- ścieżek;
- argumentów zawierających dane biznesowe;
- pełnych rezultatów;
- repozytoriów;
- identyfikatorów użytkownika;
- sekretów.

Dodanie przykładu wymaga osobnego podglądu i jawnej zgody. Redakcja automatyczna
nie zastępuje przeglądu użytkownika.

### Kryteria odbioru

- raport jest generowany lokalnie;
- nic nie jest wysyłane automatycznie;
- fakty, feedback i ograniczenia są rozdzielone;
- brak wyniku nie staje się błędem;
- raport zawiera wersję schematu i okres.

## 18. PAV-11 — wskazówki rozwojowe i obszary doskonalenia

### Potrzeba użytkownika

Użytkownik chce dowiedzieć się, co warto poznać albo poprawić, ale nie chce być
oceniany za niewykorzystanie każdej funkcji.

### Typy wskazówek

1. `Poznaj możliwość` — istnieje powtarzalny wzorzec, dla którego nowy mechanizm
   może być wart eksperymentu.
2. `Utrwal skuteczny sposób` — użytkownik wielokrotnie wykonuje podobny workflow.
3. `Sprawdź kondycję` — dane pokazują błędy, powtórzenia lub presję kontekstu.
4. `Porównaj alternatywę` — można zaplanować próbę przed/po.
5. `Ogranicz zbędną powierzchnię` — element jest regularnie eksponowany, ale nie
   ma obserwowanego wykorzystania; jest to hipoteza, nie polecenie usunięcia.
6. `Przygotuj feedback` — mechanizm jest często używany i ma powtarzalny problem.

### Wymagany kontrakt wskazówki

```text
Tytuł
  → obserwowany sygnał
  → zakres i mianownik
  → dlaczego warto to sprawdzić
  → proponowany mały eksperyment
  → jak porównać przed/po
  → konkretne sesje lub rundy
  → ograniczenie dowodu
```

### Przykłady dobrych wskazówek

#### Kandydat na skill

> W 9 sesjach w 5 różnych dniach powtórzyła się ta sama nazwa toola i
> kanoniczne argumenty, a w tych sesjach nie zaobserwowano użycia skilla.
> Sprawdź, czy ten workflow warto opisać jako powtarzalną procedurę. Telemetria
> nie dowodzi, że skill skróci pracę; porównaj pełne przebiegi przed i po.

#### MCP wymaga uwagi

> `jira-mcp/get_issue` było użyte w 9 sesjach. W 3 sesjach wystąpił potwierdzony
> błąd albo ponowienie identycznego wywołania. Przejrzyj przykłady i przygotuj
> raport dla autora integracji.

#### Częste kompaktowanie

> 6 z 24 sesji miało co najmniej dwa kompaktowania. Nie jest to błąd samo w
> sobie. Sprawdź rozmiar wyników narzędzi i długość utrzymywanej historii przed
> zmianą promptu lub konfiguracji.

#### Niewykorzystywana definicja

> Definicja narzędzia była bezpośrednio przechwycona w 18 requestach, ale w
> kompletnych odpowiedziach nie zaobserwowano jego użycia. Może to być kandydat
> do eksperymentalnego ograniczenia zestawu tooli. Brak użycia nie dowodzi, że
> narzędzie jest zbędne.

### Przykłady zabronione

- `Nie używasz MCP, więc masz niską adopcję.`
- `Użyj subagenta, aby podnieść poziom.`
- `Więcej modeli zwiększy Twoją produktywność.`
- `Kompaktowanie poprawiło dojrzałość sesji.`
- `Ten skill zaoszczędził 30% credits`, jeżeli nie ma porównywalnej próby.

### Stan wskazówki

Użytkownik może:

- zapisać ją do sprawdzenia;
- odrzucić jako niepasującą;
- oznaczyć rozpoczęcie próby;
- powiązać sesję `przed` i `po`;
- dodać wynik i notatkę;
- zamknąć bez wniosku.

Stan użytkownika nie staje się faktem telemetrycznym.

### AI

Pierwszy przyrost powinien być deterministyczny i korzystać z istniejącego
katalogu technik. AI może później pomóc sformułować hipotezę lub plan próby, ale
tylko po jawnym podglądzie, zgodzie i z zachowaniem obecnych granic prywatności.

## 19. PAV-12 — porównanie prób i obserwacja efektu

### Potrzeba użytkownika

Użytkownik chce sprawdzić, czy zastosowanie skilla, MCP, custom agenta, innego
modelu albo zmiany konfiguracji faktycznie pomogło.

### Minimalny model próby

```ts
interface PersonalExperiment {
  id: string;
  title: string;
  hypothesis: string;
  mechanismKind: string;
  mechanismId: string | null;
  beforeSessionRefs: string[];
  afterSessionRefs: string[];
  qualityChecks: string[];
  userOutcome: 'BETTER' | 'SIMILAR' | 'WORSE' | 'INCONCLUSIVE' | null;
  note: string | null;
}
```

### Porównywane dane

- pełne credits drzewa;
- model i limit kontekstu;
- fresh input, cache read, cache write i output;
- liczba rund;
- narzędzia i wyniki;
- błędy;
- kompaktowanie;
- czas;
- deklarowana jakość wyniku;
- wykonane kontrole jakości.

### Ograniczenia

- podobne zadania nie są identyczne;
- różne repozytoria i modele ograniczają porównanie;
- krótszy czas nie dowodzi lepszego wyniku;
- mniejszy koszt nie dowodzi większej wartości;
- brak błędu telemetrycznego nie dowodzi poprawności kodu.

UI opisuje zmianę, a użytkownik zapisuje wniosek. Aplikacja nie deklaruje
przyczynowości.

## 20. Proponowana architektura informacji

### 20.1. Wejście do widoku zbiorczego

Widok dotyczy wielu sesji, dlatego nie powinien być czwartą zakładką aktualnie
wybranej sesji. Kandydackie miejsca:

1. osobna pozycja `Moje wykorzystanie` nad listą sesji;
2. pozycja w topbarze obok poradnika;
3. osobna trasa `/insights` lub `/my-usage`.

Rekomendacja do dalszego omówienia: osobna trasa dostępna bez wybranej sesji,
z wejściem w sidebarze. Nie należy wdrażać tej decyzji bez makiety całej
nawigacji.

### 20.2. Proponowana kolejność sekcji

```text
Moje wykorzystanie Copilota w VS Code
[7 dni] [28 dni] [90 dni] [Cały okres]
[Wszystkie repozytoria] [Źródło danych]

1. Zakres i jakość danych
2. Aktywność i regularność
3. Udział sesji z mechanizmami
4. Trendy wykorzystania
5. Najczęściej wykorzystywane
6. Repozytoria i zaobserwowana konfiguracja
7. Wartość i niezawodność mechanizmów
8. Kondycja przebiegów
9. Obszary do poznania lub sprawdzenia
10. Lista sesji z aktywnymi filtrami
```

### 20.3. Nagłówek zakresu

Nagłówek pokazuje:

- daty;
- liczbę sesji;
- liczbę ocenialnych sesji;
- aktywne dni;
- lokalne i importowane źródła;
- procent sesji z capture content;
- wersje emiterów, jeżeli znane;
- ostrzeżenie o ograniczeniu do VS Code.

### 20.4. Neutralna prezentacja

- obecność mechanizmu używa neutralnego koloru;
- czerwony oznacza potwierdzony błąd albo jednoznacznie negatywny feedback;
- szary oznacza brak lub ograniczone pokrycie;
- nie stosujemy zielonego za samo użycie większej liczby capabilities;
- każdy tooltip używa `MatTooltip`;
- ikonowe przyciski mają `aria-label`;
- chevron rozwija inline, oko otwiera inspekcję;
- wykresy i tabele zachowują dostępny odpowiednik tekstowy.

## 21. Kontrakty danych i obliczeń

### 21.1. Koncepcyjny summary sesji

```ts
type ObservationState =
  | 'USED'
  | 'AVAILABLE_NOT_USED'
  | 'NOT_OBSERVED'
  | 'UNKNOWN'
  | 'UNSUPPORTED'
  | 'CONFLICTED';

interface CoverageSummary {
  eligible: boolean;
  reason: string | null;
  evidenceCount: number;
  missingEvidenceKinds: string[];
}

interface SessionMechanismObservation {
  kind: string;
  canonicalId: string;
  displayName: string | null;
  state: ObservationState;
  executionCount: number | null;
  distinctInteractionCount: number | null;
  evidenceRefs: string[];
  coverage: CoverageSummary;
}

interface PersonalSessionFactV1 {
  version: 'personal-session-fact-v1';
  analyzerVersion: string;
  sourceSessionId: number | null;
  sourceConversationHash: string;
  startedAt: string | null;
  endedAt: string | null;
  repositoryId: string | null;
  source: 'LOCAL' | 'IMPORTED';
  mechanisms: SessionMechanismObservation[];
  compactionCount: number | null;
  errorCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  credits: number | null;
  evidenceAvailability: 'FULL' | 'PARTIAL' | 'EXPIRED';
}
```

Nazwy i pola pozostają propozycją. Przed implementacją należy sprawdzić, czy
część wartości powinna być przechowywana kolumnowo, a część w wersjonowanym JSON.

### 21.2. Formuły agregatów

```text
eligibleSessions(kind)
  = sesje o stanie USED albo NOT_OBSERVED dla danego rodzaju

usedSessionShare(kind)
  = count(USED) / count(eligibleSessions(kind))

notUsedSessionShare(kind)
  = count(NOT_OBSERVED) / count(eligibleSessions(kind))

coverage(kind)
  = count(eligibleSessions(kind)) / count(allSessionsInScope)

activeDays(kind)
  = liczba różnych lokalnych dni z co najmniej jedną sesją USED

sessionsPerActiveDay(kind)
  = count(distinct sessions USED) / activeDays(kind)

executionsPerUsingSession(kind)
  = total exact executions / count(distinct sessions USED)
```

Procenty są zaokrąglane wyłącznie do prezentacji. Obliczenia i porównania używają
wartości niezaokrąglonych.

### 21.3. Niezawodność mechanizmu

```text
confirmedSuccesses
confirmedFailures
unknownOutcomes

knownOutcomeReliability
  = confirmedSuccesses / (confirmedSuccesses + confirmedFailures)
```

`unknownOutcomes` pozostają widoczne i nie trafiają ani do sukcesów, ani do
porażek. Sukces może być uznany tylko wtedy, gdy istnieje jednoznaczny,
tool-specific dowód. Sam brak błędu nie zawsze jest potwierdzonym sukcesem.

### 21.4. Ocena użytkownika

```text
helpfulShare
  = HELPFUL / (HELPFUL + MIXED + NOT_HELPFUL)
```

`NOT_SURE` jest pokazywane, ale wyłączone z powyższego mianownika. UI musi
pokazywać wszystkie liczby, więc sam `helpfulShare` nie wystarcza.

### 21.5. Brak wspólnego value score

Nie sumujemy:

```text
użycie + szybkość + mały koszt + feedback + brak błędów
```

Wymiary odpowiadają na różne pytania i pozostają oddzielne. Użytkownik może
sortować mechanizmy według jednego wybranego wymiaru.

## 22. PAV-13 — trwałość, retencja i usuwanie

### 22.1. Problem obecnego modelu

Obecna retencja usuwa raw sygnały, a następnie osierocone sesje. Długoterminowe
zestawienie zniknęłoby po upływie retencji, nawet gdy użytkownik chce obserwować
zmianę przez wiele miesięcy.

### 22.2. Dwie niezależne retencje

Docelowo potrzebne są dwa zbiory:

```text
Raw telemetry
  pełne spany, messages i content
  krótka retencja, np. 30 dni

Personal session facts
  minimalne, pozbawione treści podsumowanie
  osobna retencja, np. 12 miesięcy albo bezterminowo lokalnie
```

Zmiana tej granicy wymaga jawnej zgody i konfiguracji. Nie może zostać dodana
przy okazji samego widoku.

### 22.3. Zachowanie po wygaśnięciu raw

Utrwalony fakt może nadal zasilać trend, ale ma stan:

```text
evidenceAvailability = EXPIRED
```

UI wyjaśnia:

> Podsumowanie sesji zachowano na potrzeby statystyk. Szczegółowy dowód wygasł
> zgodnie z retencją raw telemetry.

### 22.4. Semantyka usuwania

Należy odróżnić:

- automatyczną retencję raw — może zachować statystyczny fact;
- ręczne usunięcie sesji — domyślnie usuwa również jej fact i feedback;
- `Usuń wszystkie dane` — usuwa raw, facts, feedback, eksperymenty i aliasy;
- zmianę retencji — nie przywraca wygasłych dowodów.

### 22.5. Migracje i eksport

- nowa tabela wymaga jawnej strategii migracji H2;
- nie wolno zmieniać po cichu eksportu sesji v1;
- osobista historia może otrzymać osobny eksport albo przyszły format v2;
- każdy trwały fact ma wersję analizatora;
- zmiana reguł nie przepisuje historii bez jawnego procesu reanalizy;
- po reanalizie należy zachować informację o wersji użytej do wcześniejszego
  wyniku albo jawnie zastąpić wynik i odnotować zmianę.

## 23. Architektura implementacyjna

### 23.1. Interpretacja domenowa

Kandydacki podział frontendu:

```text
core/personal-adoption/
  capability-catalog.ts
  session-adoption-facts.ts
  adoption-aggregation.ts
  mechanism-identity.ts
  recommendation-rules.ts
  adoption.models.ts

features/personal-adoption/
  personal-adoption-page.component.*
  capability-coverage.component.*
  mechanism-ranking.component.*
  repository-usage.component.*
  mechanism-feedback-dialog.component.*
```

Nazwy są propozycją. Nie należy tworzyć pass-through components bez własnego
kontraktu prezentacji lub zachowania.

`SessionAnalysisService` może pozostać fasadą danych pojedynczej sesji. Analiza
zbiorcza wielu sesji nie powinna rozrastać `AppComponent` ani template strony
sesji.

### 23.2. Backend

Pierwszy prototyp dla istniejących danych może użyć czystego analizatora, ale
docelowy widok nie powinien pobierać pełnych raw danych wszystkich sesji do
przeglądarki.

Kandydackie odpowiedzialności:

- `PersonalAdoptionFactService` — budowa wersjonowanego factu;
- `PersonalAdoptionStore` albo rozszerzenie `ScannerStore` — SQL i retencja;
- `PersonalAdoptionController` — zakresy, agregaty i drill-down;
- osobna usługa eksportu feedbacku;
- ponowne wykorzystanie istniejącej rekonstrukcji epizodów lub przeniesienie
  wspólnej logiki na właściwą granicę, bez dwóch sprzecznych implementacji.

### 23.3. Kiedy aktualizować fact

Sesje mogą otrzymywać późniejsze batch'e. Fact nie może zostać uznany za
niezmienny po pierwszym sygnale.

Możliwe strategie do porównania:

1. przeliczanie na odczycie — proste, ale kosztowne dla wielu sesji;
2. aktualizacja po każdym batchu — szybki odczyt, wymaga idempotencji;
3. kolejka dirty sessions i okresowe przeliczenie;
4. hybryda: bieżące sesje liczone na odczycie, starsze materializowane.

W pierwszym wdrożeniu należy preferować poprawność i małą skalę lokalną, ale
kontrakt musi umożliwiać późniejszą materializację.

### 23.4. API — kandydacki kształt

```text
GET /api/personal-adoption/summary?from=...&to=...&repository=...
GET /api/personal-adoption/mechanisms/{kind}/{id}
GET /api/personal-adoption/repositories
GET /api/personal-adoption/sessions?mechanism=...&state=...
POST /api/personal-adoption/feedback
PUT /api/personal-adoption/feedback/{id}
DELETE /api/personal-adoption/feedback/{id}
POST /api/personal-adoption/feedback-export/preview
```

To propozycja do zaprojektowania po ustaleniu, które obliczenia pozostają w
frontendzie. Nie należy dodawać publicznych endpointów przed ustabilizowaniem
modelu i testów.

## 24. Prywatność i etyka produktu

### 24.1. Osobisty charakter

Widok jest przeznaczony dla użytkownika analizującego własne sesje. Nie należy
projektować go jako rankingu pracowników ani gotowego raportu oceny wydajności.

### 24.2. Dane wrażliwe

Repozytoria, nazwy narzędzi, custom agents, MCP i notatki feedbacku mogą ujawniać
projekty oraz procesy organizacji. Pozostają lokalne, chyba że użytkownik jawnie
eksportuje zredagowany raport.

### 24.3. Brak automatycznego wysyłania

Żaden feedback, ranking, sesja ani raport nie jest automatycznie wysyłany do:

- GitHuba;
- autora MCP;
- autora skilla;
- dostawcy modelu;
- organizacji użytkownika.

### 24.4. Język bez zawstydzania

Preferowane:

- `Nie zaobserwowano użycia`;
- `Możliwość do poznania`;
- `Warto sprawdzić w małej próbie`;
- `Brak wystarczających danych`.

Niepożądane:

- `Niski poziom`;
- `Pozostajesz w tyle`;
- `Powinieneś używać więcej MCP`;
- `Nieefektywny użytkownik`;
- `Słaba adopcja`.

## 25. Fixture'y i testy referencyjne

### 25.1. Minimalny zestaw sesji

Potrzebne są anonimowe fixture'y obejmujące:

1. czat bez tooli;
2. agent z lokalnymi toolami;
3. sesję ze skillem;
4. sesję z MCP i wieloma toolami jednego serwera;
5. MCP dostępne tylko jako hash;
6. custom agent jako główny agent;
7. custom agent uruchomiony jako dziecko;
8. jeden subagent;
9. zagnieżdżoną delegację;
10. konflikt call ID;
11. brak outputu modelu;
12. niepełny capture content;
13. jedno i wiele kompaktowań;
14. potwierdzony błąd toola;
15. brak rezultatu bez dowodu błędu;
16. powtórzenie identycznych argumentów w kilku sesjach;
17. kilka sesji tego samego repozytorium;
18. sesję bez repozytorium;
19. import tej samej historii w bezpiecznym scenariuszu deduplikacji;
20. raw wygasłe, fact zachowany.

### 25.2. Testy formuł

- mianowniki per mechanizm;
- wyłączenie `UNKNOWN`;
- aktywne dni;
- okno 28 dni;
- granice strefy czasu;
- procenty i punkty procentowe;
- sesja nadrzędna liczona raz;
- exact call ID liczony raz;
- ranking po sesjach, dniach i wykonaniach;
- feedback z `NOT_SURE`;
- reliability z unknown outcomes;
- brak wspólnego score.

### 25.3. Testy UI

- filtr `z użyciem / bez użycia / nieustalone` odtwarza agregat;
- tooltips wyjaśniają mianownik;
- brak danych pokazuje `—`, nie `0`;
- czerwony nie oznacza samego braku adopcji;
- lista top N informuje o pozostałych elementach;
- focus wraca po zamknięciu modalu feedbacku;
- długie nazwy i JSON są przewijalne;
- route działa bez wybranej sesji;
- widok pozostaje czytelny bez capture content.

### 25.4. Testy retencji

- automatyczna retencja raw może pozostawić fact zgodnie z ustawieniem;
- ręczne usunięcie sesji usuwa fact i feedback;
- pełne czyszczenie usuwa wszystkie nowe dane;
- fact z wygasłym dowodem ma poprawny status;
- eksport nie zawiera raw content bez jawnego wyboru;
- migracja istniejącej H2 jest bezpieczna.

## 26. Kolejność przyrostów

### PAV-00 — audyt danych i kontrakt katalogu

Cel:

- ustalić, co VS Code rzeczywiście emituje dla tooli, skilli, MCP, custom agents,
  instrukcji i subagentów;
- zbudować `capability-catalog-v1`;
- zdefiniować stany oraz pokrycie;
- dodać fixture'y brakujących kształtów.

Nie zawiera UI zbiorczego.

Definition of done:

- każda capability ma źródło dowodu;
- znane braki są zapisane;
- katalog jest wersjonowany;
- testy odróżniają `NOT_OBSERVED` od `UNKNOWN`.

### PAV-01 — ślad jednej sesji

Cel: wdrożyć sekcję opisaną w rozdziale 8 i potwierdzić semantykę na danych
pojedynczej sesji.

Zależność: PAV-00.

### PAV-02 — agregat procentów

Cel: policzyć udział sesji z mechanizmami dla istniejącego okresu retencji,
z drill-downem do listy sesji.

Zależności: PAV-00, PAV-01.

### PAV-03 — trendy, regularność i docelowa strona

Cel: wdrożyć trendy opisane w rozdziale 10 oraz utworzyć docelowe wejście
`Moje wykorzystanie`, nagłówek zakresu i filtry czasu.

Zależność: PAV-02.

### PAV-04 — top mechanizmy

Cel: wdrożyć top modele, custom agents, skille, MCP i tools z osobnymi liczbami
sesji, dni i wykonań.

Zależności: PAV-00, PAV-03.

### PAV-05 — repozytoria i konfiguracja widoczna w telemetrii

Cel: agregować użycie per repozytorium bez twierdzeń o plikowej konfiguracji.

Zależności: PAV-00, PAV-03.

### PAV-06 — kondycja przebiegów

Cel: dodać kompaktowanie, błędy, kontekst, cache i powtórzenia jako neutralne
sygnały poza adopcją.

Zależności: istniejące analizy kosztu, kompaktowania i tooli.

### PAV-07 — wartość modeli

Cel: wdrożyć opisane w rozdziale 14 widoki użycia, kosztu, czasu, niezawodności
i pokrycia modeli bez automatycznego rankingu jakości.

Zależności: PAV-04, PAV-06.

### PAV-08 — wartość MCP, tooli, skilli i custom agents

Cel: wdrożyć opisane w rozdziale 15 osobne widoki wartości i niezawodności
mechanizmów, bez wspólnego value score.

Zależności: PAV-04, PAV-06.

### PAV-09 — lokalny feedback

Cel: zapisać jawną ocenę użytkownika i pokazać ją obok faktów.

Zależności: PAV-07, PAV-08.

### PAV-10 — eksport feedbacku

Cel: bezpieczny podgląd oraz eksport Markdown/JSON opisany w rozdziale 17.

Zależność: PAV-09.

### PAV-11 — deterministyczne wskazówki

Cel: pierwsze 2–3 reguły z pełnym dowodem i małym eksperymentem, bez AI.

Zależności: PAV-03, PAV-06 i istniejący katalog technik.

### PAV-12 — eksperymenty przed/po

Cel: umożliwić użytkownikowi świadome porównanie sesji i zapis własnego wniosku.

Zależności: PAV-09, stabilne agregaty, istniejący plan porównania sesji.

### PAV-13 — trwałe facts i osobna retencja

Cel: długoterminowe trendy mimo krótszej retencji raw, zgodnie z rozdziałem 22.

Jest to osobna decyzja architektoniczna i prywatnościowa. Można ją zrealizować
wcześniej, jeżeli widok ma od początku obejmować więcej niż 30 dni, ale nie należy
ukrywać jej w implementacji UI.

### PAV-14 — badanie proweniencji konfiguracji w telemetrii

Cel: na kontrolowanym repozytorium `playground/` wykonać scenariusze instrukcji,
skills, custom agents, MCP, subagentów i kompakcji, zapisać rzeczywiste kształty
OTLP oraz zbudować deterministyczny parser poziomów `rozpoznane / widoczne /
użyte`. Zadanie nie otrzymuje dostępu do plików analizowanego repozytorium.

## 27. Otwarte decyzje

Poniższe pytania celowo pozostają otwarte i powinny być podejmowane w zadaniach
odpowiednich `PAV-*`:

1. Dokładna nazwa widoku i trasy.
2. Czy sesje importowane domyślnie wchodzą do osobistej historii.
3. Czy mianownikiem domyślnym są wszystkie sesje, czy tylko sesje agentowe.
4. Definicja `regularnego` użycia poza progiem dwóch dni.
5. Kanoniczna tożsamość repozytorium i mechanizmów.
6. Obsługa aliasów oraz zmian nazw.
7. Dokładny katalog możliwości v1.
8. Czy użytkownik może ukryć mechanizm niepasujący do jego pracy.
9. Minimalna liczba ocen do rankingu feedbacku.
10. Domyślna retencja osobistych facts.
11. Zachowanie feedbacku po automatycznej retencji raw.
12. Czy użytkownik może ręcznie oznaczyć typ zadania.
13. Czy i kiedy używać zapisanej klasyfikacji AI do grupowania zadań.
14. Jak prezentować instructions bez pewnej proweniencji.
15. Czy model requested i response pokazywać jako osobne tożsamości.
16. Jak zidentyfikować wersję skilla lub custom agenta.
17. Czy wskazówki mogą być wyciszane globalnie albo per repozytorium.
18. Jak długo zachowywać eksperymenty i notatki.
19. Czy eksport feedbacku ma wspierać gotowe szablony GitHub Issue.
20. Jak zachować porównywalność po zmianie wersji analizatora.

## 28. Decyzje już przyjęte w tej koncepcji

1. Agent Scanner mierzy wyłącznie obserwowane sesje VS Code.
2. Nie powstaje jedna ocena adopcji ani wspólny value score.
3. Podstawą są procenty sesji, liczby sesji, aktywne dni i trendy.
4. Każdy procent pokazuje mianownik i pokrycie.
5. Brak telemetrii nie jest brakiem użycia.
6. Więcej mechanizmów nie oznacza automatycznie lepszego użytkownika.
7. Kompaktowanie, cache, błędy i presja kontekstu są kondycją przebiegu, nie
   adopcją.
8. Top listy pokazują sesje i wykonania osobno.
9. Rozpoznanie konfiguracji w kontekście modelu, ekspozycja w sesji i faktyczne
   użycie są trzema różnymi poziomami dowodu.
10. Bez dostępu do repozytorium opisujemy wyłącznie to, co rozpoznano w
    system instructions, input messages i definicjach tooli; brak rozpoznania
    pozostaje stanem `Nie ustalono`.
11. Feedback użytkownika jest deklaracją, nie faktem telemetrycznym.
12. Feedback pozostaje lokalny i nie jest automatycznie wysyłany.
13. Rekomendacja wskazuje mały eksperyment oraz ograniczenie dowodu.
14. Pierwsze rekomendacje są deterministyczne i wykorzystują istniejący katalog
    technik.
15. Długoterminowe facts wymagają osobnej, jawnej polityki retencji.

## 29. Końcowa definicja wartości

Funkcja jest wartościowa, jeżeli użytkownik potrafi bez znajomości OTLP:

- powiedzieć, jakich możliwości używa w swoich sesjach VS Code;
- odróżnić okazjonalną próbę od powtarzanego sposobu pracy;
- przejść od procentu lub top listy do dokładnej sesji;
- zobaczyć brak albo ograniczenie pokrycia;
- rozpoznać, że brak mechanizmu nie jest automatycznie problemem;
- znaleźć jeden konkretny obszar do poznania, poprawy albo ograniczenia;
- zaplanować małą próbę i porównać wynik;
- wskazać mechanizmy często używane, niezawodne i oceniane jako pomocne;
- przygotować rzeczowy, bezpieczny feedback dla autora modelu, MCP, toola,
  skilla lub custom agenta;
- zrozumieć, które wnioski są faktami, które wyliczeniami, a które jego własną
  oceną.

Funkcja nie jest wartościowa, jeżeli jedynie zachęca do użycia większej liczby
mechanizmów albo zamienia telemetrię w arbitralną ocenę użytkownika.
