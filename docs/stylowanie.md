# Standard stylowania

Status: obowiązujący kontrakt.

[Dokumentacja](README.md)

Obowiązuje dla całej aplikacji, w tym leniwie ładowanych widoków, dialogów Material,
prawego panelu, tooltipów i treści Markdown. Punkt wejścia to
`frontend/src/styles.css`. Nie dodajemy kolejnego frameworka CSS ani komponentów
Angular, które tylko opakowują element HTML.

## Spis treści

- [Własność stylów](#własność-stylów)
- [Paleta i dane](#paleta-i-dane)
- [Typografia, rytm i geometria](#typografia-rytm-i-geometria)
- [Wspólne elementy](#wspólne-elementy)
- [Dostępność i weryfikacja](#dostępność-i-weryfikacja)

## Własność stylów

| Plik | Odpowiedzialność |
| --- | --- |
| `styles/tokens.css` | Jedyna paleta, semantyczne kolory, typografia, odstępy, promienie, rozmiary kontrolek, animacje i warstwy. |
| `styles/base.css` | Reset, dziedziczenie fontów, fokus klawiatury, scrollbary i ograniczenie animacji. |
| `styles/primitives.css` | Jawne klasy `ui-*` dla powtarzalnych elementów. |
| `styles/material.css` | Publiczne zmienne motywu Angular Material 22 i ograniczony adapter geometrii overlayów. |
| `styles/markdown.css` | Treść generowana przez renderer Markdown, wyłącznie wewnątrz `.scanner-markdown`. |
| `*.component.css` | Układ konkretnego widoku, responsywność i prezentacja jego danych. |

Style globalne są ładowane raz. Komponenty zachowują domyślną enkapsulację Angulara.
Nie importujemy plików wspólnych do każdego komponentu. Nie używamy `::ng-deep`,
lokalnych palet ani `!important` do walki ze specyficznością. Wyjątek w bazie to
globalna preferencja ograniczenia animacji, która musi obejmować też biblioteki.

## Paleta i dane

Tła mają cztery role: `--color-bg`, `--color-surface`, `--color-surface-raised`
i `--color-surface-inset`. Interakcje używają `--color-surface-hover`. Tekst ma
role `text`, `text-secondary`, `text-muted` i `text-inverse`; tekst pomocniczy
pozostaje czytelny. Nie przyciemniamy go przez dodatkową opacity.

| Znaczenie | Token |
| --- | --- |
| Nowy input | `--metric-fresh` — limonka |
| Input z cache | `--metric-cache` — cyan |
| Output | `--metric-output` — łososiowy |
| Credits | `--metric-credits` — amber |
| Cache write | `--metric-cache-write` — fiolet |
| Potwierdzony błąd / akcja destrukcyjna | `--color-danger` |

Te role nie zmieniają semantyki telemetrii. Brak danych nie oznacza zera, a kolor
nie zastępuje etykiety. Stany pomocnicze mają wspólne warianty `*-soft` i
`*-border`. Zamiast nowego HEX/RGB używamy istniejącej roli. Nowa rola wymaga
uzasadnienia, definicji w tokenach i sprawdzenia wszystkich miejsc użycia.

## Typografia, rytm i geometria

- Jedna rodzina UI `--font-sans`; kod i identyfikatory używają `--font-mono`.
- Tekst bazowy: `--text-base` (13 px przy domyślnym foncie przeglądarki), opisowy:
  `--text-md` (14 px), pomocniczy: `--text-sm` (12 px). `--text-xs` (11 px) służy
  do krótkich etykiet gęstych tabel. Wszystkie rozmiary tekstu są zapisane w rem.
- Nagłówek strony: `--text-5xl`; sekcji: `--text-3xl` / `--text-4xl`;
  podsekcji: `--text-xl` / `--text-2xl`. Bez indywidualnych rozmiarów 7–10 px.
- Padding, margin i gap korzystają ze skali `--space-*`. Karta korzysta z
  `--panel-padding`, strona z `--page-padding`.
- Kontrolka ma domyślnie 36 px wysokości, wariant mały 32 px. Ikona nie określa
  rozmiaru celu kliknięcia. Małe glify danych mają osobne tokeny `--icon-*`.
- Dopuszczamy px dla geometrii wykresów/SVG, granic tabel, breakpointów,
  ograniczeń przewijania i jednopikselowych linii. Nie zastępujemy geometrii
  powiązanej z obliczeniami w TypeScript przybliżoną skalą odstępów.
- Długie dane mieszczą się w lokalnym scroll containerze. Grid/flex children
  używają `min-width: 0`; tabele mogą przewijać się w poziomie bez poszerzania strony.
- Do 900 px lista sesji otwiera się jako nakładka Material i początkowo jest
  zwinięta. Wybór sesji zamyka nakładkę; backdrop i Escape synchronizują jej stan.
  Na większym ekranie lista pozostaje panelem bocznym obok treści.

## Wspólne elementy

```html
<button class="ui-button">Zwykła akcja</button>
<button class="ui-button ui-button--primary">Główna akcja</button>
<button class="ui-icon-button ui-button--danger" aria-label="Usuń sesję">
  <mat-icon>delete</mat-icon>
</button>
<section class="ui-card feature-card">
  <header class="ui-panel-header">
    <div><span class="ui-eyebrow">KONTEKST</span><h2>Nagłówek</h2></div>
  </header>
</section>
```

`ui-button--ghost` służy do cichej akcji, `ui-button--small` do zwartej kontrolki.
`ui-tabs` to zakładki z podkreśleniem, a `ui-segmented` to przełączanie warstwy lub
interakcji. Stany używają istniejących klas `active` / `selected` i właściwych
atrybutów ARIA. `ui-badge` i `ui-code` są dostępne dla nowych etykiet i bloków kodu.

Klasa funkcji może ustawiać szerokość, pozycję czy odstęp od sąsiada. Nie kopiuje
kolorów, obramowań, paddingu i stanów wspólnego przycisku. Wiersz otwierający
narzędzie, węzeł mapy czy kafel sesji to osobny element domenowy: korzysta z
tokenów, ale nie musi przyjmować geometrii zwykłego przycisku.

Material pozostaje właścicielem dialogów, tooltipów, snackbarów i sidenav.
Zmienne `--mat-*` ustawiamy tylko w adapterze. Selektory powierzchni Material
są tam dopuszczone wyłącznie dla geometrii, której publiczne tokeny nie obejmują.
Po aktualizacji Material trzeba zweryfikować adapter. Rozmiary otwieranych
dialogów pozostają w istniejącej konfiguracji `MatDialog.open`.

## Dostępność i weryfikacja

Każda kontrolka klawiaturowa ma widoczny `:focus-visible`; obrys do wewnątrz
nie znika na krawędzi przewijanej karty. Ikonowe przyciski mają `aria-label`,
tooltipy realizuje `MatTooltip`, a wspólna `.info-tip` zachowuje jednolity rozmiar.
Obsługujemy `prefers-reduced-motion` i systemowy kolor fokusu w forced colors.

```powershell
cd frontend
npm run check:styles
npm test -- --watch=false
npm run build
```

`check:styles` uruchamia się również automatycznie przed produkcyjnym buildem.
Bez dodatkowych zależności wykrywa literalne kolory poza paletą, rozmiary fontów
w px, literalne promienie, niezdefiniowane zmienne, `::ng-deep`, lokalne
`!important` i lokalne nadpisywanie Material. To kontrola konwencji; nie zastępuje
kompilatora CSS, testów zachowania ani kontroli wizualnej. Sprawdza również
kontrast co najmniej 4,5:1 dla 17 bazowych par tekst–tło wyliczany z aktualnej
palety. Nie jest to deklaracja pełnej zgodności wszystkich stanów aplikacji z WCAG.

Przy zmianie wspólnej warstwy obejrzyj: onboarding, sześć zakładek sesji, rozwiniętą
tabelę narzędzi, definicję narzędzia, szczegóły rundy, techniki optymalizacji oraz
dialog i historię czatu. Sprawdź desktop, węższy viewport, klawiaturę, przewijanie
i zamykanie paneli. Nie uruchamiaj płatnej inferencji do sprawdzania CSS.

Źródła zasad: [enkapsulacja stylów Angulara](https://angular.dev/guide/components/styling),
[motywy Angular Material](https://material.angular.dev/guide/theming),
[WCAG: widoczny fokus](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html).
