-- Behavioural tests for supabase/migrations/0030_punch_timestamp_integrity.sql.
--
-- Self-contained: creates a minimal stand-in schema (auth.uid() stub reading
-- the `test.uid` setting, employees, managers, punch_records,
-- is_org_manager), applies the migration, then runs each case and prints
-- PASS/FAIL notices. Run against a throwaway Postgres database:
--
--   createdb punch_trigger_test
--   cd supabase/manual-tests && psql -q -d punch_trigger_test -f 0030_punch_timestamp_integrity.test.sql
--   dropdb punch_trigger_test
--
-- Any line containing FAIL is a regression.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create table public.employees (id int primary key, org_id uuid not null, user_id uuid, name text);
create table public.managers (user_id uuid not null, org_id uuid not null);
create table public.punch_records (
  id serial primary key,
  org_id uuid not null,
  employee_id int not null,
  schedule_id int,
  punch_type text not null,
  punched_at timestamptz not null default now(),
  is_manual boolean not null default false,
  note text,
  lat double precision,
  lng double precision
);

create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.managers where user_id = auth.uid() and org_id = p_org);
$$;

-- org A: employee 1 (alice), employee 2 (bob), manager mia
insert into employees values
  (1, '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Alice'),
  (2, '00000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Bob');
insert into managers values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a');

\ir ../migrations/0030_punch_timestamp_integrity.sql

\set ON_ERROR_STOP on
create or replace function pg_temp.expect_ok(label text, uid text, stmt text) returns void language plpgsql as $$
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute stmt;
  raise notice 'PASS  %', label;
exception when others then
  raise notice 'FAIL  % (unexpected error: %)', label, sqlerrm;
end $$;

create or replace function pg_temp.expect_err(label text, uid text, stmt text) returns void language plpgsql as $$
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute stmt;
  raise notice 'FAIL  % (no error raised)', label;
exception when others then
  raise notice 'PASS  % (rejected: %)', label, sqlerrm;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

\set alice '''11111111-1111-1111-1111-111111111111'''
\set bob   '''22222222-2222-2222-2222-222222222222'''
\set mia   '''33333333-3333-3333-3333-333333333333'''
\set org   '''00000000-0000-0000-0000-00000000000a'''

-- 1. Live punch: a client-supplied time is discarded for the server clock.
select pg_temp.expect_ok('employee live punch with forged time is accepted…', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at) values (%L, 1, 'clock_in', '2020-01-01T09:00:00Z')$q$, :org));
select pg_temp.check('…but stamped with now(), not the forged 2020 time',
  (select punched_at > now() - interval '1 minute' from punch_records where employee_id = 1 order by id desc limit 1));

-- 2. Punching for a coworker.
select pg_temp.expect_err('employee cannot punch for a coworker', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 2, 'clock_in')$q$, :org));

-- 3. Editing / deleting history.
select pg_temp.expect_err('employee cannot move a punch time', :alice,
  $q$update punch_records set punched_at = now() - interval '2 hours' where employee_id = 1$q$);
select pg_temp.expect_err('employee cannot delete a punch', :alice,
  $q$delete from punch_records where employee_id = 1$q$);

-- 4. Manual punches by an employee.
select pg_temp.expect_err('employee manual punch in the future is rejected', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 1, 'clock_out', now() + interval '1 hour', true, 'x')$q$, :org));
select pg_temp.expect_err('employee manual punch older than 30 days is rejected', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 1, 'clock_in', now() - interval '31 days', true, 'x')$q$, :org));
select pg_temp.expect_err('employee cannot backdate a clock-in ahead of the real one', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 1, 'clock_in', now() - interval '1 hour', true, 'x')$q$, :org));
select pg_temp.expect_err('employee manual punch must be a valid next step (clock_in after clock_in)', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 1, 'clock_in', now(), true, 'x')$q$, :org));
select pg_temp.expect_err('employee first-ever manual punch must be a clock_in (no prior punch)', :bob,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 2, 'clock_out', now() - interval '1 hour', true, 'x')$q$, :org));
select pg_temp.expect_ok('employee can add a forgotten clock-out after their clock-in', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 1, 'clock_out', now(), true, 'Forgot')$q$, :org));

-- 5. Closing yesterday's open shift after clocking in today.
select pg_temp.expect_ok('setup (service role): bob clocked in yesterday, never out', null,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at) values (%L, 2, 'clock_in', now() - interval '26 hours')$q$, :org));
select pg_temp.check('service-role insert keeps its explicit time',
  (select punched_at < now() - interval '25 hours' from punch_records where employee_id = 2 order by id desc limit 1));
select pg_temp.expect_ok('setup: bob clocks in today', :bob,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 2, 'clock_in')$q$, :org));
select pg_temp.expect_ok('bob can still close yesterday''s open shift', :bob,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 2, 'clock_out', now() - interval '18 hours', true, 'Forgot')$q$, :org));
select pg_temp.expect_err('…but not slip a clock-in before today''s real one', :bob,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 2, 'clock_in', now() - interval '1 minute', true, 'x')$q$, :org));

-- 6. Managers.
select pg_temp.expect_ok('manager can correct a punch time', :mia,
  $q$update punch_records set punched_at = now() - interval '3 hours' where id = (select min(id) from punch_records where employee_id = 1)$q$);
select pg_temp.check('a manager time change marks the punch manual',
  (select is_manual from punch_records where id = (select min(id) from punch_records where employee_id = 1)));
select pg_temp.expect_err('manager cannot move a punch into the future', :mia,
  $q$update punch_records set punched_at = now() + interval '1 day' where employee_id = 1$q$);
select pg_temp.expect_ok('manager can add a backdated manual punch for anyone', :mia,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 2, 'break_start', now() - interval '20 hours', true, 'Fix')$q$, :org));
select pg_temp.expect_ok('manager live punch is still server-stamped', :mia,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at) values (%L, 2, 'clock_out', '2020-01-01T00:00:00Z')$q$, :org));
select pg_temp.check('…with now()',
  (select punched_at > now() - interval '1 minute' from punch_records order by id desc limit 1));
select pg_temp.expect_ok('manager can delete a punch', :mia,
  $q$delete from punch_records where id = (select max(id) from punch_records)$q$);

-- 7. Service role (cron / demo seed / org deletion) is unaffected.
select pg_temp.expect_ok('service role can delete', null, $q$delete from punch_records where employee_id = 2 and punch_type = 'break_start'$q$);
