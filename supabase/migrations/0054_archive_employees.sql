-- Removing an employee archives them; their time records are kept.
--
-- Deleting an employee row cascaded to their punch_records, punch_corrections
-- and time_off_requests (and, after 0052, their call-outs and every shift), so
-- removing someone from the roster erased their time cards. The FLSA requires
-- keeping time cards for 2 years and payroll records for 3, and the privacy
-- policy says clock records are retained.
--
-- Now:
--   * employees.archived_at (null = active). An archived employee stays in
--     reports, timecards and exports, but is no longer a member of the org:
--     my_org_ids, my_employees, is_org_member and is_own_employee leave them
--     out, so their account can't read the org or write anything as that
--     employee. user_id is kept so a restore gives the same person back their
--     history.
--   * punch_records, punch_corrections, time_off_requests and callouts no
--     longer cascade: deleting an employee who has any of them is refused
--     (23503). Schedules still cascade (0052); employee_remove keeps past
--     shifts by archiving anyone who has one.
--   * A live (non-manual) punch for an archived employee is refused for every
--     caller, the service role included. Managers can still add manual punches
--     and approve corrections, to finish a last time card.
--   * A shift can't be created for, or moved to, an archived employee.
--   * employee_remove(org, employee) is what DELETE /api/employees calls. In
--     one transaction it either deletes an employee with no history at all (a
--     mistaken add) or archives them: sets archived_at, removes their shifts
--     that haven't started yet (store time), their drafts and template rows,
--     denies their pending open-shift claims and removes their manager role.
--     It enforces the API's rules for any caller: managers only, not yourself,
--     never the owner, and only the owner removes another manager in an org
--     that has one. Restoring is an ordinary update of archived_at by a
--     manager (RLS).
--   * manager_promote no longer promotes an archived employee.
--
-- DEPLOY THIS BEFORE THE APP: the app reads and filters on archived_at and
-- calls employee_remove. Needs 0052. Safe to repeat.

begin;

alter table public.employees add column if not exists archived_at timestamptz;

-- 0042 grants employees column by column.
grant select (archived_at) on public.employees to anon, authenticated;

-- Active employees only, for scheduling and the clock.
create index if not exists employees_org_active_idx
  on public.employees (org_id) where archived_at is null;

-- ── Time records are never deleted with the employee ───────────────────────

-- The cascading single-column keys go; the same-org keys (no action) stay and
-- refuse the delete.
alter table public.punch_records     drop constraint if exists punch_records_employee_id_fkey;
alter table public.time_off_requests drop constraint if exists time_off_requests_employee_id_fkey;

do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'punch_corrections_employee_org_fkey' and confdeltype <> 'a') then
    alter table public.punch_corrections drop constraint punch_corrections_employee_org_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'punch_corrections_employee_org_fkey') then
    alter table public.punch_corrections add constraint punch_corrections_employee_org_fkey
      foreign key (employee_id, org_id) references public.employees (id, org_id);
  end if;

  -- 0052 made call-outs cascade; they are attendance records.
  if exists (select 1 from pg_constraint
              where conname = 'callouts_employee_org_fkey' and confdeltype <> 'a') then
    alter table public.callouts drop constraint callouts_employee_org_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'callouts_employee_org_fkey') then
    alter table public.callouts add constraint callouts_employee_org_fkey
      foreign key (employee_id, org_id) references public.employees (id, org_id);
  end if;
end $$;

-- ── Archived employees are not members ─────────────────────────────────────

create or replace function public.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.managers  where user_id = auth.uid()
  union
  select org_id from public.employees where user_id = auth.uid() and archived_at is null
$$;

create or replace function public.my_employees()
returns table(org_id uuid, employee_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.org_id, e.id::bigint from public.employees e
   where e.user_id = auth.uid() and e.archived_at is null
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.managers  where user_id = auth.uid() and org_id = p_org
    union all
    select 1 from public.employees where user_id = auth.uid() and org_id = p_org and archived_at is null
  );
$$;

create or replace function public.is_own_employee(p_org uuid, p_employee bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees
    where id = p_employee and org_id = p_org and user_id = auth.uid() and archived_at is null
  );
$$;

create or replace function public.manager_promote(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_manager(p_org_id) then
    raise exception 'not authorized to manage roles for this organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.managers where org_id = p_org_id and is_owner)
     and not exists (
       select 1 from public.managers where org_id = p_org_id and user_id = auth.uid() and is_owner
     ) then
    raise exception 'only the organization owner can change manager roles' using errcode = '42501';
  end if;
  -- New in 0054: an archived employee is not a member.
  if not exists (select 1 from public.employees
                  where org_id = p_org_id and user_id = p_user_id and archived_at is null)
     and not exists (select 1 from public.managers where org_id = p_org_id and user_id = p_user_id) then
    raise exception 'only members of this organization can be promoted' using errcode = '42501';
  end if;

  insert into public.managers (org_id, user_id)
  values (p_org_id, p_user_id)
  on conflict (org_id, user_id) do nothing;
end;
$$;

-- ── No live punches or new shifts for an archived employee ─────────────────

create or replace function public.enforce_punch_active_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(new.is_manual, false) and exists (
    select 1 from public.employees
     where id = new.employee_id and org_id = new.org_id and archived_at is not null
  ) then
    raise exception 'This employee is archived and can''t clock in or out' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Named to sort before punch_records_integrity, so it runs first.
drop trigger if exists punch_records_active_employee on public.punch_records;
create trigger punch_records_active_employee
  before insert on public.punch_records
  for each row execute function public.enforce_punch_active_employee();

create or replace function public.enforce_schedule_active_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.employees
     where id = new.employee_id and org_id = new.org_id and archived_at is not null
  ) then
    raise exception 'This employee is archived; restore them before scheduling them' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists schedules_active_employee on public.schedules;
create trigger schedules_active_employee
  before insert or update of employee_id, org_id on public.schedules
  for each row execute function public.enforce_schedule_active_employee();

revoke all on function public.enforce_punch_active_employee(), public.enforce_schedule_active_employee()
  from public, anon, authenticated;

-- ── Removing an employee ────────────────────────────────────────────────────

create or replace function public.employee_remove(p_org uuid, p_employee bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_emp public.employees%rowtype;
  v_owner uuid;
  v_tz text;
  v_today date;
  v_now_min int;
begin
  if v_uid is null or not public.is_org_manager(p_org) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;

  select * into v_emp from public.employees where id = p_employee and org_id = p_org for update;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if v_emp.archived_at is not null then
    return 'already_archived';
  end if;

  if v_emp.user_id is not null then
    if v_emp.user_id = v_uid then
      raise exception 'You cannot remove yourself' using errcode = '42501';
    end if;
    select user_id into v_owner from public.managers where org_id = p_org and is_owner;
    if v_owner = v_emp.user_id then
      raise exception 'The organization owner cannot be removed' using errcode = '42501';
    end if;
    if v_owner is not null and v_owner <> v_uid
       and exists (select 1 from public.managers where org_id = p_org and user_id = v_emp.user_id) then
      raise exception 'Only the organization owner can remove a manager' using errcode = '42501';
    end if;
  end if;

  v_tz := public.store_timezone(p_org);
  v_today := (now() at time zone v_tz)::date;
  v_now_min := extract(hour from now() at time zone v_tz)::int * 60
             + extract(minute from now() at time zone v_tz)::int;

  -- No history at all: a mistaken add. Delete the row; what's left (future
  -- shifts, availability, preferences) cascades.
  if not exists (select 1 from public.punch_records     where org_id = p_org and employee_id = p_employee)
     and not exists (select 1 from public.punch_corrections where org_id = p_org and employee_id = p_employee)
     and not exists (select 1 from public.time_off_requests where org_id = p_org and employee_id = p_employee)
     and not exists (select 1 from public.callouts          where org_id = p_org and employee_id = p_employee)
     and not exists (select 1 from public.schedules
                      where org_id = p_org and employee_id = p_employee
                        and (date < v_today or (date = v_today and start_minutes <= v_now_min))) then
    if v_emp.user_id is not null
       and not exists (select 1 from public.organizations where id = p_org and is_demo) then
      delete from public.managers where org_id = p_org and user_id = v_emp.user_id;
    end if;
    delete from public.employees where id = p_employee and org_id = p_org;
    return 'deleted';
  end if;

  update public.employees set archived_at = now() where id = p_employee and org_id = p_org;

  -- Shifts that haven't started are plans, not records. Pending swaps of
  -- those shifts cascade with them.
  delete from public.schedules
   where org_id = p_org and employee_id = p_employee
     and (date > v_today or (date = v_today and start_minutes > v_now_min));
  delete from public.draft_schedules        where org_id = p_org and employee_id = p_employee;
  delete from public.schedule_template_rows where org_id = p_org and employee_id = p_employee;
  update public.open_shift_claims set status = 'denied'
   where org_id = p_org and employee_id = p_employee and status = 'pending';

  -- In the demo org the linked user is another visitor mid-session; the
  -- nightly reset handles them.
  if v_emp.user_id is not null
     and not exists (select 1 from public.organizations where id = p_org and is_demo) then
    delete from public.managers where org_id = p_org and user_id = v_emp.user_id;
  end if;
  return 'archived';
end;
$$;

revoke all on function public.employee_remove(uuid, bigint) from public, anon;
grant execute on function public.employee_remove(uuid, bigint) to authenticated;

commit;

notify pgrst, 'reload schema';
