# Architecture

ShiftView is one Next.js application backed by one Supabase project. This page is the map: components, data flow and trust boundaries. Details live in the linked docs. The README's [Architecture](../README.md#architecture) section lists the key design decisions.

## Components

```
Browser (React 19 PWA, service worker)          untrusted
   │  session cookie + anon key
   ▼
Vercel: Next.js 16 app                          trusted server
   ├── proxy.ts            page auth redirect (API routes authenticate themselves)
   ├── app/**/page.tsx     server-rendered pages, client components
   ├── app/api/**          route handlers: auth, org scoping, validation, business rules, audit log
   └── app/api/cron/**     scheduled jobs (vercel.json crons), require CRON_SECRET
   │
   ├──► Supabase Postgres  RLS on every tenant table, SECURITY DEFINER RPCs, triggers
   ├──► Supabase Auth      email codes, invites, anonymous demo sessions, CAPTCHA
   ├──► Supabase Realtime  live schedule and message updates (browser subscribes directly, RLS applies)
   ├──► Web Push (VAPID)   notifications
   ├──► Resend             contact form and low-coverage emails
   ├──► Cloudflare Turnstile  bot checks on demo, sign-up, login, contact
   └──► Slack webhook      operator alerts (no names, emails or message text)
```

Code layout: `app/` (pages and API routes), `components/`, `hooks/`, `lib/` (domain rules and server helpers, for example `lib/scheduler/`, `lib/geo-validation.ts`, `lib/production-env.ts`), `supabase/` (baseline schema, migrations, SQL tests), `e2e/` (Playwright).

## Trust boundaries

1. **Browser → API.** Everything from the browser is untrusted. Route handlers call `getOrgContext()` or `requireManager()`, which resolve the caller's organization only from their own memberships, then validate input and scope every query by `org_id`.
2. **Browser → Supabase directly.** The browser holds the anon key and the user's session, so it can call PostgREST and Realtime without the API. Row Level Security enforces the same tenant and role rules as the API, so this path can't do more than the API allows. See [MULTI_TENANCY.md](MULTI_TENANCY.md).
3. **Service role.** `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is used only on the server, after the route has checked the caller (invites, sign-up, demo, cron, notifications, audit log, account deletion).
4. **Cron.** `/api/cron/*` require `CRON_SECRET` and return 401 without it.
5. **Test-only bypass.** `E2E_BYPASS_AUTH=1` skips page auth for Playwright. It is ignored on Vercel (`lib/e2e-bypass.ts`) and fails a production build (`lib/production-env.ts`).

## Data

- Every tenant row carries `org_id`; composite foreign keys keep a child row in its parent's organization.
- Times are minutes since midnight in the store's timezone (`app_settings.timezone`); dates are `YYYY-MM-DD` strings.
- Message bodies are encrypted at rest (AES-256-GCM, `MESSAGE_ENCRYPTION_KEY`). Notification previews are not.
- Clock punches can carry device coordinates, checked against the store geofence (`lib/geo-validation.ts`).

## Environments

| Environment | App | Database |
| --- | --- | --- |
| Local | `npm run dev` | Developer's own Supabase project (never production) |
| CI | GitHub Actions | Throwaway Postgres 17 service for SQL tests; E2E mocks every `/api/*` call |
| Preview / dev | Vercel preview deployments | **Not verified.** See [ci-cd.md](ci-cd.md#open-questions) |
| Production | Vercel production (shiftview.app), from `main` | Supabase production project |

## Failure modes worth knowing

- A missing production secret fails the Vercel production build, so the previous deployment stays live.
- A migration marked **DEPLOY THE APP FIRST** run before its code is live breaks the running app.
- Losing `MESSAGE_ENCRYPTION_KEY` makes stored messages unreadable.

## Related docs

[REQUIREMENTS.md](REQUIREMENTS.md) (functional spec), [MULTI_TENANCY.md](MULTI_TENANCY.md), [AUTO_SCHEDULER.md](AUTO_SCHEDULER.md), [DEMO_ORG.md](DEMO_ORG.md), [testing.md](testing.md), [ci-cd.md](ci-cd.md), [adr/](adr/).
