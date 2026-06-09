# ShiftView

A mobile-first shift management app for retail and hospitality teams — scheduling, time clock, coverage analytics, and team messaging in a single installable PWA.

**[shiftview.app](https://shiftview.app)** · [Try the demo](https://shiftview.app?demo=true)

![ShiftView screenshot](public/screenshot.png)

![CI](https://github.com/samuel-burke/shift-dashboard/actions/workflows/test.yml/badge.svg?branch=dev)

## Features

**Coverage dashboard**
- Live coverage status (optimal / low / critical) computed from staff counts across store hours
- Coverage timeline chart with a pulsing now-indicator, arrival countdown for the next shift
- Shift cards with shift type (opener / mid / closer) and a "Here" badge for who's clocked in

**Scheduling**
- Week and month views with drag-free editing, reusable shift templates, and copy-week
- Employee availability tracking with conflict detection against time-off and availability when scheduling
- Shift swap requests with manager approval, and time-off requests with approval workflow

**Time clock**
- Clock in/out with optional geofence enforcement (server-validated, not just client-side)
- Missed-punch detection and payroll-ready CSV exports

**Team**
- Direct messaging, encrypted at rest with AES-256-GCM
- Web push notifications with per-user preferences, plus in-app banners
- Email invites for onboarding, manager role management, and a full audit log of every mutation

**Platform**
- Installable PWA with service worker, offline-aware shell, and home-screen prompts
- Demo mode (`/?demo=true`) — the full UI backed by static fixtures, no account or database required
- Nightly shift reminders for tomorrow's schedule via a Vercel cron job

## Tech Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Database / Auth / Realtime | Supabase |
| Charts | Recharts |
| Animation | Framer Motion |
| Push | Web Push (VAPID) |
| Unit tests | Vitest + React Testing Library |
| E2E tests | Playwright |
| CI / Hosting | GitHub Actions / Vercel |

## Architecture

```
Browser (React 19, PWA + service worker)
   │
   ├── Next.js route handlers (/app/api/*)   ← auth, validation, business rules
   │      │
   │      ├── Supabase (Postgres + RLS)      ← row-level security as defense in depth
   │      ├── Web Push (VAPID)               ← notifications
   │      └── Resend                         ← invite + reminder emails
   │
   └── Supabase Realtime                     ← live schedule/message updates
```

Key design decisions:

- **API routes as the single write path.** All mutations go through route handlers that check auth, verify manager status where required, validate input, and write an audit log entry. Row Level Security on every table acts as a second, independent enforcement layer — a bug in the API layer cannot expose more than RLS allows.
- **Times are minutes since midnight** (`480` = 8:00 AM). Shifts never cross midnight in this domain, so this avoids timezone and DST edge cases entirely; dates are plain `YYYY-MM-DD` strings.
- **"Off" is derived, not stored.** Employees with no schedule row for a date are off that day — computed by diffing the roster against the day's shifts, so there's no second source of truth to keep in sync.
- **Privileged operations use a service-role client.** Tables like `managers` and the employee-invite flow are write-denied via RLS for all users; the API performs those writes with the Supabase admin client only after verifying manager status itself.
- **Demo mode is a data-layer swap.** `?demo=true` serves static fixtures from `data/demo-fixtures.ts` through the same components and API contracts, so the entire UI is explorable with zero setup.
- **Messages are encrypted at rest** with AES-256-GCM using a server-held key; the database never sees plaintext message content.

A full functional spec lives in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), and data handling is documented in [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/samuel-burke/shift-dashboard.git
cd shift-dashboard
npm install
```

### 2. Set environment variables

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Message encryption — required for the messaging feature
MESSAGE_ENCRYPTION_KEY=your_64_char_hex_key
```

Generate a key with:

```bash
openssl rand -hex 32
```

> Keep this key secret and back it up securely. Messages are encrypted with AES-256-GCM before being stored in the database. If the key is lost, existing messages cannot be decrypted. When deploying (e.g. Vercel), set `MESSAGE_ENCRYPTION_KEY` as an environment variable in your project settings.

Optional variables enable additional features:

| Variable | Enables |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Manager role management and the employee invite flow |
| `RESEND_API_KEY` | Invite emails (via Resend) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push notifications |
| `CRON_SECRET` | Nightly shift-reminder cron endpoint |
| `NEXT_PUBLIC_SITE_URL` | Absolute URLs in emails and auth redirects |

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To use demo mode without an account, visit [http://localhost:3000?demo=true](http://localhost:3000?demo=true).

> The live app is deployed at [shiftview.app](https://shiftview.app). Try the demo at [shiftview.app?demo=true](https://shiftview.app?demo=true).

## Testing & Quality

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest unit/integration tests
npm run test:watch  # watch mode
npm run test:e2e    # Playwright e2e (demo mode, no backend needed)
```

API route handlers are tested directly against mocked Supabase clients, components with React Testing Library, and the demo-mode user flows end-to-end with Playwright. CI runs lint, typecheck, unit, and e2e suites on every push and pull request.

## Project Structure

```
app/
  api/            # route handlers: schedules, swaps, time-off, punches,
                  # templates, messages, notifications, reports, invites, …
  clock/          # time clock (geofenced punch in/out)
  schedule/       # week/month schedule editor
  reports/        # payroll + coverage reports, CSV export
  settings/       # store hours, geofence, notifications, team management
  pageClient.tsx  # coverage dashboard (home)
components/       # UI components (one concern per file, co-located tests)
data/
  types.ts        # shared domain types + pure schedule/coverage utilities
  demo-fixtures.ts# static data backing demo mode
lib/              # Supabase clients, encryption, audit log, web push, payroll
e2e/              # Playwright specs
docs/             # functional requirements spec
```

## Scheduled Tasks

`vercel.json` defines a nightly cron (`/api/cron/reminders`, 22:00 UTC) that sends each scheduled employee a push reminder of tomorrow's shift, honoring per-user notification preferences. The endpoint is protected by an `x-cron-secret` header checked against `CRON_SECRET`.

## Database Schema

| Table | Columns |
|---|---|
| `employees` | `id`, `name`, `email`, `user_id` |
| `schedules` | `id`, `employee_id`, `date`, `start_minutes`, `end_minutes` |
| `store_hours` | `day_of_week` (0–6), `open_minutes`, `close_minutes` |
| `managers` | `user_id` |

Times are stored as minutes since midnight (e.g. `480` = 8:00 AM). Employees who are off on a given day have no row in `schedules` — they are derived by diffing the employee roster against that day's scheduled shifts.

> Demo mode (`?demo=true`) does not connect to Supabase at all — it uses static in-app fixtures from `data/demo-fixtures.ts`.

## Row Level Security

RLS is enabled on all live tables. The following policies are in effect:

| Table | Operation | Allowed |
|---|---|---|
| `employees` | SELECT | Authenticated users |
| `employees` | INSERT | Denied for all (managed via service role) |
| `employees` | UPDATE / DELETE | Users with a row in `managers` |
| `schedules` | SELECT | Authenticated users |
| `schedules` | INSERT / UPDATE / DELETE | Users with a row in `managers` |
| `managers` | SELECT | Authenticated users |
| `managers` | INSERT / UPDATE / DELETE | Denied for all (managed via service role) |
| `store_hours` | SELECT | All users (including unauthenticated) |
| `store_hours` | INSERT / UPDATE / DELETE | Users with a row in `managers` |
| `app_settings` | SELECT | All users (including unauthenticated) |
| `app_settings` | INSERT / UPDATE / DELETE | Users with a row in `managers` |

> Demo mode (`?demo=true`) does not connect to Supabase at all — no RLS policies apply.

**Notes**

- The `managers` table is intentionally write-protected via RLS. The application uses a service-role admin client (bypassing RLS) for all `managers` mutations after verifying manager status at the API layer.
- The `employees` INSERT path similarly uses the service-role admin client so the invite flow can create the employee row and send an auth invite atomically.
