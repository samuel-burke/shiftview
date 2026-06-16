# Multi-Tenancy Architecture

This document describes how ShiftView was converted from a single-organization
app to a multi-tenant one, why the chosen pattern was selected, and how to roll
the migration out without downtime.

## 1. Architecture pattern: shared database, shared schema, `org_id` + RLS

Three patterns were considered:

| Pattern | Pros | Cons |
| --- | --- | --- |
| **Shared DB, shared schema, `org_id` column (chosen)** | One migration path; works with Supabase auth/PostgREST/realtime out of the box; cheap per-tenant cost; cross-tenant analytics trivial; RLS gives DB-enforced isolation | Isolation is logical, not physical; every query must be scoped (mitigated by RLS + helpers); noisy-neighbor risk at very large scale |
| Shared DB, schema-per-tenant | Stronger logical separation; per-tenant restore is easier | Supabase PostgREST works against one schema by default; migrations × N schemas; connection/search_path juggling; tooling (types, tests) multiplies |
| Database-per-tenant | Strongest isolation; per-tenant scaling/backup | One Supabase project per tenant (cost, provisioning automation); auth is per-project so cross-org users break; massive operational overhead for a small app |

For a Supabase app of this size, **shared schema + `org_id` + Row Level
Security** is the clear fit: Postgres RLS provides hard, database-enforced
isolation while keeping a single deployment and a single migration history.
Schema-per-tenant or DB-per-tenant only start paying for themselves with
strict compliance requirements (data residency, per-tenant encryption keys)
or tenants large enough to need dedicated capacity.

## 2. Database migration plan

Migrations live in `supabase/migrations/` and follow the
**expand → backfill → enforce → contract** pattern:

| File | Phase | What it does | Safe to run while old code is live? |
| --- | --- | --- | --- |
| `0001_multitenancy_expand.sql` | Expand + backfill | Creates `organizations`; adds `org_id uuid REFERENCES organizations DEFAULT <default-org>` to all 14 tenant tables; backfills existing rows into a fixed default org (`00000000-…-000000000001`); adds `(org_id, …)` indexes | **Yes** — defaults keep old writes valid |
| `0002_multitenancy_enforce.sql` | Enforce | `org_id` NOT NULL; re-keys `app_settings` → `(org_id, key)`, `store_hours` → `(org_id, day_of_week)`, `managers` → `(org_id, user_id)`; **composite FKs** so a child row's org must equal its parent's (schedules→employees, punches→schedules, swaps→both, template rows→templates/employees); partial unique on `employees (org_id, user_id)` | **Yes** |
| `0003_multitenancy_rls.sql` | Enforce | `is_org_member()` / `is_org_manager()` SECURITY DEFINER helpers; enables RLS + org-scoped policies on every tenant table; replaces the `notify_*` RPCs with org-aware versions | Deploy together with org-aware app code (the RPC signatures change) |
| `0004_multitenancy_contract.sql` | Contract | Drops the `org_id` column defaults so an unscoped write fails loudly instead of landing in the default org | Only after all old code is gone |
| `0013_callouts.sql` | New table | Creates `callouts` (employee "can't make it in" notices) following the time-off shape exactly: `org_id`, composite `(employee_id, org_id)` FK, `is_org_member` member-writable RLS, `(org_id, date)` index, and Realtime publication | **Yes** — additive |

Tables deliberately **not** org-scoped: `user_notification_preferences` and
`push_subscriptions` — they are keyed to the auth user and are personal
(device subscriptions, notification toggles), not tenant data.

Key constraint decisions:

- **Backfill** is a single `UPDATE … WHERE org_id IS NULL` per table into the
  seeded default org. Because `ADD COLUMN … DEFAULT` on Postgres 11+ fills
  existing rows without rewriting the table, the expand migration is fast even
  on large tables.
- **Composite foreign keys** (`(employee_id, org_id) → employees (id, org_id)`)
  make cross-org references a constraint violation. Even a buggy service-role
  write cannot create a schedule in org A pointing at an employee in org B.
- **Composite indexes** lead with `org_id` so every scoped query stays
  index-assisted.

## 3. Authentication changes

- **User ↔ org association** reuses the existing role tables rather than
  introducing a parallel membership table: a row in `managers (org_id,
  user_id)` makes you a manager of that org; a row in `employees` with your
  `user_id` makes you a member. A user may belong to several orgs (the old
  `managers.user_id` PK was widened to `(org_id, user_id)` to allow this).
- **Current-org resolution** happens in `lib/org-context.ts`:
  `getOrgContext(supabase, request)` authenticates the user, looks up their
  memberships, and returns `{ user, orgId, isManager, employeeId }`.
  Multi-org users pin a specific org with the `x-organization-id` header
  (`ORG_HEADER`); the header is only honored if it matches one of the user's
  memberships — it selects among the user's orgs, it can never grant access.
- `requireManager(supabase, request)` now returns `{ user, orgId, error }`,
  so every manager-gated route receives its tenant scope from the same place
  it gets its authorization.

## 4. Query scoping strategy

Two layers, by design:

1. **Application layer (explicit):** every query against a tenant table is
   scoped through `lib/org-scope.ts` — `.eq("org_id", orgId)` chained directly
   after `.select()/.update()/.delete()`, and `withOrg()/withOrgAll()` stamping
   `org_id` onto every insert/upsert. `orgId` comes exclusively from
   `getOrgContext()`/`requireManager()`, never from request bodies, query
   strings, or route params.
2. **Database layer (backstop):** RLS policies guarantee that even a query
   that forgets its filter can only return rows from orgs the JWT's user
   belongs to.

The one place RLS does **not** protect is the service-role client
(`lib/supabase-admin.ts`), which bypasses RLS by definition. Rules for it:

- Reads must carry an explicit `.eq("org_id", orgId)`.
- Writes must stamp `org_id` (e.g. `lib/audit.ts` now requires `orgId`).
- The composite FKs from migration 0002 are the last line of defense here.

## 5. Code patterns

Context resolution (the "middleware" layer — in Next.js route handlers this is
a shared helper rather than literal middleware, so tests can inject mocks):

```ts
const supabase = await createClient();
const { ctx, error } = await getOrgContext(supabase, request);
if (error) return NextResponse.json({ error }, { status: error === "Not authenticated" ? 401 : 403 });
// ctx.orgId, ctx.isManager, ctx.employeeId
```

Scoped queries:

```ts
// reads / updates / deletes
const { data } = await supabase
  .from("schedules")
  .select("*")
  .eq("org_id", ctx.orgId)
  .eq("date", date);

// inserts / upserts — org_id cannot be forgotten or spoofed
await supabase.from("schedules").insert(
  withOrg(ctx.orgId, { employee_id: employeeId, date, start_minutes, end_minutes })
);

// or the repository-style accessor for simple cases
const schedules = orgTable(supabase, "schedules", ctx.orgId);
await schedules.select("id").eq("date", date);
await schedules.insert({ employee_id: employeeId, date, ... });
```

Background jobs (`app/api/cron/reminders`) have no user session, so they use
the admin client and operate **per org**: tenant rows are read with their
`org_id`, and each downstream effect (notifications, push) is invoked with the
row's own org.

## 6. Pitfalls and security risks

- **Trusting client-supplied org ids.** The org header only *selects among*
  verified memberships. Never read an org id from a request body.
- **Service-role queries.** Admin-client code bypasses RLS; every such call
  site needs explicit scoping (and a reviewer who knows that).
- **IDOR via unscoped id lookups.** `…eq("id", id)` alone lets org A mutate
  org B's row by guessing integer ids. Every id lookup also filters `org_id`;
  RLS and composite FKs back this up.
- **Cross-org joins through children.** A schedule referencing another org's
  employee leaks data through joins — prevented by the composite FKs.
- **Global unique constraints.** Old PKs (`app_settings.key`,
  `store_hours.day_of_week`, `managers.user_id`) would make the second org's
  inserts collide with the first's. All re-keyed per org.
- **Stale single-tenant RLS policies.** Old permissive policies OR together
  with new ones. Migration 0003 owns the `mt_*` policies; audit and drop any
  pre-existing ones.
- **Broadcast fan-out.** "Notify all managers" must mean *managers of this
  org* — the `notify_*` RPCs now take the org id.
- **Background jobs.** Cron has no user context; per-row org handling, never
  "first org wins".
- **The migration default.** The default-org fallback is a rollout
  convenience and becomes a data-corruption hazard once real tenants exist —
  run the contract migration (0004) promptly after cutover.
- **Caching/realtime.** Any future cache keys and realtime channel names must
  include the org id.

## 7. Phased rollout (zero downtime)

1. **Phase 0 — prep:** snapshot/backup; verify constraint names in 0002 match
   your database (default Postgres naming assumed).
2. **Phase 1 — expand (run 0001):** schema gains `org_id` everywhere with
   defaults; existing rows backfilled into the default org. Old app code keeps
   running unchanged.
3. **Phase 2 — enforce (run 0002):** NOT NULL, per-org keys, composite FKs.
   Old code still works (defaults satisfy NOT NULL; upsert conflict targets
   resolve via the new PKs once rows carry org_id — deploy quickly after this
   step).
4. **Phase 3 — deploy org-aware app + RLS (run 0003 with the deploy):** the
   RPC signature changes and the app's new `notify` calls must land together;
   this is the only coordinated step. Everything still resolves to the default
   org, so behavior is unchanged for existing users — verify isolation with a
   second test org before proceeding.
5. **Phase 4 — contract (run 0004):** drop the column defaults so unscoped
   writes fail loudly. From here, onboarding a new organization is just an
   `organizations` insert plus a manager row.
6. **Phase 5 — productize:** org sign-up/provisioning flow, org switcher UI
   for multi-org users (send `x-organization-id` from `lib/api-fetch.ts`),
   per-org realtime channel filtering, and RLS policy tightening (e.g.
   punch-record writes restricted to the row's own employee).

Rollback: phases 1–2 are additive and rollback-safe (drop constraints/columns).
After phase 3, roll back by redeploying the previous app version **and**
restoring the old `notify_*` RPC signatures; data written in the meantime is
still valid single-org data in the default org.
