-- Baseline: the whole schema as production has it after migrations
-- 0001-0051 (verified live 2026-10-18). Generated with pg_dump --schema-only
-- from a database built from the old baseline.sql plus 0038-0051, and checked
-- against that chain with supabase/schema-fingerprint.sql. The original
-- numbered files are in git history before this commit.
--
-- Production already has all of this, so it is recorded there as applied
-- (supabase migration repair --status applied 20261018000000) rather than run.
-- A new project or a local `supabase db reset` runs it first.
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- A new Supabase project's default privileges grant everything on new tables,
-- sequences and functions to anon, authenticated and service_role. pg_dump
-- writes each object's grants relative to owner-only access, so clear those
-- defaults first; the GRANTs below then rebuild exactly production's
-- privileges, and the ALTER DEFAULT PRIVILEGES near the end restore its
-- defaults for later migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

--
-- Name: apply_generated_drafts(uuid, date, text, bigint, jsonb, jsonb, bigint, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_generated_drafts(p_org uuid, p_week_start date, p_mode text, p_replace_run_id bigint, p_expected jsonb, p_rows jsonb, p_seed bigint, p_rules jsonb, p_adjustments jsonb, p_metrics jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_week_end date;
  v_current  jsonb;
  v_previous jsonb := '[]'::jsonb;
  -- record, not %rowtype: a %rowtype declaration needs the table to exist
  -- when the function is created, so applying the statements out of order
  -- or in pieces would fail. A record only needs it when the function runs.
  v_replaced record;
  v_run_id   bigint;
  v_removed  int := 0;
  v_inserted int := 0;
begin
  if not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_week_start is null or p_mode is null or p_mode not in ('fill', 'replace')
     or jsonb_typeof(p_rows) is distinct from 'array' then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_week_end := p_week_start + 6;

  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(date date)
    where r.date is null or r.date not between p_week_start and v_week_end
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- One generation per org-week at a time.
  perform pg_advisory_xact_lock(
    hashtextextended('schedule_generation:' || p_org::text || ':' || p_week_start::text, 0)
  );

  -- The generator planned around the week's drafts as it read them; if they
  -- have changed since, its plan may no longer fit.
  perform 1 from public.draft_schedules
   where org_id = p_org and date between p_week_start and v_week_end
   for update;
  select coalesce(
           jsonb_agg(jsonb_build_array(id, employee_id, date, start_minutes, end_minutes) order by id),
           '[]'::jsonb)
    into v_current
    from public.draft_schedules
   where org_id = p_org and date between p_week_start and v_week_end;
  if v_current is distinct from coalesce(p_expected, '[]'::jsonb) then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_replace_run_id is not null then
    select * into v_replaced
      from public.schedule_generation_runs
     where id = p_replace_run_id and org_id = p_org and week_start = p_week_start
       for update;
    if not found then
      return jsonb_build_object('status', 'stale');
    end if;
    if v_replaced.undone_at is not null
       or v_replaced.published_at is not null
       or exists (
         select 1 from public.schedule_generation_runs r
          where r.org_id = p_org and r.week_start = p_week_start
            and r.id > p_replace_run_id and r.undone_at is null
       ) then
      return jsonb_build_object('status', 'stale');
    end if;
    v_previous := v_replaced.previous_drafts;
  elsif p_mode = 'replace' then
    select coalesce(
             jsonb_agg(jsonb_build_object(
               'employee_id', employee_id,
               'date', date,
               'start_minutes', start_minutes,
               'end_minutes', end_minutes,
               'generation_run_id', generation_run_id) order by id),
             '[]'::jsonb)
      into v_previous
      from public.draft_schedules
     where org_id = p_org and date between p_week_start and v_week_end;
  end if;

  -- The writes. Any constraint failure rolls back everything in this block.
  begin
    if p_replace_run_id is not null then
      delete from public.draft_schedules
       where org_id = p_org and generation_run_id = p_replace_run_id;
      get diagnostics v_removed = row_count;
      update public.schedule_generation_runs set undone_at = now() where id = p_replace_run_id;
    elsif p_mode = 'replace' then
      delete from public.draft_schedules
       where org_id = p_org and date between p_week_start and v_week_end;
      get diagnostics v_removed = row_count;
    end if;

    insert into public.schedule_generation_runs
      (org_id, week_start, mode, seed, rules, adjustments, metrics, previous_drafts, created_by)
    values
      (p_org, p_week_start, p_mode, p_seed,
       coalesce(p_rules, '{}'::jsonb), coalesce(p_adjustments, '[]'::jsonb),
       coalesce(p_metrics, '{}'::jsonb), v_previous, auth.uid())
    returning id into v_run_id;

    insert into public.draft_schedules
      (org_id, employee_id, date, start_minutes, end_minutes, generation_run_id)
    select p_org, r.employee_id, r.date, r.start_minutes, r.end_minutes, v_run_id
      from jsonb_to_recordset(p_rows)
        as r(employee_id bigint, date date, start_minutes int, end_minutes int);
    get diagnostics v_inserted = row_count;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'conflict');
    when foreign_key_violation or check_violation or not_null_violation then
      return jsonb_build_object('status', 'invalid');
  end;

  return jsonb_build_object(
    'status', 'ok', 'run_id', v_run_id, 'inserted', v_inserted, 'removed', v_removed
  );
end;
$$;

--
-- Name: approve_shift_swap(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_shift_swap(p_org uuid, p_swap_id bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_swap   public.shift_swaps%rowtype;
  v_emp_a  bigint;
  v_emp_b  bigint;
begin
  -- Only a manager of this org may approve, however the RPC is reached.
  if not public.is_org_manager(p_org) then
    return 'forbidden';
  end if;

  -- Lock the swap so two approvals can't both apply.
  select * into v_swap
  from public.shift_swaps
  where id = p_swap_id and org_id = p_org
  for update;

  if not found then
    return 'not_found';
  end if;

  -- The consent gate: a swap can only be approved once the target accepted it.
  -- Any other state (pending / approved / denied / declined) is returned as-is
  -- so the caller can distinguish "still awaiting acceptance" from "resolved".
  if v_swap.status <> 'accepted' then
    return v_swap.status;
  end if;

  -- Lock both schedules and read their current owners.
  select employee_id into v_emp_a
  from public.schedules
  where id = v_swap.schedule_a_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  select employee_id into v_emp_b
  from public.schedules
  where id = v_swap.schedule_b_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  -- The shifts must still belong to the two people who agreed to the swap.
  if v_emp_a is distinct from v_swap.requester_id or v_emp_b is distinct from v_swap.target_id then
    return 'stale';
  end if;

  -- Exchange owners and resolve the swap — all or nothing.
  update public.schedules set employee_id = v_emp_b
    where id = v_swap.schedule_a_id and org_id = p_org;
  update public.schedules set employee_id = v_emp_a
    where id = v_swap.schedule_b_id and org_id = p_org;
  update public.shift_swaps set status = 'approved'
    where id = p_swap_id and org_id = p_org;

  return 'approved';
end;
$$;

--
-- Name: canonical_timezone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_timezone(p_name text) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select name from pg_timezone_names
   where lower(name) = lower(btrim(p_name))
     and name not in ('Factory', 'posixrules', 'localtime') -- not zones; Intl rejects them
   order by name = btrim(p_name) desc, name
   limit 1
$$;

--
-- Name: employee_pay_rates(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.employee_pay_rates(p_org uuid) RETURNS TABLE(employee_id bigint, pay_rate numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select e.id::bigint, e.pay_rate
    from public.employees e
   where e.org_id = p_org
     and public.is_org_manager(p_org)
$$;

--
-- Name: enforce_callout_rules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_callout_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: enforce_punch_geofence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_punch_geofence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_settings jsonb;
  v_raw_lat text;
  v_raw_lng text;
  v_raw_radius text;
  v_lat double precision;
  v_lng double precision;
  v_radius double precision;
  v_a double precision;
  v_dist double precision;
begin
  if auth.uid() is null
     or new.punch_type <> 'clock_in'
     or coalesce(new.is_manual, false) then
    return new;
  end if;
  -- Leave rows the caller may not write to the integrity trigger and RLS.
  if not (public.is_org_manager(new.org_id) or public.is_own_employee(new.org_id, new.employee_id)) then
    return new;
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_settings
    from public.app_settings
   where org_id = new.org_id
     and key in ('gps_required', 'geofence_enabled', 'geofence_lat', 'geofence_lng', 'geofence_radius');

  if v_settings->>'gps_required' is distinct from 'true'
     or v_settings->>'geofence_enabled' is distinct from 'true' then
    return new;
  end if;

  v_raw_lat    := btrim(coalesce(v_settings->>'geofence_lat', ''));
  v_raw_lng    := btrim(coalesce(v_settings->>'geofence_lng', ''));
  v_raw_radius := btrim(coalesce(v_settings->>'geofence_radius', ''));

  if v_raw_lat = '' and v_raw_lng = '' then
    return new; -- no centre saved
  end if;

  v_lat    := public.try_parse_float8(v_raw_lat);
  v_lng    := public.try_parse_float8(v_raw_lng);
  v_radius := case when v_raw_radius = '' then 100 else public.try_parse_float8(v_raw_radius) end;

  -- NaN compares greater than every number in Postgres, so it fails the
  -- upper bounds here; the radius check excludes it explicitly.
  if v_lat is null or not (v_lat between -90 and 90)
     or v_lng is null or not (v_lng between -180 and 180)
     or v_radius is null or v_radius = 'NaN'::double precision
     or not (v_radius > 0 and v_radius < 'Infinity'::double precision) then
    raise exception 'Geofence location is misconfigured — ask a manager to update it in Settings'
      using errcode = 'GF003';
  end if;

  -- Constraints run after BEFORE triggers, so check the punch's own
  -- coordinates here first, as punch_records_coordinates_check would.
  if not ((new.lat is null) = (new.lng is null)
          and (new.lat is null or (new.lat between -90 and 90 and new.lng between -180 and 180))) then
    raise exception 'lat and lng must both be null, or in range (-90..90, -180..180)'
      using errcode = 'check_violation', constraint = 'punch_records_coordinates_check';
  end if;

  if new.lat is null or new.lng is null then
    raise exception 'GPS location required — geofence enforcement is active'
      using errcode = 'GF002';
  end if;

  -- Haversine, as lib/haversine.ts. NaN and out-of-range coordinates were
  -- ruled out above.
  v_a := sin(radians(new.lat - v_lat) / 2) ^ 2
       + cos(radians(v_lat)) * cos(radians(new.lat)) * sin(radians(new.lng - v_lng) / 2) ^ 2;
  v_a := least(greatest(v_a, 0), 1);
  v_dist := 6371000 * 2 * atan2(sqrt(v_a), sqrt(1 - v_a));

  if not (v_dist <= v_radius) then
    raise exception 'Outside geofence — you must be within %m of the designated location to clock in', round(v_radius)
      using errcode = 'GF001';
  end if;

  return new;
end;
$$;

--
-- Name: enforce_punch_integrity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_punch_integrity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

--
-- Name: enforce_punch_schedule(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_punch_schedule() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: enforce_recipient_in_org(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_recipient_in_org() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v_user is null then
    return new;
  end if;
  if not exists (select 1 from public.employees where org_id = new.org_id and user_id = v_user)
     and not exists (select 1 from public.managers where org_id = new.org_id and user_id = v_user) then
    raise exception 'The recipient is not a member of this organization' using errcode = '42501';
  end if;
  return new;
end;
$$;

--
-- Name: enforce_swap_response(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_swap_response() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null or public.is_org_manager(old.org_id) then
    return new;
  end if;
  -- RLS lets only the target employee get this far.
  if old.status is distinct from 'pending'
     or new.status not in ('accepted', 'declined')
     or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'You can only accept or decline a pending swap' using errcode = '42501';
  end if;
  return new;
end;
$$;

--
-- Name: enforce_timezone_setting(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_timezone_setting() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_name text;
begin
  if new.key <> 'timezone' then
    return new;
  end if;
  v_name := public.canonical_timezone(new.value);
  if v_name is null then
    raise exception 'timezone "%" is not a valid IANA timezone', new.value using errcode = '22023';
  end if;
  new.value := v_name;
  return new;
end;
$$;

--
-- Name: is_org_manager(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_org_manager(p_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.managers where user_id = auth.uid() and org_id = p_org
  );
$$;

--
-- Name: is_org_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_org_member(p_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.managers  where user_id = auth.uid() and org_id = p_org
    union all
    select 1 from public.employees where user_id = auth.uid() and org_id = p_org
  );
$$;

--
-- Name: is_own_employee(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_own_employee(p_org uuid, p_employee bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.employees
    where id = p_employee and org_id = p_org and user_id = auth.uid()
  );
$$;

--
-- Name: link_employee_account(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_employee_account(p_org uuid, p_employee bigint) RETURNS TABLE(user_id uuid, confirmed boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id   uuid;
  v_confirmed boolean;
begin
  select u.id, u.email_confirmed_at is not null
    into v_user_id, v_confirmed
    from public.employees e
    join auth.users u on lower(u.email) = lower(e.email)
   where e.id = p_employee and e.org_id = p_org and e.user_id is null
   order by u.created_at
   limit 1;
  if v_user_id is null then
    return;
  end if;

  -- A person holds at most one employee row per organization.
  if exists (select 1 from public.employees where org_id = p_org and employees.user_id = v_user_id) then
    return;
  end if;

  update public.employees set user_id = v_user_id where id = p_employee and org_id = p_org;
  return query select v_user_id, v_confirmed;
end;
$$;

--
-- Name: link_employee_on_signup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_employee_on_signup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.employees e
     set user_id = new.id
   where lower(e.email) = lower(new.email)
     and e.user_id is null
     and not exists (
       select 1 from public.employees o where o.org_id = e.org_id and o.user_id = new.id
     );
  return new;
exception when others then
  raise warning 'link_employee_on_signup failed: %', sqlerrm;
  return new;
end;
$$;

--
-- Name: manager_demote(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.manager_demote(p_org_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_org_manager(p_org_id) then
    raise exception 'not authorized to manage roles for this organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations where id = p_org_id and is_demo) then
    raise exception 'demoting managers is disabled in the demo organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.managers where org_id = p_org_id and is_owner)
     and not exists (
       select 1 from public.managers where org_id = p_org_id and user_id = auth.uid() and is_owner
     ) then
    raise exception 'only the organization owner can change manager roles' using errcode = '42501';
  end if;

  -- The managers_protect_owner trigger rejects removing the org owner.
  delete from public.managers
  where org_id = p_org_id and user_id = p_user_id;
end;
$$;

--
-- Name: manager_promote(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.manager_promote(p_org_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  if not exists (select 1 from public.employees where org_id = p_org_id and user_id = p_user_id)
     and not exists (select 1 from public.managers where org_id = p_org_id and user_id = p_user_id) then
    raise exception 'only members of this organization can be promoted' using errcode = '42501';
  end if;

  insert into public.managers (org_id, user_id)
  values (p_org_id, p_user_id)
  on conflict (org_id, user_id) do nothing;
end;
$$;

--
-- Name: my_employees(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_employees() RETURNS TABLE(org_id uuid, employee_id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select e.org_id, e.id::bigint from public.employees e where e.user_id = auth.uid()
$$;

--
-- Name: my_managed_org_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_managed_org_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select org_id from public.managers where user_id = auth.uid()
$$;

--
-- Name: my_org_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_org_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select org_id from public.managers  where user_id = auth.uid()
  union
  select org_id from public.employees where user_id = auth.uid()
$$;

--
-- Name: notify_delete_subs(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_delete_subs(p_user_id uuid, p_endpoints text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM push_subscriptions
  WHERE user_id = p_user_id
    AND endpoint = ANY(p_endpoints);
END;
$$;

--
-- Name: notify_get_active_endpoints(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_get_active_endpoints(p_user_id uuid) RETURNS TABLE(endpoint text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select endpoint from public.device_presence
  where user_id = p_user_id and active_until > now();
$$;

--
-- Name: notify_get_manager_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_get_manager_ids(p_org_id uuid) RETURNS TABLE(user_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select user_id from public.managers where org_id = p_org_id;
$$;

--
-- Name: notify_get_push_prefs(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_get_push_prefs(p_user_id uuid) RETURNS TABLE(late_punch_alerts boolean, message_alerts boolean, pto_alerts boolean, new_shift_alerts boolean, shift_change_alerts boolean, swap_alerts boolean, shift_reminder_alerts boolean, chess_alerts boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- The user's row, or all-on defaults when they never saved preferences.
  select
    coalesce(late_punch_alerts, true),
    coalesce(message_alerts, true),
    coalesce(pto_alerts, true),
    coalesce(new_shift_alerts, true),
    coalesce(shift_change_alerts, true),
    coalesce(swap_alerts, true),
    coalesce(shift_reminder_alerts, true),
    coalesce(chess_alerts, true)
  from public.user_notification_preferences
  where user_id = p_user_id
  union all
  select true, true, true, true, true, true, true, true
  limit 1;
$$;

--
-- Name: notify_get_push_subs(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_get_push_subs(p_user_id uuid) RETURNS TABLE(endpoint text, p256dh text, auth_key text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
    SELECT ps.endpoint, ps.p256dh, ps.auth_key
    FROM push_subscriptions ps
    WHERE ps.user_id = p_user_id;
END;
$$;

--
-- Name: notify_insert(uuid, uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_insert(p_org_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.notifications (org_id, user_id, type, title, body, data)
  values (p_org_id, p_user_id, p_type, p_title, p_body, p_data);
$$;

--
-- Name: notify_upsert_chess(uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_upsert_chess(p_org_id uuid, p_user_id uuid, p_title text, p_body text, p_data jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  delete from public.notifications
  where org_id = p_org_id
    and user_id = p_user_id
    and type = 'chess_move'
    and data->>'convId' = p_data->>'convId';

  insert into public.notifications (org_id, user_id, type, title, body, data)
  values (p_org_id, p_user_id, 'chess_move', p_title, p_body, p_data);
$$;

--
-- Name: org_delete(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.org_delete(p_org uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- The seeded default and demo organizations must never be deletable.
  if p_org in ('00000000-0000-0000-0000-000000000001',
               '00000000-0000-0000-0000-000000000002') then
    raise exception 'org_delete: organization % cannot be deleted', p_org;
  end if;
  if not exists (select 1 from organizations where id = p_org) then
    raise exception 'org_delete: organization % does not exist', p_org;
  end if;

  perform set_config('app.allow_owner_removal', 'on', true);

  delete from open_shift_claims        where org_id = p_org;
  delete from open_shifts              where org_id = p_org;
  delete from punch_corrections        where org_id = p_org;
  delete from punch_records            where org_id = p_org;
  delete from shift_swaps              where org_id = p_org;
  delete from draft_schedules          where org_id = p_org;
  delete from schedule_generation_runs where org_id = p_org;
  delete from schedule_template_rows   where org_id = p_org;
  delete from schedule_templates       where org_id = p_org;
  delete from schedules                where org_id = p_org;
  delete from positions                where org_id = p_org;
  delete from availability             where org_id = p_org;
  delete from employee_preferences     where org_id = p_org;
  delete from time_off_requests        where org_id = p_org;
  delete from callouts                 where org_id = p_org;
  delete from messages                 where org_id = p_org;
  delete from notifications            where org_id = p_org;
  delete from announcements            where org_id = p_org;
  delete from audit_logs               where org_id = p_org;
  delete from coverage_profile_blocks  where org_id = p_org;
  delete from coverage_date_overrides  where org_id = p_org;
  delete from coverage_day_defaults    where org_id = p_org;
  delete from coverage_profiles        where org_id = p_org;
  delete from store_hours              where org_id = p_org;
  delete from app_settings             where org_id = p_org;
  delete from employees                where org_id = p_org;
  delete from managers                 where org_id = p_org;
  delete from organizations            where id = p_org;
end;
$$;

--
-- Name: org_signup_create(text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.org_signup_create(p_name text, p_slug text, p_user_id uuid, p_owner_name text, p_owner_email text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid;
begin
  insert into organizations (name, slug)
  values (p_name, p_slug)
  returning id into v_org;

  insert into managers (org_id, user_id, is_owner)
  values (v_org, p_user_id, true);

  -- Linked employee row so My Schedule and the clock page work for the owner.
  insert into employees (org_id, user_id, name, email)
  values (v_org, p_user_id, p_owner_name, p_owner_email);

  return v_org;
end;
$$;

--
-- Name: presence_set(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.presence_set(p_endpoint text, p_active boolean) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.device_presence (endpoint, user_id, active_until)
  values (
    p_endpoint,
    auth.uid(),
    case when p_active then now() + interval '60 seconds' else now() end
  )
  on conflict (endpoint) do update
    set active_until = excluded.active_until,
        user_id      = excluded.user_id;
$$;

--
-- Name: protect_employee_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_employee_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;
  if (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and new.user_id is not null and new.user_id <> v_uid then
    raise exception 'You can only link an employee record to your own account' using errcode = '42501';
  end if;
  return new;
end;
$$;

--
-- Name: protect_org_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_org_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- Set (transaction-locally) only by org_delete while it tears down an
  -- entire organization; the owner row must go with it.
  if current_setting('app.allow_owner_removal', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.is_owner then
      raise exception 'the organization owner cannot be removed';
    end if;
    return old;
  end if;
  if old.is_owner and not new.is_owner then
    raise exception 'the organization owner cannot be demoted';
  end if;
  return new;
end;
$$;

--
-- Name: punch_corrections_stamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.punch_corrections_stamp() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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

--
-- Name: reset_demo_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_demo_org(p_org uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    raise exception 'reset_demo_org: % is not a demo organization', p_org;
  end if;

  delete from open_shift_claims        where org_id = p_org;
  delete from open_shifts              where org_id = p_org;
  delete from punch_records            where org_id = p_org;
  delete from shift_swaps              where org_id = p_org;
  delete from draft_schedules          where org_id = p_org;
  delete from schedule_generation_runs where org_id = p_org;
  delete from schedule_template_rows   where org_id = p_org;
  delete from schedule_templates       where org_id = p_org;
  delete from schedules                where org_id = p_org;
  delete from availability             where org_id = p_org;
  delete from employee_preferences     where org_id = p_org;
  delete from time_off_requests        where org_id = p_org;
  delete from callouts                 where org_id = p_org;
  delete from messages                 where org_id = p_org;
  delete from notifications            where org_id = p_org;
  delete from audit_logs               where org_id = p_org;
  delete from coverage_profile_blocks  where org_id = p_org;
  delete from coverage_date_overrides  where org_id = p_org;
  delete from coverage_day_defaults    where org_id = p_org;
  delete from coverage_profiles        where org_id = p_org;
  delete from store_hours              where org_id = p_org;
  delete from app_settings             where org_id = p_org;
  delete from employees                where org_id = p_org;
  delete from managers                 where org_id = p_org;
end;
$$;

--
-- Name: store_timezone(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.store_timezone(p_org uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_tz text;
begin
  select value into v_tz from public.app_settings where org_id = p_org and key = 'timezone';
  if v_tz is null then
    return 'America/New_York';
  end if;
  perform now() at time zone v_tz; -- rows are validated on write; this guards older ones
  return v_tz;
exception when others then
  return 'America/New_York';
end;
$$;

--
-- Name: try_parse_float8(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_parse_float8(p text) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return p::double precision;
exception when others then
  return null;
end;
$$;

--
-- Name: undo_generation_run(uuid, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_generation_run(p_org uuid, p_run_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_run      record; -- not %rowtype: see apply_generated_drafts
  v_removed  int := 0;
  v_restored int := 0;
begin
  if not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select * into v_run
    from public.schedule_generation_runs
   where id = p_run_id and org_id = p_org;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('schedule_generation:' || p_org::text || ':' || v_run.week_start::text, 0)
  );
  select * into v_run
    from public.schedule_generation_runs
   where id = p_run_id and org_id = p_org
     for update;

  if v_run.undone_at is not null then
    return jsonb_build_object('status', 'already_undone');
  end if;
  if v_run.published_at is not null then
    return jsonb_build_object('status', 'published');
  end if;
  if exists (
    select 1 from public.schedule_generation_runs r
     where r.org_id = p_org and r.week_start = v_run.week_start
       and r.id > v_run.id and r.undone_at is null
  ) then
    return jsonb_build_object('status', 'not_latest');
  end if;

  delete from public.draft_schedules
   where org_id = p_org and generation_run_id = p_run_id;
  get diagnostics v_removed = row_count;

  insert into public.draft_schedules
    (org_id, employee_id, date, start_minutes, end_minutes, generation_run_id)
  select p_org, d.employee_id, d.date, d.start_minutes, d.end_minutes, d.generation_run_id
    from jsonb_to_recordset(v_run.previous_drafts)
      as d(employee_id bigint, date date, start_minutes int, end_minutes int, generation_run_id bigint)
   where exists (
     select 1 from public.employees e where e.id = d.employee_id and e.org_id = p_org
   )
  on conflict (org_id, employee_id, date) do nothing;
  get diagnostics v_restored = row_count;

  update public.schedule_generation_runs set undone_at = now() where id = p_run_id;

  return jsonb_build_object(
    'status', 'ok', 'week_start', v_run.week_start, 'removed', v_removed, 'restored', v_restored
  );
end;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.announcements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.announcements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    action text NOT NULL,
    actor_id uuid,
    resource_type text,
    resource_id text,
    before jsonb,
    after jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    day_of_week smallint NOT NULL,
    note text,
    start_minutes integer,
    end_minutes integer,
    org_id uuid NOT NULL,
    CONSTRAINT availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);

--
-- Name: availability_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.availability ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.availability_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: callouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.callouts (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    employee_id bigint NOT NULL,
    date date NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: callouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.callouts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.callouts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: coverage_date_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_date_overrides (
    date date NOT NULL,
    profile_id bigint NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: coverage_day_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_day_defaults (
    day_of_week integer NOT NULL,
    profile_id bigint NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT coverage_day_defaults_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);

--
-- Name: coverage_profile_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_profile_blocks (
    id bigint NOT NULL,
    profile_id bigint NOT NULL,
    start_minutes integer NOT NULL,
    end_minutes integer NOT NULL,
    headcount integer NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT coverage_profile_blocks_check CHECK ((start_minutes < end_minutes)),
    CONSTRAINT coverage_profile_blocks_end_minutes_check CHECK (((end_minutes > 0) AND (end_minutes <= 1440) AND ((end_minutes % 15) = 0))),
    CONSTRAINT coverage_profile_blocks_headcount_check CHECK (((headcount >= 0) AND (headcount <= 99))),
    CONSTRAINT coverage_profile_blocks_start_minutes_check CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND ((start_minutes % 15) = 0)))
);

--
-- Name: coverage_profile_blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.coverage_profile_blocks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.coverage_profile_blocks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: coverage_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coverage_profiles (
    id bigint NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: coverage_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.coverage_profiles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.coverage_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: device_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_presence (
    endpoint text NOT NULL,
    user_id uuid NOT NULL,
    active_until timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: draft_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_schedules (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    date date NOT NULL,
    start_minutes integer NOT NULL,
    end_minutes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    generation_run_id bigint,
    CONSTRAINT draft_schedules_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960)))
);

--
-- Name: draft_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.draft_schedules ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.draft_schedules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: employee_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_preferences (
    org_id uuid NOT NULL,
    employee_id bigint NOT NULL,
    preferred_shift_types text[] DEFAULT '{}'::text[] NOT NULL,
    preferred_days smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    avoid_days smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    desired_weekly_hours numeric(4,1),
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_preferences_days_check CHECK (((preferred_days <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]) AND (avoid_days <@ ARRAY[(0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint, (6)::smallint]))),
    CONSTRAINT employee_preferences_days_disjoint_check CHECK ((NOT (preferred_days && avoid_days))),
    CONSTRAINT employee_preferences_desired_hours_check CHECK (((desired_weekly_hours IS NULL) OR ((desired_weekly_hours >= (0)::numeric) AND (desired_weekly_hours <= (80)::numeric)))),
    CONSTRAINT employee_preferences_note_check CHECK (((note IS NULL) OR (length(note) <= 500))),
    CONSTRAINT employee_preferences_shift_types_check CHECK ((preferred_shift_types <@ ARRAY['opener'::text, 'mid'::text, 'closer'::text]))
);

--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    name text NOT NULL,
    user_id uuid,
    email text,
    org_id uuid NOT NULL,
    pay_rate numeric(10,2),
    hire_date date,
    employment_type text,
    min_weekly_hours numeric(4,1),
    max_weekly_hours numeric(4,1),
    max_days_per_week smallint,
    CONSTRAINT chk_name_not_empty CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT employees_employment_type_check CHECK (((employment_type IS NULL) OR (employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text])))),
    CONSTRAINT employees_max_days_per_week_check CHECK (((max_days_per_week IS NULL) OR ((max_days_per_week >= 1) AND (max_days_per_week <= 7)))),
    CONSTRAINT employees_weekly_hours_check CHECK ((((min_weekly_hours IS NULL) OR ((min_weekly_hours >= (0)::numeric) AND (min_weekly_hours <= (80)::numeric))) AND ((max_weekly_hours IS NULL) OR ((max_weekly_hours >= (0)::numeric) AND (max_weekly_hours <= (80)::numeric))) AND ((min_weekly_hours IS NULL) OR (max_weekly_hours IS NULL) OR (min_weekly_hours <= max_weekly_hours))))
);

--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;

--
-- Name: managers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.managers (
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    is_owner boolean DEFAULT false NOT NULL
);

--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    conversation_id text NOT NULL,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    body text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT messages_body_check CHECK (((char_length(body) > 0) AND (char_length(body) <= 2000))),
    CONSTRAINT messages_conversation_pair_check CHECK (((from_user_id <> to_user_id) AND (conversation_id = ((LEAST(((from_user_id)::text COLLATE "C"), ((to_user_id)::text COLLATE "C")) || '_'::text) || GREATEST(((from_user_id)::text COLLATE "C"), ((to_user_id)::text COLLATE "C"))))))
);

--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_cleared boolean DEFAULT false NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: open_shift_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_shift_claims (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    open_shift_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_shift_claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);

--
-- Name: open_shift_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.open_shift_claims ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.open_shift_claims_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: open_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_shifts (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    date date NOT NULL,
    start_minutes integer NOT NULL,
    end_minutes integer NOT NULL,
    note text,
    status text DEFAULT 'open'::text NOT NULL,
    filled_by bigint,
    filled_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_shifts_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960))),
    CONSTRAINT open_shifts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'filled'::text, 'cancelled'::text]))),
    CONSTRAINT open_shifts_time_order CHECK ((start_minutes < end_minutes))
);

--
-- Name: open_shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.open_shifts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.open_shifts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
);

--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.positions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.positions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: punch_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.punch_corrections (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    employee_id bigint NOT NULL,
    punch_type text NOT NULL,
    punched_at timestamp with time zone NOT NULL,
    note text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    punch_id bigint,
    CONSTRAINT punch_corrections_note_check CHECK ((length(btrim(note)) > 0)),
    CONSTRAINT punch_corrections_punch_type_check CHECK ((punch_type = ANY (ARRAY['clock_in'::text, 'clock_out'::text, 'break_start'::text, 'break_end'::text]))),
    CONSTRAINT punch_corrections_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);

--
-- Name: punch_corrections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.punch_corrections ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.punch_corrections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: punch_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.punch_records (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    schedule_id bigint,
    punch_type text NOT NULL,
    punched_at timestamp with time zone DEFAULT now() NOT NULL,
    lat double precision,
    lng double precision,
    is_manual boolean DEFAULT false NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT punch_records_coordinates_check CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))),
    CONSTRAINT punch_records_punch_type_check CHECK ((punch_type = ANY (ARRAY['clock_in'::text, 'clock_out'::text, 'break_start'::text, 'break_end'::text])))
);

--
-- Name: punch_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.punch_records ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.punch_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: schedule_generation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_generation_runs (
    id bigint NOT NULL,
    org_id uuid NOT NULL,
    week_start date NOT NULL,
    mode text NOT NULL,
    seed bigint NOT NULL,
    rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    adjustments jsonb DEFAULT '[]'::jsonb NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    previous_drafts jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    undone_at timestamp with time zone,
    published_at timestamp with time zone,
    CONSTRAINT schedule_generation_runs_mode_check CHECK ((mode = ANY (ARRAY['fill'::text, 'replace'::text])))
);

--
-- Name: schedule_generation_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.schedule_generation_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schedule_generation_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: schedule_template_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_template_rows (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    day_of_week smallint NOT NULL,
    start_minutes integer NOT NULL,
    end_minutes integer NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT schedule_template_rows_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT schedule_template_rows_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960)))
);

--
-- Name: schedule_template_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.schedule_template_rows ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schedule_template_rows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: schedule_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_templates (
    id bigint NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL
);

--
-- Name: schedule_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.schedule_templates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.schedule_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    date date NOT NULL,
    start_minutes integer NOT NULL,
    end_minutes integer NOT NULL,
    org_id uuid NOT NULL,
    position_id bigint,
    CONSTRAINT chk_min_shift_length CHECK (((end_minutes - start_minutes) >= 60)),
    CONSTRAINT schedules_shift_times CHECK (((start_minutes >= 0) AND (start_minutes < 1440) AND (end_minutes > start_minutes) AND ((end_minutes - start_minutes) <= 960)))
);

--
-- Name: schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schedules_id_seq OWNED BY public.schedules.id;

--
-- Name: shift_swaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_swaps (
    id bigint NOT NULL,
    requester_id bigint NOT NULL,
    target_id bigint NOT NULL,
    schedule_a_id bigint NOT NULL,
    schedule_b_id bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT shift_swaps_distinct_check CHECK (((requester_id <> target_id) AND (schedule_a_id <> schedule_b_id))),
    CONSTRAINT shift_swaps_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'approved'::text, 'denied'::text])))
);

--
-- Name: shift_swaps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.shift_swaps ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.shift_swaps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: store_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_hours (
    day_of_week smallint NOT NULL,
    open_minutes integer NOT NULL,
    close_minutes integer NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT store_hours_check CHECK ((open_minutes < close_minutes)),
    CONSTRAINT store_hours_check1 CHECK (((close_minutes - open_minutes) >= 60)),
    CONSTRAINT store_hours_close_minutes_check CHECK (((close_minutes > 0) AND (close_minutes <= 1440))),
    CONSTRAINT store_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT store_hours_open_minutes_check CHECK (((open_minutes >= 0) AND (open_minutes < 1440)))
);

--
-- Name: time_off_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_off_requests (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    date date NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    CONSTRAINT time_off_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])))
);

--
-- Name: time_off_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.time_off_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.time_off_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: user_notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notification_preferences (
    user_id uuid NOT NULL,
    late_punch_alerts boolean DEFAULT true NOT NULL,
    message_alerts boolean DEFAULT true NOT NULL,
    pto_alerts boolean DEFAULT true NOT NULL,
    new_shift_alerts boolean DEFAULT true NOT NULL,
    shift_change_alerts boolean DEFAULT true NOT NULL,
    swap_alerts boolean DEFAULT true NOT NULL,
    shift_reminder_alerts boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chess_alerts boolean DEFAULT true NOT NULL
);

--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);

--
-- Name: schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules ALTER COLUMN id SET DEFAULT nextval('public.schedules_id_seq'::regclass);

--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (org_id, key);

--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

--
-- Name: availability availability_employee_id_day_of_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_employee_id_day_of_week_key UNIQUE (employee_id, day_of_week);

--
-- Name: availability availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_pkey PRIMARY KEY (id);

--
-- Name: callouts callouts_org_id_employee_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.callouts
    ADD CONSTRAINT callouts_org_id_employee_id_date_key UNIQUE (org_id, employee_id, date);

--
-- Name: callouts callouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.callouts
    ADD CONSTRAINT callouts_pkey PRIMARY KEY (id);

--
-- Name: coverage_date_overrides coverage_date_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_date_overrides
    ADD CONSTRAINT coverage_date_overrides_pkey PRIMARY KEY (org_id, date);

--
-- Name: coverage_day_defaults coverage_day_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_day_defaults
    ADD CONSTRAINT coverage_day_defaults_pkey PRIMARY KEY (org_id, day_of_week);

--
-- Name: coverage_profile_blocks coverage_profile_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_profile_blocks
    ADD CONSTRAINT coverage_profile_blocks_pkey PRIMARY KEY (id);

--
-- Name: coverage_profiles coverage_profiles_id_org_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_profiles
    ADD CONSTRAINT coverage_profiles_id_org_key UNIQUE (id, org_id);

--
-- Name: coverage_profiles coverage_profiles_org_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_profiles
    ADD CONSTRAINT coverage_profiles_org_name_unique UNIQUE (org_id, name);

--
-- Name: coverage_profiles coverage_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_profiles
    ADD CONSTRAINT coverage_profiles_pkey PRIMARY KEY (id);

--
-- Name: device_presence device_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_presence
    ADD CONSTRAINT device_presence_pkey PRIMARY KEY (endpoint);

--
-- Name: draft_schedules draft_schedules_org_employee_date_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_schedules
    ADD CONSTRAINT draft_schedules_org_employee_date_unique UNIQUE (org_id, employee_id, date);

--
-- Name: draft_schedules draft_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_schedules
    ADD CONSTRAINT draft_schedules_pkey PRIMARY KEY (id);

--
-- Name: employee_preferences employee_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_preferences
    ADD CONSTRAINT employee_preferences_pkey PRIMARY KEY (org_id, employee_id);

--
-- Name: employees employees_id_org_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_id_org_unique UNIQUE (id, org_id);

--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);

--
-- Name: managers managers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_pkey PRIMARY KEY (org_id, user_id);

--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: open_shift_claims open_shift_claims_org_id_open_shift_id_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shift_claims
    ADD CONSTRAINT open_shift_claims_org_id_open_shift_id_employee_id_key UNIQUE (org_id, open_shift_id, employee_id);

--
-- Name: open_shift_claims open_shift_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shift_claims
    ADD CONSTRAINT open_shift_claims_pkey PRIMARY KEY (id);

--
-- Name: open_shifts open_shifts_id_org_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shifts
    ADD CONSTRAINT open_shifts_id_org_key UNIQUE (id, org_id);

--
-- Name: open_shifts open_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shifts
    ADD CONSTRAINT open_shifts_pkey PRIMARY KEY (id);

--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);

--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);

--
-- Name: positions positions_id_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_id_org_id_key UNIQUE (id, org_id);

--
-- Name: positions positions_org_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_org_id_name_key UNIQUE (org_id, name);

--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);

--
-- Name: punch_corrections punch_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_corrections
    ADD CONSTRAINT punch_corrections_pkey PRIMARY KEY (id);

--
-- Name: punch_records punch_records_id_org_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_records
    ADD CONSTRAINT punch_records_id_org_unique UNIQUE (id, org_id);

--
-- Name: punch_records punch_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_records
    ADD CONSTRAINT punch_records_pkey PRIMARY KEY (id);

--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);

--
-- Name: push_subscriptions push_subscriptions_user_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);

--
-- Name: schedule_generation_runs schedule_generation_runs_id_org_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_generation_runs
    ADD CONSTRAINT schedule_generation_runs_id_org_key UNIQUE (id, org_id);

--
-- Name: schedule_generation_runs schedule_generation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_generation_runs
    ADD CONSTRAINT schedule_generation_runs_pkey PRIMARY KEY (id);

--
-- Name: schedule_template_rows schedule_template_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_rows
    ADD CONSTRAINT schedule_template_rows_pkey PRIMARY KEY (id);

--
-- Name: schedule_templates schedule_templates_id_org_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_id_org_unique UNIQUE (id, org_id);

--
-- Name: schedule_templates schedule_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_pkey PRIMARY KEY (id);

--
-- Name: schedules schedules_id_org_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_id_org_unique UNIQUE (id, org_id);

--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);

--
-- Name: shift_swaps shift_swaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_pkey PRIMARY KEY (id);

--
-- Name: store_hours store_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_hours
    ADD CONSTRAINT store_hours_pkey PRIMARY KEY (org_id, day_of_week);

--
-- Name: time_off_requests time_off_requests_employee_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_employee_id_date_key UNIQUE (employee_id, date);

--
-- Name: time_off_requests time_off_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_pkey PRIMARY KEY (id);

--
-- Name: user_notification_preferences user_notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_preferences
    ADD CONSTRAINT user_notification_preferences_pkey PRIMARY KEY (user_id);

--
-- Name: announcements_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_org_created_idx ON public.announcements USING btree (org_id, created_at DESC);

--
-- Name: audit_logs_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);

--
-- Name: audit_logs_actor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_actor_id_idx ON public.audit_logs USING btree (actor_id);

--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at DESC);

--
-- Name: audit_logs_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_org_created_idx ON public.audit_logs USING btree (org_id, created_at);

--
-- Name: audit_logs_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_resource_idx ON public.audit_logs USING btree (resource_type, resource_id);

--
-- Name: availability_org_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX availability_org_employee_idx ON public.availability USING btree (org_id, employee_id);

--
-- Name: callouts_org_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX callouts_org_date_idx ON public.callouts USING btree (org_id, date);

--
-- Name: coverage_profile_blocks_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coverage_profile_blocks_org_idx ON public.coverage_profile_blocks USING btree (org_id, profile_id);

--
-- Name: device_presence_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_presence_user_idx ON public.device_presence USING btree (user_id);

--
-- Name: draft_schedules_generation_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX draft_schedules_generation_run_idx ON public.draft_schedules USING btree (generation_run_id);

--
-- Name: draft_schedules_org_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX draft_schedules_org_date_idx ON public.draft_schedules USING btree (org_id, date);

--
-- Name: employees_org_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employees_org_email_unique ON public.employees USING btree (org_id, lower(email)) WHERE (email IS NOT NULL);

--
-- Name: employees_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employees_org_idx ON public.employees USING btree (org_id);

--
-- Name: employees_org_user_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employees_org_user_unique ON public.employees USING btree (org_id, user_id) WHERE (user_id IS NOT NULL);

--
-- Name: employees_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employees_user_id_idx ON public.employees USING btree (user_id);

--
-- Name: managers_org_owner_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX managers_org_owner_uniq ON public.managers USING btree (org_id) WHERE is_owner;

--
-- Name: managers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX managers_user_idx ON public.managers USING btree (user_id);

--
-- Name: messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_idx ON public.messages USING btree (conversation_id, created_at);

--
-- Name: messages_org_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_org_conversation_idx ON public.messages USING btree (org_id, conversation_id);

--
-- Name: notifications_org_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_org_user_created_idx ON public.notifications USING btree (org_id, user_id, created_at DESC);

--
-- Name: open_shift_claims_org_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_shift_claims_org_employee_idx ON public.open_shift_claims USING btree (org_id, employee_id);

--
-- Name: open_shifts_org_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_shifts_org_date_idx ON public.open_shifts USING btree (org_id, date);

--
-- Name: open_shifts_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_shifts_org_status_idx ON public.open_shifts USING btree (org_id, status);

--
-- Name: punch_corrections_org_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_corrections_org_employee_idx ON public.punch_corrections USING btree (org_id, employee_id, created_at DESC);

--
-- Name: punch_corrections_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_corrections_org_status_idx ON public.punch_corrections USING btree (org_id, status, created_at DESC);

--
-- Name: punch_corrections_punch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_corrections_punch_idx ON public.punch_corrections USING btree (punch_id) WHERE (punch_id IS NOT NULL);

--
-- Name: punch_records_org_employee_punched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_records_org_employee_punched_idx ON public.punch_records USING btree (org_id, employee_id, punched_at);

--
-- Name: punch_records_org_punched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_records_org_punched_idx ON public.punch_records USING btree (org_id, punched_at);

--
-- Name: punch_records_schedule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX punch_records_schedule_idx ON public.punch_records USING btree (schedule_id) WHERE (schedule_id IS NOT NULL);

--
-- Name: schedule_generation_runs_org_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_generation_runs_org_week_idx ON public.schedule_generation_runs USING btree (org_id, week_start, id DESC);

--
-- Name: schedules_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedules_date_idx ON public.schedules USING btree (date);

--
-- Name: schedules_org_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedules_org_date_idx ON public.schedules USING btree (org_id, date);

--
-- Name: schedules_org_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedules_org_employee_idx ON public.schedules USING btree (org_id, employee_id);

--
-- Name: shift_swaps_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swaps_org_idx ON public.shift_swaps USING btree (org_id);

--
-- Name: shift_swaps_schedule_a_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swaps_schedule_a_idx ON public.shift_swaps USING btree (schedule_a_id);

--
-- Name: shift_swaps_schedule_b_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swaps_schedule_b_idx ON public.shift_swaps USING btree (schedule_b_id);

--
-- Name: template_rows_org_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_rows_org_template_idx ON public.schedule_template_rows USING btree (org_id, template_id);

--
-- Name: time_off_org_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_off_org_date_idx ON public.time_off_requests USING btree (org_id, date);

--
-- Name: app_settings app_settings_timezone; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_settings_timezone BEFORE INSERT OR UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.enforce_timezone_setting();

--
-- Name: callouts callouts_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER callouts_rules BEFORE INSERT OR UPDATE ON public.callouts FOR EACH ROW EXECUTE FUNCTION public.enforce_callout_rules();

--
-- Name: employees employees_protect_link; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER employees_protect_link BEFORE INSERT OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.protect_employee_link();

--
-- Name: managers managers_protect_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER managers_protect_owner BEFORE DELETE OR UPDATE ON public.managers FOR EACH ROW EXECUTE FUNCTION public.protect_org_owner();

--
-- Name: messages messages_recipient_in_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_recipient_in_org BEFORE INSERT OR UPDATE OF org_id, to_user_id ON public.messages FOR EACH ROW EXECUTE FUNCTION public.enforce_recipient_in_org('to_user_id');

--
-- Name: notifications notifications_recipient_in_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notifications_recipient_in_org BEFORE INSERT OR UPDATE OF org_id, user_id ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.enforce_recipient_in_org('user_id');

--
-- Name: punch_corrections punch_corrections_stamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER punch_corrections_stamp BEFORE INSERT ON public.punch_corrections FOR EACH ROW EXECUTE FUNCTION public.punch_corrections_stamp();

--
-- Name: punch_records punch_records_integrity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER punch_records_integrity BEFORE INSERT OR DELETE OR UPDATE ON public.punch_records FOR EACH ROW EXECUTE FUNCTION public.enforce_punch_integrity();

--
-- Name: punch_records punch_records_integrity_geofence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER punch_records_integrity_geofence BEFORE INSERT ON public.punch_records FOR EACH ROW EXECUTE FUNCTION public.enforce_punch_geofence();

--
-- Name: punch_records punch_records_schedule_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER punch_records_schedule_owner BEFORE INSERT OR UPDATE OF schedule_id, employee_id, org_id ON public.punch_records FOR EACH ROW EXECUTE FUNCTION public.enforce_punch_schedule();

--
-- Name: shift_swaps shift_swaps_response; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER shift_swaps_response BEFORE UPDATE ON public.shift_swaps FOR EACH ROW EXECUTE FUNCTION public.enforce_swap_response();

--
-- Name: announcements announcements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: app_settings app_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: audit_logs audit_logs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: availability availability_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

--
-- Name: availability availability_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: availability availability_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: callouts callouts_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.callouts
    ADD CONSTRAINT callouts_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: callouts callouts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.callouts
    ADD CONSTRAINT callouts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: coverage_date_overrides coverage_date_overrides_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_date_overrides
    ADD CONSTRAINT coverage_date_overrides_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: coverage_date_overrides coverage_date_overrides_profile_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_date_overrides
    ADD CONSTRAINT coverage_date_overrides_profile_org_fkey FOREIGN KEY (profile_id, org_id) REFERENCES public.coverage_profiles(id, org_id) ON DELETE CASCADE;

--
-- Name: coverage_day_defaults coverage_day_defaults_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_day_defaults
    ADD CONSTRAINT coverage_day_defaults_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: coverage_day_defaults coverage_day_defaults_profile_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_day_defaults
    ADD CONSTRAINT coverage_day_defaults_profile_org_fkey FOREIGN KEY (profile_id, org_id) REFERENCES public.coverage_profiles(id, org_id) ON DELETE CASCADE;

--
-- Name: coverage_profile_blocks coverage_profile_blocks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_profile_blocks
    ADD CONSTRAINT coverage_profile_blocks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: coverage_profile_blocks coverage_profile_blocks_profile_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_profile_blocks
    ADD CONSTRAINT coverage_profile_blocks_profile_org_fkey FOREIGN KEY (profile_id, org_id) REFERENCES public.coverage_profiles(id, org_id) ON DELETE CASCADE;

--
-- Name: coverage_profiles coverage_profiles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coverage_profiles
    ADD CONSTRAINT coverage_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: device_presence device_presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_presence
    ADD CONSTRAINT device_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: draft_schedules draft_schedules_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_schedules
    ADD CONSTRAINT draft_schedules_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

--
-- Name: draft_schedules draft_schedules_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_schedules
    ADD CONSTRAINT draft_schedules_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: draft_schedules draft_schedules_generation_run_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_schedules
    ADD CONSTRAINT draft_schedules_generation_run_org_fkey FOREIGN KEY (generation_run_id, org_id) REFERENCES public.schedule_generation_runs(id, org_id) ON DELETE SET NULL (generation_run_id);

--
-- Name: draft_schedules draft_schedules_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_schedules
    ADD CONSTRAINT draft_schedules_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: employee_preferences employee_preferences_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_preferences
    ADD CONSTRAINT employee_preferences_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id) ON DELETE CASCADE;

--
-- Name: employee_preferences employee_preferences_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_preferences
    ADD CONSTRAINT employee_preferences_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: employees employees_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: employees employees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

--
-- Name: schedules fk_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT fk_employee FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;

--
-- Name: managers managers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: managers managers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managers
    ADD CONSTRAINT managers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: messages messages_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: messages messages_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: messages messages_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: notifications notifications_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: open_shift_claims open_shift_claims_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shift_claims
    ADD CONSTRAINT open_shift_claims_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: open_shift_claims open_shift_claims_open_shift_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shift_claims
    ADD CONSTRAINT open_shift_claims_open_shift_org_fkey FOREIGN KEY (open_shift_id, org_id) REFERENCES public.open_shifts(id, org_id) ON DELETE CASCADE;

--
-- Name: open_shift_claims open_shift_claims_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shift_claims
    ADD CONSTRAINT open_shift_claims_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: open_shifts open_shifts_filled_by_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shifts
    ADD CONSTRAINT open_shifts_filled_by_org_fkey FOREIGN KEY (filled_by, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: open_shifts open_shifts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_shifts
    ADD CONSTRAINT open_shifts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: positions positions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: punch_corrections punch_corrections_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_corrections
    ADD CONSTRAINT punch_corrections_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id) ON DELETE CASCADE;

--
-- Name: punch_corrections punch_corrections_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_corrections
    ADD CONSTRAINT punch_corrections_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

--
-- Name: punch_corrections punch_corrections_punch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_corrections
    ADD CONSTRAINT punch_corrections_punch_id_fkey FOREIGN KEY (punch_id) REFERENCES public.punch_records(id) ON DELETE SET NULL;

--
-- Name: punch_corrections punch_corrections_punch_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_corrections
    ADD CONSTRAINT punch_corrections_punch_org_fkey FOREIGN KEY (punch_id, org_id) REFERENCES public.punch_records(id, org_id) ON DELETE SET NULL (punch_id);

--
-- Name: punch_records punch_records_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_records
    ADD CONSTRAINT punch_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

--
-- Name: punch_records punch_records_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_records
    ADD CONSTRAINT punch_records_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: punch_records punch_records_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_records
    ADD CONSTRAINT punch_records_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: punch_records punch_records_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_records
    ADD CONSTRAINT punch_records_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE SET NULL;

--
-- Name: punch_records punch_records_schedule_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.punch_records
    ADD CONSTRAINT punch_records_schedule_org_fkey FOREIGN KEY (schedule_id, org_id) REFERENCES public.schedules(id, org_id);

--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: schedule_generation_runs schedule_generation_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_generation_runs
    ADD CONSTRAINT schedule_generation_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: schedule_template_rows schedule_template_rows_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_rows
    ADD CONSTRAINT schedule_template_rows_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

--
-- Name: schedule_template_rows schedule_template_rows_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_rows
    ADD CONSTRAINT schedule_template_rows_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: schedule_template_rows schedule_template_rows_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_rows
    ADD CONSTRAINT schedule_template_rows_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.schedule_templates(id) ON DELETE CASCADE;

--
-- Name: schedule_templates schedule_templates_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: schedules schedules_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: schedules schedules_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: schedules schedules_position_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_position_org_fkey FOREIGN KEY (position_id, org_id) REFERENCES public.positions(id, org_id) ON DELETE SET NULL;

--
-- Name: shift_swaps shift_swaps_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: shift_swaps shift_swaps_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.employees(id) ON DELETE CASCADE;

--
-- Name: shift_swaps shift_swaps_requester_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_requester_org_fkey FOREIGN KEY (requester_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: shift_swaps shift_swaps_schedule_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_schedule_a_id_fkey FOREIGN KEY (schedule_a_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

--
-- Name: shift_swaps shift_swaps_schedule_a_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_schedule_a_org_fkey FOREIGN KEY (schedule_a_id, org_id) REFERENCES public.schedules(id, org_id);

--
-- Name: shift_swaps shift_swaps_schedule_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_schedule_b_id_fkey FOREIGN KEY (schedule_b_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

--
-- Name: shift_swaps shift_swaps_schedule_b_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_schedule_b_org_fkey FOREIGN KEY (schedule_b_id, org_id) REFERENCES public.schedules(id, org_id);

--
-- Name: shift_swaps shift_swaps_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.employees(id) ON DELETE CASCADE;

--
-- Name: shift_swaps shift_swaps_target_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swaps
    ADD CONSTRAINT shift_swaps_target_org_fkey FOREIGN KEY (target_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: store_hours store_hours_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_hours
    ADD CONSTRAINT store_hours_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: schedule_template_rows template_rows_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_rows
    ADD CONSTRAINT template_rows_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: schedule_template_rows template_rows_template_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_template_rows
    ADD CONSTRAINT template_rows_template_org_fkey FOREIGN KEY (template_id, org_id) REFERENCES public.schedule_templates(id, org_id);

--
-- Name: time_off_requests time_off_employee_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_employee_org_fkey FOREIGN KEY (employee_id, org_id) REFERENCES public.employees(id, org_id);

--
-- Name: time_off_requests time_off_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

--
-- Name: time_off_requests time_off_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

--
-- Name: user_notification_preferences user_notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_preferences
    ADD CONSTRAINT user_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;

--
-- Name: callouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.callouts ENABLE ROW LEVEL SECURITY;

--
-- Name: coverage_date_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coverage_date_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: coverage_day_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coverage_day_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: coverage_profile_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coverage_profile_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: coverage_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coverage_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: device_presence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_presence ENABLE ROW LEVEL SECURITY;

--
-- Name: device_presence dp_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dp_own ON public.device_presence TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

--
-- Name: draft_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.draft_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: managers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.managers ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_preferences mt_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_all ON public.employee_preferences TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))))) WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: announcements mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.announcements FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: app_settings mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.app_settings FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: availability mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.availability FOR DELETE TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: callouts mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.callouts FOR DELETE TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: coverage_date_overrides mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.coverage_date_overrides FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_day_defaults mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.coverage_day_defaults FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_profile_blocks mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.coverage_profile_blocks FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_profiles mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.coverage_profiles FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: draft_schedules mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.draft_schedules FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: employees mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.employees FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: open_shift_claims mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.open_shift_claims FOR DELETE TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: open_shifts mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.open_shifts FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: positions mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.positions FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: punch_corrections mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.punch_corrections FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: punch_records mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.punch_records FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedule_template_rows mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.schedule_template_rows FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedule_templates mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.schedule_templates FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedules mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.schedules FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: shift_swaps mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.shift_swaps FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: store_hours mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.store_hours FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: time_off_requests mt_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_delete ON public.time_off_requests FOR DELETE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: announcements mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.announcements FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: app_settings mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.app_settings FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: availability mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.availability FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: callouts mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.callouts FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: coverage_date_overrides mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.coverage_date_overrides FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_day_defaults mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.coverage_day_defaults FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_profile_blocks mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.coverage_profile_blocks FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_profiles mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.coverage_profiles FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: draft_schedules mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.draft_schedules FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: employees mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.employees FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: messages mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.messages FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) AND (from_user_id = ( SELECT auth.uid() AS uid))));

--
-- Name: open_shift_claims mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.open_shift_claims FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR (((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))) AND (status = 'pending'::text))));

--
-- Name: open_shifts mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.open_shifts FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: positions mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.positions FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: punch_corrections mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.punch_corrections FOR INSERT TO authenticated WITH CHECK ((((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))) AND (status = 'pending'::text) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (punch_id IS NULL)));

--
-- Name: punch_records mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.punch_records FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: schedule_template_rows mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.schedule_template_rows FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedule_templates mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.schedule_templates FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedules mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.schedules FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: shift_swaps mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.shift_swaps FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR (((org_id, requester_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))) AND (COALESCE(status, 'pending'::text) = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM public.schedules a
  WHERE ((a.id = shift_swaps.schedule_a_id) AND (a.org_id = shift_swaps.org_id) AND (a.employee_id = shift_swaps.requester_id)))) AND (EXISTS ( SELECT 1
   FROM public.schedules b
  WHERE ((b.id = shift_swaps.schedule_b_id) AND (b.org_id = shift_swaps.org_id) AND (b.employee_id = shift_swaps.target_id)))))));

--
-- Name: store_hours mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.store_hours FOR INSERT TO authenticated WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: time_off_requests mt_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_insert ON public.time_off_requests FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR (((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))) AND (COALESCE(status, 'pending'::text) = 'pending'::text))));

--
-- Name: announcements mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.announcements FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: app_settings mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.app_settings FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: audit_logs mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.audit_logs FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: availability mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.availability FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: callouts mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.callouts FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: coverage_date_overrides mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.coverage_date_overrides FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: coverage_day_defaults mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.coverage_day_defaults FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: coverage_profile_blocks mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.coverage_profile_blocks FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: coverage_profiles mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.coverage_profiles FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: draft_schedules mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.draft_schedules FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: employees mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.employees FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: managers mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.managers FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: messages mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.messages FOR SELECT TO authenticated USING (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) AND ((from_user_id = ( SELECT auth.uid() AS uid)) OR (to_user_id = ( SELECT auth.uid() AS uid)))));

--
-- Name: notifications mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.notifications FOR SELECT TO authenticated USING (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ((user_id IS NULL) AND (org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))))));

--
-- Name: open_shift_claims mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.open_shift_claims FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: open_shifts mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.open_shifts FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: organizations mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.organizations FOR SELECT TO authenticated USING ((id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: positions mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.positions FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: punch_corrections mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.punch_corrections FOR SELECT TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: punch_records mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.punch_records FOR SELECT TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: schedule_generation_runs mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.schedule_generation_runs FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedule_template_rows mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.schedule_template_rows FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: schedule_templates mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.schedule_templates FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: schedules mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.schedules FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: shift_swaps mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.shift_swaps FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: store_hours mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.store_hours FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: time_off_requests mt_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_select ON public.time_off_requests FOR SELECT TO authenticated USING ((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)));

--
-- Name: announcements mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.announcements FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: app_settings mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.app_settings FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: availability mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.availability FOR UPDATE TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))))) WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: callouts mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.callouts FOR UPDATE TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))))) WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: coverage_date_overrides mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.coverage_date_overrides FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_day_defaults mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.coverage_day_defaults FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_profile_blocks mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.coverage_profile_blocks FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: coverage_profiles mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.coverage_profiles FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: draft_schedules mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.draft_schedules FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: employees mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.employees FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: messages mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.messages FOR UPDATE TO authenticated USING (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) AND (to_user_id = ( SELECT auth.uid() AS uid)))) WITH CHECK (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) AND (to_user_id = ( SELECT auth.uid() AS uid))));

--
-- Name: notifications mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.notifications FOR UPDATE TO authenticated USING (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ((user_id IS NULL) AND (org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)))))) WITH CHECK (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ((user_id IS NULL) AND (org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))))));

--
-- Name: open_shift_claims mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.open_shift_claims FOR UPDATE TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))))) WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR (((org_id, employee_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))) AND (status = 'pending'::text))));

--
-- Name: open_shifts mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.open_shifts FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: positions mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.positions FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: punch_corrections mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.punch_corrections FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: punch_records mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.punch_records FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedule_generation_runs mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.schedule_generation_runs FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedule_template_rows mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.schedule_template_rows FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedule_templates mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.schedule_templates FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: schedules mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.schedules FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: shift_swaps mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.shift_swaps FOR UPDATE TO authenticated USING (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, target_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id))))) WITH CHECK (((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)) OR ((org_id, target_id) IN ( SELECT my_employees.org_id,
    my_employees.employee_id
   FROM public.my_employees() my_employees(org_id, employee_id)))));

--
-- Name: store_hours mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.store_hours FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: time_off_requests mt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mt_update ON public.time_off_requests FOR UPDATE TO authenticated USING ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids))) WITH CHECK ((org_id IN ( SELECT public.my_managed_org_ids() AS my_managed_org_ids)));

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: open_shift_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_shift_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: open_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: punch_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.punch_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: punch_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.punch_records ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_own ON public.push_subscriptions TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

--
-- Name: schedule_generation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_generation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_template_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_template_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedule_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_swaps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_swaps ENABLE ROW LEVEL SECURITY;

--
-- Name: store_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: time_off_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notification_preferences users_own_notification_prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_own_notification_prefs ON public.user_notification_preferences TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

--
-- Name: FUNCTION apply_generated_drafts(p_org uuid, p_week_start date, p_mode text, p_replace_run_id bigint, p_expected jsonb, p_rows jsonb, p_seed bigint, p_rules jsonb, p_adjustments jsonb, p_metrics jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_generated_drafts(p_org uuid, p_week_start date, p_mode text, p_replace_run_id bigint, p_expected jsonb, p_rows jsonb, p_seed bigint, p_rules jsonb, p_adjustments jsonb, p_metrics jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_generated_drafts(p_org uuid, p_week_start date, p_mode text, p_replace_run_id bigint, p_expected jsonb, p_rows jsonb, p_seed bigint, p_rules jsonb, p_adjustments jsonb, p_metrics jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.apply_generated_drafts(p_org uuid, p_week_start date, p_mode text, p_replace_run_id bigint, p_expected jsonb, p_rows jsonb, p_seed bigint, p_rules jsonb, p_adjustments jsonb, p_metrics jsonb) TO service_role;

--
-- Name: FUNCTION approve_shift_swap(p_org uuid, p_swap_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_shift_swap(p_org uuid, p_swap_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_shift_swap(p_org uuid, p_swap_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.approve_shift_swap(p_org uuid, p_swap_id bigint) TO service_role;

--
-- Name: FUNCTION canonical_timezone(p_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.canonical_timezone(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.canonical_timezone(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.canonical_timezone(p_name text) TO service_role;

--
-- Name: FUNCTION employee_pay_rates(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.employee_pay_rates(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.employee_pay_rates(p_org uuid) TO authenticated;
GRANT ALL ON FUNCTION public.employee_pay_rates(p_org uuid) TO service_role;

--
-- Name: FUNCTION enforce_callout_rules(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_callout_rules() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_callout_rules() TO service_role;

--
-- Name: FUNCTION enforce_punch_geofence(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_punch_geofence() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_punch_geofence() TO service_role;

--
-- Name: FUNCTION enforce_punch_integrity(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_punch_integrity() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_punch_integrity() TO service_role;

--
-- Name: FUNCTION enforce_punch_schedule(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_punch_schedule() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_punch_schedule() TO service_role;

--
-- Name: FUNCTION enforce_recipient_in_org(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_recipient_in_org() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_recipient_in_org() TO service_role;

--
-- Name: FUNCTION enforce_swap_response(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_swap_response() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_swap_response() TO service_role;

--
-- Name: FUNCTION enforce_timezone_setting(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_timezone_setting() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_timezone_setting() TO service_role;

--
-- Name: FUNCTION is_org_manager(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_org_manager(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_org_manager(p_org uuid) TO service_role;

--
-- Name: FUNCTION is_org_member(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_org_member(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_org_member(p_org uuid) TO service_role;

--
-- Name: FUNCTION is_own_employee(p_org uuid, p_employee bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_own_employee(p_org uuid, p_employee bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_own_employee(p_org uuid, p_employee bigint) TO service_role;

--
-- Name: FUNCTION link_employee_account(p_org uuid, p_employee bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_employee_account(p_org uuid, p_employee bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_employee_account(p_org uuid, p_employee bigint) TO service_role;

--
-- Name: FUNCTION link_employee_on_signup(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_employee_on_signup() FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_employee_on_signup() TO service_role;

--
-- Name: FUNCTION manager_demote(p_org_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.manager_demote(p_org_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.manager_demote(p_org_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.manager_demote(p_org_id uuid, p_user_id uuid) TO service_role;

--
-- Name: FUNCTION manager_promote(p_org_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.manager_promote(p_org_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.manager_promote(p_org_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.manager_promote(p_org_id uuid, p_user_id uuid) TO service_role;

--
-- Name: FUNCTION my_employees(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_employees() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_employees() TO authenticated;
GRANT ALL ON FUNCTION public.my_employees() TO service_role;

--
-- Name: FUNCTION my_managed_org_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_managed_org_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_managed_org_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_managed_org_ids() TO service_role;

--
-- Name: FUNCTION my_org_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_org_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_org_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_org_ids() TO service_role;

--
-- Name: FUNCTION notify_delete_subs(p_user_id uuid, p_endpoints text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_delete_subs(p_user_id uuid, p_endpoints text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_delete_subs(p_user_id uuid, p_endpoints text[]) TO service_role;

--
-- Name: FUNCTION notify_get_active_endpoints(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_get_active_endpoints(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_get_active_endpoints(p_user_id uuid) TO service_role;

--
-- Name: FUNCTION notify_get_manager_ids(p_org_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_get_manager_ids(p_org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_get_manager_ids(p_org_id uuid) TO service_role;

--
-- Name: FUNCTION notify_get_push_prefs(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_get_push_prefs(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_get_push_prefs(p_user_id uuid) TO service_role;

--
-- Name: FUNCTION notify_get_push_subs(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_get_push_subs(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_get_push_subs(p_user_id uuid) TO service_role;

--
-- Name: FUNCTION notify_insert(p_org_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_insert(p_org_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_insert(p_org_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb) TO service_role;

--
-- Name: FUNCTION notify_upsert_chess(p_org_id uuid, p_user_id uuid, p_title text, p_body text, p_data jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_upsert_chess(p_org_id uuid, p_user_id uuid, p_title text, p_body text, p_data jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_upsert_chess(p_org_id uuid, p_user_id uuid, p_title text, p_body text, p_data jsonb) TO service_role;

--
-- Name: FUNCTION org_delete(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.org_delete(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.org_delete(p_org uuid) TO service_role;

--
-- Name: FUNCTION org_signup_create(p_name text, p_slug text, p_user_id uuid, p_owner_name text, p_owner_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.org_signup_create(p_name text, p_slug text, p_user_id uuid, p_owner_name text, p_owner_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.org_signup_create(p_name text, p_slug text, p_user_id uuid, p_owner_name text, p_owner_email text) TO service_role;

--
-- Name: FUNCTION presence_set(p_endpoint text, p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.presence_set(p_endpoint text, p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.presence_set(p_endpoint text, p_active boolean) TO authenticated;
GRANT ALL ON FUNCTION public.presence_set(p_endpoint text, p_active boolean) TO service_role;

--
-- Name: FUNCTION protect_employee_link(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_employee_link() FROM PUBLIC;
GRANT ALL ON FUNCTION public.protect_employee_link() TO service_role;

--
-- Name: FUNCTION protect_org_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_org_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.protect_org_owner() TO service_role;

--
-- Name: FUNCTION punch_corrections_stamp(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.punch_corrections_stamp() FROM PUBLIC;
GRANT ALL ON FUNCTION public.punch_corrections_stamp() TO service_role;

--
-- Name: FUNCTION reset_demo_org(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reset_demo_org(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_demo_org(p_org uuid) TO service_role;

--
-- Name: FUNCTION store_timezone(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.store_timezone(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_timezone(p_org uuid) TO service_role;

--
-- Name: FUNCTION try_parse_float8(p text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.try_parse_float8(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.try_parse_float8(p text) TO service_role;

--
-- Name: FUNCTION undo_generation_run(p_org uuid, p_run_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.undo_generation_run(p_org uuid, p_run_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.undo_generation_run(p_org uuid, p_run_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.undo_generation_run(p_org uuid, p_run_id bigint) TO service_role;

--
-- Name: TABLE announcements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.announcements TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;

--
-- Name: SEQUENCE announcements_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.announcements_id_seq TO anon;
GRANT ALL ON SEQUENCE public.announcements_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.announcements_id_seq TO service_role;

--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.app_settings TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;

--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.audit_logs TO anon;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

--
-- Name: SEQUENCE audit_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_logs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.audit_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_logs_id_seq TO service_role;

--
-- Name: TABLE availability; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.availability TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.availability TO authenticated;
GRANT ALL ON TABLE public.availability TO service_role;

--
-- Name: SEQUENCE availability_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.availability_id_seq TO anon;
GRANT ALL ON SEQUENCE public.availability_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.availability_id_seq TO service_role;

--
-- Name: TABLE callouts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.callouts TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.callouts TO authenticated;
GRANT ALL ON TABLE public.callouts TO service_role;

--
-- Name: SEQUENCE callouts_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.callouts_id_seq TO anon;
GRANT ALL ON SEQUENCE public.callouts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.callouts_id_seq TO service_role;

--
-- Name: TABLE coverage_date_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.coverage_date_overrides TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.coverage_date_overrides TO authenticated;
GRANT ALL ON TABLE public.coverage_date_overrides TO service_role;

--
-- Name: TABLE coverage_day_defaults; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.coverage_day_defaults TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.coverage_day_defaults TO authenticated;
GRANT ALL ON TABLE public.coverage_day_defaults TO service_role;

--
-- Name: TABLE coverage_profile_blocks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.coverage_profile_blocks TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.coverage_profile_blocks TO authenticated;
GRANT ALL ON TABLE public.coverage_profile_blocks TO service_role;

--
-- Name: SEQUENCE coverage_profile_blocks_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.coverage_profile_blocks_id_seq TO anon;
GRANT ALL ON SEQUENCE public.coverage_profile_blocks_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.coverage_profile_blocks_id_seq TO service_role;

--
-- Name: TABLE coverage_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.coverage_profiles TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.coverage_profiles TO authenticated;
GRANT ALL ON TABLE public.coverage_profiles TO service_role;

--
-- Name: SEQUENCE coverage_profiles_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.coverage_profiles_id_seq TO anon;
GRANT ALL ON SEQUENCE public.coverage_profiles_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.coverage_profiles_id_seq TO service_role;

--
-- Name: TABLE device_presence; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.device_presence TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.device_presence TO authenticated;
GRANT ALL ON TABLE public.device_presence TO service_role;

--
-- Name: TABLE draft_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.draft_schedules TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.draft_schedules TO authenticated;
GRANT ALL ON TABLE public.draft_schedules TO service_role;

--
-- Name: SEQUENCE draft_schedules_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.draft_schedules_id_seq TO anon;
GRANT ALL ON SEQUENCE public.draft_schedules_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.draft_schedules_id_seq TO service_role;

--
-- Name: TABLE employee_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.employee_preferences TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.employee_preferences TO authenticated;
GRANT ALL ON TABLE public.employee_preferences TO service_role;

--
-- Name: TABLE employees; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,DELETE,UPDATE ON TABLE public.employees TO authenticated;
GRANT ALL ON TABLE public.employees TO service_role;

--
-- Name: COLUMN employees.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.employees TO anon;
GRANT SELECT(id) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(name) ON TABLE public.employees TO anon;
GRANT SELECT(name) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.employees TO anon;
GRANT SELECT(user_id) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(email) ON TABLE public.employees TO anon;
GRANT SELECT(email) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.org_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(org_id) ON TABLE public.employees TO anon;
GRANT SELECT(org_id) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.hire_date; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(hire_date) ON TABLE public.employees TO anon;
GRANT SELECT(hire_date) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.employment_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(employment_type) ON TABLE public.employees TO anon;
GRANT SELECT(employment_type) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.min_weekly_hours; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(min_weekly_hours) ON TABLE public.employees TO anon;
GRANT SELECT(min_weekly_hours) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.max_weekly_hours; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(max_weekly_hours) ON TABLE public.employees TO anon;
GRANT SELECT(max_weekly_hours) ON TABLE public.employees TO authenticated;

--
-- Name: COLUMN employees.max_days_per_week; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(max_days_per_week) ON TABLE public.employees TO anon;
GRANT SELECT(max_days_per_week) ON TABLE public.employees TO authenticated;

--
-- Name: SEQUENCE employees_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.employees_id_seq TO anon;
GRANT ALL ON SEQUENCE public.employees_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.employees_id_seq TO service_role;

--
-- Name: TABLE managers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.managers TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.managers TO authenticated;
GRANT ALL ON TABLE public.managers TO service_role;

--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.messages TO anon;
GRANT SELECT,INSERT,DELETE ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

--
-- Name: COLUMN messages.read; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(read) ON TABLE public.messages TO authenticated;

--
-- Name: SEQUENCE messages_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.messages_id_seq TO service_role;

--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.notifications TO anon;
GRANT SELECT,INSERT,DELETE ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

--
-- Name: COLUMN notifications.read; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(read) ON TABLE public.notifications TO authenticated;

--
-- Name: COLUMN notifications.is_cleared; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(is_cleared) ON TABLE public.notifications TO authenticated;

--
-- Name: SEQUENCE notifications_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.notifications_id_seq TO anon;
GRANT ALL ON SEQUENCE public.notifications_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.notifications_id_seq TO service_role;

--
-- Name: TABLE open_shift_claims; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.open_shift_claims TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.open_shift_claims TO authenticated;
GRANT ALL ON TABLE public.open_shift_claims TO service_role;

--
-- Name: SEQUENCE open_shift_claims_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.open_shift_claims_id_seq TO anon;
GRANT ALL ON SEQUENCE public.open_shift_claims_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.open_shift_claims_id_seq TO service_role;

--
-- Name: TABLE open_shifts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.open_shifts TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.open_shifts TO authenticated;
GRANT ALL ON TABLE public.open_shifts TO service_role;

--
-- Name: SEQUENCE open_shifts_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.open_shifts_id_seq TO anon;
GRANT ALL ON SEQUENCE public.open_shifts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.open_shifts_id_seq TO service_role;

--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.organizations TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;

--
-- Name: TABLE positions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.positions TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.positions TO authenticated;
GRANT ALL ON TABLE public.positions TO service_role;

--
-- Name: SEQUENCE positions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.positions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.positions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.positions_id_seq TO service_role;

--
-- Name: TABLE punch_corrections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.punch_corrections TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.punch_corrections TO authenticated;
GRANT ALL ON TABLE public.punch_corrections TO service_role;

--
-- Name: SEQUENCE punch_corrections_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.punch_corrections_id_seq TO anon;
GRANT ALL ON SEQUENCE public.punch_corrections_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.punch_corrections_id_seq TO service_role;

--
-- Name: TABLE punch_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.punch_records TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.punch_records TO authenticated;
GRANT ALL ON TABLE public.punch_records TO service_role;

--
-- Name: SEQUENCE punch_records_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.punch_records_id_seq TO anon;
GRANT ALL ON SEQUENCE public.punch_records_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.punch_records_id_seq TO service_role;

--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.push_subscriptions TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

--
-- Name: SEQUENCE push_subscriptions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.push_subscriptions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.push_subscriptions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.push_subscriptions_id_seq TO service_role;

--
-- Name: TABLE schedule_generation_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.schedule_generation_runs TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.schedule_generation_runs TO authenticated;
GRANT ALL ON TABLE public.schedule_generation_runs TO service_role;

--
-- Name: SEQUENCE schedule_generation_runs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.schedule_generation_runs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.schedule_generation_runs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.schedule_generation_runs_id_seq TO service_role;

--
-- Name: TABLE schedule_template_rows; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.schedule_template_rows TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.schedule_template_rows TO authenticated;
GRANT ALL ON TABLE public.schedule_template_rows TO service_role;

--
-- Name: SEQUENCE schedule_template_rows_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.schedule_template_rows_id_seq TO anon;
GRANT ALL ON SEQUENCE public.schedule_template_rows_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.schedule_template_rows_id_seq TO service_role;

--
-- Name: TABLE schedule_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.schedule_templates TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.schedule_templates TO authenticated;
GRANT ALL ON TABLE public.schedule_templates TO service_role;

--
-- Name: SEQUENCE schedule_templates_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.schedule_templates_id_seq TO anon;
GRANT ALL ON SEQUENCE public.schedule_templates_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.schedule_templates_id_seq TO service_role;

--
-- Name: TABLE schedules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.schedules TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.schedules TO authenticated;
GRANT ALL ON TABLE public.schedules TO service_role;

--
-- Name: SEQUENCE schedules_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.schedules_id_seq TO anon;
GRANT ALL ON SEQUENCE public.schedules_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.schedules_id_seq TO service_role;

--
-- Name: TABLE shift_swaps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.shift_swaps TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shift_swaps TO authenticated;
GRANT ALL ON TABLE public.shift_swaps TO service_role;

--
-- Name: SEQUENCE shift_swaps_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.shift_swaps_id_seq TO anon;
GRANT ALL ON SEQUENCE public.shift_swaps_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.shift_swaps_id_seq TO service_role;

--
-- Name: TABLE store_hours; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.store_hours TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.store_hours TO authenticated;
GRANT ALL ON TABLE public.store_hours TO service_role;

--
-- Name: TABLE time_off_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.time_off_requests TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.time_off_requests TO authenticated;
GRANT ALL ON TABLE public.time_off_requests TO service_role;

--
-- Name: SEQUENCE time_off_requests_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.time_off_requests_id_seq TO anon;
GRANT ALL ON SEQUENCE public.time_off_requests_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.time_off_requests_id_seq TO service_role;

--
-- Name: TABLE user_notification_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.user_notification_preferences TO anon;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_notification_preferences TO authenticated;
GRANT ALL ON TABLE public.user_notification_preferences TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

--
-- PostgreSQL database dump complete
--


--
-- Objects outside the public schema that pg_dump -n public leaves out.
--

-- Links an invited employee row to its account when the account is created.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.link_employee_on_signup();

-- Realtime: tables the app subscribes to.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return; -- not a Supabase database
  end if;
  foreach t in array array[
    'announcements', 'app_settings', 'audit_logs', 'callouts', 'employees', 'managers',
    'messages', 'notifications', 'open_shift_claims', 'open_shifts', 'punch_corrections',
    'punch_records', 'schedules', 'shift_swaps', 'store_hours', 'time_off_requests'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

--
-- Fixed rows: the default and demo organizations (lib/org-context.ts
-- DEFAULT_ORG_ID, lib/demo-org.ts DEMO_ORG_ID).
--

INSERT INTO public.organizations (id, name, slug, is_demo) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default', false),
  ('00000000-0000-0000-0000-000000000002', 'Demo Organization', 'demo', true)
ON CONFLICT (id) DO NOTHING;

-- pg_dump clears search_path for the session; put the defaults back so later
-- migrations run in the same session see the usual settings.
RESET ALL;
