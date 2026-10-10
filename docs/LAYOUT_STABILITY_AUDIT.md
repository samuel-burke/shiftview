# Layout stability audit — October 2026

What moved on screen without the user asking for it, where it came from, what
was changed, and what is left. Numbers are Cumulative Layout Shift (CLS) from a
production build on a throttled Pixel 7 profile; see [Method](#method).

## Results

CLS per screen, cold load (first visit), before → after. Google's "good" line
is 0.1; the target here was 0, and nothing above 0.01.

| Screen | Before | After |
|---|---|---|
| Dashboard — manager | 0.058 | **0** |
| Dashboard — employee | 0.058 | **0** |
| Dashboard — repeat visit (identity cached) | 0.058 | **0** |
| Schedule — employee | 0.026 | **0** |
| Schedule — manager | 0.103 | **0** |
| Clock — employee | 0.001 | **0** |
| Clock — manager | 0.058 | **0** |
| Week | 0.121 | **0.0002** |
| Week — Draft mode | 0.640 | **0.0002** |
| Requests | 0 | 0 |
| Reports | 0.102 | **0.0008** |
| Settings — manager / employee | 0.104 | **0** |
| Coverage targets | 0.065 | **0** |
| Admin | 0 | 0 |
| Sign in, Sign up, Welcome, Privacy | 0 | 0 |
| Contact | 0.014 | **0** |

Error and empty states (the screen's API calls fail, or the store has no data):

| State | Before | After |
|---|---|---|
| Dashboard — load errors | 0.408 | **0** |
| Dashboard — empty store | 0.457 | **0** |
| Schedule — load errors / empty | 0.021 / 0.019 | **0 / 0** |
| Clock — load errors | 0.004 | **0** |
| Week — load errors | 0.143 | **0.0002** |

Flows (shifts within 500 ms of a tap are excluded, as CLS does):

| Flow | Before | After |
|---|---|---|
| Dashboard: next/previous day ×5, Back to Today | 0.058 | **0** |
| Dashboard: drawer, date picker, user menu, bell, export | 0.048 | **0** |
| Dashboard: edit a shift and save | 0.048 | **0** |
| Dashboard: returning to the tab (refetch) | 0.058 | **0** |
| Tabs: Team → Schedule → Clock → Team, then Back | 0.600 | **0** |
| Back to a scrolled dashboard | 0.315, scroll 323 → **109** | **0.0001**, scroll 435 → **435** |
| Back to a scrolled Schedule | 0, scroll → 0 | 0, scroll 71 → **71** |
| Schedule: weeks back and forth, month view | 0.104 | **0** |
| Week: weeks back and forth | 0.121 | **0.0002** |
| Reports: weeks back and forth | 0.102 | **0.0008** |
| Sign in: empty submit, send code, wrong code | 0.009 | **0.0005** |
| Clock: punch (start break) | 0.001 | 0.001 |

The remaining 0.0002–0.0008 are digits changing width in a fixed box (a week's
hour totals, the heatmap's counts): the box doesn't move.

`e2e/layout-stability.spec.ts` keeps this from regressing: it loads the six
main screens on a phone with API responses arriving staggered and out of
order, and fails at 0.01. Against the code before this work it fails on five
of the six.

## Every shift found, and the fix

Grouped by where it showed up. Sizes are on a 412 px-wide phone.
"Measured" shifts came out of the harness; "audit" ones came from reading the
code (they need a state the harness doesn't produce, a real device, or a
second overlay).

### On every app screen

| Shift | Cause | Fix |
|---|---|---|
| Bell and avatar shoved 43 px left ~1 s after load (measured) | `components/ClockStatusBadge.tsx`: the header pill's label grows from "Off" to "Clocked In" when the status arrives | The pill reserves its longest label's width (CSS pseudo-elements, no extra DOM text) |
| Demo strip arrives with `/api/me` and pushes the screen down (audit) | `TopBar`, `CoverageHeader`, Clock, Admin, Reports rendered it from `me.isDemo` | `components/DemoBanner.tsx`: always in the HTML, shown by CSS from `<html data-demo>`, which the inline script in `app/layout.tsx` sets before first paint from the cached identity (or a hint `TryDemoButton` leaves) |
| Load errors and action results as banners in the page flow push everything under them down (measured: dashboard 100 px, 0.40) | Banners rendered inline on Dashboard, Week, Clock, Coverage, Admin, Requests, Schedule, Settings | `components/Toast.tsx`: `ToastStack` is fixed above the bottom tabs (bottom of the window on larger screens), portaled to `<body>` |
| Page width jumps by the scrollbar when content passes the fold or a sheet locks scrolling (audit, desktop) | No reserved gutter | `html { scrollbar-gutter: stable }` (`app/globals.css`) |
| Short pages scroll by the toolbar's height and their centred card moves as the toolbar slides away; sheets reach under it (audit, mobile Safari/Chrome) | `100vh`/`min-h-screen`/`max-h-[80vh]` | `dvh` throughout (`min-h-dvh`, `h-dvh`, `max-h-[85dvh]`) |
| Closing one overlay unlocks the page under another (audit: time card over employee drawer) | Six sheets each set `body.style.overflow` | `lib/scroll-lock.ts`: one counted lock |
| Digits nudge their neighbours as times, counts and timers tick (audit) | Proportional digits | `font-variant-numeric: tabular-nums` on `body` |
| Content-sized buttons change width while busy ("View demo" → "Starting demo…", Save, Apply, Confirm, Delete) (audit) | Label swaps | `components/StableLabel.tsx`: every label stacked in one grid cell, inactive ones invisible |

### Dashboard (`app/pageClient.tsx`, `components/CoverageHeader.tsx`)

| Shift | Cause | Fix |
|---|---|---|
| Everything below the date pushed down 50 px when the coverage alert appears (measured, 0.048; 0.60 when returning to the tab) | The alert was inserted above the stats once the day and its target curve loaded, and on-target days had no line at all | The status line is always there while coverage alerts are on: a placeholder until today's status is known, then the warning, "Store closed", or a new calm "On target — N here now" |
| Page jumps 54 px on every day change (measured) | A full-width "Back to Today" button inserted off today, removed on today | Off today the status line reads "Viewing past/future schedule" with Back to Today inline; the desktop TODAY button keeps its room |
| List under the chart drops 21 px (measured, 0.0095) | Chart header (title + legend pills) wraps to two lines once the Target pill arrives with the curve | Header keeps two lines' height on phones; the chart waits for the day's curve on a placeholder of its own size |
| Stat cards, timeline, shift cards, section headers resize when loaded (measured: 81→75, 203→224, 64→71, 18→19 px) | Skeletons not sized like the content | `components/Skeleton.tsx` mirrors each one; a shift card reserves its attendance badge row so it doesn't grow when punches load |
| Sections (On Break, Scheduled, Called Out, Off Today) appear, vanish and reappear on day changes (measured) | Call-outs loaded after the shifts and moved people into their own section | The day waits for its call-outs; call-outs and target curves are kept per day and the neighbouring days prefetched, so a step renders from what's there |
| Manager buttons (Plan Draft Schedule, Team week, Export CSV) drawn at the top of an empty list, then pushed off the screen (measured, 0.45 in the empty store) | Rendered before the team's length was known | Rendered once the first load lands |
| Back to the dashboard lands 214 px above where the user was, then the list re-renders under them (measured) | Call-outs and curve lived in component state, so the page came back on placeholders too short to restore the scroll into | Kept for the session like the shift cache; Back renders the same page at once and the browser restores the position exactly |
| Realtime punch / edit / call-out pushes the row being read down the screen (audit, iOS Safari — Chrome anchors natively) | No scroll anchoring in Safari | `lib/scroll-anchor.ts`: notes the first row in view before an update nobody tapped for and scrolls by however far it moved |

### Schedule (`app/schedule/schedulePageClient.tsx`)

| Shift | Cause | Fix |
|---|---|---|
| Day card grows 14, 46 and 6 px as requests arrive (measured, 0.07 for managers) | Time-off, call-outs, swaps and today's punches each added buttons/lines as they landed; the manager buttons below were removed and re-added | The card waits for all four; stats, incoming swaps and manager buttons wait for the card |
| Calendar 6 px taller once loaded (measured) | Week skeleton didn't mirror `WeekView` (whose time line was conditional) | Skeleton mirrors it; the time line is always reserved |
| Next-shift card changes height ("in N days" on its own line) (audit) | Extra line | "· in N days" follows the date on its line |
| Heading icon moves when the name arrives (measured) | Name inserted | A placeholder holds the name's place |
| Week change shows the new dates with the old week's shifts for a frame, then the day card jumps (measured) | Range loaded in an effect | The calendar reads the range from the cache during render; neighbouring weeks/months prefetched |
| Month view loads in a week-shaped skeleton, then jumps 335 px (measured, 0.104) | Wrong skeleton | `MonthView` has a month-shaped loading grid |
| Calendar error state 30 px shorter than the skeleton (measured, 0.019) | Short error line | Error state is the calendar's height |
| One-tap action failures (request day off, call out) grow the card (audit) | Inline error | Toast |

### Clock (`app/clock/clockPageClient.tsx`)

| Shift | Cause | Fix |
|---|---|---|
| Punch list and the cards below drop 150 px (measured, 0.058) | Today's call-out card loaded after the body | The body waits for today's call-out and the employee's own corrections |
| Whole body back on its placeholder when a schedule changes elsewhere (audit) | Realtime reload used the loading state | Background reload |
| "Failed to load data" banner (measured, 0.004) | Inline banner | Toast |

### Week (`app/week/weekPageClient.tsx`, `components/week/*`, `hooks/useWeekShifts.ts`)

| Shift | Cause | Fix |
|---|---|---|
| Day chips slide 55 px when the store's week start arrives (measured) | Chips keyed by date | Keyed by column, placeholders until the week start is known (disabled, so a tap can't hit a day about to change) |
| "No drafts for this week yet" pushes the page down 112 px (measured, 0.64) | Inserted above the page | In the day list on phones, under the grid on larger screens |
| Coverage section drawn, then pushed off the bottom (measured, 0.12) | Rendered before the team's length was known | Rendered once the first week lands |
| Day list drops to placeholders on every week step (measured) | No week cache | `useWeekShifts` keeps loaded weeks and prefetches the ones either side |
| The whole week (dates, rows) switches ~1.5 s after the arrow tap, re-sorting the list under the user (measured, 0.074) | `router.replace` fetched the page from the server before the new `?week=` took effect | `history.replaceState`, which Next.js applies to `useSearchParams` immediately; the server page only re-ran the manager check, which the page entry already did |
| Heatmap pushed down when the chart's code arrives (measured, 0.015 with a short list) | Code-split chart's placeholder was a fixed 200 px; the chart is 332–357 px | `SkeletonBudgetChart`: the chart card's own structure, equal height at phone, tablet and desktop widths |
| Error banners (measured, 58 + 20 px) and publish-result banner | Inline | Toasts |

### Reports (`app/reports/reportsPageClient.tsx`)

| Shift | Cause | Fix |
|---|---|---|
| Hours table and Export CSV pushed down 168 px (measured, 0.085) | Heatmap loaded as a 112 px block, real card 280 px | Heatmap card always rendered, placeholder cells while loading |
| Export CSV drawn, then pushed off the screen (measured, 0.018) | Rendered before the table's length was known | Rendered with the table |
| Table rows move a slot up when loaded (measured, 0.012) | Placeholder rows keyed 0..n reused as employee rows | Loading and loaded tables keyed apart; cells on a 16 px line so loaded rows are the placeholders' 33 px |
| Table replaced by placeholders on week change and on every realtime change (measured) | Loading state reused | Table stays up, dimmed, until the new numbers land |
| Activity log resets to page one when a new entry arrives (audit) | Full reload | New entries merged on top, scroll anchored |

### Settings, Coverage, Requests, notifications

| Shift | Cause | Fix |
|---|---|---|
| Availability days re-order by 44 px (measured, 0.016) | Page showed before its own `/api/settings` (week start) | Waits for settings and identity |
| Appearance and Sounds pushed off the screen when the preferences form replaces a "Loading…" line 480 px shorter (measured, 0.088) | Text placeholder | The form renders empty and disabled while loading |
| Availability note under the section grows the card (audit) | Extra line | Note on the section's label line |
| Coverage: weekly defaults jump up 46 px then back down, then 16 px (measured, 0.065) | Empty state shown before identity was known, then placeholders; defaults before profile names | Waits for identity; defaults render with the profiles |
| Requests: the list moves up under the manager's finger a round trip after Approve/Deny (audit) | Item removed when the server answered | Removed at the tap, next one selected; put back where it was if the server refuses |
| Notifications panel: spinner, then rows; new rows push the reader (audit) | Spinner placeholder; prepends | Row-shaped placeholders; scroll compensates for prepended rows |

### Forms and marketing pages

| Shift | Cause | Fix |
|---|---|---|
| Sign-in / sign-up card re-centres 14 px when "Email is required" appears and again when it goes (measured) | Error inserted under the field | `components/FormError.tsx` reserves the line; same for sheets, settings sections, the shift editor, and `SaveStatusText` |
| Contact: form missing from the HTML, appears after hydration and pushes the footer off (measured) | `useSearchParams` put the form in a Suspense boundary with no fallback | Reads `?topic=` from `location` via `useSyncExternalStore`; the form is server-rendered |
| Contact: help text re-wraps and the page drops 68 px when Inter arrives (measured) | `next/font` with `display: swap` | `display: optional` (preloaded; the fallback is already metric-matched). The app itself loads no web font |

### Motion

Not shifts in CLS terms, but things moving the user didn't start or that
reflow the page: framer-motion ignored "reduce motion" inside the app (now
`MotionConfig reducedMotion="user"` in `AppShell` and the in-app banner);
300–350 ms transitions are 200–250 ms; the wide-screen dashboard and Week
page animated their right padding (a reflow per frame) when the side pane
opened, now one step; the bottom nav animated a drop-shadow filter, now only
its scale.

Already fine and left alone: inputs are 16 px or larger everywhere (an
unlayered `max(16px, 1em)` rule in `globals.css`, so iOS doesn't zoom on
focus); the header is sticky and the bottom nav fixed; Schedule's scroll
position survives Back.

## Not fixed, and why

- **Tap-caused re-layouts that are the design.** Off today, the dashboard
  has no "Here Now" card, so the other two widen; the day's sections differ
  by day; switching Schedule to month view grows the calendar. These happen
  in the frame of the tap, so CLS excludes them, and keeping them still would
  mean changing what the screens show.
- **Schedule's range row wraps on narrow phones when "Today" appears** (off
  the current week, ~24 px). Also in the tap's frame. Fixing it means always
  reserving an empty line on the current week or redesigning the header.
- **First visit, unknown list lengths.** What sits under a list whose length
  isn't known (dashboard manager buttons, Week insights, Reports export)
  waits for the first load instead of being pushed down. The cost: it
  appears a moment later, below the fold in normal use.
- **Far jumps show placeholders, not old data.** Neighbouring days/weeks are
  prefetched; a date picked from the calendar further away shows same-size
  placeholders until it loads.
- **Tablet nav rail on a first visit** gains the manager links when the
  identity arrives (cached on every later visit).
- **Coverage alerts turned off**: the status line slot isn't reserved (it
  would be empty space for those stores), so the first visit with alerts off
  can't know to skip it until settings arrive. Cached afterwards.
- **Realtime isn't measured live**: the harness has no Supabase. The anchoring
  is unit-tested (`lib/scroll-anchor.test.tsx`) and only acts where the
  browser doesn't (Safari).
- **Safe areas weren't checked on a notched device** (no device here);
  `viewport-fit` and the `env(safe-area-inset-*)` paddings were not changed.
- **A 4 px strip beside fixed overlays on desktop**: with the gutter
  reserved, fixed elements stop at it. Invisible on phones (overlay
  scrollbars).
- **Paint-only animations kept**: hover box-shadows and the skeleton shimmer
  (background-position) don't move layout and were left as they are.
- **The Turnstile widget on Sign up / Contact** sizes itself; it's a
  third-party iframe.

Also seen: the baseline Schedule page threw a React hydration mismatch
(#418) in these runs; the current build doesn't.

## Method

- Production builds (`next build` + `next start`, `E2E_BYPASS_AUTH=1`) of the
  code before this work and after, side by side.
- Playwright Chromium, Pixel 7 viewport (412 × 839), DevTools "Slow 4G"
  (562.5 ms RTT, 1.44 Mbps down) and 4× CPU slowdown.
- Every `/api/*` call answered by fixtures for a 12-person store with a full
  week and five people clocked in, each endpoint after its own delay
  (0.9–1.9 s) so responses arrive staggered and out of request order.
- CLS from `web-vitals` 4 `onCLS` (attribution build), plus a raw
  `layout-shift` observer recording every shift, its sources and the step of
  the flow it happened in.
- One run per scenario; the shift sources were checked by hand for each
  non-zero result. Data around "now" depends on the time of day, so the
  before and after runs were made back to back.
- Checks on the final code: `tsc --noEmit` clean; ESLint 0 errors, 49
  warnings, none new (51 before); 1,745 unit tests; all 138 e2e tests across
  the five Playwright projects.
