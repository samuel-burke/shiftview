-- Tests for 0046_live_clock_in_same_day.sql. Run against a throwaway
-- Postgres database:
--
--   createdb clock_in_test
--   cd supabase/manual-tests && psql -q -d clock_in_test -f 0046_live_clock_in_same_day.test.sql
--   dropdb clock_in_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 reproduces
-- the gap on the schema before 0046; part 2 applies it (twice) and checks it.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../archive/baseline.sql
\ir ../archive/0038_notify_service_role_only.sql
\ir ../archive/0039_link_existing_accounts.sql
\ir ../archive/0040_remove_legacy_demo_job.sql
\ir ../archive/0041_database_audit_fixes.sql
\ir ../archive/0042_pay_rate_managers_only.sql
\ir ../archive/0043_punch_schedule_ownership.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''
\set e2   '''eeeeeeee-0000-0000-0000-000000000002'''
\set e3   '''eeeeeeee-0000-0000-0000-000000000003'''
\set e4   '''eeeeeeee-0000-0000-0000-000000000004'''

-- Runs one statement as a signed-in user; expect_error says whether it should
-- be rejected.
create or replace function pg_temp.run(label text, uid text, stmt text, expect_error boolean)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
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

-- A live clock-in by `uid`, as /api/punches (or a direct PostgREST call) makes it.
create or replace function pg_temp.clock_in(uid text) returns text language sql as $$
  select format($q$insert into punch_records (org_id, employee_id, punch_type)
                  select org_id, id, 'clock_in' from employees where user_id = %L$q$, uid)
$$;

-- An earlier punch for `uid`'s employee, written as the service role does
-- (seeding, history) so it keeps the given time.
create or replace function pg_temp.past(uid text, kind text, ago interval) returns void language sql as $$
  insert into punch_records (org_id, employee_id, punch_type, punched_at)
  select org_id, id, kind, now() - ago from employees where user_id = uid::uuid
$$;

begin;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now()), (:e2, 'e2@alder.test', now()),
  (:e3, 'e3@alder.test', now()), (:e4, 'e4@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
\set alder '(select id from organizations where slug = ''alder'')'
insert into employees (org_id, name, email, user_id)
select :alder, n, n || '@alder.test', u::uuid
  from (values ('e1', :e1), ('e2', :e2), ('e3', :e3), ('e4', :e4)) v(n, u);

-- Store timezone where it is around noon right now, so "earlier today" and
-- "yesterday" below never straddle midnight. Etc/GMT-N is UTC+N.
insert into app_settings (org_id, key, value)
select :alder, 'timezone',
       'Etc/GMT' || case when o > 0 then '-' || o when o < 0 then '+' || -o else '' end
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as o) s
on conflict (org_id, key) do update set value = excluded.value;

-- Part 1: before 0046.
select pg_temp.past(:e1, 'clock_in', interval '2 hours');
select pg_temp.run('before 0046: a second clock-in in the same shift got through', :e1,
  pg_temp.clock_in(:e1), false);

-- Part 2: 0046.
\set ON_ERROR_STOP on
\ir ../archive/0046_live_clock_in_same_day.sql
\ir ../archive/0046_live_clock_in_same_day.sql
\unset ON_ERROR_STOP

select pg_temp.past(:e2, 'clock_in', interval '2 hours');
select pg_temp.run('a second clock-in in the same shift is refused', :e2, pg_temp.clock_in(:e2), true);

select pg_temp.past(:e3, 'clock_in', interval '3 hours');
select pg_temp.past(:e3, 'break_start', interval '2 hours');
select pg_temp.past(:e3, 'break_end', interval '1 hour');
select pg_temp.run('a clock-in after a break, same day, is refused', :e3, pg_temp.clock_in(:e3), true);
select pg_temp.run('clocking out still works', :e3,
  format($q$insert into punch_records (org_id, employee_id, punch_type)
            select org_id, id, 'clock_out' from employees where user_id = %L$q$, :e3), false);
select pg_temp.run('clocking back in after clocking out works', :e3, pg_temp.clock_in(:e3), false);

select pg_temp.past(:e4, 'clock_in', interval '26 hours');
select pg_temp.run('a clock-in over a shift left open yesterday is allowed (forgotten clock-out)', :e4,
  pg_temp.clock_in(:e4), false);

-- An unusable stored timezone falls back to the app's default, not an error.
update app_settings set value = 'Not/AZone' where org_id = :alder and key = 'timezone';
delete from punch_records where employee_id = (select id from employees where user_id = :e2);
select pg_temp.run('an invalid store timezone does not break clocking in', :e2, pg_temp.clock_in(:e2), false);

select pg_temp.run('managers still record punches directly', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'clock_out', now() - interval '1 minute', true, 'fix' from employees where user_id = %L$q$, :e1), false);

rollback;
