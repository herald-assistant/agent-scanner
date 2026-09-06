# Semantyka telemetrii i zasady interpretacji

Stan dokumentu: 2026-09-06.

## Nadrzędna zasada: dowód przed wnioskiem

Każdy element produktu należy zakwalifikować do jednej z trzech warstw:

| Warstwa | Źródło | Przykład | Sposób prezentacji |
|---|---|---|---|
| Fakt | Pole lub zdarzenie wyemitowane w OTLP. | `input_tokens`, tool call ID, treść odpowiedzi. | Bez znaku przybliżenia; brak pozostaje brakiem. |
| Wyliczenie deterministyczne | Jawna formuła na faktach. | Nowy input, zajętość okna, suma credits fazy. | Tooltip lub dokumentacja podaje formułę i pokrycie. |
| Interpretacja | Wynik AI albo ostrożna reguła rekomendacyjna. | `Pozyskanie danych`, ocena specjalizacji narzędzia. | Jawna etykieta analizy, ograniczenia i droga do dowodu. |

Nie wolno przedstawiać interpretacji jako pola providera. Nie wolno uzupełniać
brakującego pomiaru wartością zero ani estymować go z ceny, koloru lub sąsiedniej
rundy.

## Jednostki domenowe

### Sygnał

Jeden request do endpointu OTLP staje się rekordem `telemetry_signal`. Sygnał
zachowuje raw payload i pełny JSON, nawet jeśli tylko część atrybutów jest
normalizowana.

### Sesja

Podstawowym identyfikatorem sesji jest `gen_ai.conversation.id`. Gdy go brakuje,
ingestion może użyć `trace:<traceId>` jako fallback. Dla kształtu Copilot z
odrębnym `chat_session_id` dziecka normalizacja i frontendowa rekonstrukcja mogą
rozpoznać osobny epizod subagenta, ale tylko przy jednoznacznych jawnych ID.

Pole `connected` w widoku sesji oznacza, że aplikacja odebrała telemetrię i ma ją
w bazie. Nie jest heartbeat'em ani potwierdzeniem aktywnego połączenia z IDE.

### Interakcja

Interakcja zaczyna się od jednego promptu użytkownika i obejmuje pracę wywołaną
tym promptem. Frontend grupuje ją po trace ID; preferowanym korzeniem jest span
`invoke_agent`.

Cel interakcji jest wybierany kolejno z:

1. `copilot_chat.user_request` na korzeniu;
2. wiadomości użytkownika przypisanej do korzenia, po odrzuceniu blobów
   środowiskowych;
3. jawnego komunikatu o braku treści.

Nowy prompt tworzy nową interakcję. Nie wolno numerować wszystkich rund rozmowy
tak, jakby granice promptów nie istniały.

### Wywołanie modelu i cykl

Jedno wywołanie modelu to span `chat`. Technicznie zawiera request i response.
Produkt opowiada kolejne kroki jako cykl:

```text
M(n) → A → M(n+1)
```

Znaczenie:

1. model `M(n)` zwraca tekst i zero lub więcej tool calli;
2. agent wykonuje żądane działania;
3. wyniki mogą wejść do requestu następnego modelu `M(n+1)`.

Dla ostatniego wywołania bez następnego modelu pokazujemy `M → odpowiedź`.
Panel szczegółów otwarty na `M(n)` może więc używać requestu `M(n+1)` po prawej,
aby pokazać, co wróciło do modelu po działaniach agenta.

Wykonania narzędzi są przypisywane do odpowiedzi modelu na podstawie czasu od jej
zakończenia do rozpoczęcia następnego `chat` w tym samym epizodzie. Wyniki w
wiadomościach są łączone z żądaniami po call ID. Te dwa mechanizmy rozwiązują
różne problemy i nie powinny być zastępowane jednym heurystycznym joinem.

### Subagent

Delegacja jest żądaniem narzędzia w odpowiedzi modelu rodzica. Subagent posiada
własne wywołania modelu i własne cykle. W mapie:

- `M4` oznacza czwarte wywołanie modelu głównego agenta;
- `S1:M2` oznacza drugie wywołanie modelu pierwszego powiązanego subagenta;
- linia od rodzica do dziecka wymaga dokładnego call ID;
- zwrot dziecka wraca do przepływu rodzica jak wynik narzędzia;
- credits wywołań dziecka pozostają na wywołaniach dziecka.

Bliskość czasowa i podobna nazwa nie wystarczają do korelacji. Ambiguous join,
konkurencyjne uruchomienia i cykle pozostają niepowiązane.

## Metryki tokenowe

| Nazwa UI | Atrybut lub formuła |
|---|---|
| Input łącznie | `gen_ai.usage.input_tokens` |
| Cache read / Input z cache | `gen_ai.usage.cache_read.input_tokens` |
| Nowy input | `max(0, inputTokens - cacheReadTokens)` |
| Cache write | `gen_ai.usage.cache_creation.input_tokens`, tylko gdy wyemitowane |
| Output | `gen_ai.usage.output_tokens` |
| Reasoning | maksimum z `gen_ai.usage.reasoning.output_tokens` i `gen_ai.usage.reasoning_tokens` |
| TTFT | `copilot_chat.time_to_first_token` |
| Limit kontekstu | `copilot_chat.request.max_prompt_tokens + gen_ai.request.max_tokens` |
| Zajętość okna | `inputTokens / limitKontekstu` dla bieżącego requestu |

Reasoning jest licznikiem tokenów. Treść jest dostępna tylko wtedy, gdy provider
wyemituje użyteczny `copilot_chat.reasoning_content`. Wartość `[encrypted]` oznacza,
że treść nie jest dostępna. Nie próbujemy jej odszyfrować ani rekonstruować.

Przybliżenia `≈` dla fragmentów requestu służą nawigacji. Pełny licznik requestu
z telemetrii pozostaje autorytatywny.

## Credits

Faktyczne credits wywołania:

```text
credits = copilot_chat.copilot_usage_nano_aiu / 1_000_000_000
```

Są to GitHub Copilot AI credits. Nie są walutą ani wyliczoną ceną. Dla agregacji
zawsze liczymy pokrycie:

- `covered` — liczba wywołań z wyemitowanymi credits;
- `total` — wszystkie wywołania należące do zakresu;
- suma istnieje, jeśli co najmniej jedno wywołanie ma pomiar;
- brak pomiaru nie zwiększa sumy i nie jest zerem.

Suma fazy jest prostą sumą pełnych credits jej wywołań. To inna wartość niż
procentowy podział kategorii.

## Klasyfikacja działań modelu

Jednostką interpretacji jest to, czego model zażądał od agenta w swojej odpowiedzi
`M → A`. Cel zadania pomaga ocenić dopasowanie, ale nie zmienia faktycznej akcji.

Przykład:

```text
Cel: przeanalizuj architekturę
Tool call: read_file("AGENTS.md")
Kategoria działania: Pozyskanie danych
```

Nie klasyfikujemy tej rundy jako „analiza” tylko dlatego, że analiza jest celem.
Model przeprowadził własne rozumowanie przed odpowiedzią; widoczne żądanie do
agenta dotyczy odczytu.

### Kategorie działań

| Kod | Etykieta produktu | Znaczenie |
|---|---|---|
| `ACQUIRE_DATA` | Pozyskanie danych | Wyszukanie, lokalizacja albo odczyt informacji. |
| `MODIFY` | Modyfikacja | Zmiana kodu lub danych bez dowodu typu artefaktu. |
| `WRITE_INTERMEDIATE` | Zapis pośredni | Jawny zapis materiału roboczego do dalszej pracy. |
| `WRITE_FINAL` | Zapis wyniku | Jawny zapis końcowego artefaktu. |
| `VALIDATE` | Weryfikacja | Test, kompilacja lub sprawdzenie poprawności. |
| `DELEGATE` | Żądanie delegacji | Przekazanie zadania innemu agentowi. |
| `MANAGE_CONTEXT` | Zarządzanie kontekstem | Jawne kompaktowanie lub streszczenie dla dalszej sesji. |
| `RESPOND` | Odpowiedź lub komunikat | Tekst dla użytkownika albo pytanie bez tool calla. |
| `OTHER` | Inna akcja | Widoczne działanie poza zdefiniowanym zbiorem. |
| `UNKNOWN` | Akcja nieustalona | Brak wystarczającego dowodu. |

Jedno żądanie może mieć kilka kategorii, np. terminal zawierający odczyt i test:
`ACQUIRE_DATA + VALIDATE`. Dla pojedynczego zapisu wybieramy jeden z `MODIFY`,
`WRITE_INTERMEDIATE`, `WRITE_FINAL`.

Akcje rundy muszą być sumą zbiorów akcji wszystkich tool calli tej rundy. Gdy
tool calli nie ma, dopuszczalne są tylko kategorie wynikające z przechwyconego
tekstu: `RESPOND`, jawne `MANAGE_CONTEXT` albo `UNKNOWN`.

### Fazy

Faza jest prezentacyjnym, deterministycznym agregatem wyniku AI:

1. sortujemy wywołania głównego agenta i powiązanych subagentów w kolejności;
2. dla każdej rundy bierzemy pełny, uporządkowany zestaw kategorii;
3. łączymy wyłącznie sąsiednie rundy o identycznej sygnaturze;
4. faza pokazuje oznaczenia rund, typ aktora, typy żądanych narzędzi i sumę
   pełnych credits wywołań;
5. zmiana aktora sama nie rozcina fazy, jeżeli zestaw kategorii pozostaje taki sam.

Faza nie twierdzi, że model miał jedną intencję. Jest skrótem sekwencji widocznych
żądań.

## Klasyfikacja narzędzi

AI ocenia definicję każdej unikalnej, rzeczywiście żądanej wersji narzędzia.
Deduplikacja używa kanonicznego pełnego JSON-u definicji; zmiana opisu lub schematu
tworzy nową wersję.

### Możliwość narzędzia

Techniczne kategorie definicji obejmują `DATA_ACCESS`, `ANALYSIS`, `MODIFICATION`,
`VALIDATION`, `EXECUTION`, `EXTERNAL`, `COORDINATION`, `OTHER`.
Ta warstwa opisuje możliwości definicji, a nie konkretną akcję pojedynczego użycia.

### Specjalizacja

| Kod | Znaczenie |
|---|---|
| `GENERAL_PURPOSE` | Ogólny terminal, odczyt pliku, grep, listowanie lub uniwersalny delegator. |
| `DOMAIN_SPECIFIC` | Narzędzie rozumiejące domenę, np. symbole kodu lub API repozytorium. |
| `TASK_SPECIFIC` | Operacja zaprojektowana dla konkretnego typu zadania lub wyniku. |
| `UNKNOWN` | Definicja brakująca, konfliktowa albo niewystarczająca. |

Nazwa custom lub MCP nie jest dowodem specjalizacji. Udział narzędzi uniwersalnych
w fazie jest wskazówką do inspekcji, nie oceną błędu ani nieefektywności.

### Dopasowanie do celu

`DIRECT`, `SUPPORTING`, `WEAK`, `UNKNOWN` opisuje widoczny związek konkretnego
żądania z wyemitowanym celem. Dopasowanie nie dowodzi jakości wyniku, konieczności
wykonania ani oszczędności.

## Estymacja credits według kategorii

AI zwraca wyłącznie kategorie. Credits są dzielone lokalnie przez
`action-credit-attribution.ts`.

Dla wywołania z credits `C`, inputem `I` i outputem `O`:

```text
inputPart  = C × I / (I + O)
outputPart = C - inputPart
```

Warunki:

- wymagane są wyemitowane `C`, `I` i `O` oraz `I + O > 0`;
- reasoning i cache read nie są ponownie dodawane do mianownika;
- output part reprezentuje credits odpowiedzi modelu zawierającej żądania;
- input part reprezentuje dane wracające do tego requestu.

### Przypisanie outputu

- Jeżeli odpowiedź zawiera tool calle, `outputPart` jest rozdzielany między
  żądania proporcjonalnie do lokalnego szacunku ich rozmiaru.
- Szacunek używa długości JSON-u nazwy i argumentów podzielonej przez 4,25 tylko
  jako względnej wagi.
- Część jednego żądania z wieloma kategoriami jest dzielona równo między nie.
- Odpowiedź tekstowa bez tool calli korzysta z kategorii rundy.

### Przypisanie inputu

- Parser szuka wyników narzędzi obecnych w wiadomościach requestu.
- Wynik musi mieć dokładnie jednego kandydata żądania po call ID i dowód, że dana
  runda jest jego konsumentem.
- Wiele wyników dzieli `inputPart` według przybliżonej liczby znaków/4,25.
- Pierwszy odbiór i późniejsza retencja są liczone osobno wewnętrznie.
- Niepowiązane lub wieloznaczne wyniki pozostają poza kategoriami.

Zachowana jest równość:

```text
credits z pomiarem = suma estymacji kategorii + poza kategoriami
```

Na ekranie podział kategorii jest procentowy i oznaczony `≈`. Użytkownik nie
powinien interpretować go jako rachunku providera ani kosztu samego narzędzia.

Poddrzewo delegacji może być pokazane jako dodatkowy, dokładny roll-up credits
wywołań subagenta. Nie wolno dodawać go drugi raz do sumy kategorii.

## Błędy

Czerwony alert jest dozwolony tylko przy jednoznacznym dowodzie:

- status spanu `STATUS_CODE_ERROR`;
- niepuste `error.type`;
- zdarzenie exception/error/abort/failed compaction;
- ustrukturyzowany wynik `isError=true`, `success=false`, `ok=false`, failure
  status albo niezerowy exit code;
- znany, przetestowany format błędu konkretnego narzędzia.

Opóźnienie, duży input, brak wyniku, powtórzenie instrukcji i nietypowa odpowiedź
nie są same w sobie dowodem błędu.

## Prywatność i zakres wysyłany do AI

Po jawnym kliknięciu analiza może wysłać:

- unikalne definicje użytych narzędzi;
- lokalne identyfikatory agentów, kontekstów, rund i wywołań;
- wyemitowany cel ograniczony do 4000 znaków;
- treść odpowiedzi modelu ograniczoną do 1000 znaków na rundę;
- wszystkie pola argumentów, przy czym każdy string dłuższy niż 100 znaków jest
  skracany do pierwszych 50, `...` i ostatnich 47 znaków.

Nie wysyłamy:

- wyników wykonania narzędzi;
- pełnych requestów modelu;
- tokena GitHub;
- sekretów pobranych z konfiguracji;
- samodzielnie odkrytych plików repozytorium.

Sesja Copilot ma wyłączone tools, MCP, skille, instrukcje repozytorium, operacje
Git i pamięć. Wynik przechodzi ścisłą walidację przed zapisem.
