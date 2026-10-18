-- Tests the punch rules of 0043 (shift ownership), 0046 (one live clock-in a
-- store day) and 0050 (geofence, coordinates) together, with every migration
-- applied in order: a direct insert into punch_records with an end user's own
-- session must not get around any of them, alone or combined. Each per-
-- migration suite applies only its own migration, so this is the one place
-- they meet. Run against a throwaway Postgres database (15 or later):
--
--   createdb combined_test
--   cd supabase/manual-tests && psql -q -d combined_test -f combined_punch_integrity.test.sql
--   dropdb combined_test
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
\ir ../migrations/0043_punch_schedule_ownership.sql
\ir ../migrations/0044_org_isolation.sql
\ir ../migrations/0046_live_clock_in_same_day.sql
\ir ../migrations/0047_store_timezone.sql
\ir ../migrations/0050_punch_geofence_integrity.sql
\ir ../migrations/0051_punch_session_limits.sql
\ir ../migrations/0052_employee_delete_cascade.sql
\ir ../migrations/0053_punch_history.sql
\ir ../migrations/0054_archive_employees.sql
\ir ../migrations/0060_pay_rules.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set mia  '''aaaaaaaa-0000-0000-0000-000000000002'''
\set cara '''aaaaaaaa-0000-0000-0000-000000000003'''
\set dan  '''aaaaaaaa-0000-0000-0000-000000000004'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set eve  '''bbbbbbbb-0000-0000-0000-000000000002'''

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

-- Passes when the statement changed nothing: refused, or no row visible to it.
create or replace function pg_temp.expect_no_write(label text, got text) returns void language plpgsql as $$
begin
  if got like 'err:%' or got = 'ok:0' then raise notice 'PASS  % (%)', label, got;
  else raise notice 'FAIL  % (got %, want no rows written)', label, got; end if;
end $$;

-- Passes when `got` is any error (the rules may disagree on which fires first).
create or replace function pg_temp.expect_err(label text, got text) returns void language plpgsql as $$
begin
  if got like 'err:%' then raise notice 'PASS  % (%)', label, got;
  else raise notice 'FAIL  % (got %, want an error)', label, got; end if;
end $$;

begin;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:mia, 'mia@alder.test', now()),
  (:cara, 'cara@alder.test', now()), (:dan, 'dan@alder.test', now()),
  (:ben, 'ben@birch.test', now()), (:eve, 'eve@birch.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann Owner', 'ann@alder.test');
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben Owner', 'ben@birch.test');

create temp table fx (k text primary key, v text);
grant select on fx to public;

do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  b uuid := (select id from organizations where slug = 'birch');
  today date := (now() at time zone 'America/Chicago')::date;
  cara bigint; dan bigint; eve bigint; s bigint;
begin
  insert into employees (org_id, name, email, user_id) values
    (a, 'Mia Manager', 'mia@alder.test',  'aaaaaaaa-0000-0000-0000-000000000002'),
    (a, 'Cara Clerk',  'cara@alder.test', 'aaaaaaaa-0000-0000-0000-000000000003'),
    (a, 'Dan Driver',  'dan@alder.test',  'aaaaaaaa-0000-0000-0000-000000000004'),
    (b, 'Eve Early',   'eve@birch.test',  'bbbbbbbb-0000-0000-0000-000000000002');
  insert into managers (org_id, user_id) values (a, 'aaaaaaaa-0000-0000-0000-000000000002');
  cara := (select id from employees where email = 'cara@alder.test');
  dan  := (select id from employees where email = 'dan@alder.test');
  eve  := (select id from employees where email = 'eve@birch.test');
  insert into fx values ('alder', a), ('birch', b), ('cara', cara), ('dan', dan), ('eve', eve);

  -- Both orgs: Chicago time, GPS and geofence on, 100m around lower Manhattan.
  insert into app_settings (org_id, key, value)
  select o, k, v
    from unnest(array[a, b]) o,
         (values ('timezone', 'America/Chicago'),
                 ('gps_required', 'true'), ('geofence_enabled', 'true'),
                 ('geofence_lat', '40.7128'), ('geofence_lng', '-74.006'),
                 ('geofence_radius', '100')) s(k, v)
  on conflict (org_id, key) do update set value = excluded.value;

  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, cara, today, 540, 1020) returning id into s;
  insert into fx values ('cara_today', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, cara, today - 10, 540, 1020) returning id into s;
  insert into fx values ('cara_old', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, dan, today, 540, 1020) returning id into s;
  insert into fx values ('dan_today', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (b, eve, today, 540, 1020) returning id into s;
  insert into fx values ('eve_today', s);
end $$;

-- Live clock-in for employee `emp` in org `org` (fx keys), naming shift
-- `shift` (an fx key, or null) at lat, lng (SQL literals); `extra` adds
-- columns such as is_manual.
create or replace function pg_temp.clock_in(org text, emp text, shift text, lat text, lng text,
                                            extra_cols text default '', extra_vals text default '')
returns text language sql as $$
  select format(
    'insert into public.punch_records (org_id, employee_id, schedule_id, punch_type, lat, lng%s) '
    'select (select v::uuid from fx where k = %L), (select v::bigint from fx where k = %L), '
    '%s, ''clock_in'', %s, %s%s',
    extra_cols, org, emp,
    case when shift is null then 'null' else format('(select v::bigint from fx where k = %L)', shift) end,
    lat, lng, extra_vals)
$$;

\set inside_lat '''40.7129'''
\set inside_lng '''-74.0061'''
\set out_lat '''40.73'''
\set out_lng '''-74.006'''

-- ---------------------------------------------------------------------------
-- An employee's own session, straight to punch_records
-- ---------------------------------------------------------------------------
select pg_temp.expect('own shift, inside the geofence: accepted',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_today', :inside_lat, :inside_lng)), 'ok:1');
select pg_temp.expect('no shift, inside the geofence: accepted',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', null, :inside_lat, :inside_lng)), 'ok:1');

select pg_temp.expect('coworker''s shift, inside the geofence: refused by 0043',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'dan_today', :inside_lat, :inside_lng)), 'err:23514');
select pg_temp.expect('own shift from another day, inside the geofence: refused by 0043',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_old', :inside_lat, :inside_lng)), 'err:23514');
select pg_temp.expect('another org''s shift: refused',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'eve_today', :inside_lat, :inside_lng)), 'err:23514');

select pg_temp.expect('own shift, outside the geofence: refused by 0050',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_today', :out_lat, :out_lng)), 'err:GF001');
select pg_temp.expect('no shift, outside the geofence: refused by 0050',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', null, :out_lat, :out_lng)), 'err:GF001');
select pg_temp.expect('own shift, no location: refused by 0050',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_today', 'null', 'null')), 'err:GF002');
select pg_temp.expect('half a coordinate pair: refused',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_today', :inside_lat, 'null')), 'err:23514');
select pg_temp.expect('NaN coordinates: refused',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_today', '''NaN''::float8', '''NaN''::float8')), 'err:23514');
select pg_temp.expect_err('coworker''s shift and outside the geofence: refused',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'dan_today', :out_lat, :out_lng)));

-- The manual-punch exemptions in 0050 must not be reachable by an employee.
select pg_temp.expect('is_manual clock-in outside the geofence: refused (corrections need approval)',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_today', :out_lat, :out_lng,
                                      ', is_manual, punched_at', ', true, now() - interval ''1 minute''')), 'err:42501');
select pg_temp.expect('clock-in as a coworker: refused',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'dan', 'dan_today', :inside_lat, :inside_lng)), 'err:42501');
select pg_temp.expect_err('clock-in into another org: refused',
  pg_temp.try(:cara, pg_temp.clock_in('birch', 'eve', 'eve_today', :inside_lat, :inside_lng)));
select pg_temp.expect_err('anon clock-in: refused',
  pg_temp.try(null, pg_temp.clock_in('alder', 'cara', 'cara_today', :inside_lat, :inside_lng), 'anon'));

-- ---------------------------------------------------------------------------
-- After a real clock-in: no second one, and no rewriting it
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000003', true);
set local role authenticated;
insert into public.punch_records (org_id, employee_id, schedule_id, punch_type, lat, lng)
select (select v::uuid from fx where k = 'alder'), (select v::bigint from fx where k = 'cara'),
       (select v::bigint from fx where k = 'cara_today'), 'clock_in', 40.7129, -74.0061;
reset role;
select set_config('request.jwt.claim.sub', '', true);

select pg_temp.expect('second clock-in the same store day, inside the geofence: refused by 0046',
  pg_temp.try(:cara, pg_temp.clock_in('alder', 'cara', 'cara_today', :inside_lat, :inside_lng)), 'err:23P01');
select pg_temp.expect_no_write('employee moving their punch''s location: refused',
  pg_temp.try(:cara, 'update public.punch_records set lat = 40.73 where employee_id = (select v::bigint from fx where k = ''cara'')'));
select pg_temp.expect_no_write('employee moving their punch to a coworker''s shift: refused',
  pg_temp.try(:cara, 'update public.punch_records set schedule_id = (select v::bigint from fx where k = ''dan_today'') where employee_id = (select v::bigint from fx where k = ''cara'')'));

-- ---------------------------------------------------------------------------
-- Managers: live punches are still held to the geofence and shift rules
-- ---------------------------------------------------------------------------
select pg_temp.expect('manager live clock-in for an employee outside the geofence: refused',
  pg_temp.try(:mia, pg_temp.clock_in('alder', 'dan', 'dan_today', :out_lat, :out_lng)), 'err:GF001');
select pg_temp.expect('manager manual punch on a coworker''s shift: refused by 0043',
  pg_temp.try(:mia, pg_temp.clock_in('alder', 'dan', 'cara_today', 'null', 'null',
                                     ', is_manual, punched_at', ', true, now() - interval ''1 minute''')), 'err:23514');

-- ---------------------------------------------------------------------------
-- Service role (no auth.uid()): exempt from the geofence, not from ownership
-- ---------------------------------------------------------------------------
select pg_temp.expect('service role on a coworker''s shift: refused by 0043',
  pg_temp.try(null, pg_temp.clock_in('alder', 'dan', 'cara_today', :inside_lat, :inside_lng), 'service_role'), 'err:23514');
select pg_temp.expect('service role with bad coordinates: refused by the check constraint',
  pg_temp.try(null, pg_temp.clock_in('alder', 'dan', 'dan_today', '91', '0'), 'service_role'), 'err:23514');

rollback;
