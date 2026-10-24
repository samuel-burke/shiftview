-- Tests for 0073_calendar_feeds.sql. Run against a throwaway Postgres database:
--
--   createdb calendar_feeds_test
--   cd supabase/manual-tests && psql -q -d calendar_feeds_test -f 0073_calendar_feeds.test.sql
--   dropdb calendar_feeds_test
--
-- Any line containing FAIL (or any ERROR) is a regression. The migration is
-- applied twice (it must be safe to repeat).

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../migrations/20261018000000_baseline.sql
\ir ../migrations/20261024000052_employee_delete_cascade.sql
\ir ../migrations/20261024000070_shift_notes.sql
\ir ../migrations/20261024000072_time_off_ranges.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''

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

-- Runs a statement as the table owner and reports whether it was accepted.
create or replace function pg_temp.accepts(label text, stmt text, expect_ok boolean) returns void language plpgsql as $$
begin
  execute stmt;
  if expect_ok then raise notice 'PASS  %', label; else raise notice 'FAIL  % (accepted)', label; end if;
exception when others then
  if expect_ok then raise notice 'FAIL  % (rejected: %)', label, sqlerrm;
  else raise notice 'PASS  % (rejected: %)', label, sqlerrm; end if;
end $$;

begin;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
\set alder '(select id from organizations where slug = ''alder'')'
\set emp '(select id from employees where user_id = ''eeeeeeee-0000-0000-0000-000000000001'')'
insert into employees (org_id, name, email, user_id) values (:alder, 'e1', 'e1@alder.test', :e1::uuid);


\set ON_ERROR_STOP on
\ir ../migrations/20261024000073_calendar_feeds.sql
\ir ../migrations/20261024000073_calendar_feeds.sql
\unset ON_ERROR_STOP

-- Calendar feeds: service role only, one per person, hashed tokens.
select pg_temp.run('the service role can store a feed', null,
  format($q$insert into calendar_feeds (org_id, employee_id, token_hash) values (%L, %s, repeat('a', 64))$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false, 'service_role');
select pg_temp.run('an employee cannot read feeds', :e1, 'select * from calendar_feeds', true);
select pg_temp.run('a manager cannot read feeds', :ann, 'select * from calendar_feeds', true);
select pg_temp.run('anon cannot read feeds', null, 'select * from calendar_feeds', true, 'anon');
select pg_temp.run('an employee cannot write a feed', :e1,
  format($q$insert into calendar_feeds (org_id, employee_id, token_hash) values (%L, %s, repeat('b', 64))$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), true);
select pg_temp.accepts('one feed per person',
  format($q$insert into calendar_feeds (org_id, employee_id, token_hash) values (%L, %s, repeat('c', 64))$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false);
select pg_temp.accepts('a feed stores a hash, not a raw token',
  format($q$update calendar_feeds set token_hash = 'not-a-hash' where org_id = %L$q$, (select id from organizations where slug = 'alder')), false);
select pg_temp.accepts('a feed must belong to an employee of its org',
  format($q$insert into calendar_feeds (org_id, employee_id, token_hash) values (gen_random_uuid(), %s, repeat('d', 64))$q$,
    (select id from employees where user_id = :e1::uuid)), false);
delete from schedules; delete from draft_schedules; delete from time_off_requests;
select pg_temp.accepts('removing the employee is allowed',
  $q$delete from employees where user_id = 'eeeeeeee-0000-0000-0000-000000000001'$q$, true);
select pg_temp.check('...and removes their feed', not exists (select 1 from calendar_feeds));

rollback;
