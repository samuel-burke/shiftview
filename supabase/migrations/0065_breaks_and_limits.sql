-- Punch notes, the geofence, break types and minor-labor data.
--
-- 1. punch_records.employee_note: an employee's optional short note on a live
--    punch ("covering for Sam", "register 2 was down"). Kept apart from
--    `note`, which holds a manager's reason for a manual punch (0053 copies it
--    into the punch's history), so a manager's later edit never overwrites
--    what the employee wrote. The punch_records_integrity_note trigger cleans
--    it for every writer: control, zero-width and bidi-override characters
--    become spaces, runs of whitespace collapse, the ends are trimmed, and an
--    empty note is stored as null; then punch_records_employee_note_length
--    allows at most 140 characters. Once written it can't be changed by a
--    signed-in user (managers edit punches, not what employees said); the
--    service role can.
--
-- 2. enforce_punch_geofence (0050) checked a live clock-in against the
--    geofence only when "Require GPS for clock-in" was also on; with GPS
--    optional, a geofenced store let anyone clock in from anywhere. Now the
--    geofence applies whenever it is on and a centre is saved. A clock-in
--    with no location is refused (GF002, "location needed"), since the
--    geofence would be pointless otherwise; "Require GPS" still governs
--    stores without a geofence (the app asks for location there). The API
--    applies the same rule (POST /api/punches).
--
-- DEPLOY THIS BEFORE THE APP: the app reads and writes the new columns.
-- Safe to repeat.

begin;

-- ── 1. Employee notes on live punches ──────────────────────────────────────

alter table public.punch_records add column if not exists employee_note text;

alter table public.punch_records drop constraint if exists punch_records_employee_note_length;
alter table public.punch_records add constraint punch_records_employee_note_length
  check (employee_note is null or char_length(employee_note) between 1 and 140);

-- The same cleaning as lib/punch-note.ts cleanPunchNote.
create or replace function public.clean_punch_note(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(p, '[\u0001-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

create or replace function public.enforce_punch_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.employee_note := old.employee_note;
    return new;
  end if;
  new.employee_note := public.clean_punch_note(new.employee_note);
  return new;
end;
$$;

revoke all on function public.enforce_punch_note() from public, anon, authenticated;

drop trigger if exists punch_records_integrity_note on public.punch_records;
create trigger punch_records_integrity_note
  before insert or update on public.punch_records
  for each row execute function public.enforce_punch_note();

-- ── 2. The geofence applies whenever it is on ──────────────────────────────

create or replace function public.enforce_punch_geofence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
     and key in ('geofence_enabled', 'geofence_lat', 'geofence_lng', 'geofence_radius');

  -- New in 0065: the geofence applies whenever it is on, whether or not
  -- "Require GPS" is.
  if v_settings->>'geofence_enabled' is distinct from 'true' then
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
    raise exception 'Location needed to clock in — this store only allows clock-in near the store. Turn on location and try again'
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

revoke all on function public.enforce_punch_geofence() from public, anon, authenticated;

commit;
