-- Behavioural tests for supabase/migrations/0031_punch_correction_requests.sql
-- (applied on top of 0030).
--
-- Self-contained: builds a minimal stand-in schema, applies both migrations,
-- then runs each case as a non-superuser role so row-level security applies,
-- printing PASS/FAIL notices. Run against a throwaway Postgres database:
--
--   createdb punch_corrections_test
--   cd supabase/manual-tests && psql -q -d punch_corrections_test -f 0031_punch_correction_requests.test.sql
--   dropdb punch_corrections_test
--
-- Any line containing FAIL is a regression.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create table public.organizations (id uuid primary key);
create table public.employees (id bigint, org_id uuid not null references public.organizations (id), user_id uuid, name text,
  primary key (id), unique (id, org_id));
create table public.managers (user_id uuid not null, org_id uuid not null);
create table public.punch_records (
  id bigserial primary key,
  org_id uuid not null,
  employee_id bigint not null,
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

insert into organizations values ('00000000-0000-0000-0000-00000000000a');
insert into employees values
  (1, '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Alice'),
  (2, '00000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Bob');
insert into managers values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a');

\ir ../migrations/0030_punch_timestamp_integrity.sql
\ir ../migrations/0031_punch_correction_requests.sql

-- An app-like role: RLS applies to it (superusers bypass RLS).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then create role app_user; end if;
end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
alter table public.punch_records enable row level security;
create policy test_all on public.punch_records for all using (true) with check (true);

create or replace function pg_temp.run(label text, uid text, stmt text, expect_error boolean) returns void language plpgsql as $$
declare n int;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute 'set local role app_user';
  execute stmt;
  get diagnostics n = row_count;
  execute 'reset role';
  if expect_error then
    raise notice 'FAIL  % (no error raised, % rows)', label, n;
  else
    raise notice 'PASS  %', label;
  end if;
exception when others then
  execute 'reset role';
  if expect_error then raise notice 'PASS  % (rejected: %)', label, sqlerrm;
  else raise notice 'FAIL  % (unexpected error: %)', label, sqlerrm; end if;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

\set alice '''11111111-1111-1111-1111-111111111111'''
\set bob   '''22222222-2222-2222-2222-222222222222'''
\set mia   '''33333333-3333-3333-3333-333333333333'''
\set org   '''00000000-0000-0000-0000-00000000000a'''

begin;

-- Punches: employees can no longer write manual punches at all.
select pg_temp.run('employee live punch still works (server-stamped)', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at) values (%L, 1, 'clock_in', '2020-01-01')$q$, :org), false);
select pg_temp.check('…stamped with now()', (select punched_at > now() - interval '1 minute' from punch_records where employee_id = 1 order by id desc limit 1));
select pg_temp.run('employee cannot insert a manual punch directly (needs approval)', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 1, 'clock_out', now() - interval '1 hour', true, 'x')$q$, :org), true);

-- Filing requests.
select pg_temp.run('employee can file a pending correction for themselves', :alice,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note, created_at) values (%L, 1, 'clock_out', now() - interval '2 hours', 'Forgot', '2020-01-01')$q$, :org), false);
select pg_temp.check('…created_at is the server clock, not the client''s value',
  (select created_at > now() - interval '1 minute' from punch_corrections where employee_id = 1 order by id desc limit 1));
select pg_temp.run('employee cannot file for a coworker', :alice,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note) values (%L, 2, 'clock_out', now() - interval '2 hours', 'x')$q$, :org), true);
select pg_temp.run('employee cannot file a pre-approved request', :alice,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note, status) values (%L, 1, 'clock_out', now() - interval '2 hours', 'x', 'approved')$q$, :org), true);
select pg_temp.run('employee cannot request a future punch', :alice,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note) values (%L, 1, 'clock_out', now() + interval '1 hour', 'x')$q$, :org), true);
select pg_temp.run('a note is required', :alice,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note) values (%L, 1, 'clock_out', now() - interval '2 hours', '   ')$q$, :org), true);

-- Reviewing.
select pg_temp.run('employee cannot approve their own request (update affects 0 rows)', :alice,
  $q$update punch_corrections set status = 'approved' where employee_id = 1$q$, false);
select pg_temp.check('…and it is still pending', (select status = 'pending' from punch_corrections where employee_id = 1));
select pg_temp.run('employee cannot delete a request (0 rows)', :alice, $q$delete from punch_corrections$q$, false);
select pg_temp.check('…and it still exists', (select count(*) = 1 from punch_corrections));

-- Visibility.
select pg_temp.run('setup: bob files a request', :bob,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note) values (%L, 2, 'clock_in', now() - interval '3 hours', 'Badge')$q$, :org), false);
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', true);
set local role app_user;
select pg_temp.check('alice only sees her own request', (select count(*) = 1 and bool_and(employee_id = 1) from punch_corrections));
reset role;
select set_config('test.uid', '33333333-3333-3333-3333-333333333333', true);
set local role app_user;
select pg_temp.check('the manager sees every request in the org', (select count(*) = 2 from punch_corrections));
reset role;

-- Approval by a manager.
select pg_temp.run('manager can approve a request', :mia,
  $q$update punch_corrections set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where employee_id = 1$q$, false);
select pg_temp.run('manager can create the approved manual punch', :mia,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, 1, 'clock_out', now() - interval '2 hours', true, 'Forgot')$q$, :org), false);
select pg_temp.check('…which keeps its requested time', (select punched_at < now() - interval '1 hour' from punch_records where is_manual));

-- Deleting an employee cascades to their requests.
reset role;
delete from punch_records where employee_id = 2;
delete from employees where id = 2;
select pg_temp.check('deleting an employee removes their requests', (select count(*) = 0 from punch_corrections where employee_id = 2));

rollback;
