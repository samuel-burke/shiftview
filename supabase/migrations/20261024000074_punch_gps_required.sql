-- Require GPS for live clock-ins independently of geofencing. Migration 0050
-- only required location when a geofence was enabled with a saved centre, so
-- direct API or table inserts could bypass the separate gps_required policy.
-- Coordinate validity, ownership, manual entries and service-role exceptions
-- remain governed by the existing controls. GF002 is already mapped to 422
-- by POST /api/punches. The existing trigger uses this replacement function.
-- Safe to repeat; no existing punch records are changed.

begin;

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

  if v_settings->>'gps_required' is distinct from 'true' then
    return new;
  end if;

  -- Constraints run after BEFORE triggers, so check the punch's own
  -- coordinates here first, as punch_records_coordinates_check would.
  if not ((new.lat is null) = (new.lng is null)
          and (new.lat is null or (new.lat between -90 and 90 and new.lng between -180 and 180))) then
    raise exception 'lat and lng must both be null, or in range (-90..90, -180..180)'
      using errcode = 'check_violation', constraint = 'punch_records_coordinates_check';
  end if;

  if new.lat is null or new.lng is null then
    raise exception 'GPS location required to clock in'
      using errcode = 'GF002';
  end if;

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
