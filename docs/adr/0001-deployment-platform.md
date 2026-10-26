# ADR 0001: Keep Vercel with its Git integration as the only deploy mechanism

- **Status:** Proposed (needs owner confirmation)
- **Date:** 2026-10-26

## Context

ShiftView is a Next.js 16 app with server route handlers, scheduled jobs and a Supabase backend. It is already deployed on Vercel: `vercel.json` defines the region (`iad1`) and two cron jobs, the app uses `@vercel/analytics` and `@vercel/speed-insights`, and `lib/production-env.ts` fails a build when `VERCEL_ENV=production` and a required secret is missing. The project's engineering policy says not to assume a provider, so this records whether to keep it.

## Options

1. **Keep Vercel, deploy through its Git integration.** Native Next.js support, per-PR previews, instant rollback, crons already configured. Lock-in to Vercel crons and analytics; cost grows with traffic.
2. **Vercel, deploy from GitHub Actions** (`vercel deploy --prebuilt`). Lets CI gate production on its own checks, but needs a Vercel token in GitHub secrets and must turn off the Git integration to avoid two deploy triggers.
3. **Move to another host** (a container on Fly.io/Render, or self-hosted Node). More control, but cron, previews, TLS and rollback have to be rebuilt, and nothing in the owner's constraints asks for it.

## Decision (proposed)

Option 1. Vercel's Git integration is the single deploy controller: preview deployments for PRs and `dev`, production from `main`. GitHub Actions only tests. Branch protection on `main` with required CI checks is what gates production, since merging is the deploy.

## Consequences

- Merging into `main` deploys to production. Release merges need explicit owner approval.
- Preview deployments must use non-production Supabase credentials; this is not verified yet ([ci-cd.md](../ci-cd.md#open-questions)).
- Rollback is Vercel instant rollback for the app; database migrations need their own plan per release.
- If CI must gate deploys directly, revisit with option 2 and remove the Git integration in the same change.
