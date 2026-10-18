-- Tests for 0070_scheduling_basics.sql. Run against a throwaway Postgres
-- database:
--
--   createdb scheduling_basics_test
--   cd supabase/manual-tests && psql -q -d scheduling_basics_test -f 0070_scheduling_basics.test.sql
--   dropdb scheduling_basics_test
--
-- Any line containing FAIL (or any ERROR) is a regression. The migration is
-- applied twice (it must be safe to repeat), over an open shift with an old,
-- long note that must survive.

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

-- An open shift whose note predates the 280-character limit.
insert into open_shifts (org_id, date, start_minutes, end_minutes, note)
  values (:alder, '2026-11-02', 540, 1020, repeat('x', 400));
-- An existing whole-day request.
insert into time_off_requests (org_id, employee_id, date) values (:alder, :emp, '2026-11-01');

\set ON_ERROR_STOP on
\ir ../migrations/0070_scheduling_basics.sql
\ir ../migrations/0070_scheduling_basics.sql
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

-- Shift notes: 280 characters at most, everywhere a shift is written.
select pg_temp.accepts('a shift takes a note',
  format($q$insert into schedules (org_id, employee_id, date, start_minutes, end_minutes, note) values (%L, %s, '2026-11-05', 540, 1020, 'Truck at 7')$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), true);
select pg_temp.accepts('a shift note over 280 characters is refused',
  format($q$insert into schedules (org_id, employee_id, date, start_minutes, end_minutes, note) values (%L, %s, '2026-11-06', 540, 1020, repeat('x', 281))$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false);
select pg_temp.accepts('a draft note over 280 characters is refused',
  format($q$insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, note) values (%L, %s, '2026-11-06', 540, 1020, repeat('x', 281))$q$,
    (select id from organizations where slug = 'alder'), (select id from employees where user_id = :e1::uuid)), false);
select pg_temp.check('template rows have a note column',
  exists (select 1 from information_schema.columns where table_name = 'schedule_template_rows' and column_name = 'note'));
select pg_temp.check('an old, long open-shift note survives',
  (select char_length(note) = 400 from open_shifts where date = '2026-11-02'));
select pg_temp.accepts('a new open-shift note over 280 characters is refused',
  format($q$insert into open_shifts (org_id, date, start_minutes, end_minutes, note) values (%L, '2026-11-07', 540, 1020, repeat('x', 281))$q$,
    (select id from organizations where slug = 'alder')), false);

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
