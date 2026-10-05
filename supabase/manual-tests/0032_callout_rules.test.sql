-- Behavioural tests for supabase/migrations/0032_callout_rules.sql.
--
-- Self-contained: builds a minimal stand-in schema, applies the migration and
-- prints PASS/FAIL notices. Run against a throwaway Postgres database:
--
--   createdb callout_rules_test
--   cd supabase/manual-tests && psql -q -d callout_rules_test -f 0032_callout_rules.test.sql
--   dropdb callout_rules_test
--
-- Any line containing FAIL is a regression.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create table public.employees (id bigint primary key, org_id uuid not null, user_id uuid, name text);
create table public.managers (user_id uuid not null, org_id uuid not null);
create table public.app_settings (org_id uuid not null, key text not null, value text, primary key (org_id, key));
create table public.schedules (id serial primary key, org_id uuid not null, employee_id bigint not null, date date not null);
create table public.punch_records (id serial primary key, org_id uuid not null, employee_id bigint not null,
  punch_type text not null, punched_at timestamptz not null default now());
create table public.callouts (id serial primary key, org_id uuid not null, employee_id bigint not null,
  date date not null, reason text, unique (org_id, employee_id, date));
create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.managers where user_id = auth.uid() and org_id = p_org);
$$;

-- Org A in New York; org K at UTC+14 (its "today" is often the server's tomorrow).
insert into employees values
  (1, '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Alice'),
  (2, '00000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Bob'),
  (3, '00000000-0000-0000-0000-00000000000b', '44444444-4444-4444-4444-444444444444', 'Kai');
insert into managers values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a');
insert into app_settings values
  ('00000000-0000-0000-0000-00000000000a', 'timezone', 'America/New_York'),
  ('00000000-0000-0000-0000-00000000000b', 'timezone', 'Pacific/Kiritimati');

\ir ../migrations/0032_callout_rules.sql

create or replace function pg_temp.run(label text, uid text, stmt text, expect_error boolean) returns void language plpgsql as $$
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute stmt;
  if expect_error then raise notice 'FAIL  % (no error raised)', label; else raise notice 'PASS  %', label; end if;
exception when others then
  if expect_error then raise notice 'PASS  % (rejected: %)', label, sqlerrm;
  else raise notice 'FAIL  % (unexpected error: %)', label, sqlerrm; end if;
end $$;

\set alice '''11111111-1111-1111-1111-111111111111'''
\set bob   '''22222222-2222-2222-2222-222222222222'''
\set mia   '''33333333-3333-3333-3333-333333333333'''
\set kai   '''44444444-4444-4444-4444-444444444444'''
\set orgA  '''00000000-0000-0000-0000-00000000000a'''
\set orgK  '''00000000-0000-0000-0000-00000000000b'''

begin;

-- Store-local today/tomorrow for each org, and shifts on several days.
create temp table d as select
  (now() at time zone 'America/New_York')::date as ny,
  (now() at time zone 'Pacific/Kiritimati')::date as k;
insert into schedules (org_id, employee_id, date)
  select :orgA, e, (select ny from d) + o from unnest(array[1, 2]) e, generate_series(-1, 2) o;
insert into schedules (org_id, employee_id, date)
  select :orgK, 3, (select k from d) + o from generate_series(-1, 2) o;

select pg_temp.run('employee can call out for today''s shift', :alice,
  format('insert into callouts (org_id, employee_id, date) values (%L, 1, %L)', :orgA, (select ny from d)), false);
select pg_temp.run('employee can call out for tomorrow''s shift', :alice,
  format('insert into callouts (org_id, employee_id, date) values (%L, 1, %L)', :orgA, (select ny + 1 from d)), false);
select pg_temp.run('not for yesterday', :alice,
  format('insert into callouts (org_id, employee_id, date) values (%L, 1, %L)', :orgA, (select ny - 1 from d)), true);
select pg_temp.run('not for the day after tomorrow', :alice,
  format('insert into callouts (org_id, employee_id, date) values (%L, 1, %L)', :orgA, (select ny + 2 from d)), true);
select pg_temp.run('not for a coworker', :alice,
  format('insert into callouts (org_id, employee_id, date) values (%L, 2, %L)', :orgA, (select ny from d)), true);
select pg_temp.run('not for a day without a shift', :bob,
  format('delete from schedules where employee_id = 2 and date = %L; insert into callouts (org_id, employee_id, date) values (%L, 2, %L)',
    (select ny + 1 from d), :orgA, (select ny + 1 from d)), true);

-- Clocked in today.
insert into punch_records (org_id, employee_id, punch_type, punched_at) values (:orgA, 2, 'clock_in', now());
select pg_temp.run('not for today once clocked in', :bob,
  format('insert into callouts (org_id, employee_id, date) values (%L, 2, %L)', :orgA, (select ny from d)), true);
select pg_temp.run('…but a manager can still record it', :mia,
  format('insert into callouts (org_id, employee_id, date) values (%L, 2, %L)', :orgA, (select ny from d)), false);
select pg_temp.run('re-filing (upsert) is held to the same rules', :alice,
  format('update callouts set date = %L where employee_id = 1 and date = %L', (select ny + 2 from d), (select ny from d)), true);

-- A clock-in from yesterday doesn't block today.
delete from punch_records;
insert into punch_records (org_id, employee_id, punch_type, punched_at)
  values (:orgA, 1, 'clock_in', ((select ny from d)::timestamp at time zone 'America/New_York') - interval '1 minute');
delete from callouts where employee_id = 1;
select pg_temp.run('yesterday''s clock-in doesn''t block today', :alice,
  format('insert into callouts (org_id, employee_id, date) values (%L, 1, %L)', :orgA, (select ny from d)), false);

-- UTC+14 store: today/tomorrow follow the store, not the server.
select pg_temp.run('UTC+14 store: today is the store''s today', :kai,
  format('insert into callouts (org_id, employee_id, date) values (%L, 3, %L)', :orgK, (select k from d)), false);
select pg_temp.run('UTC+14 store: tomorrow is the store''s tomorrow', :kai,
  format('insert into callouts (org_id, employee_id, date) values (%L, 3, %L)', :orgK, (select k + 1 from d)), false);
select pg_temp.run('UTC+14 store: the store''s yesterday is rejected', :kai,
  format('insert into callouts (org_id, employee_id, date) values (%L, 3, %L)', :orgK, (select k - 1 from d)), true);

select pg_temp.run('service role is unrestricted', null,
  format('insert into callouts (org_id, employee_id, date) values (%L, 2, %L)', :orgA, (select ny + 2 from d)), false);

rollback;
