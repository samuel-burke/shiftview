# Color contrast audit — October 2026

The theme has since moved to semantic tokens; see [THEME.md](THEME.md) for
the current colors and how they're checked.

ShiftView's text and controls checked against WCAG 2.2 AA in both themes:
text at 4.5:1 (3:1 at 24 px, or 18.66 px bold), and the edges of fields,
selected states and meaningful icons at 3:1 (1.4.11).

## Results

Every screen with its sheets, menus, editors and error states (46 in
all), in light and dark, at 412 px and 1600 px wide: 92 checks per theme.

| | Light | Dark |
|---|---|---|
| Text under its ratio, before (82 checks) | 1,417 | 896 |
| Text under its ratio, after | 0 | 0 |
| Text axe can't judge (over gradients, inside SVG, symbols, one or two characters), measured from pixels: nodes, and how many are under their ratio | 379, 0 | 372, 0 |
| Field and control edges under 3:1, before → after | 121 → 0 | 121 → 0 |

The "before" edge count only covered controls scrolled into view; the
final check covers the whole page, so it also caught the off switches
further down Settings.

## What was wrong, and the fix

The light theme is the dark theme with Tailwind's slate scale inverted and
the accents remapped (`app/globals.css`). Most failures came from colors
that only worked one way round.

| Found | Theme | Fix |
|---|---|---|
| Secondary text (`text-slate-500`) 3.1–4.0:1 on cards | Dark | `#8193aa`: 5.7:1 on the card, 4.65 on slate-800 |
| Secondary text 3.9–4.3:1 on the page and slate-800 | Light | `#576578`: 4.8:1+ on every light surface |
| Shift-type and time-off colors are text too ("Opener", "Denied", often on their own tint): 2.1–4.2:1 | Light | 700/800 shades |
| Status colors hard-coded as the dark theme's hex in inline styles (`#22c55e`, `#fbbf24`…): "Clocked In" 2.3:1, the below-target warning 1.4, Week's variance 1.7 | Light | `--status-*` variables with a dark and a light value; dark values unchanged |
| `${color}22` tints (hex plus alpha digits) never rendered when the color was a `var()` | Both | `color-mix()` |
| Text faded on top of a secondary color: bottom-tab labels (60% → ~2.3:1), the Reports heatmap's dates, live shifts in Draft mode, `text-*/70` and `/80` notes | Both | Full strength; meaningful `text-slate-600` is `slate-500` |
| White text on the blue → violet primary gradient (3.8 and 4.4:1), Clock In on green-500 (2.2), End Break on amber-500 (2.1), blue-500 drawer buttons (3.8), red-500 counts (3.8), the payroll export's emerald/teal (3.7 / 2.4), 70% indigo avatars on white (3.6) | Both | 600/700 shades (5.0–6.5:1), 90% indigo avatars, hover darkens |
| Text field, select and textarea edges 1.2–1.9:1 against the card or page | Both | `border-field`: 3.2–3.7:1; the focused edge is full-strength indigo (3.9:1) |
| Placeholders: the browser's default grey (~2.4:1 on white) or `slate-600` | Both | The secondary text color |
| Selected segment shown only by a slightly lighter fill (1.2–2.1:1) | Both | A 1 px inset slate-500 ring (4.6:1+); indigo-tinted selections get a full-strength indigo edge |
| Today in the date picker (3.7:1 on white) and the date pill's chevron (3.4:1), blue-500 | Light | blue-400, which light remaps to 6.7:1 |
| Off switches: a slate track on the card, 1.48:1 (light: grey pill, white knob, white card) and 1.71:1 (dark) | Both | A 1 px inset ring in the field-edge color: 3.7:1 / 3.5:1 |
| Time fields in the availability and store hours sheets, edged by a wrapper the field-edge change missed | Both | `border-field` on the wrapper |
| The ⇄ between the two shifts of a swap, slate-600: 2.6:1 / 2.3:1 | Both | slate-500 |
| Requests' filter counts faded to 80%: 3.7–4.3:1 | Light | Full strength |
| Clocked-in green and on-break amber as 800s read olive and brown on the Here Now line, dots and icons | Light | `--status-ok-mark` / `--status-warn-mark` (`#1ca04c`, `#c17c08`) for marks and large numbers: 3.1:1 on the page, 3.4 on a card; small text keeps the 800s |

## Not changed

- **Decorative fills and dividers** (card borders, chart gridlines, the
  skeleton shimmer) carry no information on their own, so 1.4.11 doesn't
  apply.
- **Disabled controls** are exempt and keep their 40–50% opacity.
- **Brand gradient wordmark and logo** are logotypes.
- **Maps** (geofence tiles) are third-party imagery.

## Method

- Production build, Playwright Chromium, `colorScheme` light and dark (the
  app's "System" mode), API answered by the same fixtures as the layout
  audit.
- axe-core 4 `color-contrast` and `link-in-text-block` on every state.
- What axe can't decide ("needs review": text over gradients or images,
  inside SVG, one or two characters, symbols outside the BMP): each node's
  box photographed with its text hidden, and the text's color (with its
  opacity) compared against the background pixels; the median must meet
  the ratio. Nodes under an open sheet's backdrop are skipped; a few
  boxes that a toast or menu shadow lies across were checked by eye.
- Field and control edges, switch tracks, selected segments and icon-only
  buttons: a script compares each border, inset ring or fill with what's
  behind it, over the whole page.
- Keyboard focus: all 482 focusable elements on 12 pages tabbed through in
  both themes; every one shows a 2 px indigo outline, 3.9:1 or more
  against the page and cards.
