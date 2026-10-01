# Standaryzacja — skills Copilot

Status: wymagania referencyjne; kryteria merytoryczne używane przez aplikację; źródła sprawdzone 2026-09-22.

[Dokumentacja](README.md) · [Wymagania wspólne](standaryzacja.md)

## Źródła

| ID | Oficjalna podstawa |
|---|---|
| S1 | [GitHub: czym są agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) — zastosowanie i lokalizacje. |
| S2 | [GitHub: dodawanie skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) — tworzenie, zasoby, uprawnienia i code review. |
| S3 | [GitHub: skills w CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) — aktywacja, lokalizacje dodatkowe i przeładowanie. |
| S4 | [Agent Skills: specyfikacja](https://agentskills.io/specification) — formalne metadane i organizacja materiałów; wskazana w S2. |
| S5 | [VS Code: agent skills](https://code.visualstudio.com/docs/agent-customization/agent-skills) — pola klienta i wykrywanie. |
| S6 | [GitHub: referencja skills CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#skills-reference) — rozszerzenia frontmatter. |
| S7 | [GitHub: porównanie mechanizmów CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features) — skill a instrukcje i agent. |

Oznaczenia reguł i interpretację wyników definiuje
[specyfikacja wspólna](standaryzacja.md#pochodzenie-i-siła-reguł).

## Rola i wykrywanie

Skill jest pakietem procedury: opis mówi, kiedy z niej skorzystać, a treść
i zasoby określają sposób wykonania. Nie jest wymaganym dodatkiem do każdego
repozytorium ani zamiennikiem wszystkich instrukcji. S7 rozróżnia trwałe reguły,
procedury potrzebne przy konkretnym zadaniu oraz wyspecjalizowane role agentów.

| Zakres | Lokalizacje |
|---|---|
| Projekt | `.github/skills/<nazwa>/SKILL.md`, `.claude/skills/<nazwa>/SKILL.md`, `.agents/skills/<nazwa>/SKILL.md` |
| Użytkownik według GitHub | `~/.copilot/skills/<nazwa>/SKILL.md`, `~/.agents/skills/<nazwa>/SKILL.md` |
| Uzupełnienie VS Code | Także `~/.claude/skills/<nazwa>/SKILL.md` według S5. |
| Dodatkowe źródła | Lokalizacje skonfigurowane w kliencie, pluginy; nie są dowodem zawartości wybranego repozytorium. |

Podstawa: S1, S3 i S5. Wybór repozytorium obejmuje trzy lokalizacje projektowe.
Brak jednego z alternatywnych katalogów jest normalny; nie wymagać kopii skilla
w każdym z nich. `skills/testy.md` nie ma struktury pakietu `testy/SKILL.md`.

S1 opisuje obsługę m.in. przez cloud agenta, code review, CLI oraz tryb agentowy
VS Code i JetBrains. Nie rozciągać tego na każdą funkcję Chat, wersję IDE lub
wszystkie dodatkowe pola. Status preview i macierz klientów wymagają sprawdzenia
przy aktualizacji profilu.

## Struktura i metadane

S2 wymaga nazwy pliku `SKILL.md`, nagłówka YAML, `name` i `description`.
Zasoby są opcjonalne. Poniższe limity pochodzą z otwartej specyfikacji S4;
ocenę SPEC należy pokazać osobno od udowodnionego zachowania konkretnego klienta.

| Pole | Reguła specyfikacji S4 |
|---|---|
| `name` | 1–64 znaki, małe litery/cyfry/łączniki; bez łącznika na końcach i bez `--`; zgodne z nazwą katalogu. |
| `description` | Niepusty tekst, do 1024 znaków; opis czynności i sytuacji użycia. |
| `license` | Opcjonalny tekst lub odwołanie do dołączonej licencji. |
| `compatibility` | Opcjonalny opis wymagań środowiska, 1–500 znaków, jeśli podany. |
| `metadata` | Opcjonalna mapa tekstowych kluczy i wartości. |
| `allowed-tools` | Opcjonalny, eksperymentalny tekst z nazwami narzędzi rozdzielonymi spacjami. Interpretacja uprawnień zależy od klienta. |

S2 mówi, że nazwa zwykle odpowiada katalogowi, S4 wymaga zgodności, a S5 również
wymienia taki warunek. Rozbieżność nazwy raportować z podaniem podstawy SPEC/HOST,
a nie jako identycznie potwierdzony błąd wszystkich implementacji Copilot.
S4 używa też określenia Unicode przy opisie dozwolonych znaków. Bez testu
wersji klienta nie wprowadzać dodatkowego, uniwersalnego zakazu polskich liter.
Nazwy ASCII z łącznikami pozostają zalecanym przez AS profilem przenośnym.

Przykład autorski: `.github/skills/przeglad-testow/SKILL.md`.

```markdown
---
name: przeglad-testow
description: Sprawdza kompletność testów zmiany. Użyj przy prośbie o przegląd testów lub wskazanie brakujących regresji.
---

1. Ustal zmienione zachowanie i istniejące przypadki testowe.
2. Skorzystaj z [listy kontrolnej](references/lista.md).
3. Opisz luki z odniesieniem do konkretnego zachowania.
4. Oddziel testy obejrzane od testów rzeczywiście uruchomionych.
```

Przykładowa lista kontrolna jest zasobem tego hipotetycznego pakietu.
Nie jest tworzona ani ładowana przez niniejszą dokumentację.

## Zasoby i jakość procedury

S4 zaleca stopniowe udostępnianie treści: metadane do wyboru skilla, instrukcje
po aktywacji, pozostałe zasoby według potrzeb. Wskazuje mniej niż 500 linii
`SKILL.md` i zalecenie mniej niż 5000 tokenów instrukcji. Są to wskazówki
projektowe, nie przesłanka do odrzucenia pliku. Liczenie linii jest dokładne;
tokeny zależą od tokenizera.

Katalogi `scripts/`, `references/` i `assets/` są konwencjami organizacji,
nie trzema wymaganymi katalogami. S2 dopuszcza skrypty i inne materiały,
a S5 zaleca jawne odwołania do nich względem `SKILL.md`.

Kryteria merytoryczne AS, oceniane także w jawnym trybie AI:

- opis pozwala odróżnić tę procedurę od innych skills;
- wiadomo, jakie dane trzeba dostarczyć i jaki rezultat otrzyma użytkownik;
- kroki są spójne i wskazują istotne ograniczenia oraz sposób weryfikacji;
- zależność od narzędzia, sieci lub konkretnego systemu jest ujawniona;
- duże materiały pomocnicze są podlinkowane zamiast wielokrotnie kopiowane.

Stałe zasady obowiązujące niezależnie od zadania należą do instructions (S2, S7).
Umieszczenie ich tylko w skillu może uzależnić stosowanie od aktywacji procedury.
Obowiązkowa polityka AS-W wymaga uniwersalności względem technologii
i architektury adekwatnej do deklarowanego zakresu: skill ogólny nie narzuca
stosu ani wzorca bez uzasadnienia, a skill specjalistyczny jasno ogranicza zakres.
GitHub dopuszcza procedury specyficzne; obowiązek tej oceny pochodzi z produktu.

Brak słów kluczowych wybranych przez walidator nie dowodzi złego opisu.
Scanner ocenia deklaracje użycia zasobów i dołączone materiały tekstowe
w katalogach konfiguracji. Skrypty, kod, manifesty i dokumentacja rzeczywistej
architektury pozostają poza zakresem; ich brak w pakiecie nie jest usterką skilla.

## Aktywacja i uprawnienia

Według S3 CLI dobiera skill na podstawie zadania i opisu; można wskazać go
przez `/nazwa`. `/skills info`, `/skills list` i `/skills reload`
służą sprawdzeniu stanu klienta. Scanner nie uruchamia ich podczas odczytu.
Wyłączony skill może istnieć na dysku.

S5 opisuje opcjonalne `argument-hint`, `user-invocable`,
`disable-model-invocation` i eksperymentalne `context: fork`.
Widoczność w menu i możliwość automatycznej aktywacji są odrębne.
Prefiks pluginu w poleceniu nie powinien być dopisywany do `name`.
S6 dopuszcza dla `allowed-tools` również tablicę YAML lub tekst rozdzielany
przecinkami. Nie narzucać składni samego S4 profilowi CLI.

S2 i S3 ostrzegają, że uprzednie dopuszczenie `shell`/`bash` pozwala
wykonywać polecenia bez kolejnego potwierdzenia w opisanym mechanizmie.
Nieznany kod skilla wymaga przeglądu. To zalecenie dla autora konfiguracji;
Scanner nigdy nie przyznaje sobie uprawnień z `allowed-tools`.

W code review S2 wskazuje nazwę katalogu zorientowaną na review, np.
`code-review`, jako sposób ukierunkowania użycia. Inne właściwe skills
z `.github/skills` również mogą być używane. Nazwa `code-review` nie jest
obowiązkowa dla wszystkich skills.

## Reguły walidacji

| ID | Podstawa | Sprawdzenie i wynik |
|---|---|---|
| SKL-001 | GH-W · S2 | W rozpoznanym pakiecie sprawdzić obecność dokładnie nazwanego `SKILL.md`. Pusty katalog nadrzędny nie jest brakującym skillem. |
| SKL-002 | GH-W · S2 | Parsować YAML i wymagane tekstowe `name`, `description`. Brak pola lub zły typ: błąd artefaktu. |
| SKL-003 | SPEC · S4 | Zweryfikować długości i jednoznaczne ograniczenia nazwy. Pokazać oddzielnie odstępstwo od specyfikacji i niepewność obsługi klienta. |
| SKL-004 | SPEC / HOST · S4, S5 | Porównać `name` z nazwą bezpośredniego katalogu; nie mylić nazwy z etykietą całego pluginu. |
| SKL-005 | SPEC · S4 | Sprawdzać typy i limity opcjonalnych pól tylko, gdy istnieją. Brak `license`, `compatibility` lub katalogu skryptów jest dozwolony. |
| SKL-006 | AS | Pusta treść procedury: uwaga lokalna. Sens opisu i kroków oceniać osobno według SKL-014–SKL-019, z jawnym oznaczeniem wyniku AI. |
| SKL-007 | AS | Rozwiązać lokalne referencje względem pakietu, zgłosić brak celu lub cykl; nie uruchamiać skryptu. |
| SKL-008 | AS | Wykryć identyczne nazwy w kilku źródłach; zachować wszystkie lokalizacje i nie wybierać zwycięzcy bez reguły danego klienta. |
| SKL-009 | SPEC · S4 | Przekroczenie zalecanej liczby linii: zalecenie wydzielenia materiałów, nie błąd ładowania. |
| SKL-010 | GH-Z · S2, S3 | `shell`, `bash` lub szeroka allowlista: pokazać zakres uprawnień do przeglądu. Nie oznaczać pakietu jako złośliwego wyłącznie z tej przyczyny. |
| SKL-011 | HOST / GH-W · S5, S6 | Typy pól aktywacji i składnię `allowed-tools` oceniać według klienta. Nieznane rozszerzenia zachować. |
| SKL-012 | AS | Brak skills: informacja o opcjonalnej funkcji. Obecność pliku: wykrycie, nie potwierdzenie aktywacji. |
| SKL-013 | AS | Ustalić jednostkę liczenia znaków w wersjonowanym parserze; przypadki graniczne Unicode nie mogą być po cichu liczone jako bajty UTF-8. |

## Kryteria merytoryczne dla AI

Ocena stosuje [wspólny kontrakt AI](standaryzacja-ai.md). Kryteria są
interpretacją AS zaleceń autorów mechanizmu. Materiałem jest `SKILL.md`
z metadanymi, inne konfiguracje Copilot oraz dopuszczone materiały `.md`/`.txt`
w katalogach konfiguracji. Nie sprawdzamy implementacji zależności ani skryptów.
Złożoność procedury ma wynikać z zadania; prosty skill nie wymaga rozbudowanej
checklisty ani sekcji o każdym możliwym błędzie.

| ID | Podstawa | Co ocenia AI | Dowód i granica wniosku |
|---|---|---|---|
| SKL-014 | AS na podstawie S2, S3, S4 | Czy frontmatter, `name`, `description` i nagłówki jasno opisują procedurę oraz warunki wyboru? Czy opis odróżnia ją od innych przekazanych skills? | Porównać metadane z treścią i ustaleniami parsera. Wskazać błędny typ/pole albo nieczytelny podział treści, oddzielając wymagania formatu od sugestii nagłówków. Nie narzucać jednego spisu sekcji ani nie gwarantować decyzji automatycznego doboru. |
| SKL-015 | AS na podstawie S2, S7 | Czy zawartość jest procedurą dla określonego rodzaju zadania, z wejściem i rezultatem, a stałe zasady ogólne są umieszczone w instructions? Czy skill nie udaje konfiguracji narzędzi MCP lub samodzielnej roli agenta? | Wskazać fragment i wyjaśnić, dlaczego powinien być dostępny zawsze albo dopiero po aktywacji skilla. Zalecenie przeniesienia określa docelowy typ pliku i skutek dla stosowania reguły. Nie wymagać rozbudowanej procedury dla prostego zadania. |
| SKL-016 | AS-W (polityka produktu) na podstawie S2, S7 | Czy zachowana jest uniwersalność względem technologii i architektury: skill deklarowany jako ogólny nie zakłada bez uzasadnienia języka, frameworka lub architektury, a specjalistyczny ujawnia i uzasadnia ograniczenia? | Połączyć opis zastosowania z konkretnymi krokami. Wskazać neutralne sformułowanie albo nieuzasadnione założenie i zaproponować warunek, parametr lub wydzielenie specjalizacji. Nie sprawdzać faktycznego stosu repozytorium; specjalizacja nie jest sama w sobie wadą. Bez `NOT_APPLICABLE`. |
| SKL-017 | AS na podstawie SPEC · S4 | Czy skill pozostaje łatwy w utrzymaniu dzięki stopniowemu ładowaniu treści, zwięzłemu rdzeniowi, czytelnym referencjom i unikaniu kopii zasad? | Wskazać redundantny fragment, niepotrzebnie głęboki łańcuch odsyłaczy albo spójny podział rdzenia i szczegółów. Wyjaśnić wpływ na aktualizacje i kontekst; nie wymagać katalogów zasobów ani nie wydawać werdyktu wyłącznie na podstawie liczby linii. |
| SKL-018 | AS na podstawie S2, S3, S5, S6 | Czy opis aktywacji, użycia zasobów i uprawnień odpowiada mechanice skilla w wybranym kliencie? | Zestawić deklarowane zachowanie z polami aktywacji i `allowed-tools`. Rozróżnić ręczne wywołanie, automatyczny dobór i uprzednią zgodę; brak narzędzia na tej liście nie dowodzi niedostępności. Nie czytać ani nie wykonywać skryptów do potwierdzania procedury. |
| SKL-019 | AS na podstawie S2, S7 | Czy cel, kroki, przykłady, warunki i wynik tworzą spójną procedurę bez sprzecznych lub niepowiązanych zadań? | Porównać konkretne fragmenty, np. opis raportu z bezwarunkową publikacją. Ocenić opis przejść i obsługi braków, nie skuteczność komend ani testów. Uwzględnić jawne warianty; kilka etapów jednego procesu nie jest automatycznie nadmiarem. |

Przykład uwagi: skill obiecuje raport z przeglądu testów, lecz kroki kończą
się automatyczną publikacją pakietu bez wyjaśnienia związku z przeglądem.
AI wskazuje rozbieżność SKL-019 i proponuje ograniczenie lub rozdzielenie
procedury. Poprawne `name` i `description` nie usuwają tej uwagi merytorycznej.

Przykład pozytywny: opis wskazuje sytuację użycia, kroki określają dane
i rezultat, a podlinkowana lista kontrolna rozwija właściwy etap. Możliwy
jest `SUPPORTED` dla spójności procedury, bez gwarancji działania narzędzi.

## Scenariusze odbioru

| Przypadek | Oczekiwanie |
|---|---|
| Pakiet tylko z poprawnym `SKILL.md` | Akceptowany; zasoby i skrypty nie są obowiązkowe. |
| Pakiet w `.agents/skills` | Rozpoznany tak samo jak alternatywne źródło projektu z S1. |
| Plik `skill.md` | Uwaga/błąd dokładnej nazwy z dowodem rzeczywistej pisowni. |
| Brak `description` | Błąd wymaganych metadanych. |
| Nazwa z `--`, ukośnikiem lub ponad limitem | Wynik właściwej reguły SPEC/HOST; brak cichej korekty nazwy. |
| 64/65 znaków nazwy, 1024/1025 opisu | Sprawdzone granice według jawnej jednostki liczenia. |
| Inna nazwa katalogu i `name` | Odstępstwo SPEC/HOST, bez uogólnienia na każdy runtime. |
| `allowed-tools` jako tablica w CLI | Nie odrzucać przez narzucenie formatu z S4. |
| Skrypt z poleceniem pobrania danych | Odczyt deklaracji bez uruchamiania i sieci. |
| `user-invocable: false` | Nie oznacza samoistnie wyłączenia automatycznego użycia. |
| Kilka źródeł z taką samą nazwą | Osobne artefakty i uwaga o kolizji. |
| Opis przeglądu, ale kroki bez uzasadnienia publikują pakiet | AI wskazuje niespójność SKL-019 z cytatami; parser nadal może zaakceptować format. |
| Skill zawiera wyłącznie stałe zasady dla każdego zadania | Uwaga SKL-015 z propozycją przeniesienia do instructions i wyjaśnieniem aktywacji. |
| Uniwersalny skill wymaga jednego frameworka i mikroserwisów bez uzasadnienia | Uwaga AS-W SKL-016 dotycząca obu wymiarów, bez analizy kodu. |
| Jawny skill migracji określonego frameworka z ograniczonym zakresem | Możliwy `SUPPORTED` SKL-016; uzasadniona specjalizacja jest dopuszczalna. |
| Skill linkuje skrypt lub manifest | Brak odczytu i audytu jego implementacji; ocena deklaracji użycia w SKL-018. |
| Brak `shell` w `allowed-tools` | Bez twierdzenia AI, że wykonanie polecenia jest technicznie niemożliwe. |
