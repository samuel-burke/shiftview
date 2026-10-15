-- Geofence and punch coordinates, enforced in the database as well as the API.
--
-- POST /api/punches checks an employee's clock-in against the org's geofence,
-- but punch_records is member-writable under RLS, so an employee could skip
-- the API and insert a clock_in directly with their own session: no location,
-- or any location. Malformed coordinates (NaN, Infinity, out of range, half a
-- pair) could also be stored by the same route.
--
--   1. punch_records_coordinates_check: lat and lng are both null, or both
--      finite and in range (lat -90..90, lng -180..180). NaN and Infinity fail
--      the range tests. Added NOT VALID, then validated if existing rows allow
--      it; if they don't, new and updated rows are still checked and a notice
--      says so.
--   2. punch_records_integrity_geofence: an end user's live clock_in must be
--      inside the geofence when the org has gps_required and geofence_enabled
--      on and a centre saved — the same rule as the API (lib/geo-validation.ts).
--      A stored centre or radius that is present but unusable rejects the
--      punch instead of switching enforcement off. Manual punches (manager
--      entries and approved corrections) and the service role are not checked.
--      The name sorts after punch_records_integrity, so ownership is checked
--      first and a caller can't probe another org's geofence.
--
-- Errors use SQLSTATE GF001 (outside), GF002 (no location) and GF003
-- (misconfigured); the API maps them to 422. Safe to repeat.

begin;

alter table public.punch_records drop constraint if exists punch_records_coordinates_check;
-- Written so no case evaluates to null: a CHECK passes on null, so the
-- obvious "(both null) or (both in range)" would let half a pair through.
alter table public.punch_records add constraint punch_records_coordinates_check check (
  (lat is null) = (lng is null)
  and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
) not valid;

do $$
begin
  alter table public.punch_records validate constraint punch_records_coordinates_check;
exception when check_violation then
  raise notice 'punch_records has rows with invalid coordinates; punch_records_coordinates_check applies to new and updated rows only until they are fixed';
end $$;

-- Parses a stored app_settings value as a number; null when blank or not a
-- number. NaN and Infinity parse, and callers reject them with range tests.
create or replace function public.try_parse_float8(p text)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return p::double precision;
exception when others then
  return null;
end;
$$;

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

revoke all on function public.enforce_punch_geofence() from public, anon, authenticated;
revoke all on function public.try_parse_float8(text) from public, anon, authenticated;

drop trigger if exists punch_records_integrity_geofence on public.punch_records;
create trigger punch_records_integrity_geofence
  before insert on public.punch_records
  for each row execute function public.enforce_punch_geofence();

commit;
