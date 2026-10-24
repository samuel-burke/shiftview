-- Open Shifts: a shift-pickup marketplace for filling uncovered slots.
--
-- A manager posts an unassigned "open shift" (a date + time range, e.g. to
-- backfill a call-out or cover a critical coverage gap). Eligible employees
-- file a *claim* expressing interest; a manager approving a claim converts the
-- open shift into a real `schedules` row for that employee, marks the open
-- shift filled, and the remaining claims are denied. Fine-grained rules
-- (eligibility, who may approve) stay in the API + lib/open-shifts.ts; RLS is
-- the tenant-isolation backstop, exactly as for callouts / shift_swaps.
--
-- Mirrors the callouts multitenancy shape (0013): org_id column, composite FK
-- so a row's org_id must match its employee's org, is_org_member RLS, Realtime
-- publication, and demo-reset wiring.

begin;

-- ---------------------------------------------------------------------------
-- open_shifts — the posted, unassigned slots.
-- ---------------------------------------------------------------------------
create table if not exists public.open_shifts (
  id            bigint generated always as identity primary key,
  org_id        uuid   not null references public.organizations (id),
  date          date   not null,
  start_minutes integer not null,
  end_minutes   integer not null,
  note          text,
  -- 'open'      : awaiting a claim / approval
  -- 'filled'    : a claim was approved and a schedules row created
  -- 'cancelled' : the manager withdrew the slot
  status        text   not null default 'open'
                  check (status in ('open', 'filled', 'cancelled')),
  -- The employee assigned when the shift is filled (nullable until then).
  filled_by     bigint,
  filled_at     timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  -- A shift can't end before it starts; mirrors BR-4 (no overnight shifts).
  constraint open_shifts_time_order check (start_minutes < end_minutes),
  -- filled_by, when set, must reference an employee in the same org.
  constraint open_shifts_filled_by_org_fkey
    foreign key (filled_by, org_id) references public.employees (id, org_id)
);

create index if not exists open_shifts_org_date_idx   on public.open_shifts (org_id, date);
create index if not exists open_shifts_org_status_idx on public.open_shifts (org_id, status);

-- ---------------------------------------------------------------------------
-- open_shift_claims — an employee expressing interest in an open shift.
-- ---------------------------------------------------------------------------
create table if not exists public.open_shift_claims (
  id            bigint generated always as identity primary key,
  org_id        uuid   not null references public.organizations (id),
  open_shift_id bigint not null references public.open_shifts (id) on delete cascade,
  employee_id   bigint not null,
  -- 'pending' until a manager approves or denies it.
  status        text   not null default 'pending'
                  check (status in ('pending', 'approved', 'denied')),
  created_at    timestamptz not null default now(),
  -- One claim per employee per open shift.
  unique (org_id, open_shift_id, employee_id),
  -- A claim's org must match its employee's org.
  constraint open_shift_claims_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists open_shift_claims_org_shift_idx    on public.open_shift_claims (org_id, open_shift_id);
create index if not exists open_shift_claims_org_employee_idx on public.open_shift_claims (org_id, employee_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — member-readable/writable, identical to callouts.
-- ---------------------------------------------------------------------------
alter table public.open_shifts       enable row level security;
alter table public.open_shift_claims enable row level security;

drop policy if exists mt_select on public.open_shifts;
create policy mt_select on public.open_shifts
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.open_shifts;
create policy mt_write on public.open_shifts
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists mt_select on public.open_shift_claims;
create policy mt_select on public.open_shift_claims
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.open_shift_claims;
create policy mt_write on public.open_shift_claims
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Demo reset — fold the two new tables into reset_demo_org() so nightly demo
-- resets clear them too. Claims must be deleted before open_shifts (FK), and
-- both before employees (the composite org FK has no ON DELETE CASCADE).
-- Redefining the whole function keeps it the single source of truth; this
-- mirrors 0013_callouts.sql with the added DELETEs.
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo_org(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    raise exception 'reset_demo_org: % is not a demo organization', p_org;
  end if;

  delete from open_shift_claims      where org_id = p_org;
  delete from open_shifts            where org_id = p_org;
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
-- Realtime — the schedule/dashboard subscribes so posted, claimed, and filled
-- open shifts appear live.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_shifts'
    ) then
      execute 'alter publication supabase_realtime add table public.open_shifts';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'open_shift_claims'
    ) then
      execute 'alter publication supabase_realtime add table public.open_shift_claims';
    end if;
  end if;
end $$;

commit;
