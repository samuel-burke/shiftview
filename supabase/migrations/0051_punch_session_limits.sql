-- Live punches: a forgotten shift can't be continued, and the break cap holds.
--
-- enforce_punch_integrity (0047) judged a live punch only against the latest
-- punch, so the database disagreed with the clock (lib/punch-sessions.ts
-- currentShift) about shifts left open past midnight:
--   * A closer who took a break after midnight and forgot to clock out could
--     not clock in again all the next day: the latest punch (the break end)
--     was "today", so a clock-in over it was refused.
--   * A clock-in over a shift still open from before midnight was allowed at
--     12:30 AM, though the clock treats that shift as current until 4:00 AM:
--     two clock-ins, one shift.
--   * A break or clock-out could continue an abandoned shift of any age.
--   * punch_max_breaks_per_shift was only enforced by the API.
--
-- Now, for live punches by signed-in users, the open shift is judged from its
-- clock-in, as the clock does:
--   * a clock-in over an open shift is allowed when that shift began on an
--     earlier store day and it is past 4:00 AM store time or the shift began
--     over 16 hours ago (the clock allows less while a scheduled overnight
--     shift runs; the API holds that line);
--   * a break or clock-out must continue a shift that began today, or one
--     that began on an earlier store day less than 18 hours ago (the 16-hour
--     shift cap plus the 2-hour late clock-out grace);
--   * a break_start beyond the org's punch_max_breaks_per_shift is refused.
-- Managers' manual punches and the service role are unchanged.
--
-- punch_corrections_stamp also refuses a requested time over 30 days old, as
-- the API does, so a request inserted directly can't reopen an old shift.
--
-- Safe to repeat.

begin;

create or replace function public.enforce_punch_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_uid uuid := auth.uid();
  v_is_manager boolean;
  v_last_type text;
  v_last_at timestamptz;
  v_valid boolean;
  v_tz text;
  v_in_at timestamptz;
  v_now timestamptz;
  v_continues boolean;
  v_max_breaks int;
  v_breaks int;
begin
  if v_uid is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if not public.is_org_manager(old.org_id) then
      raise exception 'Only managers can delete punches' using errcode = '42501';
    end if;
    return old;
  end if;

  v_is_manager := public.is_org_manager(new.org_id);

  if tg_op = 'UPDATE' then
    if not v_is_manager then
      raise exception 'Only managers can edit punches' using errcode = '42501';
    end if;
    if new.punched_at is distinct from old.punched_at then
      if new.punched_at > now() then
        raise exception 'punched_at cannot be in the future' using errcode = '22007';
      end if;
      new.is_manual := true;
    end if;
    return new;
  end if;

  -- INSERT
  if not v_is_manager then
    if not public.is_own_employee(new.org_id, new.employee_id) then
      raise exception 'You can only record punches for yourself' using errcode = '42501';
    end if;
    if coalesce(new.is_manual, false) then
      raise exception 'Punch corrections need manager approval' using errcode = '42501';
    end if;
  end if;

  if not coalesce(new.is_manual, false) then
    perform pg_advisory_xact_lock(
      hashtextextended('punch:' || new.org_id::text || ':' || new.employee_id::text, 0)
    );
    v_tz := public.store_timezone(new.org_id);
    -- clock_timestamp(), not now(): a punch committed while this one waited
    -- for the lock may carry a later transaction start than ours.
    v_now := clock_timestamp();

    select punch_type, punched_at into v_last_type, v_last_at
      from public.punch_records
     where org_id = new.org_id and employee_id = new.employee_id
       and punched_at <= v_now
     order by punched_at desc, id desc
     limit 1;
    -- New in 0051: the open shift's clock-in.
    if v_last_type is not null and v_last_type <> 'clock_out' then
      select punched_at into v_in_at
        from public.punch_records
       where org_id = new.org_id and employee_id = new.employee_id
         and punch_type = 'clock_in' and punched_at <= v_last_at
       order by punched_at desc, id desc
       limit 1;
    end if;
    -- Whether a break or clock-out may continue the open shift.
    v_continues := v_in_at is not null
      and ((v_in_at at time zone v_tz)::date = (v_now at time zone v_tz)::date
           or v_in_at > v_now - interval '18 hours');

    v_valid := case new.punch_type
      -- A clock-in over an open punch is only a new shift when the open shift
      -- was left from an earlier store day, as in lib/punch-sessions.ts.
      when 'clock_in'    then v_last_type is null or v_last_type = 'clock_out'
                              or v_in_at is null
                              or (v_last_at < v_now - interval '1 minute'
                                  and (v_in_at at time zone v_tz)::date < (v_now at time zone v_tz)::date
                                  and ((v_now at time zone v_tz)::time >= time '04:00'
                                       or v_in_at < v_now - interval '16 hours'))
      when 'break_start' then v_continues and v_last_type in ('clock_in', 'break_end')
      when 'break_end'   then v_continues and v_last_type = 'break_start'
      when 'clock_out'   then v_continues and v_last_type in ('clock_in', 'break_end')
      else true
    end;
    if not v_valid then
      raise exception 'Punch conflicts with the latest punch (%)', coalesce(v_last_type, 'none')
        using errcode = '23P01';
    end if;

    -- New in 0051: the org's break cap (0 or unset: no cap), counted from the
    -- shift's clock-in, as the API counts it.
    if new.punch_type = 'break_start' then
      select case when value ~ '^\s*\d{1,3}\s*$' then btrim(value)::int else 0 end into v_max_breaks
        from public.app_settings
       where org_id = new.org_id and key = 'punch_max_breaks_per_shift';
      if coalesce(v_max_breaks, 0) > 0 then
        select count(*) into v_breaks
          from public.punch_records
         where org_id = new.org_id and employee_id = new.employee_id
           and punch_type = 'break_start' and punched_at >= v_in_at and punched_at <= v_now;
        if v_breaks >= v_max_breaks then
          raise exception 'Break limit reached (% per shift)', v_max_breaks using errcode = '23P01';
        end if;
      end if;
    end if;

    -- Live punch: the server clock is the only source of truth. Stamped
    -- after the lock so punches are in the order they were accepted.
    new.punched_at := v_now;
    return new;
  end if;

  if new.punched_at is null then
    raise exception 'Manual punches require punched_at' using errcode = '23502';
  end if;
  if new.punched_at > now() then
    raise exception 'punched_at cannot be in the future' using errcode = '22007';
  end if;
  return new;
end;
$$;


create or replace function public.punch_corrections_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  if new.punched_at > now() then
    raise exception 'punched_at cannot be in the future' using errcode = '22007';
  end if;
  -- New in 0051: the API's 30-day window, for requests inserted directly.
  if new.punched_at < now() - interval '30 days' then
    raise exception 'punched_at must be within the last 30 days' using errcode = '22007';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_punch_integrity(), public.punch_corrections_stamp()
  from public, anon, authenticated;

commit;
