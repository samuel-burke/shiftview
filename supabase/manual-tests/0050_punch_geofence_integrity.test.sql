-- Tests for 0050_punch_geofence_integrity.sql: punch coordinates must be in
-- range, and an end user's live clock_in must be inside the org's geofence,
-- even when written straight to punch_records instead of through the API.
-- Run against a throwaway Postgres database (15 or later):
--
--   createdb geofence_test
--   cd supabase/manual-tests && psql -q -d geofence_test -f 0050_punch_geofence_integrity.test.sql
--   dropdb geofence_test
--
-- Any line containing FAIL (or any ERROR) is a regression.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../baseline.sql
\ir ../migrations/0038_notify_service_role_only.sql
\ir ../migrations/0039_link_existing_accounts.sql
\ir ../migrations/0040_remove_legacy_demo_job.sql
\ir ../migrations/0041_database_audit_fixes.sql
\ir ../migrations/0042_pay_rate_managers_only.sql
\ir ../migrations/0050_punch_geofence_integrity.sql
\ir ../migrations/0050_punch_geofence_integrity.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set mia  '''aaaaaaaa-0000-0000-0000-000000000002'''
\set cara '''aaaaaaaa-0000-0000-0000-000000000003'''
\set dan  '''aaaaaaaa-0000-0000-0000-000000000004'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''

-- Runs one statement as `role` with auth.uid() = uid, always rolled back.
-- Returns 'ok:<rows>' or 'err:<sqlstate>'.
create or replace function pg_temp.try(uid text, stmt text, role text default 'authenticated')
returns text language plpgsql as $$
declare n bigint;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
    execute format('set local role %I', role);
    execute stmt;
    get diagnostics n = row_count;
    raise exception using errcode = 'P0123', message = n::text;
  exception when others then
    if sqlstate = 'P0123' then return 'ok:' || sqlerrm; end if;
    return 'err:' || sqlstate;
  end;
end $$;

create or replace function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got = want then raise notice 'PASS  %', label;
  else raise notice 'FAIL  % (got %, want %)', label, got, want; end if;
end $$;

begin;

-- Alder (owner Ann, manager Mia, employees Cara and Dan) and Birch (owner Ben).
insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:mia, 'mia@alder.test', now()),
  (:cara, 'cara@alder.test', now()), (:dan, 'dan@alder.test', now()),
  (:ben, 'ben@birch.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann Owner', 'ann@alder.test');
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben Owner', 'ben@birch.test');

create temp table fx (k text primary key, v text);
grant select on fx to public;

do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  b uuid := (select id from organizations where slug = 'birch');
begin
  insert into employees (org_id, name, email, user_id) values
    (a, 'Mia Manager', 'mia@alder.test', 'aaaaaaaa-0000-0000-0000-000000000002'),
    (a, 'Cara Clerk',  'cara@alder.test', 'aaaaaaaa-0000-0000-0000-000000000003'),
    (a, 'Dan Driver',  'dan@alder.test',  'aaaaaaaa-0000-0000-0000-000000000004'),
    (b, 'Bea Birch',   'bea@birch.test',  null);
  insert into managers (org_id, user_id) values (a, 'aaaaaaaa-0000-0000-0000-000000000002');
  insert into fx values
    ('alder', a), ('birch', b),
    ('cara', (select id from employees where org_id = a and name = 'Cara Clerk')),
    ('dan',  (select id from employees where org_id = a and name = 'Dan Driver')),
    ('bea',  (select id from employees where org_id = b and name = 'Bea Birch'));

  -- Both orgs: GPS and geofence on, 100m around lower Manhattan.
  insert into app_settings (org_id, key, value)
  select o, k, v
    from unnest(array[a, b]) o,
         (values ('gps_required', 'true'), ('geofence_enabled', 'true'),
                 ('geofence_lat', '40.7128'), ('geofence_lng', '-74.006'),
                 ('geofence_radius', '100')) s(k, v)
  on conflict (org_id, key) do update set value = excluded.value;

  -- Dan is already clocked in (service role: no auth.uid()).
  insert into punch_records (org_id, employee_id, punch_type, punched_at)
    values (a, (select id from employees where org_id = a and name = 'Dan Driver'), 'clock_in', now() - interval '2 hours');
end $$;

\set alder '(select v::uuid from fx where k = ''alder'')'
\set birch '(select v::uuid from fx where k = ''birch'')'
\set cara_emp '(select v::bigint from fx where k = ''cara'')'

-- Statement for Cara clocking in with the given lat, lng (SQL literals).
create or replace function pg_temp.cara_in(lat text, lng text) returns text language sql as $$
  select format(
    'insert into public.punch_records (org_id, employee_id, punch_type, lat, lng) '
    'select (select v::uuid from fx where k = ''alder''), (select v::bigint from fx where k = ''cara''), ''clock_in'', %s, %s',
    lat, lng)
$$;

create or replace function pg_temp.set_alder(k text, v text) returns void language sql as $$
  update public.app_settings set value = v
   where org_id = (select v::uuid from fx where k = 'alder') and key = k
$$;

-- ---------------------------------------------------------------------------
-- Direct inserts by an employee, geofence on
-- ---------------------------------------------------------------------------
select pg_temp.expect('employee clock_in inside the geofence is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('40.7129', '-74.0061')), 'ok:1');
select pg_temp.expect('employee clock_in outside the geofence is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('40.73', '-74.006')), 'err:GF001');
select pg_temp.expect('employee clock_in with no location is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'err:GF002');

-- Malformed coordinates: the check constraint, before any distance maths.
select pg_temp.expect('NaN latitude is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('''NaN''::float8', '-74.006')), 'err:23514');
select pg_temp.expect('Infinity latitude is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('''Infinity''::float8', '-74.006')), 'err:23514');
select pg_temp.expect('-Infinity longitude is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '''-Infinity''::float8')), 'err:23514');
select pg_temp.expect('latitude above 90 is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('90.5', '-74.006')), 'err:23514');
select pg_temp.expect('latitude below -90 is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('-91', '-74.006')), 'err:23514');
select pg_temp.expect('longitude above 180 is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '180.1')), 'err:23514');
select pg_temp.expect('longitude below -180 is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-286')), 'err:23514');
select pg_temp.expect('latitude without longitude is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', 'null')), 'err:23514');
select pg_temp.expect('longitude without latitude is rejected',
  pg_temp.try(:cara, pg_temp.cara_in('null', '-74.006')), 'err:23514');
select pg_temp.expect('boundary coordinates are allowed by the constraint (outside the fence)',
  pg_temp.try(:cara, pg_temp.cara_in('-90', '180')), 'err:GF001');

-- Only clock_in is fenced, as in the API.
select pg_temp.expect('clock_out needs no location',
  pg_temp.try(:dan, format(
    'insert into public.punch_records (org_id, employee_id, punch_type) values (%L, %s, ''clock_out'')',
    (select v from fx where k = 'alder'), (select v from fx where k = 'dan'))), 'ok:1');

-- A punch the caller may not write never reaches the geofence check, so it
-- can't be used to probe another org's fence.
select pg_temp.expect('clock_in for another org fails ownership, not the geofence',
  pg_temp.try(:cara, format(
    'insert into public.punch_records (org_id, employee_id, punch_type, lat, lng) values (%L, %s, ''clock_in'', 0, 0)',
    (select v from fx where k = 'birch'), (select v from fx where k = 'bea'))), 'err:42501');

-- Trusted writers.
select pg_temp.expect('service role clock_in without location is accepted',
  pg_temp.try(null, pg_temp.cara_in('null', 'null'), 'service_role'), 'ok:1');
select pg_temp.expect('manager manual clock_in without location is accepted',
  pg_temp.try(:mia, format(
    'insert into public.punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) '
    'values (%L, %s, ''clock_in'', now() - interval ''1 day'', true, ''forgot'')',
    (select v from fx where k = 'alder'), (select v from fx where k = 'cara'))), 'ok:1');
select pg_temp.expect('manager can''t set an out-of-range latitude on an existing punch',
  pg_temp.try(:mia, format(
    'update public.punch_records set lat = 200, lng = 0 where org_id = %L',
    (select v from fx where k = 'alder'))), 'err:23514');

select pg_temp.expect('manager can''t clear only the longitude on an existing punch',
  pg_temp.try(:mia, format(
    'update public.punch_records set lat = 40.7128, lng = null where org_id = %L',
    (select v from fx where k = 'alder'))), 'err:23514');

-- ---------------------------------------------------------------------------
-- Stored geofence settings
-- ---------------------------------------------------------------------------
select pg_temp.set_alder('geofence_lat', 'not-a-number');
select pg_temp.expect('unparseable centre latitude fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_lat', '1e999');
select pg_temp.expect('overflowing centre latitude fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_lat', 'NaN');
select pg_temp.expect('NaN centre latitude fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_lat', '40.7128');
select pg_temp.set_alder('geofence_lng', '200');
select pg_temp.expect('out-of-range centre longitude fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_lng', '');
select pg_temp.expect('half a centre fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_lng', '-74.006');
select pg_temp.set_alder('geofence_radius', 'wide');
select pg_temp.expect('unparseable radius fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_radius', 'NaN');
select pg_temp.expect('NaN radius fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_radius', '0');
select pg_temp.expect('zero radius fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', '-74.006')), 'err:GF003');
select pg_temp.set_alder('geofence_radius', '100');

select pg_temp.set_alder('geofence_lat', '');
select pg_temp.set_alder('geofence_lng', '');
select pg_temp.expect('no centre saved: clock_in without location is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'ok:1');
select pg_temp.set_alder('geofence_lat', '40.7128');
select pg_temp.set_alder('geofence_lng', '-74.006');

select pg_temp.set_alder('geofence_enabled', 'false');
select pg_temp.expect('geofence off: clock_in without location is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'ok:1');
select pg_temp.expect('geofence off: malformed coordinates are still rejected',
  pg_temp.try(:cara, pg_temp.cara_in('''NaN''::float8', '0')), 'err:23514');
select pg_temp.expect('geofence off: half a pair is still rejected',
  pg_temp.try(:cara, pg_temp.cara_in('40.7128', 'null')), 'err:23514');
select pg_temp.set_alder('geofence_enabled', 'true');

select pg_temp.set_alder('gps_required', 'false');
select pg_temp.expect('GPS not required: clock_in outside the fence is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('40.73', '-74.006')), 'ok:1');
select pg_temp.set_alder('gps_required', 'true');

-- The migration's functions aren't callable through the API.
select pg_temp.expect('enforce_punch_geofence is not executable by authenticated',
  (not has_function_privilege('authenticated', 'public.enforce_punch_geofence()', 'execute'))::text, 'true');
select pg_temp.expect('try_parse_float8 is not executable by authenticated',
  (not has_function_privilege('authenticated', 'public.try_parse_float8(text)', 'execute'))::text, 'true');

rollback;
