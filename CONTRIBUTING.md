# Contributing to ShiftView

ShiftView has one maintainer. This guide is for anyone (person or AI agent) making changes. The full engineering policy is [AGENTS.md](AGENTS.md); where this guide is shorter, AGENTS.md wins.

## Set up

1. Node.js 22 and npm. Install with `npm ci`.
2. Copy `.env.example` to `.env.local` and fill in values for a **non-production** Supabase project. See [README → Getting Started](README.md#getting-started).
3. `npm run dev`, then open http://localhost:3000.

Never point a local or test run at the production database.

## Branches

| Branch | Role |
| --- | --- |
| `main` | Production. Changes arrive only through the release PR from `dev`, or an owner-approved `hotfix/*` PR (below). |
| `dev` | Integration. Every task PR targets `dev`. |
| `feat/…`, `fix/…` (or `bug/…`), `chore/…`, `docs/…`, `refactor/…`, `test/…`, `ci/…`, `perf/…` | Short-lived task branches cut from `dev`. |
| `hotfix/…` | Only with the owner's approval for an urgent production fix: PR into `main` with the `emergency-hotfix` label, then back into `dev`. |

Use lowercase names, for example `fix/geofence-coordinate-validation`. The **Branch flow** check rejects other prefixes and any PR into `main` that isn't from `dev`.

Never push directly to `main` or `dev`, never force-push them, and never merge or deploy without the owner's approval.

## Making a change

1. Open (or find) a GitHub issue that says what should happen and how you'll know it works.
2. `git fetch origin && git switch -c feat/short-name origin/dev`
3. Make the smallest change that meets the acceptance criteria, with tests at the right layer ([docs/testing.md](docs/testing.md)).
4. Run the checks below on your final code.
5. Add a line to `CHANGELOG.md` under `Unreleased` for user-visible changes.
6. Open a PR into `dev` using the template. Its body says `Closes #N`; the issue closes when the PR merges into `dev`.

Commits: clear messages, Conventional Commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`) where they fit.

## Checks to run before a PR

```bash
npm run lint
npm run typecheck
npm run test:coverage          # unit + route-handler tests, fails below the coverage floor
npm run test:security          # *.security.test.ts
npm run test:sql               # needs a local Postgres: PGHOST, PGUSER, PGPASSWORD
npm run build && npm run test:e2e
```

CI runs all of these on every PR (see [docs/ci-cd.md](docs/ci-cd.md)). Report each one as PASS, FAIL, NOT RUN or N/A in the PR. A failing or skipped required check means the PR isn't ready. Don't skip, loosen or delete tests to get green.

## Security-sensitive changes

Changes to auth, roles, organization isolation, RLS policies, RPCs, punches/geofencing, secrets or migrations need negative tests: a `*.security.test.ts` file or a SQL suite in `supabase/manual-tests/` showing that a user in one organization can't read or change another's data. Add a short risk note to the PR.

Database migrations go in `supabase/migrations/`. Check the header rules in the README ("DEPLOY THE APP FIRST") and add each new migration to `supabase/manual-tests/baseline.test.sql`.

## Reporting problems

- Bugs and ideas: GitHub issues, using the templates. Use demo or made-up data only.
- Security vulnerabilities: **privately**, as described in [SECURITY.md](SECURITY.md). Never in a public issue or PR.
