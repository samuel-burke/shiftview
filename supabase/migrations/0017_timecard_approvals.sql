-- Timecard approval & lock: a manager sign-off that freezes an inclusive
-- [period_start, period_end] date range for one employee. Once a period is
-- approved the API rejects any punch whose LOCAL date falls inside it — new
-- manual corrections and live clock punches alike — so the hours that flow to
-- the payroll export can no longer change underneath it. Reopening deletes the
-- row (audit-logged) and unfreezes the period; re-approving re-freezes it.
--
-- The row is purely a lock record — there is intentionally no hours snapshot.
-- Because a locked period's punches cannot change, recomputing the time card
-- always reproduces the approved hours, so a stored copy would be redundant
-- (and could drift from the org-timezone computation that produced it).
--
-- Mirrors the callouts multitenancy shape exactly: org_id column, a composite
-- FK so a row's org must match its employee's org, RLS, and folded into
-- reset_demo_org() so nightly demo resets clear it too.

begin;

create table if not exists public.timecard_approvals (
  id           bigint generated always as identity primary key,
  org_id       uuid   not null references public.organizations (id),
  employee_id  bigint not null,
  period_start date   not null,
  period_end   date   not null,
  note         text,
  approved_by  uuid,
  approved_at  timestamptz not null default now(),
  -- A period cannot end before it starts.
  constraint timecard_approvals_period_order check (period_start <= period_end),
  -- Exact-period uniqueness; the API additionally rejects partial overlaps so
  -- a date is never covered by two approvals.
  unique (org_id, employee_id, period_start, period_end),
  -- An approval's org must match its employee's org (employees has a
  -- (id, org_id) unique key from 0002_multitenancy_enforce.sql).
  constraint timecard_approvals_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists timecard_approvals_org_emp_idx
  on public.timecard_approvals (org_id, employee_id, period_start);

-- ---------------------------------------------------------------------------
-- Row Level Security — any org member may read their lock status; only
-- managers may write (approve / reopen). Fine-grained rules (tenant scoping,
-- overlap rejection) stay enforced in the API layer; RLS is the backstop.
-- ---------------------------------------------------------------------------
alter table public.timecard_approvals enable row level security;

drop policy if exists mt_select on public.timecard_approvals;
create policy mt_select on public.timecard_approvals
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.timecard_approvals;
create policy mt_write on public.timecard_approvals
  for all using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

-- ---------------------------------------------------------------------------
-- Demo reset — fold the new table into reset_demo_org() so nightly demo resets
-- clear approvals too. Must run before employees (the composite org FK has no
-- ON DELETE CASCADE). Redefining the whole function keeps it the single source
-- of truth; this mirrors 0015_open_shifts.sql with one added DELETE.
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo_org(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    raise exception 'reset_demo_org: % is not a demo organization', p_org;
  end if;

  delete from timecard_approvals     where org_id = p_org;
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

commit;
