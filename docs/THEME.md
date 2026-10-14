# Theme colors

Every color the app draws comes from `app/globals.css`, defined once per
theme. Components never name a color directly: no Tailwind palette class
(`bg-slate-800`, `text-red-400`), no hex or `rgba()` in a style. Tailwind's
palette is switched off (`--color-*: initial`), so a palette class produces
no CSS at all, and `lib/theme-tokens.test.ts` fails on one.

## How it fits together

- **Semantic tokens** (`@theme`): `--color-<name>` makes the utilities
  `bg-<name>`, `text-<name>`, `border-<name>`, `ring-<name>` and so on, with
  Tailwind's opacity modifiers (`bg-danger/15`). The `@theme` values are the
  dark theme; `[data-theme="light"]` redefines every one.
- **Purpose tokens** (`:root`): status (`--status-*`), shift type
  (`--color-shift-*`), time off, the coverage heatmap (`--color-cov-*`),
  charts (`--chart-*`) and elevation (`--shadow-card`, `--shadow-popover`,
  `--shadow-dialog`, `--shadow-segment`, `--shadow-hover`). Inline styles,
  SVG and Recharts use these as `var(...)`.
- **Text and mark twins.** A color drawn both as text and as a mark (a dot,
  stripe, chart line, large number or tint) has a `-mark` twin. In light
  mode text needs a dark shade (4.5:1), and a tint mixed from that shade
  comes out brown or olive; the mark is the vivid shade (3:1). Dark mode
  uses one color for both. `lib/theme-colors.ts` has `tint(color, pct)`,
  which mixes from the twin, and `markColor(color)`.
- **Charts** read `--chart-*` through CSS variables, so a theme change
  (Settings, or the OS in System mode) recolors them with no reload. The
  tooltip box is `CHART_TOOLTIP_STYLE`.
- **Light values are sRGB hex.** Several Tailwind v4 colors sit outside
  sRGB; mixed into a translucent border they fringed yellow on anti-aliased
  edges in Chromium. Dark keeps Tailwind's OKLCH values (what it always
  rendered), and the status, shift and chart colors keep the hex they had.

## Light mode

The light theme used to be the dark one with the slate scale inverted. It
now has its own values:

- A neutral page (`#f4f6f9`), white cards, and edges (`line`, `#dfe5ec`)
  that hold the layers apart instead of grey fills. Cards that only had a
  5% white edge (invisible on white) now have a real one.
- Tints mixed from vivid marks: Opener cells and badges are cream, not tan;
  Mid is sky, Closer lavender.
- Status, chart and badge text in the 700-800 shades (4.5:1 on white, the
  page and their own tints); marks, dots and chart lines in brighter shades
  (3:1).
- The coverage chart's target line is violet: indigo and blue read as one
  hue on white.
- Soft slate shadows for popovers and dialogs instead of dark mode's black
  ones.

Dark mode is unchanged (checked pixel by pixel against the previous build;
see Verification).

## Tokens

### Semantic (utilities)

| Token | Use | Dark | Light |
|---|---|---|---|
| **Surfaces** | | | |
| `bg` | page, header, sidebar | `#080f1e` | `#f4f6f9` |
| `card` | cards, sheets, list rows | `#111827` | `#ffffff` |
| `raised` | popovers, menus, dialogs, toasts: lifted by shadow-popover / shadow-dialog | `#111827` | `#ffffff` |
| `well` | an inset area inside a card | `#0f172b` | `#f4f6f9` |
| `fill` | neutral control fill: chips, secondary buttons, segmented tracks, row hover | `#1d293d` | `#eef1f6` |
| `fill-strong` | hover/pressed on a fill, progress tracks | `#314158` | `#e2e7ee` |
| `fill-stronger` | a selected segment, the off switch track | `#45556c` | `#cbd3de` |
| `inverse` | inverse surface (a high-contrast chip or ring) | `#f1f5f9` | `#0f172b` |
| `scrim` | backdrop under sheets and dialogs (used at /60-/75) | `#000000` | `#0f172b` |
| `on-accent` | text and knobs on accent, status and brand fills | `#ffffff` | `#ffffff` |
| **Text** | | | |
| `fg` | primary text, headings | `#f1f5f9` | `#0f172b` |
| `fg-body` | body text | `#e2e8f0` | `#1d293d` |
| `fg-secondary` | secondary text | `#cad5e2` | `#314158` |
| `fg-muted` | muted text, inactive nav and icons | `#90a1b9` | `#45556c` |
| `fg-subtle` | least emphasis: captions, placeholders, timestamps | `#8193aa` | `#576578` |
| **Borders** | | | |
| `line` | default border and divider | `#1d293d` | `#dfe5ec` |
| `line-subtle` | card edges that only separate a card from the page | `rgb(255 255 255 / 0.05)` | `#e6ebf1` |
| `line-strong` | secondary button and chip edges, dashed placeholders | `#314158` | `#cbd5e1` |
| `line-stronger` | hovered edges | `#45556c` | `#94a3b8` |
| `line-emphasis` | selected-segment ring and other 3:1 edges | `#8193aa` | `#576578` |
| `field` | text field, select and textarea edge: 3:1 on card and page | `#5e6f88` | `#77859b` |
| `focus` | keyboard focus outline | `#6366f1` | `#4f39f6` |
| **Accent** | | | |
| `accent` |  | `#615fff` | `#615fff` |
| `accent-solid` | primary button fill (white text 6.3:1) | `#4f39f6` | `#4f39f6` |
| `accent-fg` | links, active nav, selected text | `#7c86ff` | `#4f39f6` |
| `accent-fg-strong` |  | `#a3b3ff` | `#432dd7` |
| `accent-fg-max` |  | `#c6d2ff` | `#372aac` |
| `brand-from` | brand gradient (CTA buttons, avatar) | `#155dfc` | `#155dfc` |
| `brand-to` |  | `#7f22fe` | `#7f22fe` |
| **Feedback** | | | |
| `info` | scheduled, informational | `#2b7fff` | `#2b7fff` |
| `info-solid` |  | `#155dfc` | `#155dfc` |
| `info-solid-hover` |  | `#1447e6` | `#1447e6` |
| `info-fg` |  | `#51a2ff` | `#1447e6` |
| `info-fg-strong` |  | `#8ec5ff` | `#193cb8` |
| `auto` | auto-scheduled (generated) shifts | `#8e51ff` | `#8e51ff` |
| `auto-fg` |  | `#a684ff` | `#7f22fe` |
| `auto-fg-strong` |  | `#c4b4ff` | `#7008e7` |
| `auto-fg-max` |  | `#ddd6ff` | `#5d0ec0` |
| `danger` | errors, denied, over budget, called out | `#fb2c36` | `#fb2c36` |
| `danger-solid` |  | `#e7000b` | `#e7000b` |
| `danger-mark` |  | `#ff6467` | `#e7000b` |
| `danger-fg` |  | `#ff6467` | `#c10007` |
| `danger-fg-strong` |  | `#ffa2a2` | `#9f0712` |
| `warning` | warnings, pending, on break, drafts | `#fe9a00` | `#fe9a00` |
| `warning-mark` |  | `#ffb900` | `#c17c08` |
| `warning-solid` |  | `#bb4d00` | `#bb4d00` |
| `warning-solid-hover` |  | `#973c00` | `#973c00` |
| `warning-fg` |  | `#ffb900` | `#973c00` |
| `warning-fg-strong` |  | `#ffd230` | `#7b3306` |
| `warning-fg-max` |  | `#fee685` | `#7b3306` |
| `success` | approved, published, saved | `#00bc7d` | `#00bc7d` |
| `success-mark` |  | `#00d492` | `#009966` |
| `success-solid` |  | `#007a55` | `#007a55` |
| `success-solid-alt` | second stop of the payroll export gradient | `#00786f` | `#00786f` |
| `success-fg` |  | `#00d492` | `#006045` |
| `success-fg-strong` |  | `#5ee9b5` | `#004f3b` |
| `ok` | present: clocked in, on target (the Here Now green) | `#00c950` | `#1ca04c` |
| `ok-solid` | Clock In button | `#008236` | `#008236` |
| `ok-solid-hover` |  | `#016630` | `#016630` |
| `ok-fg` |  | `#00c950` | `#016630` |
| `attention` | break-length violations | `#ff6900` | `#ff6900` |
| `attention-fg` |  | `#ff8904` | `#9f2d00` |
| `tag-cyan` | audit-log category: swaps | `#00b8db` | `#00b8db` |
| `tag-cyan-fg` |  | `#00d3f2` | `#005f78` |
| `tag-rose` | audit-log category: managers; call-outs on a time card | `#ff2056` | `#ff2056` |
| `tag-rose-fg` |  | `#ff637e` | `#a50036` |

### Status, shift type and time off

| Token | Dark | Light (text) | Light mark |
|---|---|---|---|
| `--status-ok` | `#22c55e` | `#016630` | `#1ca04c` |
| `--status-warn` | `#f59e0b` | `#973c00` | `#c17c08` |
| `--status-caution` | `#fbbf24` | `#973c00` | `#c17c08` |
| `--status-bad` | `#f87171` | `#c10007` | `#e7000b` |
| `--status-muted` | `#94a3b8` | `#576578` | `#90a1b9` |
| `--status-info` | `#818cf8` | `#432dd7` | `#615fff` |
| `--status-blue` | `#3b82f6` | `#1447e6` | `#2b7fff` |
| `--status-sky` | `#60a5fa` | `#1447e6` | `#2b7fff` |
| `--status-violet` | `#a78bfa` | `#7008e7` | `#8e51ff` |
| `--status-teal` | `#34d399` | `#004f3b` | `#009966` |
| `--status-orange` | `#fb923c` | `#9f2d00` | `#ff6900` |
| `--color-shift-opener` | `#fbbf24` | `#973c00` | `#fe9a00` |
| `--color-shift-mid` | `#60a5fa` | `#1447e6` | `#2b7fff` |
| `--color-shift-closer` | `#a78bfa` | `#7008e7` | `#8e51ff` |
| `--color-timeoff-pending` | `#cbd5e1` | `#576578` | `#90a1b9` |
| `--color-timeoff-approved` | `#4ade80` | `#016630` | `#1ca04c` |
| `--color-timeoff-denied` | `#f87171` | `#c10007` | `#fb2c36` |

### Charts and coverage heatmap

| Token | Dark | Light |
|---|---|---|
| `--chart-scheduled` | `#3b82f6` | `#155dfc` |
| `--chart-target` | `#818cf8` | `#7f22fe` |
| `--chart-actual` | `#22c55e` | `#1ca04c` |
| `--chart-budget` | `#cbd5e1` | `#45556c` |
| `--chart-axis` | `#94a3b8` | `#576578` |
| `--chart-over` | `#f87171` | `#e7000b` |
| `--chart-under` | `#fbbf24` | `#bb4d00` |
| `--chart-met` | `#22c55e` | `#008236` |
| `--chart-cursor` | `rgb(148 163 184 / 0.08)` | `rgb(148 163 184 / 0.12)` |
| `--chart-tooltip-bg` | `#0f172a` | `#ffffff` |
| `--chart-tooltip-border` | `#334155` | `#dfe5ec` |
| `--chart-tooltip-fg` | `#f1f5f9` | `#0f172b` |
| `--color-cov-met` | `#2a3445` | `#e2e8f0` |
| `--color-cov-empty` | `#334155` | `#cbd5e1` |
| `--color-cov-short-1` | `#684b1c` | `#f59e0b` |
| `--color-cov-short-2` | `#9e6b16` | `#d97706` |
| `--color-cov-short-3` | `#de910e` | `#b45309` |
| `--color-cov-over-1` | `#264d8f` | `#60a5fa` |
| `--color-cov-over-2` | `#2f64bc` | `#3b82f6` |
| `--color-cov-over-3` | `#3a80f2` | `#2563eb` |


## Measured contrast

From the token values (both themes; tints composited over the card). The
full set of pairs is asserted in `lib/theme-tokens.test.ts`.

| Foreground | On | Min | Dark | Light |
|---|---|---|---|---|
| `fg` | `card` | 4.5:1 | 16.19 | 17.83 |
| `fg-muted` | `card` | 4.5:1 | 6.74 | 7.58 |
| `fg-subtle` | `card` | 4.5:1 | 5.65 | 5.94 |
| `fg-subtle` | `bg` | 4.5:1 | 6.09 | 5.48 |
| `fg-subtle` | `card` + `fill` | 4.5:1 | 4.65 | 5.24 |
| `accent-fg` | `card` | 4.5:1 | 5.67 | 6.46 |
| `on-accent` | `accent-solid` | 4.5:1 | 6.46 | 6.46 |
| `on-accent` | `warning-solid` | 4.5:1 | 5.03 | 5.03 |
| `on-accent` | `ok-solid` | 4.5:1 | 4.95 | 4.95 |
| `on-accent` | `danger-solid` | 4.5:1 | 4.77 | 4.77 |
| `danger-fg` | `card` + `danger/15` | 4.5:1 | 5.44 | 5.17 |
| `warning-fg` | `card` + `warning/15` | 4.5:1 | 8.00 | 6.31 |
| `success-fg` | `card` + `success/20` | 4.5:1 | 6.54 | 6.29 |
| `ok-fg` | `card` + `ok/15` | 4.5:1 | 6.22 | 6.03 |
| `info-fg` | `card` + `info/15` | 4.5:1 | 5.61 | 5.71 |
| `auto-fg-strong` | `card` + `auto/15` | 4.5:1 | 8.21 | 6.00 |
| `--status-ok` | `card` + `--status-ok-mark/13` | 4.5:1 | 6.29 | 6.17 |
| `--status-warn` | `card` + `--status-warn-mark/13` | 4.5:1 | 6.67 | 6.16 |
| `shift-opener` | `card` + `shift-opener-mark/13` | 4.5:1 | 8.18 | 6.41 |
| `shift-mid` | `card` + `shift-mid-mark/13` | 4.5:1 | 5.65 | 5.85 |
| `shift-closer` | `card` + `shift-closer-mark/13` | 4.5:1 | 5.34 | 6.17 |
| `field` | `card` | 3:1 | 3.47 | 3.74 |
| `field` | `bg` | 3:1 | 3.74 | 3.46 |
| `line-emphasis` | `card` | 3:1 | 5.65 | 5.94 |
| `focus` | `bg` | 3:1 | 4.28 | 5.97 |
| `--status-ok-mark` | `bg` | 3:1 | 8.40 | 3.14 |
| `--status-warn-mark` | `bg` | 3:1 | 8.91 | 3.15 |
| `--chart-scheduled` | `card` | 3:1 | 4.82 | 5.25 |
| `--chart-target` | `card` | 3:1 | 5.95 | 5.89 |
| `--chart-actual` | `card` | 3:1 | 7.79 | 3.40 |
| `--chart-axis` | `card` | 4.5:1 | 6.92 | 5.94 |
| `--chart-tooltip-fg` | `--chart-tooltip-bg` | 4.5:1 | 16.30 | 17.83 |

## Fixed colors (not theme colors)

| File | What | Why |
|---|---|---|
| `components/Logo.tsx` | Gradient stops and the green dot | Brand artwork (`docs/brand`) |
| `components/ChessBoard.tsx` | Board squares | A board keeps its colors in both themes; highlights use the accent |
| `components/marketing/frames.tsx` | Phone and laptop bezels, macOS window buttons | Device hardware in the marketing art |
| `components/marketing/app-chrome.tsx` | The phone's camera cutout | Hardware |
| `app/layout.tsx` | `theme-color` meta, `#080f1e` | Static HTML for the first paint; ThemeProvider sets each theme's `--color-bg` after |
| `public/manifest.json` | `theme_color`, `background_color` | PWA manifest is static JSON (unchanged) |

## Verification

- `lib/theme-tokens.test.ts`: every token resolves in both themes, light
  values stay in sRGB, every `var(--…)` the code uses is defined, no palette
  classes or raw colors outside the files above, every color utility names
  a token, and the contrast pairs.
- `e2e/contrast.spec.ts`: axe `color-contrast` on the dashboard (manager,
  employee), Clock (clocked in, on break), Schedule, Week, Requests, Reports
  and Settings, light and dark, at 412 and 1440 px; switching theme in
  Settings, and an OS change in System mode, recolor the page and charts
  without a reload.
- Screenshots of 14 screens and overlays in both themes at 412 and 1440 px
  were compared with the previous build: dark matches, apart from
  animation timing and a few one-shade merges (violet-100 text uses
  violet-200, emerald-900 tints use emerald-500).
