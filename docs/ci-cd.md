# CI/CD and releases

How code gets from a task branch to shiftview.app, and what is verified versus still to be configured. Status words follow [AGENTS.md](../AGENTS.md) section 12. Last checked 2026-10-26.

## Decisions

- **Artifact:** a Next.js 16 server application (not a package; nothing is published to a registry).
- **CI:** GitHub Actions, `.github/workflows/test.yml` (workflow name `CI`) and `.github/workflows/branch-flow.yml`.
- **Hosting:** Vercel, already in use (`vercel.json` crons and region, `@vercel/analytics`, `lib/production-env.ts` checks `VERCEL_ENV`). See [ADR 0001](adr/0001-deployment-platform.md) for why it stays.
- **Single deploy controller:** Vercel's Git integration. GitHub Actions never deploys the app. Do not add a deploy job or a second Vercel project for the same repository.
- **Database changes** are not deployed by the app. The `Migrate database` workflow (`.github/workflows/migrate.yml`) is the one migration controller: when Vercel reports the `main` production deployment as successful, it runs `supabase db push`, which applies the migrations production's history doesn't have yet, in timestamp order. Automatic runs are off until the repository variable `SUPABASE_AUTO_MIGRATE` is `true`; until then (and for the one-time cutover in the README) migrations are applied with the Supabase CLI by hand, never pasted into the SQL editor.

## Branch to environment mapping

| Source | Required checks | Target | Secrets / data | Promotion |
| --- | --- | --- | --- | --- |
| Task PR into `dev` | All CI jobs below | Vercel preview deployment per PR (**expected, not verified**) | Must not use production secrets or the production database (**not verified**) | Owner review, then merge into `dev` |
| `dev` | CI on push | Vercel preview of the `dev` branch (**not verified**) | Staging values only (**no isolated staging database exists yet**) | Release PR `dev` → `main` |
| Release PR `dev` → `main` (#195 today) | All CI jobs + `Validate branch flow` | — | — | Owner approval and merge |
| `main` | CI on push | **Vercel production, shiftview.app** (assumed automatic on merge; **not verified**) | Production | Merging is the deploy |
| `hotfix/*` → `main` | All CI jobs; label `emergency-hotfix` | Production on merge | Production | Owner exception only; then PR back into `dev` |

**Merging into `main` should be treated as deploying to production.** Confirm in Vercel → Project → Settings → Git that the production branch is `main`, and treat every release merge as needing explicit owner approval.

## CI jobs (the status checks)

| Check name | What it runs | Required on `dev` and `main`? |
| --- | --- | --- |
| `static-checks` | `npm run lint`, `npm run typecheck` | Yes |
| `unit` | `npm run test:coverage` (fails below the coverage floor), uploads `coverage/` | Yes |
| `unit-timezones (Pacific/Kiritimati)`, `unit-timezones (America/St_Johns)` | `npm test` with `TZ` set | Yes |
| `security` | `npm run test:sql` on Postgres 17, `npm run test:security` | Yes |
| `e2e` | `npm run build`, Playwright on five device projects | Yes |
| `dependency-audit` | `npm audit --omit=dev --audit-level=high` | Yes |
| `Validate branch flow` | `.github/workflows/branch-flow.yml` and `.github/scripts/branch-flow.mjs`, both from the base branch (`pull_request_target`) | Yes |
| `Vercel` (deployment status, from the Vercel app) | Preview deployment | Optional; useful once previews are isolated |

All jobs use `permissions: contents: read`, and no job receives deployment or database secrets. The `test.yml` jobs install with `npm ci` from the committed lockfile on Node 22. `branch-flow.yml` installs nothing: it checks out only `.github/scripts` from the base branch and runs the script with the runner's `node`. It is the only workflow on `pull_request_target`, so that a PR can't edit its own branch check, and it never checks out PR code. Because the workflow is read from the base branch, `Validate branch flow` first runs on PRs into `dev` after it merges there, and on PRs into `main` after the next release reaches `main`. A newer push to a PR cancels its older run; pushes to `dev` and `main` are never cancelled.

The check names above are the job names GitHub reports. Confirm them on the first PR run before adding them as required checks; a matrix job reports one check per matrix value.

## Release process

1. Every task PR into `dev` adds its line to the release PR's body and to `CHANGELOG.md` under `Unreleased`, and lists any new migration under "Before release".
2. When `dev` is ready, a `chore/release-…` PR into `dev` moves `Unreleased` into a version section (and bumps `package.json` `version` if versioning is adopted).
3. The release PR (`dev` → `main`) is filled in using the template's release section: included PRs, migrations and their order, CI run on the release commit, preview checks, rollback.
4. The owner approves and merges. Vercel builds `main` for production.
5. As soon as the production deployment is Ready, the `Migrate database` workflow applies the release's migrations (`supabase db push`). Check that its run on the merge commit succeeded; `supabase migration list` in its log shows nothing pending.
6. Verify the deployment: the Vercel production deployment shows the merge commit SHA and state Ready, run the smoke test below, and run `supabase/schema-fingerprint.sql` (read-only) to confirm production matches the repository.

Migrations run about a minute after the new app goes live, so write them to work with both app versions: add tables, columns and functions in one release and remove the old ones in a later release (expand → contract). A migration that can't, such as one that revokes access the old app still uses while the new app needs objects it adds, says **DEPLOY WITH THE APP** in its header, and the release PR calls out the short window between the deploy and the migration where the affected feature errors.
7. Tag the release (`vX.Y.Z`) on the merge commit once versioning is adopted.

### Post-deploy smoke test (manual for now)

On https://shiftview.app: the landing page loads; **Open the live demo** signs in to the Demo organization; the dashboard, Week and Clock pages load without errors; a sign-in code email arrives for a test account. Check Vercel runtime errors and the Slack alert channel for failures in the hour after the deploy.

### Rollback

- **App:** Vercel instant rollback to the previous production deployment (Deployments → previous → Promote / Instant Rollback), then revert the merge on a `fix/` branch through `dev`, or use the hotfix path.
- **Database:** migrations are forward-only. Each release that ships a migration must say in the release PR how to undo it or why it is safe to leave in place with the previous app version (expand → contract keeps the old app working).

## Monitoring

Vercel runtime logs and errors, Vercel Speed Insights and Web Analytics, Supabase logs and advisors, and Slack operator alerts for failed sign-ups and cron jobs. There is no uptime monitor or error-tracking service configured.

## Verification record

| Gate | Result | Evidence |
| --- | --- | --- |
| CI definition in an active location, using the repo's real scripts | PASS | `.github/workflows/test.yml`, `.github/workflows/branch-flow.yml` |
| CI execution on the current `dev` commit | PASS | Run 40228029040, `dev` at `c4d5027`, success (2026-10-25) |
| CI execution on the current `main` commit | PASS | Run 39084927151, `main` at `d904f8d`, success (2026-10-18) |
| CI execution of this setup's new jobs | NOT RUN | Needs a pushed branch and PR |
| Branch protection / rulesets on `dev` and `main` | FAIL | GitHub's branch API reports `protected: false` for both. Needs owner setup |
| README badges | NOT RUN | URLs point at the real workflow, and the workflow has runs on both branches; the badge images could not be loaded from this environment |
| Vercel production branch is `main` and merge auto-deploys | NOT RUN | Vercel API access to the team was refused; owner to confirm |
| Preview deployments isolated from production secrets and data | NOT RUN | Owner to check Vercel env var scopes (Production vs Preview) |
| Staging environment for `dev` | N/A today | No isolated staging Supabase project exists. Recommended below |
| Production smoke test, monitoring, rollback rehearsal | NOT RUN | Done at the next release |

## Open questions

1. Which Supabase project do Vercel **Preview** deployments use? If Preview has the production `SUPABASE_SERVICE_ROLE_KEY` and URL, every PR preview can write to production. Recommended: a separate Supabase project (or Supabase branching) for Preview, with its own keys, and Preview-scoped values for every secret in `.env.example`.
2. Is "Deployment Protection" or a manual promotion step wanted for production, or is merge-to-deploy acceptable? Merge-to-deploy is fine for a solo project if `main` is protected and the release PR is reviewed.
3. Should releases be versioned and tagged (`v0.2.0`, …)? Recommended, starting with the #195 release.
