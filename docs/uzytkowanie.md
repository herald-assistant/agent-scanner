# Obsługa Agent Scanner

Status: aktualna dokumentacja.

[Dokumentacja](README.md)

## Spis treści

- [Uruchomienie i pierwsza sesja](#uruchomienie-i-pierwsza-sesja)
- [Demo w przeglądarce](#demo-w-przeglądarce)
- [Czytanie sesji](#czytanie-sesji)
- [Narzędzia i techniki optymalizacji](#narzędzia-i-techniki-optymalizacji)
- [Korzystanie z AI](#korzystanie-z-ai)
- [Dane i prywatność](#dane-i-prywatność)
- [Źródła emitera](#źródła-emitera)

## Uruchomienie i pierwsza sesja

Do budowania wymagane są JDK 17+ i Maven. Z katalogu repozytorium wykonaj:

```powershell
mvn clean package
java -jar target/agent-scanner.jar
```

Maven pobiera własny Node.js do budowania frontendu. Otwórz
[aplikację lokalną](http://localhost:8081). Port, baza i retencja są opisane
w [konfiguracji](konfiguracja.md).

W VS Code otwórz `Preferences: Open User Settings (JSON)` z palety `Ctrl+Shift+P`
i dodaj poniższe właściwości do głównego obiektu ustawień:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.protocol": "http/protobuf",
  "github.copilot.chat.otel.otlpEndpoint": "http://localhost:8081",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}
```

To kompletny obiekt JSON; w istniejącym pliku przenieś same pary klucz–wartość.
Przeładuj okno VS Code i rozpocznij nową interakcję z Copilotem. Sesja powinna
pojawić się na liście, a status zmienić na „Ostatnia aktualizacja”.
Oznacza to zapis danych w bazie, nie aktywne połączenie z IDE. Status można
sprawdzić także przez `GET /api/status`.

## Demo w przeglądarce

Demo działa na statycznym hostingu i nie wymaga uruchomienia Java ani Spring.
Na stronie startowej skopiuj ustawienia eksportera plikowego, wpisz własną ścieżkę
w `github.copilot.chat.otel.outfile`, a po pracy z Copilotem użyj „Wczytaj plik
Copilot OTel JSONL” lub ikony importu przy nagłówku Sesje.

Zaznacz jedną lub kilka głównych rozmów w modalu i zatwierdź. Model, czas i rundy
głównego agenta są oddzielone od subagentów i wywołań pomocniczych. Zapis obejmuje
tylko wybrane rozmowy oraz ich jednoznacznie powiązany zakres. Nieprzypisane spany,
logi i metryki są pomijane; podgląd podaje ich liczniki. Limit pliku wynosi 64 MiB.

Plik pozostaje w przeglądarce. Sesje zapisują się w IndexedDB i wracają po
odświeżeniu strony. Dane zależą od adresu aplikacji i profilu przeglądarki; mogą
zostać usunięte przez przeglądarkę. Eksportuj potrzebny materiał jako kopię.
Eksport JSON Scanner zawiera sesję i jej powiązane dane; nie można go wczytać
wejściem Copilot JSONL. Usuwanie sesji i całej bazy wymaga potwierdzenia.

Podsumowanie, Koszt i przebieg, Mapa pracy i Dane techniczne działają lokalnie.
Górny pasek demo zawiera nazwę aplikacji i przycisk panelu sesji; nie pokazuje
statusu, poradnika technik, konfiguracji ani pauzy. Wejścia do AI i Standaryzacji
pokazują modal
„Dostępne w pełnej wersji”. Brak pomiaru lub przechwyconej treści jest pokazany
jako brak danych. Instrukcje budowania są w [konfiguracji](konfiguracja.md#statyczne-demo).

## Czytanie sesji

| Zakładka | Do czego służy |
|---|---|
| Podsumowanie | Najważniejsze informacje o zapisanej sesji. |
| Koszt i przebieg | Bilans, interakcje, rundy, subagenci i analiza narzędzi. |
| Mapa pracy | Faktyczny diagram z wyborem interakcji i warstwy Kontekst/Tokeny/Credits. |
| AI Hub | Jawna analiza kategorii i rozmowy o całej zamrożonej sesji. |
| Dane techniczne | Drzewo spanów oraz surowe dane do audytu. |

Standaryzację otwiera ikona przy nagłówku **Repozytoria** w lewym panelu.
Pod repozytorium można ponownie otworzyć zapisane analizy konfiguracji Copilot;
każda lista pokazuje 5 pozycji i przycisk do wyświetlenia kolejnych.
[Przebieg i prywatność](standaryzacja.md).

Sesja może zawierać wiele interakcji użytkownika. Runda to jedno wywołanie modelu.
Cykl `M → A → M` pokazuje odpowiedź modelu, wykonanie narzędzi przez agenta i dane
wracające do kolejnego requestu. Kliknięcie rundy otwiera wspólny panel szczegółów;
strzałki poprzednia/następna poruszają się w sekwencji wybranego widoku.
`M4` oznacza rundę głównego agenta, a `S1:M2` — rundę powiązanego subagenta.

Wiersz `Cała sesja` sumuje rozłącznie głównego agenta, jednoznacznie powiązanych
subagentów i kompaktowania. Zwijane rozliczenie używa tych samych kolumn dla
wszystkich pozycji. `Czas modeli` sumuje czas wywołań; czas całej sesji z przerwami
pozostaje osobno w nagłówku.

`Nowy input` oznacza input po odjęciu cache read, `Output` — odpowiedź modelu,
a `Credits` — GitHub Copilot AI credits, bez przeliczenia na walutę.
`≈` oznacza estymację, a `—` brak pomiaru. Brak cache write nie jest zerem.
Reasoning nie jest ponownie dodawane do outputu; treść pojawia się tylko wtedy,
gdy została jawnie wyemitowana. [Pełne formuły i reguły](telemetria.md).

Kompaktowanie ma własną pozycję i może być widoczne również bez późniejszej rundy.
Panel pokazuje instrukcje, rzeczywisty request, wynik i pomiary. Zmianę kontekstu
przed/po prezentuje tylko po potwierdzonym odbiorze wyniku w kolejnej wiadomości.
Alert błędu wymaga potwierdzenia w telemetrii; nietypowy czas lub liczba tokenów
nie są same w sobie błędem.

## Narzędzia i techniki optymalizacji

Pod bilansem rozwiń kartę **Potencjalne usprawnienia · bez AI**. Zakładki
`Niewykorzystane` i `Wykorzystane` rozdzielają dostępność definicji od użycia.
Przy niepełnym przechwyceniu odpowiedzi brak użycia pozostaje nieustalony.
Estymacje definicji, żądań, pierwszych odbiorów wyników i późniejszego cache są
osobne. Wartość definicji już sumuje wszystkie jej ekspozycje; nie mnoż jej przez
liczbę rund. Nie jest to pomiar kosztu konkretnego narzędzia ani dowód cache.

Kliknięcie nazwy lub ikony otwiera wszystkie przechwycone wersje definicji,
parametry i pełny JSON. Dla użytych narzędzi licznik powtórzeń wskazuje identyczną
nazwę i kanoniczne argumenty w całej sesji. Modal pokazuje argumenty, rundy i stan
wyników. Powtórzenie jest powodem do sprawdzenia przebiegu, nie dowodem zbędnej pracy.
[Dokładne reguły zestawienia](frontend.md#narzędzia).

Przycisk **Techniki optymalizacji** w górnym pasku pełnej wersji otwiera lokalny
katalog T01–T16.
Nie wymaga sesji ani konfiguracji AI. Można filtrować techniki, czytać przykłady
i skopiować plan próby. Katalog przedstawia warunki, nakład, utrzymanie i kontrolę
jakości, nie obiecuje oszczędności. **Poznaj techniki** w AI Hub otwiera ten sam
poradnik z dowodami dla kategorii lub kompaktowania. Powrót z dowodu zachowuje
wybraną technikę i pozycję przewijania.

## Korzystanie z AI

Po [skonfigurowaniu Copilota](konfiguracja.md#uruchomienie-ai) otwórz AI Hub:

- **Uruchom Quick Analysis** klasyfikuje żądane działania i pokazuje lokalnie
  estymowany podział credits dla wybranej interakcji.
- **Nowa rozmowa**, kontynuacja i historia dotyczą całej zamrożonej sesji.
  W pytaniu można wskazać rundę, np. „Co zwiększyło input w M3?”.
- Dostępne doradztwo najpierw tworzy zweryfikowany lokalny podgląd. Dopiero
  **Wyślij do AI** uruchamia analizę tego pakietu.

Otwarcie AI Hub, historii lub podglądu nie wykonuje inferencji. Jawne wywołanie
może zużyć limit konta Copilot. Klasyfikacja, doradztwo i rozmowa mają różne zakresy
wysyłanych danych opisane w [kontrakcie AI](ai.md).

## Dane i prywatność

Przechwytywanie treści może zapisać lokalnie kod, prompty, instrukcje, ścieżki,
argumenty i wyniki narzędzi. Raw payload oraz jego JSON pozostają w bazie H2 pełnej
wersji lub w IndexedDB demo.
Eksport `agent-scanner-session` v1 zawiera dane źródłowe; traktuj go jak bazę
przed udostępnieniem innym. Eksport nie zawiera analiz AI ani historii rozmów.

Import pod ikoną w nagłówku `Sesje` przyjmuje plik Copilot OTel JSONL. W VS Code
ustaw eksport do pliku, np.:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": "C:/Users/mknie/copilot-otel.jsonl",
  "github.copilot.chat.otel.captureContent": true,
  "github.copilot.chat.otel.maxAttributeSizeChars": 0
}
```

Wybierz wygenerowany plik `.jsonl` lub `.ndjson`. Demo umożliwia wybór wielu rozmów
i przetwarza plik lokalnie. W pełnej wersji wybierz w modalu jedną sesję do
zapisu. Jej podgląd przesyła plik do backendu bez utrwalania; potwierdzenie zapisuje
wybraną sesję i jej jednoznacznie powiązanych subagentów w H2, po czym otwiera
sesję. Anulowanie niczego nie zapisuje. Niepowiązane sesje, logi i metryki z pliku
nie trafiają do bazy; podgląd podaje liczbę pominiętych rekordów. Import egzekwuje
limit rozmiaru, odrzuca istniejące dane i omija pauzę odbiornika. Stary import
eksportu Scanner v1 został usunięty. Pauza zatrzymuje
zapis nowych poprawnych sygnałów, nie usuwa wcześniejszych danych. Retencja
usuwa stare sygnały, a następnie osierocone sesje. Usunięcie sesji lub wszystkich
danych wymaga potwierdzenia w UI. [API operacji](api.md).

Odbieranie i oglądanie faktów nie wysyła treści do modelu. Opcjonalne AI przekazuje
zakres danych do usługi Copilot po jawnej akcji. Katalog modeli może kontaktować
się z usługą bez inferencji. Redakcja rozpoznanych sekretów nie gwarantuje
anonimizacji dowolnego kodu ani tekstu. Historia rozmów i audyt narzędzi są lokalne,
ale treść udostępniona modelowi opuszcza komputer.

## Źródła emitera

- [VS Code: Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents).
- [GitHub Copilot: OpenTelemetry concepts](https://docs.github.com/en/copilot/concepts/agents/opentelemetry).
- [Specyfikacja OTLP](https://opentelemetry.io/docs/specs/otlp/).
- [VS Code: Cache Explorer](https://code.visualstudio.com/docs/agents/agent-troubleshooting/cache-explorer).
