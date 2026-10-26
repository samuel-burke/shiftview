-- Enforce the clock's current-shift window for direct live punch inserts.
-- Replaces the 0051 trigger for databases that already applied that migration.
-- Expired shifts must use the existing manager-approved correction workflow.
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
  v_today date;
  v_in_day date;
  v_end_local timestamp;
  v_end_at timestamptz;
  v_first_end timestamptz;
  v_scheduled_overnight boolean := false;
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
    -- Match currentShift/loadCurrentShift, including the store's calendar
    -- day and the employee's latest scheduled overnight end. schedule_id on
    -- the incoming punch is only a label and cannot extend this window.
    v_today := (v_now at time zone v_tz)::date;
    v_in_day := (v_in_at at time zone v_tz)::date;
    if v_in_day = v_today - 1 then
      select s.date::timestamp + make_interval(mins => s.end_minutes) into v_end_local
        from public.schedules s
       where s.org_id = new.org_id and s.employee_id = new.employee_id
         and s.date = v_today - 1 and s.end_minutes > 1440
       order by s.end_minutes desc
       limit 1;
      if v_end_local is not null then
        v_end_at := v_end_local at time zone v_tz;
        -- Like zonedTimeToUtc: use the first occurrence of an ambiguous
        -- fall-back time. PostgreSQL otherwise picks the second occurrence.
        -- For a spring-forward gap, AT TIME ZONE already shifts forward.
        v_first_end := ((v_end_local - interval '1 day') at time zone v_tz) + interval '24 hours';
        if (v_first_end at time zone v_tz) = v_end_local then
          v_end_at := least(v_end_at, v_first_end);
        end if;
        v_scheduled_overnight := v_now <= v_end_at + interval '2 hours';
      end if;
    end if;
    v_continues := v_in_at is not null
      and (v_in_day = v_today
           or (v_in_day = v_today - 1
               and ((v_now at time zone v_tz)::time < time '04:00' or v_scheduled_overnight)
               and v_in_at >= v_now - case when v_scheduled_overnight then interval '18 hours'
                                          else interval '16 hours' end));

    v_valid := case new.punch_type
      when 'clock_in'    then v_last_type is null or v_last_type = 'clock_out'
                              or v_in_at is null
                              or (v_last_at < v_now - interval '1 minute' and not v_continues)
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


revoke all on function public.enforce_punch_integrity() from public, anon, authenticated;

commit;
