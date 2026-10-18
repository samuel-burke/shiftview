-- One store timezone, read the same way by the app and the database.
--
-- The app resolves app_settings.timezone with Intl (lib/dates.ts), which
-- accepts any capitalisation ("asia/tokyo" is Tokyo). The live clock-in check
-- in enforce_punch_integrity (0046) looked the value up in pg_timezone_names
-- by exact name, so a store saved as "asia/tokyo" had its store day judged in
-- America/New_York: a clock-in the app allowed (a new store day, after a
-- forgotten clock-out) was refused by the database, or the reverse. The other
-- time triggers (0032 callouts, 0043 punch shifts) use AT TIME ZONE, which is
-- case-insensitive but also accepts POSIX strings like 'XYZ-3' that the app
-- rejects. And scanning pg_timezone_names took ~7 ms on every punch.
--
-- Now:
--   * app_settings.timezone may only hold a name in pg_timezone_names, and is
--     stored with its canonical capitalisation ('asia/tokyo' → 'Asia/Tokyo').
--     The settings API answers 422 for anything else.
--   * Existing rows are normalised the same way; a value the database doesn't
--     know is replaced with America/New_York, the zone both the app and the
--     triggers already used for it.
--   * public.store_timezone(org) returns the org's zone (default
--     America/New_York) without scanning the catalogue, and
--     enforce_punch_integrity uses it. Otherwise unchanged from 0046.
--
-- Safe to repeat.

begin;

create or replace function public.canonical_timezone(p_name text)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select name from pg_timezone_names
   where lower(name) = lower(btrim(p_name))
     and name not in ('Factory', 'posixrules', 'localtime') -- not zones; Intl rejects them
   order by name = btrim(p_name) desc, name
   limit 1
$$;

create or replace function public.enforce_timezone_setting()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
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

update public.app_settings s
   set value = coalesce(public.canonical_timezone(s.value), 'America/New_York')
 where s.key = 'timezone'
   and s.value is distinct from coalesce(public.canonical_timezone(s.value), 'America/New_York');

drop trigger if exists app_settings_timezone on public.app_settings;
create trigger app_settings_timezone
  before insert or update on public.app_settings
  for each row execute function public.enforce_timezone_setting();

-- The org's store timezone, as lib/dates.ts resolveTimezone() picks it.
create or replace function public.store_timezone(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
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

-- Security definer (it reads any org's settings), so only the triggers that
-- run as its owner and the service role may call it: a signed-in user calling
-- it directly could read another organisation's timezone.
revoke all on function public.store_timezone(uuid) from public, anon, authenticated;
grant execute on function public.store_timezone(uuid) to service_role;
revoke all on function public.enforce_timezone_setting() from public, anon, authenticated;
revoke all on function public.canonical_timezone(text) from public, anon;
grant execute on function public.canonical_timezone(text) to authenticated, service_role;

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
    perform pg_advisory_xact_lock(
      hashtextextended('punch:' || new.org_id::text || ':' || new.employee_id::text, 0)
    );
    -- New in 0047: the store's day in the zone the app uses, whatever the
    -- stored capitalisation, without scanning pg_timezone_names.
    v_tz := public.store_timezone(new.org_id);

    -- clock_timestamp(), not now(): a punch committed while this one waited
    -- for the lock may carry a later transaction start than ours.
    select punch_type, punched_at into v_last_type, v_last_at
      from public.punch_records
     where org_id = new.org_id and employee_id = new.employee_id
       and punched_at <= clock_timestamp()
     order by punched_at desc, id desc
     limit 1;
    v_valid := case new.punch_type
      -- A clock-in over an open punch is only a new shift when that punch is
      -- from an earlier store day (a forgotten clock-out), as in /api/punches.
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

commit;
