-- A punch may only be linked to the employee's own shift.
--
-- punch_records_schedule_org_fkey (0002) already keeps a punch's shift in the
-- punch's org, but nothing stopped a punch naming a coworker's shift, or a
-- shift weeks away from the punch. This trigger checks, whenever a punch's
-- shift, employee or org is written:
--   * the shift belongs to the punch's employee, and
--   * the shift's date is the punch's store-local day or the day either side
--     (an overnight shift's clock-out, an early clock-in just before midnight),
--   * and a live clock-in (not a manual punch) starts that day's shift or the
--     previous day's overnight shift, as /api/punches requires. Employees can
--     insert live punches directly through the API gateway, so this can't be
--     left to the route alone.
-- It applies to everyone, the service role included: it is a data-integrity
-- rule, not a permission. Existing rows are not re-checked, so a shift later
-- swapped to another employee keeps its old punches.
--
-- It runs after punch_records_integrity (triggers fire in name order), so a
-- live punch is checked against the server time that trigger stamps.
-- /api/punches makes the same checks first and returns a readable error.
--
-- DEPLOY THE APP FIRST: /api/punches and the clock page must drop a stale or
-- other-day shift before inserting (this branch), or those punches fail with
-- a 500 instead of being saved or refused with a readable message. Safe to
-- repeat.

create or replace function public.enforce_punch_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_employee bigint;
  v_shift_date date;
  v_shift_end int;
  v_tz text;
  v_punch_day date;
begin
  if new.schedule_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.schedule_id is not distinct from old.schedule_id
     and new.employee_id is not distinct from old.employee_id
     and new.org_id is not distinct from old.org_id then
    return new;
  end if;

  select employee_id, date, end_minutes into v_shift_employee, v_shift_date, v_shift_end
    from public.schedules
   where id = new.schedule_id and org_id = new.org_id;
  if not found or v_shift_employee is distinct from new.employee_id then
    raise exception 'A punch can only be linked to the employee''s own shift'
      using errcode = '23514';
  end if;

  select value into v_tz from public.app_settings
   where org_id = new.org_id and key = 'timezone';
  begin
    v_punch_day := (coalesce(new.punched_at, now()) at time zone coalesce(v_tz, 'America/New_York'))::date;
  exception when others then
    v_punch_day := (coalesce(new.punched_at, now()) at time zone 'America/New_York')::date; -- unrecognised zone
  end;
  if v_shift_date not between v_punch_day - 1 and v_punch_day + 1 then
    raise exception 'A punch can only be linked to a shift on the same day'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not coalesce(new.is_manual, false) and new.punch_type = 'clock_in'
     and not (v_shift_date = v_punch_day or (v_shift_date = v_punch_day - 1 and v_shift_end > 1440)) then
    raise exception 'A clock-in can only start today''s shift or last night''s overnight shift'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_punch_schedule() from public, anon, authenticated;

drop trigger if exists punch_records_schedule_owner on public.punch_records;
create trigger punch_records_schedule_owner
  before insert or update of schedule_id, employee_id, org_id on public.punch_records
  for each row execute function public.enforce_punch_schedule();

notify pgrst, 'reload schema';
