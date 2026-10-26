# Testing strategy

How ShiftView is tested, what each layer proves, and the coverage baseline. The policy behind it is [AGENTS.md](../AGENTS.md) sections 4 and 12.

## Layers

| Layer | Tool and location | What it proves | Runs in CI as |
| --- | --- | --- | --- |
| Unit | Vitest, `lib/**/*.test.ts`, `components/**/*.test.tsx`, `hooks/` | Domain rules (scheduler, pay rules, time math, callout and swap rules), validation, components with React Testing Library | `unit` (with coverage), `unit-timezones` (same suite under `Pacific/Kiritimati` and `America/St_Johns`) |
| Route-handler integration | Vitest, `app/api/**/*.test.ts` | Each API route's auth checks, org scoping, validation and responses, against a mocked Supabase client | `unit` |
| Security regression (unit) | Vitest, files named `*.security.test.ts` | Auth bypass guards, production env check, CAPTCHA, email validation, push endpoints, sign-out, employee deletion | `security` |
| Database integration | `npm run test:sql`: every `supabase/manual-tests/*.test.sql` in a fresh Postgres 17 database | RLS policies, cross-organization isolation, RPC privileges, triggers, punch integrity and geofence rules, and that a new project built from `baseline.sql` plus every later migration works | `security` |
| End-to-end | Playwright, `e2e/*.spec.ts`, against a production build | Dashboard, week planner, auto-schedule, demo, responsive layouts on phone/tablet/desktop, time zones, layout stability, text contrast in light and dark | `e2e` |
| Build | `next build` | The app compiles and the production env guard runs | `e2e` (builds before testing) |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | No known high or critical advisories in production dependencies | `dependency-audit` |

### What the E2E layer does not cover

The Playwright specs mock every `/api/*` call client-side and run with `E2E_BYPASS_AUTH=1`, so they test the UI against fixed API responses. They do **not** exercise real sign-in, real route handlers or real RLS end to end. Those are covered separately by the route-handler tests and the SQL suites. A full-stack E2E run (local Supabase via `supabase start`, real sign-in, two organizations) is the main gap; see the improvement plan.

### Not applicable

- **Contract tests for third-party APIs** (Resend, Turnstile, Slack, Web Push): the integrations are thin and mocked at the HTTP boundary in unit tests. A provider contract suite isn't worth its cost yet.
- **Formatter check:** the repository has no formatter configured and ESLint is the style gate. Adding Prettier would reformat most files; that would need its own decision.
- **Package publishing tests:** nothing is published as a package.

## Coverage

Measured with `@vitest/coverage-v8` over `app/`, `components/`, `hooks/`, `lib/` and `proxy.ts` (`npm run test:coverage`). The SQL suites and Playwright runs are not included in these numbers.

Baseline, 2026-10-26, on `dev` at `c4d5027` plus this setup:

| Metric | Baseline | Floor enforced in `vitest.config.ts` | Target (AGENTS.md) |
| --- | --- | --- | --- |
| Lines | 68.86% | 68% | 85% |
| Branches | 64.17% | 64% | 80% |
| Statements | 66.57% | 66% | — |
| Functions | 56.32% | 56% | — |

By area (lines / branches): `app/api` 87.2% / 79.5%, `lib` 85.8% / 85.3%, `lib/scheduler` 98.5% / 92.7%, `components` 68.6% / 67.5%. The low areas are page clients with no component tests: `app/schedule` 2.9%, `app/reports` 0%, `app/week` 0%, `app/requests` 0%, `app/coverage` 0%, `components/marketing` 19.1%, `hooks` 45.5% / 20.4%, `proxy.ts` 0%.

The floor stops coverage from dropping. It must only go up. CI uploads the `coverage/` report as an artifact on every run; there is no coverage badge because no coverage service is configured.

### Improvement plan

1. `proxy.ts` (page auth redirect): unit tests for signed-in, signed-out and `/api/*` pass-through. Security-relevant and small.
2. `hooks/` branches (20.4%): the data-loading hooks' error and empty states.
3. Page clients with 0%: `app/week`, `app/requests`, `app/reports`, `app/schedule` component tests for loading, empty, error and permission-denied states. Playwright already covers their main paths, but not in these numbers.
4. Full-stack E2E smoke against a local Supabase: sign in, clock in, and a second organization that can't see the first one's schedule.
5. Raise the floor after each step. Target 85% lines / 80% branches overall, 90% on changed code.

## Known flaky test

`e2e/contrast.spec.ts` "/week (manager) holds text contrast … at 412px" failed once and passed on retry in a local run on 2026-10-26 (strict-mode violation: `getByText('Weekly Budget')` matched 2 elements). CI retries twice. It should get its own issue and a fix that makes the locator unambiguous, not a skip.

## Acceptance criteria for the workflow setup

| Criterion | Verification |
| --- | --- |
| PRs into `main` from anything but `dev` (or a labeled `hotfix/*`) fail | `.github/scripts/branch-flow.test.ts`, plus the `Validate branch flow` check on a real PR |
| Task branches with approved prefixes pass; unprefixed and agent-named branches fail | `.github/scripts/branch-flow.test.ts` |
| Coverage can't drop below the baseline | `npm run test:coverage` exits non-zero below the floor; `unit` job |
| Production dependencies have no high/critical advisories | `dependency-audit` job |
| `.env.example` names every required production variable and holds no values | `lib/env-example.test.ts` |
| Existing CI gates still pass | `static-checks`, `unit`, `unit-timezones`, `security`, `e2e` on the PR |
| `dev` and `main` badges show the real CI workflow | Badge images load from `actions/workflows/test.yml/badge.svg?branch=…` |
