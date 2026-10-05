-- Call-out rules, enforced in the database.
--
-- callouts is member-writable under RLS (0013) so the API can file a call-out
-- with the employee's own session; the same key works from the browser, so
-- the rules POST /api/callouts applies (lib/callout-rules.ts) are mirrored
-- here for every end-user write by a non-manager:
--   * only for their own employee record;
--   * only for today or tomorrow, in the store's timezone (app_settings);
--   * only for a day they have a scheduled shift;
--   * not for today once they have clocked in today.
-- Managers and the service role are unaffected. Deleting (undoing) a
-- call-out is not restricted.

begin;

create or replace function public.enforce_callout_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
begin
  if auth.uid() is null or public.is_org_manager(new.org_id) then
    return new;
  end if;

  if not exists (
    select 1 from public.employees
    where id = new.employee_id and org_id = new.org_id and user_id = auth.uid()
  ) then
    raise exception 'You can only call out for yourself' using errcode = '42501';
  end if;

  select value into v_tz from public.app_settings
    where org_id = new.org_id and key = 'timezone';
  begin
    v_today := (now() at time zone coalesce(v_tz, 'America/New_York'))::date;
  exception when others then
    v_today := (now() at time zone 'America/New_York')::date; -- unrecognised zone
    v_tz := 'America/New_York';
  end;
  v_tz := coalesce(v_tz, 'America/New_York');

  if new.date not in (v_today, v_today + 1) then
    raise exception 'You can only call out for today''s or tomorrow''s shift' using errcode = '22007';
  end if;

  if not exists (
    select 1 from public.schedules
    where org_id = new.org_id and employee_id = new.employee_id and date = new.date
  ) then
    raise exception 'You don''t have a shift scheduled that day' using errcode = '22007';
  end if;

  -- The store's local day [midnight, next midnight) as instants; converting a
  -- local timestamp with "at time zone" handles 23/25-hour DST days.
  if new.date = v_today and exists (
    select 1 from public.punch_records
    where org_id = new.org_id and employee_id = new.employee_id
      and punch_type = 'clock_in'
      and punched_at >= (v_today::timestamp at time zone v_tz)
      and punched_at <  ((v_today + 1)::timestamp at time zone v_tz)
  ) then
    raise exception 'You''ve already clocked in for today''s shift' using errcode = '22007';
  end if;

  return new;
end;
$$;

drop trigger if exists callouts_rules on public.callouts;
create trigger callouts_rules
  before insert or update on public.callouts
  for each row execute function public.enforce_callout_rules();

commit;
