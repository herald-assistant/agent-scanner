# Cel produktu i model wartości

Stan dokumentu: 2026-09-06.

## Problem użytkownika

Użytkownik widzi, że agent wykonał zadanie, ale zwykle nie potrafi odpowiedzieć na
ważniejsze pytania:

- dlaczego potrzeba było tylu wywołań modelu;
- co model próbował osiągnąć w kolejnych rundach;
- które wyniki narzędzi powiększały następny input;
- jaki udział pracy przypadł na odczyt danych, delegację, walidację i zapis;
- czy szerokie narzędzia uniwersalne powodowały wiele powtarzalnych kroków;
- czy bardziej celowane narzędzie, indeks, repo mapa albo dobrze opisany skill
  mogłyby zmniejszyć liczbę rund lub rozmiar kontekstu;
- czy subagent przyniósł wartość proporcjonalną do własnych wywołań modelu i
  wielkości zwrotu.

Surowa telemetria odpowiada na pytanie „co zostało wyemitowane”, ale sama tabela
spanów nie buduje zrozumiałej historii. Z kolei swobodna interpretacja AI może
brzmieć przekonująco, lecz bez połączenia z dowodami nie nadaje się do optymalizacji.
Produkt ma połączyć oba poziomy.

## Obietnica produktu

Agent Scanner pomaga zrozumieć przepływ pracy agenta i wskazać miejsca warte
sprawdzenia przed zmianą promptu, narzędzi, skilli lub strategii delegowania.

Obietnica składa się z trzech kroków:

1. **Zobacz przebieg.** Odtwórz kolejność wywołań modeli, żądań narzędzi,
   wykonania i wyników wracających do modelu.
2. **Znajdź ciężar.** Pokaż wyemitowane tokeny i credits oraz ostrożną estymację,
   z jakimi kategoriami działań są związane.
3. **Sprawdź alternatywę.** Skieruj użytkownika do konkretnych rund i danych,
   na podstawie których może ocenić krótszy prompt, mniejszy wynik, indeks,
   dedykowane narzędzie, skill albo zmianę granicy delegacji.

Narzędzie nie ma obiecywać oszczędności na podstawie samej etykiety. Ma skracać
czas potrzebny do postawienia i zweryfikowania dobrej hipotezy optymalizacyjnej.

## Docelowy użytkownik

Pierwszym odbiorcą jest programista lub osoba techniczna, która korzysta z agenta,
ale nie zna szczegółów protokołu OTLP, mechaniki cache ani architektury agentów.
Ekran powinien być czytelny przed otwarciem danych technicznych.

Drugim odbiorcą jest osoba rozwijająca integrację agentową. Potrzebuje ona wejścia
do konkretnej rundy, raw atrybutów i audytu relacji, aby sprawdzić hipotezę bez
polegania na skrócie UI.

## Decyzje, które ekran ma ułatwiać

### Optymalizacja pozyskiwania danych

Użytkownik powinien zobaczyć, jaka część badanego zużycia wiąże się z pozyskiwaniem
danych, w których fazach występuje oraz jaki udział mają narzędzia uniwersalne,
domenowe i celowane. Następnie może sprawdzić:

- czy wyniki są większe niż wymaga pytanie;
- czy podobne dane są wyszukiwane wielokrotnie;
- czy model dostaje indeks lub mapę repozytorium;
- czy narzędzie pozwala ograniczyć zakres do symbolu, endpointu lub fragmentu;
- czy skill opisuje skuteczny sposób użycia dostępnych narzędzi.

### Optymalizacja delegacji

Użytkownik powinien rozpoznać rundę delegującą, własne rundy subagenta, credits
tego poddrzewa i wynik wracający do rodzica. To pozwala sprawdzić:

- czy zakres zlecenia był precyzyjny;
- czy subagent powtórzył pozyskanie danych wykonane przez rodzica;
- czy pełny zwrot był potrzebny, czy wystarczył artefakt i krótka referencja;
- czy równoległe delegacje nie nakładały się zakresem.

### Optymalizacja walidacji i zapisu

Użytkownik powinien odróżnić sprawdzanie wyniku od pozyskiwania materiału oraz
zapis roboczy od końcowego. To pozwala ocenić:

- czy test lub kompilacja były ograniczone do zmienionego obszaru;
- czy kilka zapisów dało się połączyć;
- czy duży artefakt wrócił do kontekstu mimo że wystarczyłaby ścieżka;
- czy odpowiedź końcowa nie powtarza treści już zapisanej w pliku.

## Hierarchia informacji w `Mapie pracy`

Ekran prowadzi od celu do szczegółów:

1. nagłówek wyjaśnia schemat `interakcja → M → A → M → odpowiedź`;
2. zlecenie użytkownika ustala kontekst biznesowy;
3. wybór interakcji i warstwy pozwala czytać wyłącznie faktyczny przebieg;
4. szczegółowy diagram pozwala odnaleźć konkretną rundę;
5. `AI Hub` pokazuje zapisany podział credits i udostępnia rozmowę o sesji;
6. prawy panel `M → A → M` pokazuje dokładne żądanie i dane następnego modelu;
7. `Dane techniczne` zachowują pełną ścieżkę audytu do raw OTLP.

Tabela techniczna nie powinna wyprzedzać odpowiedzi na pytanie „co się działo”.
Wartości liczbowe mają wspierać historię, a nie zastępować jej.

## Słownik produktu

| Termin w UI | Znaczenie |
|---|---|
| Fakty | Dane wyemitowane przez runtime oraz deterministyczne relacje i formuły. |
| Analiza | Jawnie uruchomiony proces wysłania ograniczonego zakresu do AI i walidacji odpowiedzi. |
| AI Hub | Jawnie uruchamiana analiza kategorii i rozmowy o całej zapisanej sesji. |
| Kategorie | Wynik analizy AI prezentowany w `AI Hub`. |
| Pozyskanie danych | Wyszukiwanie i odczyt, których wyniki mogą zasilić dalszy model. |
| Szczegółowy przebieg | Faktyczny graf wywołań modeli głównego agenta i subagentów. |
| Credits | GitHub Copilot AI credits wyemitowane w telemetrii, bez przeliczenia na walutę. |
| Credits objęte analizą | Credits wywołań mających dane potrzebne do lokalnej estymacji kategorii. |
| Poza kategoriami | Zmierzona część credits, której nie da się połączyć z dowodem kategorii. |

W komunikacji produktowej preferujemy czasownik `przeanalizuj` i rzeczownik
`kategorie`. Słowo `klasyfikacja` pozostaje nazwą techniczną kontraktu i kodu.
Nie używamy `inwentaryzacji`, jeśli chodzi o semantyczną ocenę działań modelu.

## Granice obietnicy

Agent Scanner:

- nie jest proxy modelu i nie kontroluje jego requestów;
- nie jest źródłem rozliczeń finansowych;
- nie zna ceny modelu na podstawie credits;
- nie odtwarza ukrytego reasoning;
- nie ocenia jakości wykonania na podstawie samego typu narzędzia;
- nie dowodzi, że narzędzie celowane jest tańsze;
- nie skanuje repozytorium ani nie sprawdza, czy skill istnieje, jeśli nie ma tego
  w telemetrii;
- nie przypisuje subagenta na podstawie samej bliskości czasowej.

## Kryteria wartości

Rozwój ekranu powinien zwiększać co najmniej jeden z tych rezultatów:

- użytkownik szybciej identyfikuje dominujący rodzaj pracy;
- potrafi przejść od agregatu do konkretnych rund i dowodów;
- odróżnia wyemitowane dane od estymacji i oceny AI;
- formułuje konkretną hipotezę optymalizacji;
- może porównać efekt zmiany na kolejnej sesji;
- nie musi znać nazw atrybutów OTel, aby poprawnie odczytać podstawowy ekran.

Docelowo warto mierzyć czas do wskazania pierwszej hipotezy, odsetek poprawnie
zrozumianych pojęć w testach użyteczności oraz możliwość odtworzenia wniosku z
raw danych. Te miary nie są obecnie zbierane przez aplikację.
