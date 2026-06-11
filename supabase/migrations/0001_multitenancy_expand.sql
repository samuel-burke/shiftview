-- Multi-tenancy migration, phase 1 of 4: EXPAND.
--
-- Adds the organizations table and a nullable-with-default org_id column to
-- every tenant-owned table, then backfills existing rows into a "default"
-- organization. Old application code that does not send org_id keeps working
-- because the column DEFAULT fills it in — this is what makes the rollout
-- zero-downtime. Run this before deploying any org-aware application code.
--
-- Deliberately NOT org-scoped (these are per-user, not per-tenant):
--   user_notification_preferences, push_subscriptions

begin;

create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- Fixed UUID so code and later migrations can reference the default org
-- deterministically (lib/org-context.ts DEFAULT_ORG_ID must match).
insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default')
on conflict (id) do nothing;

do $$
declare
  t text;
begin
  foreach t in array array[
    'employees',
    'managers',
    'schedules',
    'availability',
    'time_off_requests',
    'punch_records',
    'store_hours',
    'app_settings',
    'messages',
    'notifications',
    'shift_swaps',
    'schedule_templates',
    'schedule_template_rows',
    'audit_logs'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists org_id uuid
         references public.organizations (id)
         default ''00000000-0000-0000-0000-000000000001''',
      t
    );
    -- Explicit backfill; a no-op when ADD COLUMN already applied the default,
    -- but covers rows inserted with an explicit NULL in between.
    execute format(
      'update public.%I set org_id = ''00000000-0000-0000-0000-000000000001''
        where org_id is null',
      t
    );
  end loop;
end $$;

-- Hot-path composite indexes (org_id first so every org-scoped filter is
-- index-assisted).
create index if not exists schedules_org_date_idx          on public.schedules (org_id, date);
create index if not exists schedules_org_employee_idx      on public.schedules (org_id, employee_id);
create index if not exists employees_org_idx               on public.employees (org_id);
create index if not exists employees_org_user_idx          on public.employees (org_id, user_id);
create index if not exists managers_org_user_idx           on public.managers (org_id, user_id);
create index if not exists availability_org_employee_idx   on public.availability (org_id, employee_id);
create index if not exists time_off_org_date_idx           on public.time_off_requests (org_id, date);
create index if not exists punch_records_org_punched_idx   on public.punch_records (org_id, punched_at);
create index if not exists messages_org_conversation_idx   on public.messages (org_id, conversation_id);
create index if not exists notifications_org_user_idx      on public.notifications (org_id, user_id);
create index if not exists shift_swaps_org_idx             on public.shift_swaps (org_id);
create index if not exists template_rows_org_template_idx  on public.schedule_template_rows (org_id, template_id);
create index if not exists audit_logs_org_created_idx      on public.audit_logs (org_id, created_at);

commit;
