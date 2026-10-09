-- Smoke tests for supabase/baseline.sql: builds a new project's database the
-- way the README says (baseline, then every migration after 0037), then runs
-- the core flows against it as real API roles, printing PASS/FAIL notices.
-- Run against a throwaway Postgres database:
--
--   createdb baseline_test
--   cd supabase/manual-tests && psql -q -d baseline_test -f baseline.test.sql
--   dropdb baseline_test
--
-- Any line containing FAIL (or any ERROR) is a regression. The schema itself
-- is checked separately, by comparing the catalog with production's.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../baseline.sql
\ir ../migrations/0038_notify_service_role_only.sql
\ir ../migrations/0039_link_existing_accounts.sql
\ir ../migrations/0040_remove_legacy_demo_job.sql
\ir ../migrations/0041_database_audit_fixes.sql
\ir ../migrations/0042_pay_rate_managers_only.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set cara '''cccccccc-0000-0000-0000-000000000001'''

-- Runs one statement as `role` with auth.uid() = uid; expect_error says
-- whether it should be rejected. Statements outside these helpers run with no
-- signed-in user, like Supabase Auth and the service role do.
create or replace function pg_temp.run(label text, uid text, stmt text, expect_error boolean, role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute format('set local role %I', role);
  execute stmt;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if expect_error then raise notice 'FAIL  % (no error raised)', label;
  else raise notice 'PASS  %', label; end if;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if expect_error then raise notice 'PASS  % (rejected: %)', label, sqlerrm;
  else raise notice 'FAIL  % (unexpected error: %)', label, sqlerrm; end if;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- Rows `uid` can see in `tbl` that match `cond`.
create or replace function pg_temp.visible(uid text, tbl text, cond text default 'true') returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  execute format('select count(*) from public.%I where %s', tbl, cond) into n;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

begin;

select pg_temp.check('the default and demo organizations are seeded',
  (select count(*) = 2 from organizations where (slug, is_demo) in (('default', false), ('demo', true))));

-- Sign-up: /api/organizations creates the account, then calls
-- org_signup_create with the service role.
insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()),
  (:ben, 'ben@birch.test', now());
select pg_temp.run('the service role creates an organization for a new owner', null,
  format($q$select org_signup_create('Alder Street', 'alder', %L, 'Ann', 'ann@alder.test')$q$, :ann), false, 'service_role');
select pg_temp.run('a signed-in user cannot call org_signup_create', :ben,
  format($q$select org_signup_create('Birch Lane', 'birch', %L, 'Ben', 'ben@birch.test')$q$, :ben), true);
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben', 'ben@birch.test');

\set alder '(select id from organizations where slug = ''alder'')'
\set birch '(select id from organizations where slug = ''birch'')'

select pg_temp.check('the owner is a manager and has a linked employee row',
  exists (select 1 from managers where user_id = :ann and is_owner and org_id = :alder)
  and exists (select 1 from employees where user_id = :ann and org_id = :alder));

-- Invites: the manager adds an employee row, then the invite creates the
-- account, which on_auth_user_created links to that row.
select pg_temp.run('a manager adds an employee to their team', :ann,
  format($q$insert into employees (org_id, name, email) values (%L, 'Cara', 'cara@example.test')$q$, (select id from organizations where slug = 'alder')), false);
select pg_temp.run('a manager cannot add an employee to another team', :ann,
  format($q$insert into employees (org_id, name, email) values (%L, 'Mole', 'mole@example.test')$q$, (select id from organizations where slug = 'birch')), true);
insert into auth.users (id, email) values (:cara, 'cara@example.test');
select pg_temp.check('accepting the invite links the employee row',
  exists (select 1 from employees where user_id = :cara and org_id = :alder));

-- Cross-organization isolation.
select pg_temp.check('a manager sees only their own team',
  pg_temp.visible(:ann, 'employees') = 2
  and pg_temp.visible(:ann, 'employees', format('org_id = %L', (select id from organizations where slug = 'birch'))) = 0);
select pg_temp.check('an employee sees their coworkers but no other team',
  pg_temp.visible(:cara, 'employees') = 2 and pg_temp.visible(:cara, 'managers') = 1);
select pg_temp.run('an anonymous caller reads no employees', null,
  $q$do $d$ begin if (select count(*) from public.employees) > 0 then raise exception 'saw rows'; end if; end $d$$q$, false, 'anon');

-- Schedules: managers write, members read.
select pg_temp.run('a manager schedules their employee', :ann,
  format($q$insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
            select org_id, id, '2030-01-15', 540, 1020 from employees where user_id = %L$q$, :cara), false);
select pg_temp.run('an employee cannot write the schedule', :cara,
  format($q$insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
            select org_id, id, '2030-01-16', 540, 1020 from employees where user_id = %L$q$, :cara), true);
select pg_temp.check('the employee sees the shift; the other team does not',
  pg_temp.visible(:cara, 'schedules') = 1 and pg_temp.visible(:ben, 'schedules') = 0);

-- Time clock: own punches only, in order.
select pg_temp.run('an employee clocks in', :cara,
  format($q$insert into punch_records (org_id, employee_id, punch_type)
            select org_id, id, 'clock_in' from employees where user_id = %L$q$, :cara), false);
select pg_temp.run('a duplicate clock-in is refused', :cara,
  format($q$insert into punch_records (org_id, employee_id, punch_type)
            select org_id, id, 'clock_in' from employees where user_id = %L$q$, :cara), true);
select pg_temp.run('an employee cannot punch for the owner', :cara,
  format($q$insert into punch_records (org_id, employee_id, punch_type)
            select org_id, id, 'clock_in' from employees where user_id = %L$q$, :ann), true);
select pg_temp.check('the other team cannot see the punch',
  pg_temp.visible(:ben, 'punch_records') = 0 and pg_temp.visible(:ann, 'punch_records') = 1);

-- Existing accounts (0039): Birch invites Cara, who already has an account.
insert into employees (org_id, name, email) values (:birch, 'Cara', 'Cara@Example.test');
select pg_temp.run('only the service role can link existing accounts', :ben,
  format($q$select link_employee_account(%L, (select id from employees where email = 'Cara@Example.test'))$q$, (select id from organizations where slug = 'birch')), true);
select pg_temp.check('the invite links Cara''s existing account to Birch',
  (select user_id = :cara from link_employee_account(:birch, (select id from employees where email = 'Cara@Example.test'))));
select pg_temp.check('Cara now belongs to both teams',
  pg_temp.visible(:cara, 'organizations') = 2);

-- Notify helpers are server-only (0038).
select pg_temp.run('a signed-in user cannot write notifications through notify_insert', :cara,
  format($q$select notify_insert(%L, %L, 'x', 'spoof', 'spoof', '{}')$q$, (select id from organizations where slug = 'alder'), :ann), true);
select pg_temp.run('the service role can', null,
  format($q$select notify_insert(%L, %L, 'x', 'hello', 'hello', '{}')$q$, (select id from organizations where slug = 'alder'), :ann), false, 'service_role');

select pg_temp.check('swaps, messages and schedules stream over Realtime',
  (select count(*) = 3 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename in ('shift_swaps', 'messages', 'schedules')));

rollback;
