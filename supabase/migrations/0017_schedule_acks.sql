-- Schedule acknowledgements: an employee confirming they've seen their
-- published shifts for a given week. One row per (employee, week). Managers read
-- the confirmed/pending split to chase down anyone who hasn't looked.
--
-- Mirrors the callouts multitenancy shape (0013): org_id column, composite FK so
-- a row's org_id must match its employee's org, is_org_member RLS, Realtime
-- publication, and demo-reset wiring.

begin;

create table if not exists public.schedule_acknowledgements (
  id              bigint generated always as identity primary key,
  org_id          uuid   not null references public.organizations (id),
  employee_id     bigint not null,
  week_start      date   not null,
  acknowledged_at timestamptz not null default now(),
  -- One acknowledgement per employee per week.
  unique (org_id, employee_id, week_start),
  -- An ack's org must match its employee's org.
  constraint schedule_acks_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists schedule_acks_org_week_idx     on public.schedule_acknowledgements (org_id, week_start);
create index if not exists schedule_acks_org_employee_idx on public.schedule_acknowledgements (org_id, employee_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — member-writable, identical to callouts. The API
-- restricts an employee to acknowledging only their own schedule.
-- ---------------------------------------------------------------------------
alter table public.schedule_acknowledgements enable row level security;

drop policy if exists mt_select on public.schedule_acknowledgements;
create policy mt_select on public.schedule_acknowledgements
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.schedule_acknowledgements;
create policy mt_write on public.schedule_acknowledgements
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Demo reset — clear acks before employees (the composite org FK has no
-- ON DELETE CASCADE). Redefining the whole function keeps it the single source
-- of truth; mirrors 0013_callouts.sql with one added DELETE.
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo_org(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    raise exception 'reset_demo_org: % is not a demo organization', p_org;
  end if;

  delete from schedule_acknowledgements where org_id = p_org;
  delete from punch_records          where org_id = p_org;
  delete from shift_swaps            where org_id = p_org;
  delete from draft_schedules        where org_id = p_org;
  delete from schedule_template_rows where org_id = p_org;
  delete from schedule_templates     where org_id = p_org;
  delete from schedules              where org_id = p_org;
  delete from availability           where org_id = p_org;
  delete from time_off_requests      where org_id = p_org;
  delete from callouts               where org_id = p_org;
  delete from messages               where org_id = p_org;
  delete from notifications          where org_id = p_org;
  delete from audit_logs             where org_id = p_org;
  delete from coverage_profile_blocks where org_id = p_org;
  delete from coverage_date_overrides where org_id = p_org;
  delete from coverage_day_defaults  where org_id = p_org;
  delete from coverage_profiles      where org_id = p_org;
  delete from store_hours            where org_id = p_org;
  delete from app_settings           where org_id = p_org;
  delete from employees              where org_id = p_org;
  delete from managers               where org_id = p_org;
end;
$$;

revoke all on function public.reset_demo_org(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime — managers' acknowledgement view updates live as people confirm.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_acknowledgements'
    ) then
      execute 'alter publication supabase_realtime add table public.schedule_acknowledgements';
    end if;
  end if;
end $$;

commit;
