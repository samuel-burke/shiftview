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
-- 3. Break types (break_types): per organization, each paid or unpaid with
--    an optional minimum length; archived rather than deleted. A store with
--    none configured has one implicit unpaid "Break", so every break is
--    deducted exactly as before. A break_start records its type
--    (break_type_id) and whether it was paid (break_paid), stamped from the
--    type by the punch_records_integrity_break trigger and never taken from
--    the writer; payroll counts a paid break as worked time. A clock_out may
--    record the employee's answer to "I was able to take my breaks"
--    (breaks_attested, null when not asked).
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


-- ── 3. Break types and break attestation ───────────────────────────────────

create table if not exists public.break_types (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  paid        boolean not null default false,
  min_minutes int check (min_minutes is null or min_minutes between 1 and 240),
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint break_types_id_org_key unique (id, org_id)
);

create unique index if not exists break_types_org_name_active_idx
  on public.break_types (org_id, lower(btrim(name))) where archived_at is null;

alter table public.break_types enable row level security;

-- Members read their organization's types (the clock offers them); managers
-- add and change them. Types are archived, never deleted: punches name them.
revoke all on table public.break_types from public, anon, authenticated;
grant select, insert, update on table public.break_types to authenticated;
grant all on table public.break_types to service_role;

drop policy if exists mt_select on public.break_types;
create policy mt_select on public.break_types for select to authenticated
  using (org_id in (select public.my_org_ids()));
drop policy if exists mt_insert on public.break_types;
create policy mt_insert on public.break_types for insert to authenticated
  with check (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_update on public.break_types;
create policy mt_update on public.break_types for update to authenticated
  using (org_id in (select public.my_managed_org_ids()))
  with check (org_id in (select public.my_managed_org_ids()));

alter table public.punch_records add column if not exists break_type_id bigint;
alter table public.punch_records add column if not exists break_paid boolean not null default false;
alter table public.punch_records add column if not exists breaks_attested boolean;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'punch_records_break_type_org_fkey') then
    alter table public.punch_records add constraint punch_records_break_type_org_fkey
      foreign key (break_type_id, org_id) references public.break_types (id, org_id);
  end if;
end $$;

-- Stamps a break_start with its type and whether it is paid, from the type
-- itself: break_paid is never taken from the writer. A break_start naming no
-- type gets the org's first active type (none configured: no type, unpaid,
-- which is how every break was paid before). An edit that changes neither
-- the type nor the punch type keeps the paid flag the break was taken with,
-- so changing a type later never re-prices old breaks. Only a clock_out
-- carries breaks_attested; once written, a signed-in user can't change it.
create or replace function public.enforce_punch_break()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type record;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.breaks_attested := old.breaks_attested;
  end if;
  if new.punch_type <> 'clock_out' then
    new.breaks_attested := null;
  end if;

  if new.punch_type <> 'break_start' then
    new.break_type_id := null;
    new.break_paid := false;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.break_type_id is not distinct from old.break_type_id
     and old.punch_type = 'break_start' then
    new.break_paid := old.break_paid;
    return new;
  end if;

  if new.break_type_id is null then
    select id, paid, archived_at into v_type
      from public.break_types
     where org_id = new.org_id and archived_at is null
     order by sort_order, id
     limit 1;
  else
    select id, paid, archived_at into v_type
      from public.break_types
     where org_id = new.org_id and id = new.break_type_id;
    if v_type.id is null then
      raise exception 'Unknown break type' using errcode = '23503';
    end if;
    -- A live break must be one the store still offers.
    if v_type.archived_at is not null and not coalesce(new.is_manual, false) and auth.uid() is not null then
      raise exception 'That break type is no longer offered' using errcode = '23514';
    end if;
  end if;

  new.break_type_id := v_type.id;
  new.break_paid := coalesce(v_type.paid, false);
  return new;
end;
$$;

revoke all on function public.enforce_punch_break() from public, anon, authenticated;

drop trigger if exists punch_records_integrity_break on public.punch_records;
create trigger punch_records_integrity_break
  before insert or update on public.punch_records
  for each row execute function public.enforce_punch_break();

commit;
