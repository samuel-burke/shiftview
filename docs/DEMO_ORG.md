# Demo Mode: Mock APIs → Dedicated Demo Organization

This document analyzes replacing ShiftView's fixture-based demo mode with a
dedicated Demo organization in the real database, and lays out a recommended
migration plan. It assumes the multi-tenant architecture described in
`MULTI_TENANCY.md` (shared schema, `org_id` + RLS, composite FKs) is fully
rolled out, as it is on `dev`.

## 1. Current state

Demo mode today is an **unauthenticated fallback layer** spread across the API
surface, not a separate mock server:

- `data/demo-fixtures.ts` (~125 LOC) holds hardcoded employees, shift
  patterns, availability, settings, store hours, and coverage profiles, plus
  generator functions that synthesize schedules relative to the requested
  date.
- ~20 API routes branch on "not authenticated" (or `?demo=true` on
  `/api/me` and `/api/my-schedule`) and return fixtures instead of querying
  the database. **9 routes return substantial fixture data; 11 return empty
  arrays** — so punches, time off, swaps, messages, drafts, templates, and
  notifications all look like dead features in the demo.
- The frontend threads `?demo=true` through navigation in ~11 files, shows a
  "Demo Mode · Changes are not saved" banner, disables Supabase realtime
  subscriptions, and **silently no-ops every write** (saves update local state
  only).
- E2E tests (`e2e/demo.spec.ts`) carry a *second*, independent copy of mock
  data via Playwright route interception.

Drift is already observable: the demo `/api/me` omits `employeeId`,
`/api/my-schedule` always returns `employeeId: null`, the empty-fallback
routes hide entire features, and the e2e mocks have diverged from the backend
fixtures. Every new endpoint or schema change requires remembering to update
the fixture branch — the exact maintenance tax this proposal eliminates.

## 2. Benefits vs. drawbacks

### Benefits of a Demo organization

| Benefit | Why it matters here |
| --- | --- |
| **Zero schema/behavior drift** | Demo traffic exercises the same routes, `getOrgContext()`, org-scoped queries, RLS policies, and business logic as production. A response-shape change can no longer diverge. |
| **Writes become real** | Today every mutation is a silent no-op. With a demo org, visitors can create shifts, approve swaps, clock in — a dramatically more convincing demo, and it exercises validation/conflict logic. |
| **Whole features become demoable** | The 11 empty-fallback endpoints (time off, swaps, messages, punches, drafts, templates…) get real seeded data instead of looking unimplemented. |
| **Code deletion** | Removes the fixture branch from ~20 routes, the `isDemo` write-guards in page clients, and the dual `?demo=true` plumbing. The remaining demo-specific surface is a banner + a reset job. |
| **Realtime works in demo** | Subscriptions are currently disabled in demo; with real rows and RLS membership they can be re-enabled, demoing one of the app's differentiators. |
| **Free production smoke test** | The demo org is a canary: if the demo breaks, production is broken. |
| **Marginal cost is low** | The hard part — org scoping, RLS, composite FKs, membership functions — already shipped. A demo org is "just another tenant." |

### Drawbacks / new costs

| Drawback | Mitigation |
| --- | --- |
| Demo now requires an authenticated session (RLS demands a real `auth.users` member of the org) | Supabase **anonymous sign-ins** + a `POST /api/demo/start` endpoint that provisions membership (see §6). Visitor friction stays at one click. |
| Shared mutable state: concurrent visitors see (and can vandalize) each other's edits | Frequent scheduled resets; per-visitor ephemeral orgs as an upgrade path (see §4, §5). |
| Real side effects: cron reminders, Resend emails, web push, audit logs now fire for demo data | `organizations.is_demo` flag + suppression guards in `lib/notify.ts`, `lib/email.ts`, `/api/cron/reminders`, and `/api/invites` (see §3). |
| Static seeds go stale (fixtures currently *generate* schedules relative to the requested date) | Rolling re-seed: nightly job reseeds a ±2-week window around "today" (see §4). |
| Demo no longer works without a reachable database | Acceptable for the hosted product; keep route-intercepted mocks for e2e/local dev (see §7). |
| Demo rows pollute analytics, backups, audit history | Exclude `is_demo` orgs in any cross-tenant query; resets keep volume bounded. |

Net: for this codebase the trade strongly favors the demo org. The mock layer
is small today (~270 LOC) but it silently caps what the demo can show, and the
empty-fallback pattern means drift grows with every feature shipped.

## 3. Security, isolation, and multi-tenant considerations

The existing defense-in-depth already does most of the work — the demo org is
isolated by the same four layers as any customer org:

1. route-level `getOrgContext()` / `requireManager()`,
2. explicit `.eq("org_id", orgId)` / `orgTable()` scoping,
3. RLS via `is_org_member()` / `is_org_manager()`,
4. composite FKs (`(child_id, org_id) → (parent_id, org_id)`).

Demo-specific hardening is still required because demo members are
**anonymous, untrusted users holding manager-level write access** inside their
org:

- **`organizations.is_demo boolean not null default false`** — the single
  source of truth for every guard below. Expose it from `/api/me` so the
  frontend banner is driven by the org, not a query param.
- **Block outbound side effects for demo orgs:**
  - `POST /api/invites` calls `admin.auth.admin.inviteUserByEmail()` — a
    public demo manager could use it to send arbitrary real emails (spam
    vector, sender-reputation damage). Hard-block invites when `is_demo`.
  - `lib/email.ts` sends via Resend; fixture addresses like
    `jordan@demo.com` would bounce and hurt deliverability. Suppress when
    `is_demo` (or route to a sink).
  - `/api/cron/reminders` iterates **all orgs** with the admin client — skip
    `is_demo` orgs (or send in-app notifications only, no email/push).
  - Web push: `push_subscriptions` is per-user, not org-scoped; anonymous
    demo users shouldn't register push subscriptions at all.
- **Lock the demo identity down.** With anonymous sign-ins each visitor gets
  a throwaway `auth.users` row, which avoids the worst shared-credential
  problems (one visitor changing the password locks everyone out). If a
  shared demo account is used instead, block password/email changes for it.
- **Abuse and cost controls:** rate-limit `POST /api/demo/start` (anonymous
  user creation is effectively unauthenticated row creation in `auth.users`),
  cap row counts on demo writes, and exclude `?demo` entry points from
  crawler indexing so bots don't mint sessions.
- **Content vandalism:** anything a visitor types (employee names, messages)
  is visible to subsequent visitors until the next reset. Frequent resets are
  the primary mitigation; per-visitor orgs eliminate it entirely.
- **Never special-case the demo org inside query scoping.** All demo branches
  should be additive guards (suppress a side effect), never relaxations of
  org filters — otherwise the demo org becomes the soft spot in tenant
  isolation.

## 4. Seeding, reset, and maintenance strategy

- **Fixed `DEMO_ORG_ID`** (e.g. `00000000-0000-0000-0000-00000000000d`),
  mirroring the existing `DEFAULT_ORG_ID` convention, so seed/reset/guard code
  can reference it without lookups.
- **Seed script (`scripts/seed-demo.ts`)** run with the service-role client:
  - Port `data/demo-fixtures.ts` as the data source — it stays the single
    source of truth for *what* the demo contains, but now it's inserted, not
    served. Extend it to cover the currently-empty features (a pending time
    off request, an open swap, a short message thread, yesterday's punches,
    one draft schedule, one template).
  - **Date-rolling:** generate schedules/punches for a window around "today"
    (e.g. −7/+14 days) from `EMPLOYEE_PATTERNS`, exactly as
    `getDemoSchedulesForDate()` does at request time today. Seeded absolute
    dates that age out are the #1 way demo tenants rot.
  - Idempotent: safe to run on a fresh org or as a full reset.
- **Reset = delete + reseed, in dependency order.** The composite FKs were
  created **without `ON DELETE CASCADE`**, so the reset must delete children
  before parents (punch_records → shift_swaps → schedule_template_rows →
  drafts → schedules/templates → availability/time_off → employees → …), or
  use a `SECURITY DEFINER` SQL function `reset_demo_org(p_org uuid)` that
  encapsulates the ordering server-side. Also purge anonymous `auth.users`
  created by demo sessions older than a TTL.
- **Cadence:** a nightly Vercel cron (`/api/cron/demo-reset`, guarded by the
  existing `CRON_SECRET` pattern) is the floor. Hourly is reasonable given the
  small data volume; it bounds both staleness and vandalism windows.
- **Maintenance loop:** when a feature ships, its demo presence is now just
  rows — update the seed script, not 20 route branches. Add a CI smoke test
  that runs the seed against a local Supabase and hits the main endpoints as
  a demo member.

## 5. Risks, edge cases, operational concerns

- **Concurrent visitors collide.** Two simultaneous visitors share state:
  one deletes the schedule the other is looking at. For a portfolio/sales
  demo this is usually acceptable (and resets heal it). If it isn't,
  **per-visitor ephemeral orgs** (clone seed into a fresh org per
  `demo/start`, TTL-delete after N hours) give perfect isolation at the cost
  of a more complex provisioning/cleanup path. Recommended as an upgrade
  path, not the starting point.
- **Cron and admin-client paths are the leak risk.** Anything using
  `supabase-admin.ts` bypasses RLS; every such path (`cron/reminders`,
  `audit-log`, `invites`, notify RPCs) needs an explicit `is_demo` decision.
- **Audit log growth:** every demo mutation writes `audit_logs`; resets must
  truncate them for the demo org or they grow unbounded.
- **`/api/me` contract:** demo currently returns `employeeId: null` and the
  frontend tolerates it; with a real org the demo manager gets a real
  employee row — strictly better, but verify nothing special-cases null.
- **E2E tests:** `e2e/demo.spec.ts` intercepts routes and asserts the
  "changes are not saved" behavior, which inverts (changes *are* saved).
  These tests must be rewritten against a seeded org or kept as pure
  frontend-contract tests.
- **Anonymous-user buildup** in `auth.users` if cleanup is skipped; include
  it in the reset job from day one.
- **Backups/metrics:** demo writes show up in DB metrics, PITR, and any
  future billing/analytics — tag-and-exclude via `is_demo` from the start.

## 6. Recommended implementation plan

Phased so demo never breaks; the fixture fallback acts as its own safety net
until the final step.

1. **Schema (migration `0006_demo_org.sql`):** add
   `organizations.is_demo boolean not null default false`; insert the demo
   org with fixed `DEMO_ORG_ID`; add `reset_demo_org(uuid)` SECURITY DEFINER
   function (FK-ordered deletes); optionally enable Supabase anonymous
   sign-ins in project config.
2. **Seed:** `scripts/seed-demo.ts` (service role, idempotent, date-rolling),
   sourcing from `data/demo-fixtures.ts`; extend fixtures to cover the 11
   currently-empty features.
3. **Side-effect guards:** thread `is_demo` into `OrgContext`; suppress
   email/push and block `/api/invites` for demo orgs; skip demo orgs in
   `/api/cron/reminders`.
4. **Demo session entry:** `POST /api/demo/start` — anonymous sign-in, then
   (admin client) upsert the visitor as a manager + linked employee in the
   demo org; rate-limited. "Try the demo" button calls it and lands on `/`
   with a real session.
5. **Frontend switch:** drive the demo banner from `/api/me → org.is_demo`
   instead of `?demo=true`; delete the `isDemo` write no-op guards (writes
   are real now); re-enable realtime; keep the banner text but change it to
   "Demo Mode · Data resets nightly".
6. **Reset cron:** `/api/cron/demo-reset` calling `reset_demo_org` +
   reseed + anonymous-user purge; wire into `vercel.json` crons.
7. **Contract:** once the demo org is verified in production, delete the
   fixture fallbacks from all ~20 routes and the `?demo=true` propagation;
   keep `data/demo-fixtures.ts` only as the seed source. Rewrite
   `e2e/demo.spec.ts` expectations.

Steps 1–4 ship behind the scenes with zero user-visible change; step 5 flips
the experience; step 7 is pure deletion.

## 7. Where mocks remain the right tool

- **E2E / component tests:** Playwright route interception stays — tests need
  determinism, speed, and no network. (Drift there is mitigated by also
  running a small seeded-org smoke suite.)
- **Local frontend development** without a Supabase instance, if that
  workflow matters to contributors.
- **Failure-mode and edge-case demos** (forcing 500s, empty states, huge
  datasets) that are awkward to seed.
- **Offline demos** (sales on a plane) and **load testing**, where hitting
  the real database is impossible or undesirable.

The dividing line: mocks for *testing and development isolation*, the demo
org for *anything a user sees*.

## 8. Implementation status

The plan in §6 is implemented. Map of the moving parts:

| Piece | Where |
| --- | --- |
| Migration (is_demo flag, demo org row, `reset_demo_org()`) | `supabase/migrations/0006_demo_org.sql` |
| Demo org constants + side-effect guard helper | `lib/demo-org.ts` (`DEMO_ORG_ID`, `isDemoOrgId`, `DEMO_MANAGER_EMAIL`) |
| Seed (rolling window, all features) | `lib/demo-seed.ts`, sourcing `data/demo-fixtures.ts` |
| Session entry (anonymous sign-in + membership) | `POST /api/demo/start`, called by `components/TryDemoButton.tsx` |
| Nightly reset + reseed + anonymous-user purge | `GET /api/cron/demo-reset` (08:00 UTC via `vercel.json`) |
| `isDemo` plumbing | `OrgContext` → `/api/me` → `AppDataContext.me.isDemo` → banners |
| Side-effect guards | `lib/notify.ts` (no push), `app/api/invites` (blocked), `app/api/schedules` DELETE (no email), `app/api/cron/reminders` (skips demo orgs), `app/api/push/subscribe` (no anonymous users) |
| Abuse guards | `app/api/employees` PATCH (no linking arbitrary user ids in demo), `app/api/managers/[userId]` (promote only demo members) |
| Contract | All fixture fallbacks removed; unauthenticated API access now returns 401 |
| E2E | `?demo=true` server bypass replaced by `E2E_BYPASS_AUTH=1` set in `playwright.config.ts` webServer env |

### Deployment runbook

1. **Enable anonymous sign-ins** in Supabase: Dashboard → Authentication →
   Sign In / Up → "Allow anonymous sign-ins". Without this,
   `POST /api/demo/start` returns 503 and the "View Demo" button surfaces
   "Demo is unavailable right now".
1a. **(Recommended) Bot gate**: create a Cloudflare Turnstile widget
   (Cloudflare dashboard → Turnstile → Add widget, hostname = the app's
   domain — the apex covers subdomains — "Managed" mode). The gate protects
   the two abusable auth paths that mint new `auth.users` rows: the demo
   entry point (`signInAnonymously`, throwaway anonymous users with no email
   step) and signup (`signInWithOtp` with `shouldCreateUser: true`, which
   also fires a verification email to an arbitrary address). The login flow
   is left ungated — it only emails existing users (`shouldCreateUser:
   false`), so Supabase's built-in email rate limits are friction enough.

   Verification is **route-level**: set both
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in Vercel.
   `/api/demo/start` and `/api/auth/signup-otp` each verify the token against
   siteverify themselves (the signup OTP is sent from the server so the gate
   runs before any email goes out). Leave Supabase's Auth CAPTCHA protection
   **off** — enabling it would force a token on *every* auth endpoint (login
   included), which is the all-or-nothing behavior this setup intentionally
   avoids. With no keys set the gate is off; local dev and e2e need no
   configuration. The self-heal path for existing anonymous sessions is
   always exempt (no new auth user is minted).
2. **Apply the migration**: run `supabase/migrations/0006_demo_org.sql`
   (after 0001–0005) in the SQL editor or via the Supabase CLI.
3. **Seeding is automatic**: the first `POST /api/demo/start` against an
   empty demo org seeds it (guarded by an `app_settings` mutex row so
   concurrent first visitors can't double-seed). To force a reset/reseed on
   demand:
   `curl -H "x-cron-secret: $CRON_SECRET" https://<site>/api/cron/demo-reset`
   — it returns `{ employees, schedules, punches, deletedUsers }` counts.
4. **Deploy**: `vercel.json` already schedules the nightly reset at 08:00 UTC
   (≈3–4 AM ET); confirm the cron is registered in the Vercel dashboard and
   that `CRON_SECRET` is set.
5. Verify: landing page → "View Demo" → dashboard renders the seeded roster
   with the "Demo Mode · Sample data resets nightly" banner; creating a shift
   persists; `/api/invites` returns 403 inside the demo org.
