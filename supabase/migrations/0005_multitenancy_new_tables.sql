-- Multi-tenancy: add org_id to tables introduced by dev after the initial
-- multi-tenancy expand (0001). Run after 0001 and after dev's own migrations
-- (2026-06-10-coverage-profiles.sql, 2026-06-10-draft-schedules.sql).

begin;

-- 1. coverage_profiles: name is globally unique today; make it per-org.
alter table public.coverage_profiles
  add column if not exists org_id uuid
    references public.organizations (id)
    default '00000000-0000-0000-0000-000000000001';
update public.coverage_profiles set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.coverage_profiles alter column org_id set not null;
alter table public.coverage_profiles drop constraint if exists coverage_profiles_name_key;
alter table public.coverage_profiles add constraint coverage_profiles_org_name_unique unique (org_id, name);

-- 2. coverage_profile_blocks: accessed only via profile_id FK; add org_id for
--    RLS and direct scoping consistency.
alter table public.coverage_profile_blocks
  add column if not exists org_id uuid
    references public.organizations (id)
    default '00000000-0000-0000-0000-000000000001';
update public.coverage_profile_blocks set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.coverage_profile_blocks alter column org_id set not null;

-- 3. coverage_day_defaults: day_of_week is the old PK; re-key per-org.
alter table public.coverage_day_defaults
  add column if not exists org_id uuid
    references public.organizations (id)
    default '00000000-0000-0000-0000-000000000001';
update public.coverage_day_defaults set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.coverage_day_defaults alter column org_id set not null;
alter table public.coverage_day_defaults drop constraint if exists coverage_day_defaults_pkey;
alter table public.coverage_day_defaults add primary key (org_id, day_of_week);

-- 4. coverage_date_overrides: date is the old PK; re-key per-org.
alter table public.coverage_date_overrides
  add column if not exists org_id uuid
    references public.organizations (id)
    default '00000000-0000-0000-0000-000000000001';
update public.coverage_date_overrides set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.coverage_date_overrides alter column org_id set not null;
alter table public.coverage_date_overrides drop constraint if exists coverage_date_overrides_pkey;
alter table public.coverage_date_overrides add primary key (org_id, date);

-- 5. draft_schedules: unique was (employee_id, date); make it per-org.
alter table public.draft_schedules
  add column if not exists org_id uuid
    references public.organizations (id)
    default '00000000-0000-0000-0000-000000000001';
update public.draft_schedules set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.draft_schedules alter column org_id set not null;
alter table public.draft_schedules drop constraint if exists draft_schedules_employee_id_date_key;
alter table public.draft_schedules add constraint draft_schedules_org_employee_date_unique
  unique (org_id, employee_id, date);
alter table public.draft_schedules
  add constraint draft_schedules_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id);

-- Indexes
create index if not exists coverage_profiles_org_idx         on public.coverage_profiles (org_id);
create index if not exists coverage_profile_blocks_org_idx   on public.coverage_profile_blocks (org_id, profile_id);
create index if not exists coverage_day_defaults_org_idx     on public.coverage_day_defaults (org_id);
create index if not exists coverage_date_overrides_org_idx   on public.coverage_date_overrides (org_id);
create index if not exists draft_schedules_org_date_idx      on public.draft_schedules (org_id, date);

-- Replace old single-tenant RLS policies with org-aware ones.
do $$
declare t text;
begin
  foreach t in array array[
    'coverage_profiles', 'coverage_profile_blocks',
    'coverage_day_defaults', 'coverage_date_overrides', 'draft_schedules'
  ]
  loop
    execute format('drop policy if exists "Authenticated read" on public.%I', t);
    execute format('drop policy if exists "Managers insert" on public.%I', t);
    execute format('drop policy if exists "Managers update" on public.%I', t);
    execute format('drop policy if exists "Managers delete" on public.%I', t);
    execute format('drop policy if exists "Managers manage draft schedules" on public.%I', t);
    execute format('create policy mt_select on public.%I for select using (public.is_org_member(org_id))', t);
    execute format('create policy mt_insert on public.%I for insert with check (public.is_org_manager(org_id))', t);
    execute format('create policy mt_update on public.%I for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id))', t);
    execute format('create policy mt_delete on public.%I for delete using (public.is_org_manager(org_id))', t);
  end loop;
end $$;

commit;
