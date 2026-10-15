-- Live clock-ins: no second clock-in on the same store day.
--
-- enforce_punch_integrity (0035) let a clock_in through whenever the latest
-- punch was over a minute old, whatever it was, so an employee could clock in
-- twice in one shift by inserting into punch_records directly with their own
-- session (RLS allows employees to insert their own live punches). The API
-- refuses that: a clock-in over an open punch is a new shift only when the open
-- punch is from an earlier store day. The trigger now applies the same rule in
-- the store's timezone (app_settings.timezone, defaulting like the app does).
--
-- Unchanged otherwise. Managers, manual punches and the service role behave as
-- before. Safe to repeat.

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
    -- New in 0035: serialize and re-check.
    perform pg_advisory_xact_lock(
      hashtextextended('punch:' || new.org_id::text || ':' || new.employee_id::text, 0)
    );
    -- clock_timestamp(), not now(): a punch committed while this one waited
    -- for the lock may carry a later transaction start than ours.
    -- The store's day, as lib/dates.ts resolveTimezone() picks it.
    select value into v_tz from public.app_settings
     where org_id = new.org_id and key = 'timezone';
    if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
      v_tz := 'America/New_York';
    end if;

    select punch_type, punched_at into v_last_type, v_last_at
      from public.punch_records
     where org_id = new.org_id and employee_id = new.employee_id
       and punched_at <= clock_timestamp()
     order by punched_at desc, id desc
     limit 1;
    v_valid := case new.punch_type
      -- New in 0046: a clock-in over an open punch is only a new shift when
      -- that punch is from an earlier store day (a forgotten clock-out), as
      -- in /api/punches. It used to be allowed a minute after any punch.
      when 'clock_in'    then v_last_type is null or v_last_type = 'clock_out'
                              or (v_last_at < clock_timestamp() - interval '1 minute'
                                  and (v_last_at at time zone v_tz)::date
                                      < (clock_timestamp() at time zone v_tz)::date)
      when 'break_start' then coalesce(v_last_type in ('clock_in', 'break_end'), false)
      when 'break_end'   then coalesce(v_last_type = 'break_start', false)
      when 'clock_out'   then coalesce(v_last_type in ('clock_in', 'break_end'), false)
      else true
    end;
    if not v_valid then
      raise exception 'Punch conflicts with the latest punch (%)', coalesce(v_last_type, 'none')
        using errcode = '23P01';
    end if;

    -- Live punch: the server clock is the only source of truth. Stamped
    -- after the lock so punches are in the order they were accepted.
    new.punched_at := clock_timestamp();
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
