<!-- PRs target dev. Only the release PR (dev -> main) or an owner-approved, labeled hotfix/* targets main. See AGENTS.md and CONTRIBUTING.md. -->

## Why

Closes #

## What changed

<!-- User-visible behavior and key implementation changes. Say what is out of scope. Screenshots for UI changes. -->

## Type

- [ ] Feature / fix / maintenance -> `dev`
- [ ] Release: `dev` -> `main`
- [ ] Owner-approved emergency hotfix: `hotfix/*` -> `main` (label `emergency-hotfix`)

## Verification (AGENTS.md section 12, run against the final commit)

**Status:** VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / BLOCKED

| Acceptance criterion | Verification performed | Result (PASS / FAIL / NOT RUN / N/A) |
| --- | --- | --- |
| | | |

| Check | Command or CI job | Result | Notes |
| --- | --- | --- | --- |
| Lint + typecheck | `npm run lint`, `npm run typecheck` / `static-checks` | | |
| Unit + coverage floor | `npm run test:coverage` / `unit` | | lines / branches: |
| Unit in far-off time zones | `unit-timezones` | | |
| Security (SQL + `*.security.test.ts`) | `npm run test:sql`, `npm run test:security` / `security` | | |
| E2E + production build | `npm run build && npm run test:e2e` / `e2e` | | |
| Dependency audit | `npm audit --omit=dev --audit-level=high` / `dependency-audit` | | |
| Branch flow | `Validate branch flow` | | |
| Real browser / manual check | | | |
| Vercel preview smoke test | | | |

- Regression test for a bug fix (fails before, passes after):
- Checks not run, and why:

## Risk

- Auth, roles, org isolation (RLS), punches/geofence:
- Database migration (does it say DEPLOY THE APP FIRST?), API compatibility:
- New environment variables or secrets:
- Privacy: new personal data, vendors or retention changes (update the privacy policy before release?):

## Docs

- [ ] README / docs / `.env.example` updated if setup or behavior changed
- [ ] `CHANGELOG.md` `Unreleased` entry added (user-visible changes)
- [ ] No secrets, real personal data or unrelated changes in the diff

## Release details (`dev` -> `main` only)

- Version / tag:
- Changelog (moved from `Unreleased`):
- Included PRs:
- Migrations to run, in order, and whether each needs the app deployed first:
- Breaking changes:
- CI run on the release commit:
- Preview / staging verification:
- Deployment: merging into `main` triggers a Vercel production deployment (confirm current Vercel settings before merging)
- Post-deploy smoke test and monitoring:
- Rollback (Vercel instant rollback to the previous deployment; database rollback plan per migration):
- Known issues:

## Approvals

- [ ] Diff self-reviewed
- [ ] All required checks green on the final commit
- [ ] Owner approval before merge; no merge or deploy without it
