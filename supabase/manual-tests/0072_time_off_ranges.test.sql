-- Tests for 0072_time_off_ranges.sql. Run against a throwaway Postgres database:
--
--   createdb time_off_ranges_test
--   cd supabase/manual-tests && psql -q -d time_off_ranges_test -f 0072_time_off_ranges.test.sql
--   dropdb time_off_ranges_test
--
-- Any line containing FAIL (or any ERROR) is a regression. The migration is
-- applied twice (it must be safe to repeat), over an existing whole-day
-- request that must keep reading as a whole day.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../migrations/20261018000000_baseline.sql
\ir ../migrations/20261024000052_employee_delete_cascade.sql
\ir ../migrations/20261024000070_shift_notes.sql
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

-- An existing whole-day request.
insert into time_off_requests (org_id, employee_id, date) values (:alder, :emp, '2026-11-01');

\set ON_ERROR_STOP on
\ir ../migrations/20261024000072_time_off_ranges.sql
\ir ../migrations/20261024000072_time_off_ranges.sql
\unset ON_ERROR_STOP

-- Time off: existing rows are whole days; part days stay inside one day.
select pg_temp.check('existing requests read as whole days',
  (select start_minutes is null and end_minutes is null and group_id is null from time_off_requests where date = '2026-11-01'));
select pg_temp.accepts('a part-day request is accepted',
  format($q$insert into time_off_requests (org_id, employee_id, date, start_minutes, end_minutes) values (%L, %s, '2026-11-03', 900, 1080)$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), true);
select pg_temp.accepts('a part day needs both times',
  format($q$insert into time_off_requests (org_id, employee_id, date, start_minutes) values (%L, %s, '2026-11-04', 900)$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false);
select pg_temp.accepts('a part day must end after it starts',
  format($q$insert into time_off_requests (org_id, employee_id, date, start_minutes, end_minutes) values (%L, %s, '2026-11-04', 900, 900)$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false);
select pg_temp.accepts('a part day stays inside the day',
  format($q$insert into time_off_requests (org_id, employee_id, date, start_minutes, end_minutes) values (%L, %s, '2026-11-04', 1380, 1500)$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false);
select pg_temp.accepts('the days of a multi-day request share a group',
  format($q$insert into time_off_requests (org_id, employee_id, date, group_id) values
    (%1$L, %2$s, '2026-11-10', '11111111-1111-1111-1111-111111111111'),
    (%1$L, %2$s, '2026-11-11', '11111111-1111-1111-1111-111111111111')$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), true);
select pg_temp.accepts('still one request per person per day',
  format($q$insert into time_off_requests (org_id, employee_id, date) values (%L, %s, '2026-11-10')$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false);

rollback;
