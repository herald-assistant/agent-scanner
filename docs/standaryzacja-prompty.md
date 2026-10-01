# Standaryzacja — pliki promptów Copilot

Status: wymagania referencyjne; kryteria merytoryczne używane przez aplikację; źródła sprawdzone 2026-09-22.

[Dokumentacja](README.md) · [Wymagania wspólne](standaryzacja.md)

## Źródła

| ID | Oficjalna podstawa |
|---|---|
| P1 | [GitHub: pliki promptów w IDE](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide#enabling-and-using-prompt-files) — nazwy, lokalizacje, referencje i użycie. |
| P2 | [GitHub: pierwszy plik promptu](https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file) — przykład powtarzalnego zadania. |
| P3 | [GitHub: dostosowanie odpowiedzi](https://docs.github.com/en/copilot/concepts/prompting/response-customization#about-prompt-files) — prompt a instrukcje. |
| P4 | [VS Code: prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files) — pola, priorytet narzędzi i ograniczenie Agent Host. |
| P5 | [GitHub: zestawienie mechanizmów](https://docs.github.com/en/copilot/reference/customization-cheat-sheet) — macierz klientów. |
| P6 | [GitHub: macierz funkcji](https://docs.github.com/en/copilot/reference/copilot-feature-matrix) — różnice między IDE i wersjami. |

Oznaczenia reguł i interpretację wyników definiuje
[specyfikacja wspólna](standaryzacja.md#pochodzenie-i-siła-reguł).

## Zastosowanie i dostępność

Prompt file utrwala zadanie do ponownego wywołania z innymi danymi, np. przegląd
zmiany albo przygotowanie testów. P2 pokazuje taki sposób ponownego wykorzystania,
a P3 odróżnia go od stale stosowanych instrukcji.
Samo zapisanie promptu nie powoduje wykonywania go dla wszystkich rozmów.

| Profil | Wniosek dla Standaryzacji |
|---|---|
| VS Code Local agent | P4 opisuje obsługę plików promptów. |
| VS Code Agent Host | P4: pliki promptów są wycofane i nie są ładowane przez Agent Host; wskazana jest migracja do skills. |
| Visual Studio | P1, P5 i P6 opisują obsługę. Nie zakładać wszystkich pól YAML z VS Code. |
| JetBrains | P1 opisuje użycie, P5/P6 oznaczają preview. |
| Xcode | P5/P6 oznaczają preview, podczas gdy P1/P3 ograniczają listę klientów; rozbieżność wymaga uwzględnienia wersji. |
| Eclipse | Brak obsługi według P5/P6. |
| CLI / GitHub.com | Brak obsługi mechanizmu plików promptów według P5. Polecenie slash skilla nie jest dowodem obsługi `*.prompt.md`. |

Nie wydawać globalnego zalecenia usunięcia promptów tylko dlatego, że jeden
wybrany profil ich nie ładuje. Repozytorium może obsługiwać kilka środowisk.
W profilu Agent Host rekomendacja dotyczy migracji zastosowania do
[skills](standaryzacja-skills.md), z przeglądem zmiany sposobu aktywacji.

## Lokalizacje i format

P1 wskazuje katalog `.github/prompts/` i sufiks `.prompt.md`.
Nazwa ma opisywać zadanie; dopuszczone są m.in. spacje. Wymagania nazwy skilla
nie obowiązują nazw promptów. Prywatne prompty profilu użytkownika są osobnym
źródłem poza skanowanym repozytorium.

P4 opisuje Markdown z opcjonalnym YAML. Zwykły prompt bez nagłówka jest poprawny.
Pola VS Code są opcjonalne:

| Pole | Przeznaczenie w VS Code |
|---|---|
| `name` | Nazwa wywołania; domyślnie wynika z pliku. |
| `description` | Krótki opis zadania. |
| `argument-hint` | Podpowiedź danych wejściowych. |
| `agent` | `ask`, `agent`, `plan` albo nazwa własnego agenta. |
| `model` | Wybór modelu; brak zachowuje aktualny wybór. |
| `tools` | Lista narzędzi/zestawów, również MCP i rozszerzeń. |

Scanner parsuje obecne pola zgodnie z profilem. Nie wymaga `description`,
`agent` lub `tools` tylko dlatego, że są użyte w przykładzie. Nie traktuje
frontmatter promptu jak frontmatter skilla lub agenta GitHub.com.

## Kontekst, dane wejściowe i narzędzia

P1 dokumentuje linki Markdown oraz `#file:`; lokalne ścieżki odnoszą się
do położenia promptu. Przykładowo z `.github/prompts/testy.prompt.md`
referencja `../../docs/testy.md` prowadzi do dokumentu repozytorium.

P4 opisuje również zmienne wejściowe, m.in. `${input:nazwa}`,
i odwołania `#tool:`. Nie są to lokalne pliki. Nie uznawać nierozwiązanej
zmiennej wejściowej za brakujący plik ani nie pytać użytkownika o jej wartość
w czasie skanowania.

W VS Code narzędzia zadeklarowane przez prompt mają pierwszeństwo przed
narzędziami wskazanego agenta, a dalej stosowane są domyślne narzędzia (P4).
Scanner nie może obiecać przecięcia obu list jako ochrony przed rozszerzeniem
dostępu. Narzędzia niedostępne są ignorowane przez klienta; ich brak w lokalnym
katalogu nie jest dowodem niepoprawnego promptu.

Wymagania AS dla referencji:

- odróżniać link lokalny, URL, kotwicę, zmienną i nazwę narzędzia;
- sprawdzać ścieżki względem właściwego pliku, zachowując rzeczywistą pisownię;
- wykrywać nieistniejące lokalne cele oraz cykle między promptami;
- nie traktować tekstu przykładu w bloku kodu jako automatycznej deklaracji zależności;
- nie pobierać URL i nie przechodzić poza zakres wybranego katalogu;
- referencje dynamiczne oznaczać jako wymagające kontekstu wywołania.

## Zalecenia redakcyjne i przykład

P4 zaleca jasny cel, oczekiwany format wyniku, przykłady oraz odwołania do
wspólnych instrukcji zamiast ich powielania. Dla Standaryzacji przekłada się to
na kryteria AS do jawnej oceny AI i przeglądu użytkownika: zadanie, wymagane wejście, sposób obsługi
braków, zakres zmian, oczekiwany rezultat i sposób sprawdzenia wyniku.
Nie wymagać sztucznych nagłówków ani jednego języka treści.

Obowiązkowa polityka AS-W wymaga uniwersalności względem technologii i architektury
odpowiedniej do deklarowanego zakresu szablonu. Prompt ogólny nie może bez
uzasadnienia zakładać stosu lub wzorca architektonicznego; specjalistyczny
może to robić w jasno opisanym zadaniu. To kryterium produktu, nie nakaz GitHub
usunięcia technologii z każdego promptu. Nie sprawdzamy komend ani zgodności
opisu projektu z kodem, manifestem lub dokumentacją rzeczywistej architektury.

Autorski przykład dla VS Code Local agent:
`.github/prompts/przeglad-testow.prompt.md`.

```markdown
---
description: Wskazuje brakujące przypadki testowe dla opisanej zmiany.
agent: ask
---

Przeanalizuj zmianę wskazaną przez użytkownika.
Jeśli nie podano zakresu zmiany, poproś o niego przed oceną.
Uwzględnij [zasady testowania](../../docs/testowanie.md).
Wynik zapisz jako tabelę: zachowanie, istniejący dowód, brakujący przypadek.
Oddziel propozycje testów od wyników faktycznie uruchomionych testów.
```

Link ilustruje położenie dokumentu w hipotetycznym projekcie. Ten przykład
nie jest instalowany jako prompt w Agent Scanner i nie obiecuje działania
w Agent Host.

## Reguły walidacji

| ID | Podstawa | Sprawdzenie i wynik |
|---|---|---|
| PRM-001 | GH-W · P1 | Rozpoznać `*.prompt.md` w udokumentowanej lokalizacji. Plik `*.md` bez sufiksu nie staje się automatycznie promptem. |
| PRM-002 | HOST · P4 | Akceptować brak YAML. Jeżeli nagłówek istnieje, sprawdzić składnię i typy znanych pól. |
| PRM-003 | AS | Pusty prompt daje uwagę o braku treści zadania. Sens i kompletność oceniać według kryteriów merytorycznych PRM-013–PRM-018. |
| PRM-004 | AS | Sprawdzić lokalne referencje i cykle według zasad powyżej, bez pobierania kontekstu z sieci. |
| PRM-005 | AS | Spacje lub wielkie litery w nazwie nie są automatycznym błędem. Zachować faktyczną nazwę wywołania. |
| PRM-006 | AS | Duplikaty nazw i kolizje z nazwami skills pokazywać do przeglądu, bez arbitralnego wyboru zwycięzcy w menu klienta. |
| PRM-007 | HOST · P4 | `agent` rozpatrywać jako nazwę wbudowaną albo własną. Brak lokalnego profilu może wynikać z konfiguracji użytkownika. |
| PRM-008 | HOST · P4 | Gdy prompt i agent deklarują narzędzia, pokazać zmianę zestawu zgodnie z priorytetem; nie traktować jej jako potwierdzonego wykonania. |
| PRM-009 | AS | Nieznane `model`, narzędzie lub pole: zachować i oznaczyć granicę rozpoznania, bez udawanego sprawdzenia konta. |
| PRM-010 | HOST · P4 | Dla Agent Host wynik „mechanizm nieobsługiwany w tym profilu” oraz rekomendacja migracji; nie błąd Markdown. |
| PRM-011 | AS | Brak plików promptów: informacja o opcjonalnym mechanizmie. Nie wymagać ich w CLI/GitHub.com. |
| PRM-012 | AS | Ocenę ustawień aktywacji wykonywać tylko z danymi właściwego klienta i wersji. Sam brak ustawienia lokalnego nie dowodzi wyłączenia funkcji. |

## Kryteria merytoryczne dla AI

Ocena stosuje [wspólny kontrakt AI](standaryzacja-ai.md). To kryteria AS
oparte na dokumentacji GitHub i klienta, proporcjonalne do zadania promptu.
Materiałem jest pełny szablon z metadanymi oraz wybrane referencje i profile
agentów. Dane przyszłego wywołania nie muszą być już uzupełnione: oceniamy,
czy szablon jasno określa sposób ich dostarczenia i wykorzystania.

| ID | Podstawa | Co ocenia AI | Dowód i granica wniosku |
|---|---|---|---|
| PRM-013 | AS na podstawie P2, P3, P4 | Czy plik opisuje zadanie do ponownego wywołania, zgodnie z odpowiedzialnością promptu? Czy nie jest wyłącznie zbiorem stałych instructions, definicją roli agenta lub procedurą wymagającą mechanizmu skilla? | Wskazać treść zadania i sposób użycia. Przy rekomendacji innego mechanizmu wyjaśnić różnicę aktywacji oraz profil klienta; sama wieloetapowość nie przesądza o konieczności skilla. Nie uznawać zapisanego promptu za instrukcję stosowaną zawsze. |
| PRM-014 | AS na podstawie P2, P4 | Czy cel, wejścia, warunki obsługi braków i oczekiwany wynik są zrozumiałe bez domyślania się wcześniejszej rozmowy? | Powiązać użycie danych ze zmienną, referencją lub wyborem użytkownika oraz wskazać kryterium kompletnego wyniku. Pusta zmienna jest normalna dla szablonu; w ramach oceny konfiguracji nie żądać kodu ani manifestu w celu wykonania opisanego zadania. |
| PRM-015 | AS na podstawie P1, P4 | Czy nazwa, opcjonalne frontmatter, typy pól i nagłówki czytelnie reprezentują zadanie w wybranym kliencie? | Powiązać strukturę z faktami parsera i treścią. Oddzielić błąd typu pola od sugestii uporządkowania Markdown. Brak YAML, przykładu, tabeli lub nagłówka o konkretnej nazwie nie jest sam w sobie niezgodnością. |
| PRM-016 | AS na podstawie P3, P4, P5 | Czy kroki i granice działania są spójne z wybranym agentem, priorytetem narzędzi i obsługą promptów przez klienta? | Porównać polecenia oraz deklaracje, np. „tylko raport” i „nadpisz pliki”, po uwzględnieniu jawnych warunków. Nie potwierdzać działania nieobsługiwanego mechanizmu, dostępności modelu lub nieznanego narzędzia. |
| PRM-017 | AS na podstawie HOST · P4 | Czy szablon pozostaje łatwy w utrzymaniu: jest zwięzły, ma potrzebne przykłady i referencje oraz nie kopiuje nadmiarowo wspólnych zasad? | Wskazać powtórzenie, niepowiązany fragment albo spójne odwołanie do konfiguracji. Wyjaśnić ryzyko rozbieżności przy aktualizacji i zaproponować właściwe źródło zasady. Brak przykładu i długość same nie dowodzą wady. |
| PRM-018 | AS-W (polityka produktu) na podstawie P2, P3, P4 | Czy zachowana jest uniwersalność względem technologii i architektury: szablon ogólny nie narzuca bez uzasadnienia języka, frameworka lub wzorca, a szablon specjalistyczny ma jawny i uzasadniony zakres? | Porównać deklarowany cel z warunkami i przykładami. Wskazać neutralną instrukcję albo założenie wykraczające poza zakres; zalecić parametr, warunek lub osobny wariant. Nie ustalać rzeczywistej technologii lub architektury projektu. Specjalizacja jest dopuszczalna; bez `NOT_APPLICABLE`. |

Przykład uwagi: szablon wymaga oceny „tej zmiany”, ale nie określa sposobu
wskazania zmiany ani nie korzysta z udokumentowanego kontekstu klienta.
AI może zalecić dodanie wejścia i obsługi jego braku według PRM-014.
Nie powinno zgadywać, że chodzi o ostatni commit.

Przykład pozytywny: prompt prosi o zakres zmiany, wskazuje dostępne zasady
testowania i wymaga uwag z dowodami. Możliwy jest `SUPPORTED` dla konstrukcji
szablonu; faktyczny zakres wywołania pozostaje jeszcze nieznany.

## Rozbieżności i ograniczenia

- P1 opisuje starszy krok włączania `chat.promptFiles: true`.
  Aktualne P4 opisuje użycie Local agenta i wycofanie mechanizmu w Agent Host.
  Nie wymagać tej flagi jako uniwersalnego warunku dla dowolnej wersji VS Code.
- P5/P6 wymieniają prompty w Xcode jako preview, a P1/P3 mówią tylko
  o VS Code, Visual Studio i JetBrains. Dla Xcode bez potwierdzonej wersji
  pozostawić obsługę nierozstrzygniętą i nie stosować schematu VS Code.
- Informacja „prompt files dostępne w VS Code” w macierzy nie rozróżnia
  Local agenta i Agent Host; szczegół P4 jest niezbędny w raporcie.
- Markdown może wskazywać kontekst, ale obecność linku nie dowodzi,
  że klient go załadował. Dane aktywnej rozmowy nie są dostępne w tym skanie.
- Prompty dostarczane przez MCP są innym mechanizmem niż pliki
  `.github/prompts/*.prompt.md`; ich ocenę ogranicza [dokument MCP](standaryzacja-mcp.md).

## Scenariusze odbioru

| Przypadek | Oczekiwanie |
|---|---|
| Poprawny prompt bez frontmatter | Akceptowany w obsługującym go profilu. |
| `Przegląd API.prompt.md` | Bez narzucenia nazwy skilla. |
| Plik `przeglad.md` obok promptów | Nie zaliczać go jako promptu na podstawie treści. |
| Link `../../docs/testy.md` | Rozwiązany względem pliku promptu. |
| `${input:zakres}` | Dane przyszłego wywołania, nie ścieżka. |
| Link zewnętrzny lub `~/...` | Poza zakresem lokalnej walidacji, bez automatycznego odczytu. |
| Prompt wskazuje wbudowany agent `ask` | Brak fałszywego błędu nieistniejącego pliku agenta. |
| Oba pliki deklarują `tools` | Jawnie pokazany priorytet promptu w VS Code. |
| Ten sam prompt w Local agent i Agent Host | Różne wyniki obsługi mechanizmu. |
| Brak flagi `chat.promptFiles` | Bez uniwersalnego błędu konfiguracji. |
| Prompt wymaga interpretacji biznesowej | Przed uruchomieniem AI „Do przeglądu”; po jawnym wysłaniu osobna ocena z dowodami i ograniczeniami kontekstu. |
| Szablon używa zmiennej wejściowej bez konkretnej wartości | Nie zgłaszać braku danych przyszłego wywołania jako błędu samego szablonu. |
| „Tylko raport” i „nadpisz pliki” bez warunku rozdzielającego | AI wskazuje sprzeczność PRM-016 z oboma fragmentami. |
| Ogólny szablon przeglądu bez uzasadnienia narzuca framework i mikroserwisy | Uwaga AS-W PRM-018 w obu wymiarach, bez analizy projektu. |
| Szablon jawnie ograniczony do określonej technologii i rodzaju architektury | Możliwy `SUPPORTED` PRM-018, jeśli szczegóły odpowiadają zadeklarowanemu celowi. |
| Prompt kopiuje stale obowiązujące instrukcje bez osobnego zadania | Uwaga PRM-013; zalecenie właściwego mechanizmu i wyjaśnienie jego aktywacji. |
