-- Tests for 0070_shift_notes.sql. Run against a throwaway Postgres database:
--
--   createdb shift_notes_test
--   cd supabase/manual-tests && psql -q -d shift_notes_test -f 0070_shift_notes.test.sql
--   dropdb shift_notes_test
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
\ir ../migrations/0052_employee_delete_cascade.sql
\ir ../migrations/0053_punch_history.sql
\ir ../migrations/0054_archive_employees.sql
\ir ../migrations/0060_pay_rules.sql
\ir ../migrations/0062_pay_periods.sql
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

\set ON_ERROR_STOP on
\ir ../migrations/0070_shift_notes.sql
\ir ../migrations/0070_shift_notes.sql
\unset ON_ERROR_STOP

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

rollback;
