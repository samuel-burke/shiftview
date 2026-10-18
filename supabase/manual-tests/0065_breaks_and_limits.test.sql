-- Tests for 0065_breaks_and_limits.sql. Run against a throwaway Postgres
-- database:
--
--   createdb breaks_test
--   cd supabase/manual-tests && psql -q -d breaks_test -f 0065_breaks_and_limits.test.sql
--   dropdb breaks_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows each
-- gap on the schema before 0065; part 2 applies it (twice) and checks it, and
-- what still works.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../baseline.sql
\ir ../migrations/0038_notify_service_role_only.sql
\ir ../migrations/0039_link_existing_accounts.sql
\ir ../migrations/0040_remove_legacy_demo_job.sql
\ir ../migrations/0041_database_audit_fixes.sql
\ir ../migrations/0042_pay_rate_managers_only.sql
\ir ../migrations/0043_punch_schedule_ownership.sql
\ir ../migrations/0044_org_isolation.sql
\ir ../migrations/0046_live_clock_in_same_day.sql
\ir ../migrations/0047_store_timezone.sql
\ir ../migrations/0050_punch_geofence_integrity.sql
\ir ../migrations/0051_punch_session_limits.sql
\ir ../migrations/0052_employee_delete_cascade.sql
\ir ../migrations/0053_punch_history.sql
\ir ../migrations/0054_archive_employees.sql
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

-- Runs a statement that returns one value (a select, or a write ... returning)
-- as `role` with auth.uid() = uid, always rolled back. Returns 'val:<value>'
-- ('val:<null>' for null) or 'err:<sqlstate>'.
create or replace function pg_temp.got(uid text, stmt text, role text default 'authenticated')
returns text language plpgsql as $$
declare v text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
    execute format('set local role %I', role);
    execute stmt into v;
    raise exception using errcode = 'P0123', message = coalesce(v, '<null>');
  exception when others then
    if sqlstate = 'P0123' then return 'val:' || sqlerrm; end if;
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
  insert into app_settings (org_id, key, value) values (a, 'timezone', 'America/New_York')
  on conflict (org_id, key) do update set value = excluded.value;

  -- Dan clocked in two hours ago (service role: no auth.uid()).
  insert into punch_records (org_id, employee_id, punch_type, punched_at)
    values (a, (select id from employees where org_id = a and name = 'Dan Driver'), 'clock_in', now() - interval '2 hours');
  insert into fx values ('dan_in', (select max(id) from punch_records));
end $$;

-- Statements, as SQL text, for the checks below.
create or replace function pg_temp.live(who text, kind text, extra_cols text default '', extra_vals text default '')
returns text language sql as $$
  select format(
    'insert into public.punch_records (org_id, employee_id, punch_type%s) '
    'select (select v::uuid from fx where k = ''alder''), (select v::bigint from fx where k = %L), %L%s',
    extra_cols, who, kind, extra_vals)
$$;

create or replace function pg_temp.manual(who text, kind text, at_sql text, note text default 'Payroll fix')
returns text language sql as $$
  select format(
    'insert into public.punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) '
    'select (select v::uuid from fx where k = ''alder''), (select v::bigint from fx where k = %L), %L, %s, true, %L',
    who, kind, at_sql, note)
$$;

create or replace function pg_temp.request(who text, kind text, at_sql text) returns text language sql as $$
  select format(
    'insert into public.punch_corrections (org_id, employee_id, punch_type, punched_at, note) '
    'select (select v::uuid from fx where k = ''alder''), (select v::bigint from fx where k = %L), %L, %s, ''Forgot''',
    who, kind, at_sql)
$$;

create or replace function pg_temp.set_alder(k text, v text) returns void language sql as $$
  insert into public.app_settings (org_id, key, value)
  values ((select fx.v::uuid from fx where fx.k = 'alder'), k, v)
  on conflict (org_id, key) do update set value = excluded.value
$$;


-- The geofence: 100m around lower Manhattan, with "Require GPS" as given.
create or replace function pg_temp.fence(gps_required text, enabled text default 'true') returns void language sql as $$
  select pg_temp.set_alder('gps_required', gps_required);
  select pg_temp.set_alder('geofence_enabled', enabled);
  select pg_temp.set_alder('geofence_lat', '40.7128');
  select pg_temp.set_alder('geofence_lng', '-74.006');
  select pg_temp.set_alder('geofence_radius', '100');
$$;

-- Cara clocking in at lat, lng (SQL literals).
create or replace function pg_temp.cara_in(lat text, lng text) returns text language sql as $$
  select pg_temp.live('cara', 'clock_in', ', lat, lng', format(', %s, %s', lat, lng))
$$;
-- ===========================================================================
-- Part 1: before 0065
-- ===========================================================================

select pg_temp.expect('before 0065: a live punch can''t carry an employee''s note',
  pg_temp.try(:cara, pg_temp.live('cara', 'clock_in', ', employee_note', ', ''Covering for Sam''')), 'err:42703');


select pg_temp.fence('false');
select pg_temp.expect('before 0065: with GPS not required, a geofenced store let a clock-in from 2 km away through',
  pg_temp.try(:cara, pg_temp.cara_in('40.73', '-74.006')), 'ok:1');
select pg_temp.expect('before 0065: ... and one with no location',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'ok:1');
select pg_temp.fence('false', 'false');
-- ===========================================================================
-- Part 2: 0065, applied twice
-- ===========================================================================
\set ON_ERROR_STOP on
\ir ../migrations/0065_breaks_and_limits.sql
\ir ../migrations/0065_breaks_and_limits.sql
\unset ON_ERROR_STOP

-- ── Managers fix punches of any age; requests keep the 30-day window ───────

select pg_temp.expect('a manager adds a punch 31 days back',
  pg_temp.try(:mia, pg_temp.manual('cara', 'clock_in', 'now() - interval ''31 days''')), 'ok:1');
select pg_temp.expect('a manager adds a punch a year back',
  pg_temp.try(:mia, pg_temp.manual('cara', 'clock_in', 'now() - interval ''400 days''')), 'ok:1');
select pg_temp.expect('a manager moves a punch to 60 days back',
  pg_temp.try(:mia, format('update public.punch_records set punched_at = now() - interval ''60 days'', note = ''Fix'' where id = %s',
    (select v from fx where k = 'dan_in'))), 'ok:1');
select pg_temp.expect('a manager''s punch still can''t be in the future',
  pg_temp.try(:mia, pg_temp.manual('cara', 'clock_in', 'now() + interval ''1 minute''')), 'err:22007');
select pg_temp.expect('an employee''s request 30 days less a minute back is accepted',
  pg_temp.try(:cara, pg_temp.request('cara', 'clock_in', 'now() - interval ''30 days'' + interval ''1 minute''')), 'ok:1');
select pg_temp.expect('an employee''s request 30 days and a minute back is refused',
  pg_temp.try(:cara, pg_temp.request('cara', 'clock_in', 'now() - interval ''30 days'' - interval ''1 minute''')), 'err:22007');
select pg_temp.expect('an employee still can''t add a manual punch of any age',
  pg_temp.try(:cara, pg_temp.manual('cara', 'clock_in', 'now() - interval ''40 days''')), 'err:42501');

-- ── Employee notes on live punches ─────────────────────────────────────────

select pg_temp.expect('an employee''s note is stored with the live punch, cleaned',
  pg_temp.got(:cara, pg_temp.live('cara', 'clock_in', ', employee_note',
    ', E''  covering\u200B for \t Sam\n ''') || ' returning employee_note'), 'val:covering for Sam');
select pg_temp.expect('bidi overrides and control characters become spaces',
  pg_temp.got(:cara, pg_temp.live('cara', 'clock_in', ', employee_note',
    ', E''ok\u202Eevil\u0007x''') || ' returning employee_note'), 'val:ok evil x');
select pg_temp.expect('a blank note is stored as none',
  pg_temp.got(:cara, pg_temp.live('cara', 'clock_in', ', employee_note',
    ', E'' \u200B \n ''') || ' returning coalesce(employee_note, ''<none>'')'), 'val:<none>');
select pg_temp.expect('a 140-character note is accepted',
  pg_temp.try(:cara, pg_temp.live('cara', 'clock_in', ', employee_note', ', repeat(''n'', 140)')), 'ok:1');
select pg_temp.expect('a 141-character note is refused',
  pg_temp.try(:cara, pg_temp.live('cara', 'clock_in', ', employee_note', ', repeat(''n'', 141)')), 'err:23514');
select pg_temp.expect('140 characters after cleaning is accepted',
  pg_temp.try(:cara, pg_temp.live('cara', 'clock_in', ', employee_note', ', ''   '' || repeat(''n'', 140) || ''   ''')), 'ok:1');
select pg_temp.expect('the service role is held to the same limit',
  pg_temp.try(null, pg_temp.live('cara', 'clock_in', ', employee_note', ', repeat(''n'', 141)'), 'service_role'), 'err:23514');

update punch_records set employee_note = 'Register 2 down' where id = (select v::bigint from fx where k = 'dan_in');
select pg_temp.expect('a manager''s edit leaves the employee''s note as written',
  pg_temp.got(:mia, format('update public.punch_records set employee_note = ''edited'', note = ''Fix'', punched_at = now() - interval ''3 hours'' where id = %s returning employee_note',
    (select v from fx where k = 'dan_in'))), 'val:Register 2 down');
select pg_temp.expect('an employee''s edit of their note after the punch changes nothing (RLS)',
  pg_temp.try(:dan, format('update public.punch_records set employee_note = ''edited'' where id = %s',
    (select v from fx where k = 'dan_in'))), 'ok:0');
select pg_temp.expect('the employee''s note stays apart from a manager''s reason',
  pg_temp.got(:mia, format('update public.punch_records set note = ''Badge reader down'' where id = %s returning note || '' / '' || employee_note',
    (select v from fx where k = 'dan_in'))), 'val:Badge reader down / Register 2 down');


-- ── The geofence applies with or without "Require GPS" ─────────────────────

select pg_temp.fence('false');
select pg_temp.expect('GPS not required: a clock-in inside the fence is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('40.7129', '-74.0061')), 'ok:1');
select pg_temp.expect('GPS not required: a clock-in 2 km away is refused',
  pg_temp.try(:cara, pg_temp.cara_in('40.73', '-74.006')), 'err:GF001');
select pg_temp.expect('GPS not required: a clock-in with no location is refused (location needed)',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'err:GF002');
select pg_temp.set_alder('geofence_radius', 'wide');
select pg_temp.expect('GPS not required: a misconfigured radius fails closed',
  pg_temp.try(:cara, pg_temp.cara_in('40.7129', '-74.0061')), 'err:GF003');

select pg_temp.fence('true');
select pg_temp.expect('GPS required: a clock-in inside the fence is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('40.7129', '-74.0061')), 'ok:1');
select pg_temp.expect('GPS required: a clock-in 2 km away is refused',
  pg_temp.try(:cara, pg_temp.cara_in('40.73', '-74.006')), 'err:GF001');
select pg_temp.expect('GPS required: a clock-in with no location is refused',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'err:GF002');

select pg_temp.fence('false');
select pg_temp.expect('the geofence doesn''t apply to a clock-out',
  pg_temp.try(:dan, pg_temp.live('dan', 'clock_out')), 'ok:1');
select pg_temp.expect('a manager''s manual clock-in needs no location',
  pg_temp.try(:mia, pg_temp.manual('cara', 'clock_in', 'now() - interval ''1 day''')), 'ok:1');
select pg_temp.expect('the service role needs no location',
  pg_temp.try(null, pg_temp.cara_in('null', 'null'), 'service_role'), 'ok:1');
select pg_temp.expect('another org''s clock-in fails ownership, not the geofence',
  pg_temp.try(:cara, format(
    'insert into public.punch_records (org_id, employee_id, punch_type, lat, lng) values (%L, %s, ''clock_in'', 0, 0)',
    (select v from fx where k = 'birch'), (select v from fx where k = 'bea'))), 'err:42501');

select pg_temp.set_alder('geofence_lat', '');
select pg_temp.set_alder('geofence_lng', '');
select pg_temp.expect('no centre saved: a clock-in with no location is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'ok:1');

select pg_temp.fence('true', 'false');
select pg_temp.expect('geofence off, GPS required: a clock-in with no location is accepted (as before)',
  pg_temp.try(:cara, pg_temp.cara_in('null', 'null')), 'ok:1');
select pg_temp.fence('false', 'false');
select pg_temp.expect('geofence off, GPS not required: a clock-in from anywhere is accepted',
  pg_temp.try(:cara, pg_temp.cara_in('40.73', '-74.006')), 'ok:1');
select pg_temp.expect('geofence off: malformed coordinates are still refused',
  pg_temp.try(:cara, pg_temp.cara_in('''NaN''::float8', '0')), 'err:23514');
select pg_temp.expect('enforce_punch_geofence is not executable by authenticated',
  (not has_function_privilege('authenticated', 'public.enforce_punch_geofence()', 'execute'))::text, 'true');
-- ── What still works ────────────────────────────────────────────────────────

select pg_temp.expect('a live punch with no note',
  pg_temp.try(:cara, pg_temp.live('cara', 'clock_in')), 'ok:1');
select pg_temp.expect('a manager''s manual punch keeps its reason in note',
  pg_temp.got(:mia, pg_temp.manual('cara', 'clock_in', 'now() - interval ''1 day''', 'Forgot to clock in') || ' returning note'), 'val:Forgot to clock in');
select pg_temp.expect('clean_punch_note and enforce_punch_note are not executable by authenticated',
  (not has_function_privilege('authenticated', 'public.enforce_punch_note()', 'execute'))::text, 'true');

rollback;
