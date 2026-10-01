# Standaryzacja — custom agents Copilot

Status: wymagania referencyjne; kryteria merytoryczne używane przez aplikację; źródła sprawdzone 2026-09-22.

[Dokumentacja](README.md) · [Wymagania wspólne](standaryzacja.md)

## Źródła

| ID | Oficjalna podstawa |
|---|---|
| A1 | [GitHub: konfiguracja custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration) — pola, narzędzia i przetwarzanie. |
| A2 | [GitHub: tworzenie agentów cloud](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents) — pliki, nazwy i treść. |
| A3 | [GitHub: tworzenie agentów CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli) — wybór i instrukcje subagenta. |
| A4 | [GitHub: referencja agentów CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#custom-agents-reference) — pola i kolejność źródeł. |
| A5 | [VS Code: custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents) — format klienta, handoffs i dawne chat modes. |
| A6 | [GitHub: czym są custom agents](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents) — rola i zakresy udostępniania. |
| A7 | [GitHub: podział odpowiedzialności mechanizmów CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features) — specjalizacja agenta a stałe zasady i procedury. |

Oznaczenia reguł i interpretację wyników definiuje
[specyfikacja wspólna](standaryzacja.md#pochodzenie-i-siła-reguł).
Instrukcje `AGENTS.md` opisuje [osobny dokument](standaryzacja-instrukcje.md).

## Lokalizacje i tożsamość

| Zakres | Lokalizacja / interpretacja |
|---|---|
| Repozytorium | `.github/agents/<nazwa>.agent.md`; GitHub dokumentuje również `<nazwa>.md`. |
| Organizacja | `agents/` w specjalnym repozytorium organizacji `.github` albo `.github-private`. |
| Enterprise | `agents/` w wyznaczonym repozytorium `.github-private`. |
| CLI — osobiste | `~/.copilot/agents/`; poza wyborem katalogu projektu. |
| CLI / VS Code — dodatkowy format projektu | `.claude/agents/`; osobny format i reguły klienta. |
| VS Code — osobiste | `~/.copilot/agents/` albo `~/.claude/agents/` według A5. |

Podstawa: A2, A4–A6. Katalog `agents/` w zwykłym repozytorium nie staje się
automatycznie konfiguracją organizacyjną. Wymagany jest kontekst specjalnego
repozytorium; nazwa lokalnego folderu sama go nie dowodzi.

A2 dopuszcza w nazwie pliku litery ASCII, cyfry, kropkę, łącznik i podkreślenie.
`name` jest etykietą, a identyfikator pliku powstaje po odjęciu
`.agent.md` lub `.md`. Nie usuwać wyłącznie końcowego `.md` z dłuższego
sufiksu. Preferowanie opisowych nazw z małymi literami i łącznikami w CLI
jest zaleceniem A3, nie zakazem innych nazw dozwolonych przez GitHub.

## Profil GitHub.com

Profil obejmuje nagłówek YAML oraz treść Markdown. A2 wymaga opisu
`description`, dopuszcza opcjonalne `name` i określa maksymalnie
30 000 znaków promptu pod nagłówkiem. Nie jest to limit bajtów całego pliku.
Nie przenosić go bez osobnego źródła do wszystkich klientów.

Podstawowe właściwości według A1:

| Pole | Znaczenie |
|---|---|
| `description` | Wymagany tekst opisujący rolę. |
| `name` | Opcjonalna nazwa wyświetlana. |
| `target` | `vscode` lub `github-copilot`; pominięcie obejmuje oba środowiska. |
| `tools` | Lista tekstów lub tekst z nazwami oddzielonymi przecinkami. |
| `model` | Opcjonalny tekst; dostępności modelu nie ustala lokalny plik. |
| `disable-model-invocation` | Boolean, domyślnie `false`; blokuje automatyczny wybór. |
| `user-invocable` | Boolean, domyślnie `true`; steruje ręcznym wyborem. |
| `infer` | Pole wycofywane w A1; `disable-model-invocation` ma pierwszeństwo, jeśli podano oba. |
| `mcp-servers` | Mapa konfiguracji MCP; bez obsługi przez profile IDE według A1. |
| `metadata` | Mapa tekstowych par; również nieużywana przez profile IDE według A1. |

## Narzędzia i odpowiedzialność

A1 rozróżnia trzy przypadki: brak `tools` lub `["*"]` udostępnia wszystkie
dostępne narzędzia, `[]` wyłącza wszystkie, a lista nazw ogranicza zestaw.
Nieznane nazwy są ignorowane. Nazwy narzędzi MCP mogą mieć postać
`serwer/narzedzie` albo `serwer/*`.

Przykładowe aliasy `read`, `search` i `edit` nie oznaczają tego samego
zakresu. Sam tekst „niczego nie zmieniaj” przy pełnym zestawie narzędzi
nie jest techniczną blokadą zapisu. A5 zaleca dobór narzędzi zgodnie
z zasadą najmniejszych uprawnień.

Wymagania AS dla raportu:

- pokazać osobno deklarowaną rolę oraz deklarowany dostęp do narzędzi;
- zachować pierwotne nazwy; katalog aliasów musi należeć do profilu klienta;
- nierozpoznanego narzędzia nie uznawać za dowód braku serwera;
- nie mylić filtra agenta z pozwoleniem konta lub polityką wykonania;
- nie traktować listy narzędzi jako dowodu, że agent rzeczywiście ich użył.

Szczegóły konfiguracji serwerów i filtrów opisuje [MCP](standaryzacja-mcp.md).

Profil agenta opisuje rolę, podejście do zadania i deklarowany zestaw narzędzi.
Stałe zasady wspólne dla wszystkich zadań należą do instructions, a wydzielona
procedura może należeć do skilla (A7). Ocena sprawdza uzasadnienie tego podziału.
Obowiązkowa polityka AS-W wymaga uniwersalności względem technologii i architektury
stosownie do zadeklarowanej roli. Agent ogólny nie narzuca stosu ani architektury
bez uzasadnienia; agent specjalistyczny ujawnia ograniczenia. GitHub dopuszcza
specjalizacje technologiczne, więc AS-W nie jest zakazem takich profili.

## Różnice CLI i VS Code

A4 opisuje dodatkowe pola CLI: `include-custom-instructions`, `models`,
`modelPolicy`, `reasoningEffort`. `models` jest listą preferencji modeli,
a `modelPolicy` rozróżnia `preferred` i `required`. Są to rozszerzenia
konkretnego klienta. Nie odrzucać ich tylko dlatego, że nie występują w A1.

A3 wyjaśnia, że własny agent uruchomiony jako subagent domyślnie nie otrzymuje
instrukcji repozytorium. Służy temu `include-custom-instructions: true`.
To inny przypadek niż agent wybrany jako agent sesji.
Opcja `--no-custom-instructions` ma według A4 pierwszeństwo przed tym
włączeniem. Nie wymagać opt-in dla każdego agenta, niezależnie od jego zadania.

VS Code według A5 rozpoznaje również zwykłe `.md` w `.github/agents`.
Nagłówek jest tam opisany jako opcjonalny. Format obejmuje m.in.
`argument-hint`, `agents`, `handoffs` oraz `model` jako tekst lub listę.
Przekazanie zadania w `handoffs` opisują `label`, `agent`, `prompt`,
opcjonalne `send` i `model`. A1 zaznacza, że `handoffs` i `argument-hint`
są ignorowane przez cloud agenta na GitHub.com.

Stare `*.chatmode.md` należy pokazać jako kandydatów do migracji zgodnie z A5.
Nie zmieniać ich automatycznie. Ustawienia dodatkowych lokalizacji Local agenta
nie muszą działać w Agent Host. `hooks` pozostają deklaracją spoza pełnej
walidacji tej kategorii; ich obecność nigdy nie uruchamia poleceń w Scannerze.

## Przykład profilu

Autorski przykład `.github/agents/przeglad-kontraktow.agent.md`:

```markdown
---
name: przeglad-kontraktow
description: Porównuje zmianę z lokalnymi kontraktami i wskazuje rozbieżności wymagające przeglądu.
tools: ["read", "search"]
---

Odczytaj kontrakt właściwy dla zmienionego obszaru.
Każdą uwagę poprzyj ścieżką i konkretną regułą.
Oddziel brak dowodu od potwierdzonej niezgodności.
Przygotuj raport; nie edytuj plików.
```

Przykład określa zakres narzędzi, ale nie potwierdza dostępności ich aliasów
w dowolnej wersji klienta. Nie instaluje agenta w tym repozytorium.

## Reguły walidacji

| ID | Podstawa | Sprawdzenie i wynik |
|---|---|---|
| AGT-001 | GH-W · A2 | Rozpoznać lokalizację i oba sufiksy. Sprawdzić nazwę pliku w profilu GitHub, bez narzucania wzorca nazwy skilla. |
| AGT-002 | GH-W / HOST · A2, A5 | Dla cloud agenta sprawdzić frontmatter i tekstowe `description`; w VS Code brak opcjonalnego nagłówka ocenić jako zalecenie uzupełnienia, nie uniwersalny błąd. |
| AGT-003 | GH-W · A2 | Dla cloud agenta policzyć treść promptu względem 30 000 znaków. Pokazać zakres pomiaru i jednostkę, nie liczbę tokenów. |
| AGT-004 | GH-W · A1 | Sprawdzić typy znanych pól i wartości `target`. Nieznane pola zachować z informacją o zakresie walidacji. |
| AGT-005 | GH-W · A1 | Rozróżnić pominięte `tools`, `["*"]` i `[]`; pusta lista jest poprawna. |
| AGT-006 | AS | Pokazać skutki szerokiego dostępu i potencjalną rozbieżność z rolą do przeglądu; nie udawać analizy faktycznych uprawnień runtime. |
| AGT-007 | GH-W · A1 | Nierozpoznane nazwy narzędzi są informacją o możliwym ignorowaniu, nie błędem składni YAML. |
| AGT-008 | AS | Wykryć kolizje identyfikatorów po odjęciu sufiksu. Zachować wszystkie profile; odróżnić kolizję plików od identycznej etykiety `name`. |
| AGT-009 | GH-W · A1; AS | Przedstawić `mcp-servers` jako deklarację zależną od profilu; zastosować reguły MCP, bez uruchamiania serwerów. |
| AGT-010 | GH-Z · A3 | Oceniać specjalizację, wyzwalacze użycia, rezultat i granice roli według kryteriów merytorycznych AGT-016–AGT-021. Nie wymagać ustalonego zestawu nazw sekcji. |
| AGT-011 | HOST · A5 | Sprawdzić strukturę `handoffs` i referencje agentów, jeśli profil je obsługuje. Brak lokalnego celu może oznaczać agenta wbudowanego lub osobistego. |
| AGT-012 | GH-W · A3, A4 | Dla subagenta CLI pokazać stan opt-in instrukcji; brak pola oznacza zachowanie domyślne, nie błąd. |
| AGT-013 | AS | Nie potwierdzać publikacji agenta na GitHub na podstawie niezatwierdzonego pliku lokalnego. |
| AGT-014 | AS | Brak custom agentów jest poprawnym użyciem Copilot bez własnych specjalizacji. |
| AGT-015 | HOST · A5 | W VS Code przy ograniczeniu `agents` uwzględnić wymagany dostęp do narzędzia `agent`; semantykę delegacji oceniać wyłącznie w tym profilu. |

## Kryteria merytoryczne dla AI

Ocena stosuje [wspólny kontrakt AI](standaryzacja-ai.md). Pytania poniżej
są interpretacją AS dokumentacji agenta; nie tworzą uniwersalnego szablonu
roli. AI otrzymuje profil, jego treść, deklaracje narzędzi oraz wybrane
konfiguracje Copilot i ich dopuszczone tekstowe materiały pomocnicze.
Nie sprawdza kodu, zależności, komend ani rzeczywistej architektury projektu.

| ID | Podstawa | Co ocenia AI | Dowód i granica wniosku |
|---|---|---|---|
| AGT-016 | AS na podstawie A3, A7 | Czy treść uzasadnia odrębną rolę agenta, jasno opisuje jej specjalizację i sytuację użycia? Czy nie jest wyłącznie kopią stałych instructions lub procedury nadającej się do skilla? | Powiązać `description` z konkretnym podejściem i odpowiedzialnością. Przy propozycji innego mechanizmu wskazać fragment i zmianę sposobu użycia. Nie wymagać narzędzi, jeśli rola analizuje tylko tekst zadania. |
| AGT-017 | AS na podstawie A2, A3 | Czy zadania, granice, warunki działania i oczekiwany wynik tworzą spójną rolę? | Wskazać oba fragmenty, gdy profil obiecuje tylko przegląd, lecz nakazuje bezwarunkowe edycje lub publikację. Jawne warianty nie są automatycznie sprzecznością. Oceniać opis zachowania, nie skuteczność narzędzi lub kodu. |
| AGT-018 | AS na podstawie A1, A2, A5 | Czy frontmatter, opis, nagłówki i deklarowane narzędzia właściwie reprezentują rolę w wybranym kliencie? | Powiązać metadane i strukturę z treścią oraz faktami parsera; oddzielić wymagane pola od opcjonalnych. Rozróżnić brak `tools`, `[]` i `*`; ocenić uzasadnienie szerokiego zakresu. Nie narzucać szablonu sekcji ani zgadywać możliwości nieznanego narzędzia. |
| AGT-019 | AS na podstawie A3, A4, A5 | Czy opis kontekstu, aktywacji, delegowania i `handoffs` odpowiada mechanice Copilot, zwłaszcza różnicom między agentem sesji a subagentem? | Połączyć obietnicę z trybem, `include-custom-instructions` i dołączonym celem przekazania. Brak opt-in ma znaczenie dla zależnego od instrukcji subagenta CLI; nie jest błędem każdej roli. Nie potwierdzać stanu sesji ani obsługi ignorowanego pola. |
| AGT-020 | AS-W (polityka produktu) na podstawie A3, A6, A7 | Czy zachowana jest uniwersalność względem technologii i architektury: rola ogólna nie zakłada bez uzasadnienia języka, frameworka lub wzorca architektonicznego, a rola specjalistyczna ma jawny i uzasadniony zakres? | Porównać deklarowaną specjalizację z poleceniami. Wskazać neutralne zasady albo założenie wykraczające poza zakres; rekomendować warunek lub osobną specjalizację. Dopuszczać np. jawnego recenzenta określonej technologii bez badania stosu projektu. Bez `NOT_APPLICABLE`. |
| AGT-021 | AS na podstawie A2, A3, A7 | Czy profil pozostaje łatwy w utrzymaniu: ogranicza zbędne treści, unika rozbieżnych kopii wspólnych zasad i oddziela rolę od szczegółowych procedur? | Wskazać powielony fragment lub uzasadnione odwołanie do konfiguracji, wyjaśniając wpływ aktualizacji na inne pliki. Nie wymagać dodatkowych agentów ani skilli dla każdego etapu; długość sama nie dowodzi nadmiaru. |

Przykład uwagi: agent „przegląd bez zmian” otrzymuje wszystkie narzędzia,
a jego instrukcja nakazuje edytować pliki po znalezieniu problemu. AI wskazuje
sprzeczność treści AGT-017; oddzielnie może zalecić ograniczenie narzędzi
według AGT-018. Sam zestaw `tools: ["*"]` nie dowodzi wykonania edycji.

Przykład pozytywny: agent analizuje wyłącznie tekst dołączony do zadania,
zwraca raport z cytatami i ma `tools: []`. Taki zestaw może być merytorycznie
spójny; walidator nie powinien żądać narzędzi tylko dlatego, że ocenia agenta.

## Rozbieżności i ograniczenia

- A1 wymaga `description`, podczas gdy A5 określa nagłówek jako opcjonalny.
  Wymaganie ma zależeć od profilu, a profil przenośny może rekomendować opis.
- A1 wycofuje `infer`, lecz A4 nadal je dokumentuje. Nie uznawać każdego
  użycia w CLI za błąd; pokazać rozbieżność i możliwość migracji.
- A3 podaje pierwszeństwo agenta osobistego przed projektowym, a A4 odwrotne.
  Przy kolizji tych zakresów wynik kolejności jest nierozstrzygnięty bez
  potwierdzenia konkretnej wersji. Nie dotyczy to opisanej w A1 hierarchii
  GitHub.com: repozytorium przed organizacją przed enterprise.
- A4 opisuje odkrywanie katalogów agentów od katalogu roboczego ku korzeniowi,
  z pierwszeństwem bliższej definicji i `.github/agents` względem
  `.claude/agents` na tym samym poziomie. Sam korzeń repozytorium nie
  wystarcza do symulacji sesji uruchomionej w nieznanym podkatalogu.
- Dostępność modeli, narzędzi, definicji organizacyjnych i ustawień osobistych
  pozostaje niezweryfikowana bez odpowiednich danych środowiska.

## Scenariusze odbioru

| Przypadek | Oczekiwanie |
|---|---|
| `kontrola.md` oraz `kontrola.agent.md` | Oba rozpoznane, wspólna tożsamość pliku zgłoszona do rozstrzygnięcia. |
| Brak YAML w profilu tylko VS Code | Bez fałszywego błędu wymagania z cloud agenta. |
| Brak `description` w profilu cloud | Błąd. |
| Brak `tools` / `tools: []` | Odpowiednio wszystkie / żadne narzędzia, bez utożsamienia. |
| `narzedzie-nieznane` | Informacja o niepotwierdzonym/ignorowanym narzędziu. |
| 30 000 / 30 001 znaków treści cloud | Sprawdzenie granicy z wyłączeniem nagłówka. |
| `handoffs` dla GitHub.com | Informacja o ignorowaniu, nie potwierdzone przekazanie zadania. |
| `include-custom-instructions: true` w CLI | Rozpoznane rozszerzenie; nie uruchamia instrukcji w Scannerze. |
| `model` jako lista w VS Code | Nie odrzucać na podstawie tekstowego pola w A1. |
| Kolizja agenta osobistego i projektowego CLI | Nierozstrzygnięta kolejność, obie podstawy dokumentacyjne. |
| Rola „bez zmian” nakazuje w treści edycję | AI wskazuje oba fragmenty według AGT-017. |
| Agent z `tools: []` ocenia tekst dostarczony w zadaniu | Możliwa pozytywna ocena adekwatności AGT-018. |
| Subagent CLI wymaga instrukcji repozytorium bez ich dołączenia/opt-in | Warunkowa uwaga AGT-019 dla tego trybu, bez globalnego wymogu pola. |
| Agent deklaruje uniwersalny przegląd, lecz bez uzasadnienia narzuca jeden framework i architekturę | Uwaga AS-W AGT-020 z dowodem, bez żądania kodu lub manifestów. |
| Agent jasno deklaruje przegląd konkretnej technologii i ogranicza do niej zasady | Możliwy `SUPPORTED` AGT-020; specjalizacja jest zamierzona. |
| Profil kopiuje kilka wersji tych samych ogólnych zasad | Uwaga AGT-021 opisuje ryzyko rozbieżności i proponuje jedno źródło. |
