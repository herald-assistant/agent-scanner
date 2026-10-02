# Rozwój, testowanie i dokumentacja

Status: obowiązujący kontrakt.

[Dokumentacja](README.md)

Wiążąca część [AGENTS.md](../AGENTS.md). Zacznij od stanu Git, właściciela zmiany
w [architekturze](architektura.md) i kodu oraz testów danej warstwy. Zachowuj cudze
zmiany; nie wykonuj resetu, czyszczenia repozytorium ani masowego formatowania.
Zmiana semantyki wymaga dowodu z raw lub wersjonowanego, anonimowego fixture'u.

## Spis treści

- [Środowisko deweloperskie](#środowisko-deweloperskie)
- [Weryfikacja zmian](#weryfikacja-zmian)
- [Prywatność](#prywatność)
- [Utrzymanie dokumentacji](#utrzymanie-dokumentacji)
- [Kryteria ukończenia](#kryteria-ukończenia)

## Środowisko deweloperskie

Backend z katalogu repozytorium:

```powershell
mvn "-Dskip.frontend=true" spring-boot:run
```

Frontend w osobnym terminalu, z Node zgodnym z manifestem:

```powershell
cd frontend
npm ci --no-fund --no-audit
npm start
```

Maven używa własnego Node.js 22.22.3. [Proxy](../frontend/proxy.conf.json) przekazuje
`/api` i `/v1` do portu 8081. Produkcyjny build Angulara zapisuje do
`target/classes/static`; pełne `mvn clean package` tworzy wykonywalny JAR.
Na PowerShell cytuj argumenty Maven `-D...`.

Jeżeli `npm ci` zwraca `EPERM`, ustal proces trzymający moduł natywny, zamknij go
i ponów instalację. Nie usuwaj rekurencyjnie katalogu ze niesprawdzonej ścieżki.

## Weryfikacja zmian

Polecenia Maven i kontrolę dokumentów uruchamiaj z katalogu repozytorium,
a npm z `frontend/`.

| Obszar zmiany | Końcowe sprawdzenia |
|---|---|
| Dokumentacja | `node scripts/check-docs.mjs`, `git diff --check` |
| Skrypt kontroli dokumentacji | dodatkowo `node --test scripts/check-docs.test.mjs` |
| Frontend | `npm test -- --watch=false`, `npm run build` |
| Demo, Worker, IndexedDB i Pages | dodatkowo `npm run build:demo -- --base-href /agent-scanner/`, `node scripts/check-demo-artifact.mjs /agent-scanner/`, `npm run test:demo:e2e` |
| Wspólne style | dodatkowo `npm run check:styles` i ogląd ekranów/overlayów przy desktopowej i wąskiej szerokości |
| OTLP, H2, API, walidacja AI, konfiguracja | `mvn "-Dskip.frontend=true" test` |
| Zależności i integracja buildu | osobny build frontendu oraz `mvn clean package` |

Podczas pracy uruchamiaj najmniejszy właściwy zakres. Testuj zachowanie, nie kopię
implementacji. Prosta zmiana CSS nie wymaga testu odtwarzającego reguły arkusza.
Testy zwykłego buildu nie wywołują płatnego modelu.

`OtlpFlowIntegrationTest` pokrywa protobuf, JSON, gzip, pauzę, błędne wejście,
metryki/logi i eksport/usuwanie/import. Przy zmianie ingestu sprawdź atrybuty,
drzewo, znormalizowane sesje/spany/messages i zachowanie raw. Zmiana agregacji
wymaga fixture'u wielobatchowego. Pochodzenie i kształt regresji opisuj w
[katalogu fixture'ów](../src/test/resources/fixtures/README.md).

Frontendowe regresje obejmują grupowanie interakcji/rund, korelację subagentów,
tokeny i credits, potwierdzone błędy, konfigurację, krytyczne warunki widoczności
i stan rozwinięcia. Preferuj publiczne zachowanie komponentu i wyrenderowany wynik.

Do testów demo zainstaluj Chromium przez `npx playwright install chromium`
(na Linux CI `npx playwright install --with-deps chromium`). Test
[demo.test.mjs](../frontend/e2e/demo.test.mjs) uruchamia zwykły serwer statycznego
artefaktu, bez Spring i atrap API. Rejestruje sieć, blokuje wysyłkę oraz każde
`/api` i `/v1`, sprawdza rzeczywiste IndexedDB, Workera, multi import, rollback,
konflikt między kartami, migrację, anulowanie, lokalne widoki, eksport i usuwanie.
Ten sam test odczytuje base href z buildu i działa w root oraz podkatalogu.
Ustawienie `DEMO_URL` na adres HTTPS opublikowanego demo uruchamia ten sam odbiór
na hostingu zamiast lokalnego serwera; dane testowe nadal pozostają w izolowanym
kontekście przeglądarki.
Screeny i syntetyczne pliki robocze zapisują się w ignorowanym `frontend/test-results`.
Nie zawierają pliku użytkownika. Wspólne JSONL i oczekiwania normalizacji pozostają
w `src/test/resources/fixtures`; skrypt pretest generuje ignorowany moduł TypeScript.

## Prywatność

Payload, messages, argumenty i wyniki mogą zawierać dane poufne. Nie drukuj realnej
telemetrii w testach i nie commituj jej bez anonimizacji. Preferuj syntetyczne
fixture'y. Usuwaj prompty, kod, repo URL, ścieżki użytkowników, identyfikatory,
sekrety i unikalne timestampy, zachowując potrzebną strukturę dowodu.

Nie commituj tokena, `config/application.properties`, bazy H2 ani `target/`.
Usuwanie sesji i całej bazy pozostaje jawną, potwierdzaną akcją UI. Import/eksport
mogą zawierać te same dane wrażliwe co raw; zachowuj dokładne ostrzeżenia.
Wysyłka do AI jest ograniczona [kontraktem AI](ai.md). Dodatkowa analityka,
upload albo zdalny storage wymagają wyraźnej autoryzacji i opisanej prywatności.

## Utrzymanie dokumentacji

Utrzymuj mały, płaski zestaw dokumentów wskazany w [indeksie](README.md).
Aktualizuj dokument właściwy dla zmienionej funkcji w tym samym zadaniu co kod.
`README.md` przedstawia produkt, `AGENTS.md` zasady pracy, a indeks prowadzi do
kontraktów. Nie kopiuj pełnych opisów do wszystkich punktów wejścia.

Każdy plik `docs/` ma jeden H1, krótki `Status:`, link do indeksu i tematyczne H2.
Pisz po polsku z dokładnymi nazwami kodu; zachowane angielskie reguły techniczne
nie potrzebują drugiej pełnej wersji językowej. Większy dokument może mieć spis
treści. Nowy plik twórz dopiero dla odrębnego tematu wymagającego osobnego utrzymania.
Zwykle wystarczy sekcja istniejącego dokumentu.

Formuły definiuje telemetria, endpointy API, ustawienia konfiguracja, a zachowanie
funkcji AI jej kontrakt. Poradnik tylko objaśnia i linkuje te reguły.
Opisuj istniejącą aplikację. Nie przechowuj tu liczby testów, rozmiarów bundla,
chwilowego working tree ani hipotetycznych funkcji. Wersje zależności rozstrzygają
manifesty i lockfile; nie nazywaj ich „najnowszymi”.

Używaj względnych linków inline `[opis](plik.md)` i nagłówków ATX. Przy przenoszeniu
popraw też fragmenty `#…` i ścieżki w przykładach. `check-docs.mjs` sprawdza lokalne
pliki, nagłówki, statusy, bloki kodu i dostępność z punktów wejścia. Pomija sieć
i nie ocenia prawdziwości treści. Po przejściu kontroli przeczytaj zmiany i diff.

## Kryteria ukończenia

Zmiana zachowuje dowód przed wnioskiem i jawne braki danych, znajduje się we
właściwej warstwie, synchronizuje DTO Java/TypeScript oraz dokumentację.
UI pozostaje polskie, dostępne i spójne. Właściwe testy i build przechodzą;
diff nie zawiera sekretów, prawdziwej telemetrii ani plików generowanych.
