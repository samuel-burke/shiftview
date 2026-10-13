# Front-end performance audit — October 2026

What a phone on weak store Wi-Fi waits for when it opens ShiftView, what was
changed, and what is left. Numbers are from a production build (`next build`
+ `next start`) on a throttled Pixel 7 profile; see [Method](#method).

## Results

Dashboard (`/`, a manager viewing today), Slow 4G + 4× CPU slowdown:

| | Before | After |
|---|---|---|
| **Cold visit** — team list on screen | 5.9 s | **5.3 s** |
| Cold visit — coverage chart drawn | 7.6 s | **6.4 s** |
| Cold visit — transferred (JS) | 663 KB (545 KB) | **544 KB (475 KB)** |
| **Repeat visit** — team list on screen | 1.9 s | **1.8 s** |
| Repeat visit — coverage chart drawn | 2.3 s | 2.3 s |
| **Tap "next day"** — settled | 0.25–0.9 s, 5 requests | **0.05–0.12 s**, 3 requests |
| Tap "next day" — slowest input event | 144–272 ms | **16–40 ms** |
| Tap "next day" — main-thread work in the next 2.5 s | 1.72 s | **0.85 s** |
| **Save a shift** — drawer closes | 1.43 s (2 round trips) | **0.91 s** (1) |
| **Idle on today's view** — main-thread work per 4 s | 1.23 s | **0.11 s** |
| Lighthouse (observed) TBT | 690 ms | 536–790 ms (no clear change) |
| CLS | 0.01 | 0.01 |

Visit timings are medians of five runs alternating between the two builds;
main-thread figures are averages of three traces. Lighthouse's LCP went from
7.5 s to 1.8 s, but that isn't like for like: before, its LCP element was the
chart's "Coverage timeline" label (painted with the chart); after, it picks
the date heading painted at first paint. The chart-drawn row is the honest
comparison. TBT varies by ±130 ms between identical runs here; the same
libraries still run on load, so no change is claimed.

Other screens and pages:

| | Before | After |
|---|---|---|
| `/login` — API calls on load | 4 | 0 |
| `/login` — JS transferred (cold) | 284 KB | 237 KB |
| First-load JS gzip: `/` dashboard | 368 KB | **301 KB** |
| First-load JS gzip: `/schedule`, `/clock`, `/reports` | 329 / 323 / 322 KB | **291 / 285 / 285 KB** |
| First-load JS gzip: `/login`, `/signup`, `/privacy` | 268 / 268 / 264 KB | **221 / 221 / 217 KB** |
| JS every route downloads first (shared) | 262 KB | **214 KB** |
| Supabase Auth round trips per `/api/*` call (server) | 2 | 1 |
| Serial Supabase round trips: `/api/me` (owner) · `/api/schedules` · `/api/callouts?date=` | 8 · 5 · 7 | 4 · 3 · 4 |
| `getUser()` calls from the phone per dashboard load | 5 | 0 |

## Where the time went (cold dashboard, before)

```
   0 –  629 ms  HTML
 591 – 1527 ms  Inter woff2 (48 KB, preloaded at high priority — the dashboard never uses it)
1396 – 4357 ms  JS: 545 KB in 17 chunks, incl. the landing page's code and a 34 KB chess board
3948 ms         /api/me, /api/store-hours, /api/settings   ← layout provider, after hydration
4685 ms         7 page requests (employees, schedules ×2, punches, coverage ×2, callouts)
                ← ~700 ms later: the page's Suspense boundary waited on its own chunks
4895 ms         /api/punches/current   ← waited for /api/me to answer
5867 ms         Recharts chunk (105 KB) starts — only once the data had arrived
7171 ms         chart renders → LCP 7.5 s
```

Not visible in that trace (the mock has no Supabase session), but in
production on top of it: five `supabase.auth.getUser()` calls from the phone to
Supabase Auth per dashboard load, and two Supabase Auth round trips plus a
serial `managers` → `employees` lookup inside every `/api/*` request.

After:

```
   0 –  633 ms  HTML (no font preload)
1209 – 3486 ms  JS: 475 KB in 14 chunks
4005 ms         /api/punches/current, /api/me, /api/store-hours, /api/settings — together
4411 ms         6 page requests (employees, schedules for 3 days, punches, coverage ×2, callouts)
4430 ms         Recharts chunk, in parallel with the data
```

Data still waits for the JS to download and hydrate — see the first open item
under Waterfalls.

## Findings by area

Status: **Fixed** in this change, or **Open** with a recommendation.

### 1. Waterfalls

- **Fixed — proxy re-checked auth on every API call.** `proxy.ts` ran
  `supabase.auth.getUser()` (a Supabase Auth round trip) for `/api/*` even
  though every route authenticates itself (and refreshes the session's cookies)
  in `getOrgContext`. API routes now skip it. Page routes use `getClaims()`,
  which verifies the JWT locally when the project uses asymmetric signing keys
  and falls back to the same Auth call otherwise. `app/page.tsx` likewise.
- **Fixed — membership lookups ran back to back.** `getOrgContext` (every API
  request) queried `managers`, then `employees`. They now run in parallel; only
  a user who manages one org and works in a different one needs a second
  lookup.
- **Fixed — `/api/me` ran three independent lookups in sequence** (employee
  name, org name, memberships). Now parallel.
- **Fixed — `/api/callouts?date=`** (the dashboard's call) awaited the org
  timezone it never uses.
- **Fixed — attendance status waited for `/api/me`.** The layout provider only
  requested `/api/punches/current` once `/api/me` had answered; the route already
  answers for the caller, so both start together.
- **Fixed — `getUser()` from the browser before anything could load.** The
  notification bell (rendered twice on the dashboard — phone top bar and desk
  header, one hidden by CSS), each bell's closed message thread, and the in-app
  banner each awaited `getUser()` (network) to learn the user's id. They only
  need the id for channel names and message alignment — the API and RLS do the
  verifying — so they read the local session with `getSession()`.
- **Open — data still waits for hydration.** Every data request starts from a
  `useEffect` after ~470 KB of JS has downloaded and run. `app/page.tsx` already
  resolves the user and membership on the server; fetching the dashboard's
  first day there (or one `/api/bootstrap` for me + settings + store hours +
  status + the day) and passing it as props would put data on screen with the
  HTML instead of ~4 s later on Slow 4G. This is the largest remaining win.
- **Open — `getOrgContext` still calls `getUser()`.** Switching it to
  `getClaims()` removes the last Auth round trip per API call if the project
  uses asymmetric JWT signing keys (Dashboard → Project Settings → JWT Keys).
  ~40 route tests hand-build an auth mock with only `getUser`, so it needs
  those updated alongside.

### 2. Fetch timing and prefetching

- **Fixed — the chart's code loaded after the data.** The Recharts timeline is
  code-split (good), but the chunk only started downloading once the data had
  arrived and the skeleton was replaced. The dashboard now starts that import
  when its own code runs, in parallel with the requests.
- **Fixed — no prefetch of the next day.** The dashboard reads the previous
  day (overnight shifts), the viewed day and the next day in one ranged request
  and caches all three, so "next day" renders from cache.
- **Open — Week/My schedule could prefetch the adjacent week** the same way
  (`/api/schedules?from&to` and `/api/my-schedule` already take ranges).

### 3. Wasted requests

- **Fixed — two schedule requests per day** (`?date=D` and `?date=D-1`) → one
  ranged request that also prefetches D+1.
- **Fixed — coverage profiles refetched on every day change**; they don't
  depend on the day. Loaded once per dashboard visit.
- **Fixed — CSV export made one request per day** (up to 62). Now ≤ 2 ranged
  requests.
- **Fixed — refetch storm on every return to the app.** Supabase emits
  `SIGNED_IN` whenever it re-validates the stored session — at startup and on
  every return to the foreground — and `TOKEN_REFRESHED` hourly. The provider
  treated those as a sign-in and refetched `/api/me`, store hours, settings and
  the status, on top of its own `visibilitychange` refetch of the same four.
  It now reloads only when the signed-in user actually changes, and refreshes
  identity/settings after 5 minutes away (Realtime covers them while open);
  the live status still refreshes after 5 seconds.
- **Fixed — signed-out pages loaded app data.** `/login`, `/signup`,
  `/privacy`, `/contact` and `/auth/*` fired `/api/me`, store hours, settings
  and opened a Realtime socket. They now load nothing.
- **Fixed — one notifications fetch and channel per bell, per navigation.**
  All bells share one store: one session read, one fetch, one channel, kept
  for 10 s after the last bell unmounts so page navigation reuses it.
- **Fixed — `select('*')`** on the hot reads (`/api/schedules`,
  `/api/my-schedule`, `/api/punches`, the current-shift loader) now selects the
  mapped columns only.
- **Open — `/clock` fetches `/api/me` itself** although the provider has it
  (a duplicate on a cold open of the Clock screen). The page's comment says this
  is deliberate; its test relies on it.
- **Open — `/schedule` makes two overlapping `/api/my-schedule` requests** (the
  viewed week and "next 30 days"), and on a first visit computes the week from
  the default first day of the week before `/api/settings` answers. Repeat
  visits now start with the store's settings (see 4), which removes the
  refetch there.

### 4. Client caching

- There is no data-cache library; the layout provider holds ad-hoc caches
  (`scheduleCache`, `punchCache`, `myScheduleCache`, employees) and `me` in
  localStorage. That works for the main screens, now with:
- **Fixed — settings and store hours are remembered** next to the cached
  identity (tagged with the org, and only used with a cached identity for that
  org), so a repeat visit renders with the store's timezone and week start
  immediately instead of the defaults.
- **Fixed — saves wait for one round trip, not two.** Editing a shift now
  closes the drawer when the server accepts it (conflict checks are
  server-side, so the PUT itself still has to be awaited) and re-reads the days
  in the background. `POST /api/schedules` returns the new id so a created
  shift shows without waiting for the re-read.
- **Open — adopt TanStack Query (or SWR)** if more screens need cross-screen
  dedupe, stale-while-revalidate and optimistic updates; it would replace the
  hand-rolled caches and visibility handlers with one policy.

### 5. Service worker and PWA

- The service worker handles push only and has **no `fetch` handler**. That
  is the right default here: Chrome skips starting a handler-less worker on
  navigation, while a caching handler would put worker start-up (50–300 ms on
  a midrange Android) in front of every launch. Hashed `/_next/static` assets
  are already `Cache-Control: immutable`, so a repeat visit transfers ~28 KB.
- Caching the HTML for an instant shell is **not recommended**: it depends on
  the session, and store devices are often shared, so a cached page could show
  the previous user's dashboard.
- **Fixed — registration moved off the startup path** (after `load`).
- Updates: `skipWaiting()` + `clients.claim()`, nothing precached, so no stale
  app can get stuck. If offline support becomes a goal, use the Static Routing
  API for `/_next/static` plus navigation preload rather than a plain handler.

### 6. Critical path

- **Fixed — the dashboard preloaded the landing page's font** (48 KB Inter,
  high priority, competing with the critical JS). `/` served both the landing
  page and the dashboard from one route, so each audience downloaded the
  other's code and the dashboard got the marketing font. The landing page is
  now its own route (`app/welcome`), served at `/` to signed-out visitors by a
  rewrite in the proxy (which already checks the session for `/`); the URL is
  unchanged and its canonical is `/`.
- **Fixed — no preconnect to Supabase.** The browser talks to Supabase
  directly for session refreshes and the Realtime socket; the layout now
  preconnects (saves DNS + TCP + TLS, ~3 round trips on Slow 4G).
- The app's `font-family: Inter` is never loaded in the app (system fallback),
  so there is no font download there. The theme script in `<head>` is tiny and
  inline (prevents a theme flash).
- **Open — one 103 KB (18 KB gzip) render-blocking stylesheet** for every
  route, including the marketing pages' utilities. Tailwind's output is small
  per class; splitting marketing CSS would save a few KB at most.

### 7. Bundle

- **Fixed — the chess easter egg was in every app page.** `MessageThread`
  lazy-loaded `ChessBoard` but also imported `parseChessMessage` from it, which
  pulled `react-chessboard` + `chess.js` (34 KB gzip) into the bundle of every
  page with a notification bell. The parser lives in `lib/chess-message.ts`
  now, and the bell loads `MessageThread` only when a conversation opens.
- **Fixed — framer-motion was in the code every page needs first**, via the
  root layout's notification banner. The banner is loaded after the page and
  only when a Supabase session cookie exists, so signed-out pages don't
  download framer-motion at all.
- **Fixed — landing and dashboard shipped each other's code** (see 6).
- **Open — Recharts is emitted three times** (dashboard timeline, coverage,
  reports) under different hashes, ~105 KB gzip each, so visiting two of those
  screens downloads it twice. The dashboard's chart is a step line and two
  areas; a small hand-rolled SVG would remove Recharts from the main screen.
- Polyfills ship as `noModule` only; modern phones don't download them.
- `lib/supabase.ts` (a second, plain Supabase client) is unused.

### 8. Images and assets

- The app pages render no raster images (the geofence map's tiles on Settings
  only). CLS stays at 0.01.
- PWA icons are PNG (required for iOS). `icon-512` / `icon-maskable-512` are
  57–62 KB; a lossless optimizer would cut them roughly by a third, but they are
  only fetched on install.
- **Open — `public/icon-1024.png` (164 KB) is referenced nowhere**, and the
  15 KB `favicon.ico` loads on every cold visit (an SVG favicon is ~1 KB).

### 9. Third-party scripts

- Vercel Analytics and Speed Insights load after hydration (~3 KB each) and
  don't block anything. No other third-party scripts.

### 10. Responsiveness

- **Fixed — the dashboard repainted its chart every frame while idle.** The
  "now" dot's pulse was an SVG `<animate>` on the circle's radius, which
  repaints the whole chart SVG every frame — 1.1–1.3 s of main-thread work in
  every 4 s at 4× CPU, for as long as today's dashboard is open (the screen
  managers leave up). It is now an HTML ring animated with `transform` /
  `opacity`, which runs on the compositor.
- **Fixed — the chart re-animated on every update.** Recharts re-ran its 1.5 s
  draw-in animation on each day switch and each minute tick. It now draws in
  once and updates in place afterwards (and not at all with reduced motion).
- **Fixed — day switching rendered synchronously in the tap.** The click
  handler re-rendered the whole dashboard (~280 ms at 4× CPU) before the next
  paint. Day changes are now transitions, so the tap paints at once.
- **Fixed — unrelated updates redrew the chart.** The timeline is memoized, so
  opening the employee drawer or the export panel doesn't re-render Recharts.
- **Fixed — context value recreated on every provider render**, re-rendering
  every consumer on each navigation; now memoized.
- **Open — the dashboard still renders twice per day change** (once with the
  new date, then again when an effect copies the cached day into state).
  Deriving the day's shifts from the cache during render would remove the
  second pass.
- Lists are short (a store's team, a week), so virtualization isn't needed.
  The address autocomplete on Settings is already debounced.

### 11. Perceived speed

- Skeletons match the final layout (CLS 0.01). A repeat visit now renders
  the cached identity *and* the store's settings at once, the next day renders
  from cache, and saves close the drawer one round trip sooner.
- **Open — the whole dashboard waits on the schedules request** (`isLoading`
  gates the stats, chart and team list together). The team list could render
  from the cached roster while the day loads.

### 12. Supabase

- One browser client: `createBrowserClient` is a singleton in the browser.
  Server clients are per request, as cookie-based auth requires.
- **Fixed — Realtime scoped server-side.** The provider's channel subscribed
  to every change on `store_hours`, `app_settings` and `punch_records`; RLS kept
  other orgs' rows out, but Realtime still evaluated them, and every punch in
  the store made each connected manager refetch their own status. It now filters on
  the org (and on the user's own `employee_id` for punches) and subscribes only
  once the org is known — so signed-out pages open no socket.
- Channels are removed on unmount throughout. **Open:** the dashboard's and
  My schedule's channels could add the same `org_id` filter.
- Indexes cover every hot filter and sort (`schedules(org_id, date)`,
  `punch_records(org_id, punched_at)`, `managers(user_id)`,
  `employees(user_id)`, `notifications(org_id, user_id, created_at desc)`,
  `callouts(org_id, date)`). The advisor's unindexed-foreign-key notes are
  composite keys covered by indexes in a different column order, or tables
  that only matter on deletes.
- RLS already wraps its helpers in `(select …)` (one evaluation per query); the
  performance advisor reports no `auth_rls_initplan` or duplicate-policy issues.
- **Region:** the Supabase project is `us-east-1`; Vercel functions ran in
  `iad1` (US East) only by default. `vercel.json` now pins `"regions": ["iad1"]`
  so a settings change can't move them away from the database.
- **Open — work after the write.** `PUT`/`POST /api/schedules` await an
  employee lookup for the notification before answering, and `DELETE` can await
  the coverage check, manager lookups and the alert emails. Moving that into
  `after()` (from `next/server`) answers the client sooner and also keeps the
  un-awaited `notify()`/audit promises alive on Vercel.

## Method

- **Build:** `next build`, served by `next start` with `E2E_BYPASS_AUTH=1`
  (the E2E setting, so the dashboard renders without Supabase).
- **API:** a local HTTP/2 + TLS proxy in front of `next start` answered every
  `/api/*` call from fixtures shaped like the demo org (12 employees, a full
  week, five people clocked in) after a fixed 200 ms, standing in for the
  function + Supabase time. It logged each request's start and end for the
  waterfall. HTTP/2 matters: over HTTP/1.1 Chrome queues the 7th parallel
  request.
- **Lighthouse 12.8, mobile:** simulated throttling (what PageSpeed Insights
  reports) and observed DevTools throttling (562.5 ms request latency,
  1.47 Mbps, 4× CPU). Repeat visits reuse the same Chrome profile (HTTP cache,
  service worker, localStorage).
- **Interactions:** Playwright on the same throttling, Pixel 7 viewport,
  Event Timing + Long Task observers; "team list on screen" is when the first
  shift card shows a name, "chart drawn" is when the skeletons are gone.
  Main-thread work comes from DevTools timeline traces (average of three runs),
  on this commit and on the commit before it.
- **Limits:** without a real session, the browser's Supabase Auth calls and
  the server's Supabase round trips don't appear in the traces; those are
  counted from the code. Realtime couldn't connect.
