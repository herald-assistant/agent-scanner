# Standaryzacja — instrukcje Copilot

Status: wymagania referencyjne; kryteria merytoryczne używane przez aplikację; źródła sprawdzone 2026-09-22.

[Dokumentacja](README.md) · [Wymagania wspólne](standaryzacja.md)

## Źródła

| ID | Oficjalna podstawa |
|---|---|
| I1 | [GitHub: obsługa typów instrukcji](https://docs.github.com/en/copilot/reference/custom-instructions-support) — profile klientów i funkcji. |
| I2 | [GitHub: instrukcje repozytorium](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions) — lokalizacje, globy, `excludeAgent`. |
| I3 | [GitHub: dostosowanie odpowiedzi](https://docs.github.com/en/copilot/concepts/prompting/response-customization) — zakres, pierwszeństwo, redakcja. |
| I4 | [GitHub: instrukcje CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) — wykrywanie, łączenie i importy. |
| I5 | [GitHub: dobre praktyki CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices) — zalecana zawartość. |
| I6 | [GitHub: instrukcje dla code review](https://docs.github.com/en/copilot/tutorials/customize-code-review) — zwięzłość, testowanie i gałąź PR. |
| I7 | [VS Code: custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions) — opcjonalne frontmatter i ustawienia. |
| I8 | [GitHub: instrukcje w IDE](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide) — różnice klientów. |
| I9 | [GitHub: referencja CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#custom-instructions-imports) — importy, opis częściowo rozbieżny z I4. |
| I10 | [GitHub: ograniczanie zbędnego kontekstu](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage) — instrukcje oparte na rzeczywistych potrzebach projektu. |
| I11 | [GitHub: podział odpowiedzialności mechanizmów CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features) — stałe reguły, procedury, role i narzędzia. |

Oznaczenia GH-W, GH-Z, HOST i AS oraz stany wyniku definiuje
[specyfikacja wspólna](standaryzacja.md#pochodzenie-i-siła-reguł).
ID źródła w tabeli reguł wskazuje konkretny artykuł powyżej.

## Lokalizacje i zakres

| Artefakt | Zakres i interpretacja |
|---|---|
| `.github/copilot-instructions.md` | Instrukcje całego repozytorium. Markdown, bez obowiązkowego YAML. |
| `.github/instructions/**/*.instructions.md` | Instrukcje ścieżkowe; dozwolone podkatalogi. |
| `AGENTS.md`, także w podkatalogach | Instrukcje dla obsługujących je agentów. Nie jest profilem custom agenta. |
| `CLAUDE.md`, `GEMINI.md` | Alternatywy zależne od klienta. Opis GitHub.com wskazuje korzeń repozytorium. |
| `~/.copilot/copilot-instructions.md`, `~/.copilot/instructions/**/*.instructions.md` | Osobiste instrukcje CLI; poza samym odczytem repozytorium. |
| Ustawienia osobiste i organizacyjne na GitHub.com | Zewnętrzne wobec lokalnego katalogu. |

Podstawa lokalizacji: I2 i I4. CLI uwzględnia katalog roboczy, korzeń
i odpowiednie katalogi na ścieżce pracy; instrukcje modularne mają wyjątek
dotyczący katalogów pośrednich. Obsługuje także `.claude/CLAUDE.md`.
`COPILOT_HOME` zmienia bazę konfiguracji osobistej, a
`COPILOT_CUSTOM_INSTRUCTIONS_DIRS` dodaje lokalizacje. Scanner nie odczytuje
ich automatycznie z konta procesu serwera.

## Obsługa według funkcji

Zestawienie na podstawie I1; „—” oznacza brak danego mechanizmu w tej macierzy,
nie dowód, że lokalny plik jest wadliwy.

| Funkcja | Ogólne | Ścieżkowe | Instrukcje agentowe |
|---|---|---|---|
| GitHub.com Chat | Tak | — | — |
| GitHub.com cloud agent | Tak | Tak | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` |
| GitHub.com code review | Tak | Tak | `AGENTS.md` |
| VS Code Chat | Tak | Tak | `AGENTS.md`; rozszerzenia opisuje I7 |
| VS Code code review | Tak | — | — |
| Visual Studio Chat | Tak | Tak | — |
| Visual Studio code review | Tak | — | — |
| JetBrains Chat / code review | Tak | Tak według I1 | — |
| Xcode Chat / code review | Tak | Tak według I1 | — |
| Eclipse Chat | Tak | — | — |
| Eclipse code review | — | — | — |
| CLI | Tak | Tak | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` |

Wywołanie cloud agenta z IDE należy oceniać jako cloud agenta.
Nie utożsamiać go z lokalnym trybem agentowym tego IDE.

## Format i stosowanie

Przykład autorski: `.github/instructions/testy.instructions.md`.

```markdown
---
applyTo: "src/test/**/*.java,frontend/**/*.spec.ts"
excludeAgent: "code-review"
---

Dodawaj regresje dla zachowania zmienionego przez zadanie.
Korzystaj z syntetycznych danych i poleceń testowych opisanych w repozytorium.
```

I2 dokumentuje tekstowy `applyTo`, wzorce glob i oddzielanie wielu wzorców
przecinkiem. `*.java` nie jest równoważne `**/*.java`.
`excludeAgent` może wyłączyć `code-review` albo `cloud-agent`;
nie jest uniwersalnym filtrem wszystkich klientów.

Gdy instrukcje ścieżkowe pasują, są używane razem z ogólnymi. Dla GitHub.com
I3 opisuje pierwszeństwo: osobiste → ścieżkowe → ogólne repozytorium →
agentowe → organizacyjne. I2 wskazuje pierwszeństwo najbliższego
`AGENTS.md` w drzewie. Nie należy scalać tych reguł w domniemany algorytm
każdego klienta.

CLI według I4 łączy pasujące instrukcje, deduplikuje określone identyczne
treści i nie określa ogólnego pierwszeństwa wszystkich plików.
Wyłączenie w `/instructions` i stan istniejącej sesji wpływają na użycie;
zmiana pliku nie dowodzi aktualizacji już działającej sesji.

## Zalecana zawartość

GitHub zaleca krótkie, konkretne informacje o rzeczywistym projekcie:
komendy budowania, testowania i kontroli jakości, konwencje oraz istotne
decyzje architektoniczne (I5). Instrukcje powinny uwzględniać znane pułapki,
aktualne narzędzia i oczekiwany rezultat; rozbudowane ogólne poradniki oraz
rzadkie jednorazowe preferencje zwiększają zbędny kontekst (I10).

Standaryzacja ocenia konstrukcję tych wskazówek: odpowiedzialność pliku,
zakres, jasność, utrzymanie i koszt zbędnego kontekstu. Nie sprawdza komend,
wersji ani opisanej architektury względem kodu, manifestów lub CI projektu.
Zapis o technologii jest deklaracją autora, a nie potwierdzonym faktem.
Uniwersalność względem technologii i architektury jest obowiązkową polityką
AS-W: reguła ogólna nie może bez uzasadnienia narzucać jednego stosu lub wzorca.
Jawnie wyspecjalizowana instrukcja jest dopuszczalna w uzasadnionym zakresie;
GitHub nie wymaga technologicznej neutralności każdego pliku (I3, I11).
Nazwy sekcji nie są obowiązkowym schematem GitHub. Polski język, brak
konkretnego nagłówka lub użycie akapitów zamiast list nie są błędem formatu.

I6 zaleca dla code review rozpoczynanie od niewielkiego zestawu konkretnych
reguł i ocenę ich działania na PR. Wskazanie około 1000 linii na pojedynczy
plik jest dobrą praktyką, nie technicznym limitem wszystkich instrukcji.
Z kolei „dwie strony” w I2 występują w przykładowym zadaniu generowania pliku;
nie tworzą uniwersalnej reguły walidacji.

## Reguły walidacji

| ID | Podstawa | Sprawdzenie i wynik |
|---|---|---|
| INS-001 | GH-W · I2 | Zweryfikować dokładną lokalizację i nazwę. Podobny plik w korzeniu pokazać jako kandydata w innej lokalizacji, nie jako aktywne `.github/copilot-instructions.md`. |
| INS-002 | AS | Brak ogólnych instrukcji: informacja i opcjonalne zalecenie ich rozważenia; nie błąd repozytorium. |
| INS-003 | GH-W / HOST · I2, I7 | Dla ścieżkowego mechanizmu GitHub.com oczekiwać `applyTo`. W VS Code brak frontmatter/`applyTo` może oznaczać instrukcje dodawane ręcznie; nie odrzucać pliku. |
| INS-004 | GH-W · I2 | Jeżeli `applyTo` występuje, sprawdzić typ tekstowy i wzorce. Nie traktować wartości jako regexu ani ścieżki systemowej Windows. |
| INS-005 | AS | Brak lokalnych dopasowań poprawnego globu: informacja, nie błąd. Nakładanie zakresów jest dozwolone; pokazać pliki współobowiązujące. |
| INS-006 | GH-W · I2 | W profilu GitHub.com sprawdzić `excludeAgent` względem udokumentowanych wartości. Wykluczenie zmienia zastosowanie, a nie poprawność pliku. |
| INS-007 | HOST · I7 | `name` i `description` instrukcji VS Code są opcjonalne. Nie przenosić wymaganych metadanych skills do instrukcji. |
| INS-008 | AS | Pusta treść daje uwagę o braku użytecznych instrukcji. Nieznane pola i treść Markdown zachować. |
| INS-009 | GH-Z · I5, I10 | Ocenę kompletności i aktualności treści przedstawić z fragmentami dowodów. Szczegółowe kryteria AI opisują INS-016–INS-021. |
| INS-010 | GH-Z · I3 | Sprzeczne polecenia wymagają przeglądu; nakładanie globów samo w sobie nie dowodzi sprzeczności. |
| INS-011 | GH-W · I4; AS | Rozpoznać importy `@ścieżka` właściwych plików CLI. Lokalne referencje analizować z wykrywaniem cykli; nie wykonywać zawartych poleceń. |
| INS-012 | HOST · I7 | Wskazać zależność zagnieżdżonych `AGENTS.md` od ustawień VS Code. Bez ustawień brak podstaw do potwierdzenia ich użycia. |
| INS-013 | GH-Z · I6 | Długość raportować jako pomiar i ewentualne zalecenie. Nie wnioskować z liczby znaków o dokładnych tokenach lub posłuszeństwie modelu. |
| INS-014 | GH-W · I6 | Review na GitHub czyta instrukcje i skills z gałęzi head PR. Lokalny katalog nie potwierdza zawartości zdalnej gałęzi ani konfiguracji review. |
| INS-015 | AS | Poprawność komend, zależności i rzeczywistej architektury projektu pozostaje poza zakresem. Nie żądać manifestów ani kodu do jej sprawdzenia. Ocenić jedynie sposób zapisania zakresu i założeń w konfiguracji Copilot. |

## Kryteria merytoryczne dla AI

Ocena stosuje [wspólny kontrakt AI](standaryzacja-ai.md). Poniższe kryteria
przekładają zalecenia źródeł na pytania analityczne Agent Scanner; szczegółowe
warunki oceny są decyzją AS. Nie wymagają identycznego spisu sekcji w każdym
repozytorium. Materiałem są pliki konfiguracji Copilot, dopuszczone tekstowe
materiały w ich katalogach i fakty analizy lokalnej. AS-W jest obowiązkową
polityką produktu; nie jest dodatkowym wymogiem GitHub.

| ID | Podstawa | Co ocenia AI | Dowód i granica wniosku |
|---|---|---|---|
| INS-016 | AS na podstawie GH-Z · I3, I11 | Czy plik zawiera trwałe zasady zachowania właściwe dla instrukcji? Czy nie przejmuje szczegółowej procedury skilla, definicji roli agenta, zadania promptu lub konfiguracji MCP? | Wskazać konkretny fragment, jego częstotliwość zastosowania i właściwy mechanizm. Zalecenie przeniesienia musi wyjaśniać sposób ładowania treści; samo użycie listy kroków nie dowodzi błędnej kategorii. |
| INS-017 | AS-W (polityka produktu) na podstawie I2, I3, I11 | Czy zachowana jest uniwersalność względem technologii i architektury: zasady ogólne nie narzucają bez uzasadnienia frameworka, języka lub wzorca architektonicznego, a specjalistyczne mają jawny, uzasadniony zakres? | Porównać deklarowany zakres z treścią i warunkami stosowania. Wskazać neutralną zasadę albo konkretną nieuzasadnioną zależność. Specjalizacja jest dopuszczalna w opisanym zakresie; nie weryfikować rzeczywistego stosu ani architektury repozytorium. Kryterium zawsze ocenić, bez `NOT_APPLICABLE`. |
| INS-018 | AS na podstawie I2, I7 | Czy frontmatter, metadane zakresu i nagłówki poprawnie komunikują sposób stosowania instrukcji w wybranym kliencie? Czy warunki i wyjątki są łatwe do odnalezienia? | Powiązać tekst z `applyTo`, opcjonalnym opisem i strukturą Markdown. Oddzielić błędny YAML/typ pola od zalecenia redakcyjnego. Nie narzucać obowiązkowego YAML ogólnym instrukcjom ani jednego schematu H1/H2; nie deklarować dopasowania do nieprzekazanego drzewa kodu. |
| INS-019 | AS na podstawie I2, I3, I4 | Czy współobowiązujące instrukcje są spójne i nie opierają się na błędnym założeniu o pierwszeństwie, dziedziczeniu lub aktywacji Copilot? | Przy konflikcie podać dwa cytaty i wspólny deklarowany zakres/profil. Uwzględnić jawne wyjątki i różnice klientów. Obecność pliku nie dowodzi załadowania go w sesji; nie wyprowadzać hierarchii CLI z GitHub.com. |
| INS-020 | AS na podstawie GH-Z · I6, I10 | Czy konfiguracja pozostaje łatwa w utrzymaniu: bez zbędnych powtórzeń, rozproszonych kopii reguł, nadmiarowych poradników i często zmiennych szczegółów w stale ładowanym tekście? | Wskazać konkretne kopie lub niepotrzebny fragment i wyjaśnić ryzyko rozbieżności przy aktualizacji. Zaproponować jedno źródło reguły, odnośnik albo procedurę na żądanie. Długość sama nie dowodzi nadmiarowości ani dokładnego zużycia tokenów. |
| INS-021 | AS na podstawie GH-Z · I3, I6 | Czy zasady są konkretne, samodzielnie zrozumiałe i mają czytelne warunki zastosowania oraz oczekiwane zachowanie? Dla review: czy wiadomo, kiedy zgłosić uwagę? | Wskazać użyteczny warunek albo ogólnik i jego wpływ na interpretację. Ocenić jakość zapisu, nie skuteczność komendy, testu lub rzeczywistych odpowiedzi modelu. Brak dowolnie nazwanej sekcji nie jest brakiem merytorycznym. |

Przykład uwagi: instrukcja opisana jako uniwersalna wymaga warstw kontroler,
serwis i repozytorium w każdej aplikacji. AI wskazuje nieuzasadnione narzucenie
architektury w INS-017 i proponuje ograniczenie tej reguły do jawnej specjalizacji.
Nie musi ustalać, jak zbudowane jest badane repozytorium.

Przykład pozytywny: ogólna zasada wymaga udokumentowania zmiany kontraktu,
a szczegóły określonego frameworka znajdują się w osobnej instrukcji z jawnym
zakresem. Taki podział może spełniać politykę uniwersalności AS-W.

## Rozbieżności i ograniczenia

- I1 wymienia instrukcje ścieżkowe dla JetBrains i Xcode, podczas gdy części
  I8 nadal opisują pojedynczy plik repozytoryjny. Przy nieznanej wersji klienta
  zgłosić rozbieżność zamiast kategorycznej oceny obsługi.
- I7 dokumentuje także `CLAUDE.md` i opcjonalne nagłówki instrukcji, szerzej niż
  zestawienie I1. Te reguły oznaczyć jako HOST. Nie przypisywać ich wszystkim IDE.
- I7 opisuje dobór instrukcji również przez dopasowanie opisu do zadania,
  ale tabela `applyTo` wiąże automatyczne stosowanie ze wzorcem. Bez globu
  nie gwarantować automatycznej aktywacji ani nie oznaczać pliku jako błędnego.
- I4 ogranicza importy do względnych ścieżek wewnątrz repozytorium/lokalizacji
  instrukcji; I9 wspomina również ścieżki absolutne. Ocena takiego importu
  w CLI jest nierozstrzygnięta bez potwierdzenia wersji. Scanner w obu przypadkach
  zachowuje własną granicę odczytu.
- Nie przenosić pierwszeństwa z GitHub.com do CLI: I4 jawnie nie definiuje
  ogólnej hierarchii. Samo wczytanie pliku nie dowodzi zastosowania instrukcji
  przez model; I3 opisuje niedeterministyczność odpowiedzi.

## Scenariusze odbioru

| Przypadek | Oczekiwanie |
|---|---|
| Poprawny Markdown bez YAML w `.github/copilot-instructions.md` | Akceptowany. |
| `copilot-instructions.md` tylko w korzeniu | Nie zalicza ścieżki repozytoryjnej INS-001. |
| Dwa globy rozdzielone przecinkiem | Dwa wzorce, nie jedna literalna nazwa. |
| `*.ts` i plik w `src/a.ts` | Brak dopasowania; `**/*.ts` dopasowuje. |
| Instrukcja VS Code bez `applyTo` | Informacja o braku potwierdzonego automatycznego zastosowania. |
| `excludeAgent: code-review` | Plik wyłączony dla review; nadal możliwy dla cloud agenta. |
| Dwa pliki o nachodzących zakresach | Lista obu źródeł, bez automatycznego błędu konfliktu. |
| `AGENTS.md` w module | Zachowany zakres katalogowy i profil klienta. |
| Cykl lokalnych importów | Raport cyklu, skończony odczyt, brak wykonywania tekstu. |
| Reguła wymienia polecenie testowania | Oceniony zakres i jasność zapisu; poprawność polecenia poza zakresem. |
| Uniwersalna instrukcja bez uzasadnienia narzuca framework i architekturę warstwową | Uwaga AS-W INS-017 z cytatem, bez żądania manifestów. |
| Ogólne zasady i jawnie ograniczona instrukcja specjalistyczna | Możliwy `SUPPORTED` INS-017, bez zakazu specjalizacji. |
| Instrukcje zawierają same ogólniki, ale mają poprawną lokalizację | Lokalizacja zgodna; AI może wskazać brak konkretu według INS-021. |
| Reguła modułu doprecyzowuje ogólną zasadę jako jawny wyjątek | Nie zgłaszać automatycznie konfliktu INS-019. |
