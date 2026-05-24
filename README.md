# ShiftView

A mobile-first shift dashboard for retail and hospitality managers — see who's in, who's next, and whether coverage is on track, all at a glance.

![Test](https://github.com/samuel-burke/shift-dashboard/actions/workflows/test.yml/badge.svg?branch=dev)

## Features

- **Live coverage status** — real-time indicator of whether staffing is optimal, low, or critical
- **Coverage timeline** — area chart showing staff count across the full operating day
- **Shift cards** — sorted list of scheduled employees with shift type, times, and "Here" badge for who's currently on shift
- **Arrival countdown** — shows how long until the next employee's shift starts
- **Date navigation** — swipe or tap to browse past and future schedules
- **Pull to refresh** — drag down on mobile to fetch the latest data
- **Employee drawer** — tap any employee for a detail sheet with start/end times and shift type
- **Demo mode** — try the app without an account at `/?demo=true`
- **Auth** — sign in via Supabase to view live schedule data

## Tech Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database / Auth | Supabase |
| Charts | Recharts |
| Animation | Framer Motion |
| Testing | Vitest + React Testing Library |

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
```

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To use demo mode without an account, visit [http://localhost:3000?demo=true](http://localhost:3000?demo=true).

## Running Tests

```bash
npm test          # single run
npm run test:watch  # watch mode
```

57 smoke tests covering utility functions and all UI components.

## Project Structure

```
app/
  api/
    employees/    # GET /api/employees
    schedules/    # GET /api/schedules?date=YYYY-MM-DD
  login/          # sign-in page
  page.tsx        # server entry, wraps pageClient in Suspense
  pageClient.tsx  # main dashboard client component
components/
  CoverageHeader.tsx    # date nav, stat cards, coverage alert
  CoverageTimeline.tsx  # recharts area chart
  EmployeeDrawer.tsx    # bottom sheet employee detail
  ShiftCard.tsx         # individual employee row
  TeamSection.tsx       # grouped list of shift cards
data/
  types.ts        # shared types and pure utility functions
lib/
  supabase-browser.ts
  supabase-server.ts
```

## Database Schema

The app expects two sets of tables in Supabase — live tables (`employees`, `schedules`) used when a user is signed in, and read-only demo tables (`employees_demo`, `schedules_demo`) used in demo mode.

| Table | Columns |
|---|---|
| `employees` / `employees_demo` | `id`, `name`, `avatar` |
| `schedules` / `schedules_demo` | `id`, `employee_id`, `date`, `start_minutes`, `end_minutes` |

Times are stored as minutes since midnight (e.g. `480` = 8:00 AM).
