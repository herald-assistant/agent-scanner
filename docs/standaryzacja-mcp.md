# Standaryzacja — serwery i narzędzia MCP

Status: wymagania referencyjne; kryteria merytoryczne używane przez aplikację; źródła sprawdzone 2026-09-22.

[Dokumentacja](README.md) · [Wymagania wspólne](standaryzacja.md)

## Źródła

| ID | Oficjalna podstawa |
|---|---|
| M1 | [GitHub: konfiguracja MCP repozytorium](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers) — GitHub.com, JSON, filtry i review. |
| M2 | [GitHub: dodawanie MCP w CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) — konfiguracja użytkownika i projektu. |
| M3 | [GitHub: MCP w cloud agencie](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/mcp-and-cloud-agent) — możliwości, domyślne serwery, autonomia. |
| M4 | [GitHub: MCP w IDE](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) — konfiguracja klientów. |
| M5 | [VS Code: referencja MCP](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) — struktura, transporty i pola. |
| M6 | [VS Code: zarządzanie MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers) — sekrety, profile, Agent Host i kontenery. |
| M7 | [GitHub: MCP w custom agentach](https://docs.github.com/en/copilot/reference/custom-agents-configuration#mcp-server-configuration-details) — YAML i podstawienia. |
| M8 | [GitHub: referencja MCP CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#mcp-server-configuration) — schemat, OAuth i priorytety. |
| M9 | [GitHub: informacje o MCP](https://docs.github.com/en/copilot/concepts/context/mcp) — integracje i polityki organizacji. |
| M10 | [GitHub: podział odpowiedzialności mechanizmów CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features) — integracje MCP a instrukcje, procedury i role. |
| M11 | [GitHub: ograniczanie zbędnego kontekstu](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage#bring-in-only-the-tools-you-need) — dobór potrzebnych narzędzi. |

Oznaczenia reguł i interpretację wyników definiuje
[specyfikacja wspólna](standaryzacja.md#pochodzenie-i-siła-reguł).

## Co można sprawdzić lokalnie

Konfiguracja opisuje **serwery** i ewentualny filtr udostępnianych narzędzi.
Nie jest pełnym katalogiem definicji narzędzi: schematy argumentów i rzeczywiste
możliwości są dostarczane przez serwer. Odczyt pliku nie potwierdza odpowiedzi
`tools/list`, połączenia ani wykonania. Jest to granica oceny AS, wynikająca
z rozdzielenia deklaracji i runtime opisanego w M1, M4 i M9.

Nie ma jednego uniwersalnego pliku `mcptools.json` ani obowiązkowego
`.github/mcp.json` dla wszystkich produktów. Brak lokalnego pliku nie
oznacza braku MCP: źródłem mogą być ustawienia użytkownika, plugin albo
konfiguracja usługi.

MCP deklaruje połączenie i dostęp do narzędzi; nie zastępuje instructions,
skilla ani profilu agenta (M10). Ocena AS-W uniwersalności względem technologii
i architektury dotyczy uzasadnienia i zakresu integracji. Serwer może być
specjalistyczny; nie należy z jego obecności wywodzić obowiązku używania tej
technologii lub architektury w każdym zadaniu. To obowiązkowa polityka produktu,
a nie wymaganie GitHub, aby każda konfiguracja MCP działała z dowolnym stosem.

## Lokalizacje i odrębne schematy

| Profil | Lokalizacja / źródło | Struktura i podstawa |
|---|---|---|
| VS Code | `.vscode/mcp.json` | Mapa `servers`, opcjonalne `inputs`; M4–M5. |
| VS Code użytkownika | `mcp.json` profilu, otwierany poleceniem klienta | Poza repozytorium; M6. |
| VS Code Dev Container | `.devcontainer/devcontainer.json`, sekcja `customizations.vscode.mcp` | Osobny kontekst wykonania; M6. Nie zakładać kompletności tego jednego wariantu lokalizacji kontenera. |
| CLI użytkownika | `~/.copilot/mcp-config.json` | Mapa `mcpServers`; M2. |
| CLI projektu | `.mcp.json`, `.github/mcp.json` | `mcpServers` albo bezpośrednia mapa nazw serwerów; M2. |
| GitHub.com cloud / code review | Settings → Copilot → MCP servers | JSON z `mcpServers`, zapisany w ustawieniach usługi; M1. |
| Custom agent | `mcp-servers` w YAML profilu | Deklaracja agenta; M7. |
| Visual Studio / JetBrains / Xcode / Eclipse | Konfiguracja udostępniana przez dany klient | M4 opisuje `mcp.json`; nie wyprowadza z tego wspólnej ścieżki w każdym repozytorium. |

Scanner rozpoznaje lokalne warianty projektowe. Ustawienia zewnętrzne oznacza
jako niezweryfikowane, chyba że użytkownik jawnie dołączy ich eksport jako
odrębne źródło. Eksport nie jest dowodem aktualnego stanu usługi.

W CLI M2 opisuje przejście od katalogu roboczego do korzenia Git:
bliższa definicja wygrywa, a `.mcp.json` ma pierwszeństwo przed
`.github/mcp.json` na tym samym poziomie. Konfiguracja projektu ma
pierwszeństwo przed osobistą. Wymagane jest zaufanie katalogowi.
`.vscode/mcp.json` nie jest bezpośrednio czytany przez CLI.

M6 wyjaśnia osobno Agent Host w VS Code: edytor przekazuje mu konfigurację,
z wyjątkiem serwerów wymagających interaktywnego wejścia, np. `${input:...}`.
Host natywnie czyta `.mcp.json` i `~/.copilot/mcp-config.json`.
Nie utożsamiać tego z obsługą `.vscode/mcp.json` przez sam CLI.

## Pola według profilu

| Profil / transport | Pola i ograniczenia deklaracji |
|---|---|
| GitHub.com lokalny | `type: local` lub `stdio`, `command` jako tekst, `args` jako lista tekstów, `tools` jako lista tekstów; opcjonalne `env`. |
| GitHub.com zdalny | `type: http` lub `sse`, `url`, `tools`; opcjonalne `headers`. |
| VS Code stdio | `command`; referencja wymienia `type: stdio`. `args`, `cwd`, `env`, `envFile` są opcjonalne. |
| VS Code HTTP/SSE | `url`, typ `http`/`sse`; opcjonalne `headers`, `oauth`. |
| CLI lokalny | `command`, `args`; `type` opcjonalne, domyślnie `local`. W sprawie `tools` zobacz rozbieżność poniżej. |
| CLI zdalny | `type`, `url`; M8 dopuszcza też alias `streamable-http`. Nie ograniczać OAuth według reguł GitHub.com. |

Podstawa: M1, M5 i M8. Pominięcie pola i błędny typ pola to różne przypadki.
Pustą listę argumentów można podać jawnie, gdy program nie wymaga argumentów.
Typy wartości `env` nie są uniwersalne: M5 dopuszcza tekst, liczbę i `null`,
więc parser VS Code nie może narzucać samych tekstów.

M4 pokazuje w JetBrains/Xcode m.in. `requestInit.headers`, podczas gdy M5
opisuje `headers` bezpośrednio w konfiguracji serwera. Nie przenosić jednego
schematu do drugiego IDE. Nieznane rozszerzenia pozostają zachowane.

## Narzędzia, autonomia i uwierzytelnianie

M1 zaleca jawne listy potrzebnych narzędzi tylko do odczytu; `["*"]`
dopuszcza wszystkie. Dla code review narzędzie musi deklarować
`annotations.readOnlyHint: true` w odpowiedzi serwera. Nazwa
`read_document` w pliku nie potwierdza tej adnotacji.

M3 wskazuje, że cloud agent i code review obsługują narzędzia MCP, lecz nie
MCP resources/prompts ani zdalnego OAuth. Po skonfigurowaniu cloud agent
może korzystać z narzędzi samodzielnie. Domyślnie udostępnione serwery GitHub
i Playwright nie wymagają dopisania do lokalnego pliku; GitHub ma ograniczony
dostęp do bieżącego repozytorium, a Playwright do usług we własnym środowisku.
Nie rozszerzać tych reguł na dowolny klient MCP.

Są dwie odrębne listy: filtr serwera `tools` oraz filtr profilu agenta.
Ocena powinna je pokazać osobno. Nie rekonstruować ostatecznych możliwości,
jeśli brakuje ustawień repozytorium lub katalogu narzędzi runtime.

W konfiguracji GitHub.com M1 opisuje odwołania `$COPILOT_MCP_NAZWA`,
`${COPILOT_MCP_NAZWA}` i wariant z wartością domyślną. Sekrety/zmienne
udostępnione przez ustawienia Agents mają prefiks `COPILOT_MCP_`.
Nazwa zmiennej docelowej wewnątrz `env` nie musi mieć tego prefiksu.
W YAML agenta M7 dopuszcza dodatkowo składnię `${{ secrets.NAZWA }}`
i `${{ vars.NAZWA }}` dla właściwych nazw. Nie zakładać jej obsługi
w każdym pliku JSON klienta.

M6 zaleca unikanie sekretów wpisanych bezpośrednio w konfigurację oraz użycie
inputów lub plików środowiska. M9 opisuje dodatkowe polityki organizacyjne,
których lokalny skan nie potwierdza. Scanner nie odczytuje wartości z `envFile`,
magazynu poświadczeń ani środowiska procesu tylko po to, aby sprawdzić placeholder.

## Przykłady porównawcze

Autorskie przykłady są syntetyczne: domena `.invalid` i narzędzie
`read_document` ilustrują format. Nie są gotowymi połączeniami do usługi.

VS Code Local agent — `.vscode/mcp.json`:

```json
{
  "inputs": [
    {
      "id": "docs-token",
      "type": "promptString",
      "description": "Token do dokumentacji",
      "password": true
    }
  ],
  "servers": {
    "dokumentacja": {
      "type": "http",
      "url": "https://mcp.example.invalid/mcp",
      "headers": {"Authorization": "Bearer ${input:docs-token}"}
    }
  }
}
```

GitHub.com — JSON do ustawień usługi:

```json
{
  "mcpServers": {
    "dokumentacja": {
      "type": "http",
      "url": "https://mcp.example.invalid/mcp",
      "tools": ["read_document"],
      "headers": {"Authorization": "Bearer $COPILOT_MCP_DOCS_TOKEN"}
    }
  }
}
```

CLI — repozytoryjne `.github/mcp.json`, bez wymuszania prefiksu sekretów cloud:

```json
{
  "mcpServers": {
    "dokumentacja": {
      "type": "http",
      "url": "https://mcp.example.invalid/mcp",
      "tools": ["read_document"],
      "headers": {"Authorization": "Bearer ${DOCS_TOKEN}"}
    }
  }
}
```

Ostatni plik nie konfiguruje automatycznie MCP na GitHub.com.
Zmiana samego klucza `servers` na `mcpServers` nie potwierdza przenośności
zmiennych, uwierzytelniania ani polityk dostępu.

## Reguły walidacji

| ID | Podstawa | Sprawdzenie i wynik |
|---|---|---|
| MCP-001 | GH-W / HOST · M1, M2, M5 | Wybrać schemat po profilu i źródle. Nie wymagać `mcpServers` w pliku VS Code ani `servers` w CLI. |
| MCP-002 | AS | Parser uwzględnia format klienta. W pliku VS Code obsłużyć komentarze jak w M4; JSON ustawień GitHub.com oceniać jako ścisły JSON. Zgłaszać powtórzone klucze. |
| MCP-003 | GH-W / HOST · M1, M5, M8 | Weryfikować rodzaj transportu i pola odpowiedniej gałęzi. Brak `command` dla zadeklarowanego stdio lub `url` dla HTTP to błąd deklaracji. |
| MCP-004 | AS | Brak `type` lub `tools` oceniać zgodnie z rozbieżnościami źródeł, bez arbitralnego zaostrzenia wszystkich profili. |
| MCP-005 | AS | Sprawdzić typy `args`, `env`, `headers` i struktury `inputs` właściwe dla klienta; wskazać dokładne pole błędu. |
| MCP-006 | AS | Zweryfikować składnię lokalnych referencji `${input:id}` i duplikaty ID. Nie prosić o wartość tokena w celu skanowania. |
| MCP-007 | GH-W · M1, M7 | Dla cloud sprawdzić składnię i prefiks odwołań do sekretów. Nie weryfikować ich rzeczywistych wartości ani istnienia po stronie usługi. |
| MCP-008 | GH-Z · M1, M3 | Szeroki filtr `*` oznaczyć do przeglądu. Zalecana allowlista nie jest wymogiem składni. |
| MCP-009 | AS | Bez odpowiedzi runtime nie potwierdzać nazw, schematów ani `readOnlyHint` narzędzi. Nie wywoływać `tools/list` przy skanowaniu. |
| MCP-010 | AS | Podejrzenie sekretu maskować wraz z komunikatem błędu parsera; zachować lokalizację, bez ujawnienia wartości. Placeholder nie jest prawdziwym sekretem. |
| MCP-011 | AS | Nie pobierać pakietów, nie sprawdzać URL przez sieć, nie wykonywać `command` i nie tworzyć plików środowiska. |
| MCP-012 | GH-W · M2; AS | Kolizje konfiguracji CLI pokazywać wraz z poziomem i katalogiem roboczym. Brak danych o źródłach osobistych/pluginach ogranicza pewność wyniku. |
| MCP-013 | AS | Brak plików MCP: informacja. Nie wymagać lokalnego wpisu wbudowanego serwera. |
| MCP-014 | HOST · M6 | Serwer VS Code zależny od interaktywnego inputu: uwaga o ograniczeniu przekazywania do Agent Host. |
| MCP-015 | AS | Jawne `cwd` lub referencja do pliku poza korzeniem: poza zakresem odczytu, nie automatycznie błędna konfiguracja Copilot. |
| MCP-016 | GH-W · M3 | Zadeklarowana zależność cloud agenta od MCP resources/prompts lub zdalnego OAuth: nieobsługiwana możliwość tego profilu. Nie przenosić wyniku na IDE/CLI. |
| MCP-017 | AS | Nie oceniać transportu wyłącznie po rozszerzeniu pliku; nazwy serwerów i nieznane pola zachować bez „naprawiania”. |

## Kryteria merytoryczne dla AI

Ocena stosuje [wspólny kontrakt AI](standaryzacja-ai.md). Analizujemy sens
deklaracji MCP w kontekście zadania oraz powiązanych agentów, skills i promptów.
To interpretacja AS wskazanych zaleceń, nie audyt działania serwera. JSON
nie musi mieć dodatkowego pola opisowego: cel może wynikać z dołączonych
instrukcji albo jawnego opisu użytkownika. Taki opis oznaczamy jako deklarację.

| ID | Podstawa | Co ocenia AI | Dowód i granica wniosku |
|---|---|---|---|
| MCP-018 | AS na podstawie M3, M9, M10 | Czy konfiguracja realizuje odpowiedzialność MCP — deklarację integracji i narzędzi — a jej uzasadnienie nie myli jej ze stałymi instrukcjami, procedurą skilla lub rolą agenta? | Powiązać deklarację z opisanym zastosowaniem w przekazanej konfiguracji. Nie wymagać nieudokumentowanego pola opisu w JSON. Brak celu oznacza nieznane uzasadnienie, nie dowód zbędności serwera. |
| MCP-019 | AS na podstawie GH-Z · M1, M3, M11 | Czy zakres udostępnianych narzędzi jest proporcjonalny do deklarowanego zadania i ogranicza niepotrzebny kontekst? | Wskazać filtr i deklarowane operacje. `*` może uzasadniać przegląd; konkretnej allowlisty nie wymyślać bez danych. Nie ustalać operacji zapisu ani `readOnlyHint` po nazwie i nie udawać pomiaru dokładnego zużycia tokenów. |
| MCP-020 | AS na podstawie M1, M5, M7 | Czy struktura, nazwy pól, typy, transport i odwołania do uwierzytelniania odpowiadają profilowi klienta? | Powiązać pole z faktami parsera i właściwym schematem. Dla JSON/JSONC nie wymagać nagłówków Markdown ani YAML. Wskazać ujawnianie sekretów bez ich cytowania; nie twierdzić, że konto ma dany sekret lub uprawnienie. |
| MCP-021 | AS na podstawie M2, M3, M4, M5, M6, M7, M8 | Czy deklarowane możliwości, odwołania do serwerów i użycie w agentach/skills/promptach są spójne z mechaniką wybranego klienta? | Powiązać konkretne referencje i profil. Rozróżnić MCP prompts od zwykłego tekstu promptu, źródła lokalne od ustawień usługi oraz filtry serwera od agenta. Brak lokalnego wpisu nie dowodzi nieistnienia serwera w runtime; nie potwierdzać połączenia. |
| MCP-022 | AS-W (polityka produktu) na podstawie M2, M7, M9, M10 | Czy zachowana jest uniwersalność względem technologii i architektury: integracja opisana jako ogólna nie narzuca bez uzasadnienia jednego stosu lub wzorca, a integracja specjalistyczna ma jawny i uzasadniony zakres? | Porównać deklarację serwera z opisem jego zastosowania w konfiguracji. Wyspecjalizowany serwer jest dozwolony; nie przenosić jego ograniczeń na cały projekt ani każde zadanie. Nie badać manifestów, architektury lub bezpieczeństwa implementacji serwera. Brak opisu może ograniczyć ocenę; bez `NOT_APPLICABLE`. |
| MCP-023 | AS na podstawie M2, M7, M8, M11 | Czy konfiguracja pozostaje łatwa w utrzymaniu: bez nieuzasadnionych kopii, sprzecznych definicji serwera i nadmiarowych integracji? Czy podział między profilami jest czytelny? | Wskazać konkretne kopie lub różnice i ich wpływ na aktualizacje/przesłanianie. Definicje dla odrębnych klientów mogą być potrzebne; samo podobieństwo URL ani brak lokalnego użycia nie dowodzą zbędności. Nie wymagać jednego schematu dla wszystkich klientów. |

Przykład uwagi: agent ma wyłącznie czytać dokumentację, a deklaracja serwera
udostępnia `*`. AI może zalecić przegląd i ograniczenie zakresu MCP-019.
Bez opisu rzeczywistych narzędzi nie proponuje zmyślonej nazwy `read_docs`
i nie ogłasza, że serwer na pewno umożliwia usuwanie danych.

Przykład pozytywny: zadanie wskazuje potrzebną operację, a konfiguracja
ogranicza dostęp do odpowiadających jej narzędzi opisanych w przekazanym
materiale. AI może ocenić spójność tych deklaracji; działanie połączenia,
faktyczne uprawnienia i zgodność opisu z serwerem pozostają niezweryfikowane.

## Rozbieżności i ograniczenia

- M5 oznacza `type` jako wymagane dla stdio, lecz jego własny minimalny
  przykład oraz przykłady M4 i M6 je pomijają. Sam brak pola w takim
  profilu nie wystarcza do kategorycznego błędu; zalecić jawny typ i wskazać
  rozbieżność. Jawnie nieprawidłowa wartość to osobna sytuacja.
- M8 wymienia `tools` jako wymagane, ale M2 pokazuje poprawne projektowe
  konfiguracje CLI bez tego pola. Bez potwierdzenia konkretnej wersji
  brak `tools` w projekcie oznacza nierozstrzygnięty zakres domyślny.
- M1 wymaga `tools`, chociaż jeden z przykładów je pomija. Dla ustawień
  GitHub.com raport ma wskazać brak pola i rozbieżność, rekomendując jawną
  listę, zamiast ukrywać niespójność źródła.
- M4 wspomina osobiste ustawienia VS Code w `settings.json`, podczas gdy
  aktualne M5–M6 opisują osobny `mcp.json` profilu. Sam katalog projektu
  nie rozstrzyga konfiguracji osobistej.
- Globalny stan polityk organizacji, zaufanie katalogowi, dostęp do programu
  w PATH, sekrety i połączenie pozostają niezweryfikowane.

## Scenariusze odbioru

| Przypadek | Oczekiwanie |
|---|---|
| `.vscode/mcp.json` z `servers` | Rozpoznany format VS Code. |
| CLI `.mcp.json` jako bezpośrednia mapa serwerów | Akceptowana forma projektu. |
| `.github/mcp.json` w repozytorium | Źródło CLI, bez twierdzenia o zapisaniu ustawień GitHub.com. |
| Poprawne JSONC VS Code / komentarze w JSON cloud | Różne wyniki według formatu. |
| `args` jako tekst zamiast listy | Błąd typu, bez wykonania programu. |
| Brak `tools` w przykładzie projektu CLI | Nierozstrzygnięte, jawna sprzeczność źródeł. |
| `${input:brak}` bez definicji | Wskazana niezwiązana referencja, bez dialogu o sekret. |
| `env.API_KEY = "$COPILOT_MCP_API_KEY"` w cloud | Poprawny prefiks źródła; alias `API_KEY` może być inny. |
| OAuth w CLI / OAuth w cloud | Osobne reguły obsługi, brak globalnego zakazu. |
| Filtr `read_document` bez deskryptora narzędzia | Niezweryfikowane `readOnlyHint`. |
| Token w nagłówku lub błędnym JSON | Maskowany również w komunikatach błędów. |
| Dwa źródła tego samego serwera | Raport pochodzenia i możliwego przesłonięcia. |
| Serwer z `*`, brak opisu faktycznych narzędzi | AI może zalecić zawężenie po przeglądzie; nie wymyśla allowlisty ani operacji zapisu. |
| Referencja agenta bez lokalnej konfiguracji serwera | Jawna luka kontekstu; bez twierdzenia o nieistnieniu serwera w ustawieniach użytkownika. |
| Poprawny HTTPS i znana nazwa pakietu | Nie stanowią audytu bezpieczeństwa lub działania implementacji; ocena dotyczy konfiguracji. |
| Integracja specjalistyczna jest jasno ograniczona do określonego zadania | Możliwy `SUPPORTED` AS-W MCP-022; nie wymagać zgodności ze wszystkimi technologiami. |
| Deklarowana uniwersalna integracja narzuca wszystkim zadaniom jeden stos lub architekturę | Uwaga MCP-022 z powiązanymi cytatami; bez badania architektury projektu. |
| Rozbieżne kopie tego samego serwera w tym samym zakresie CLI | Uwaga MCP-023 wyjaśnia utrzymanie i przesłanianie zamiast automatycznie usuwać definicję. |
