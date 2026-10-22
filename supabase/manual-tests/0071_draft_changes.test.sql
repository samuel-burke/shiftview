-- Tests for 0071_draft_changes.sql. Run against a throwaway Postgres
-- database:
--
--   createdb draft_changes_test
--   cd supabase/manual-tests && psql -q -d draft_changes_test -f 0071_draft_changes.test.sql
--   dropdb draft_changes_test
--
-- Any line containing FAIL (or any ERROR) is a regression. The migration is
-- applied twice (it must be safe to repeat).

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
\ir ../migrations/0070_shift_notes.sql
\ir ../migrations/0072_time_off_ranges.sql
\ir ../migrations/0073_calendar_feeds.sql
\ir ../migrations/0074_punch_gps_required.sql
\ir ../migrations/0075_live_punch_current_shift.sql
\ir ../migrations/0076_callout_reason_privacy.sql
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
insert into employees (org_id, name, email, user_id)
  select id, 'e1', 'e1@alder.test', :e1::uuid from organizations where slug = 'alder';
insert into employees (org_id, name, email)
  select id, 'e2', 'e2@alder.test' from organizations where slug = 'alder';

create temp table ids as select
  (select id from organizations where slug = 'alder') as org,
  (select id from employees where email = 'e1@alder.test') as e1,
  (select id from employees where email = 'e2@alder.test') as e2;

insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
  select org, e1, date '2026-10-19', 540, 1020 from ids
  union all select org, e1, date '2026-10-20', 540, 1020 from ids;

\set ON_ERROR_STOP on
\ir ../migrations/0071_draft_changes.sql
\ir ../migrations/0071_draft_changes.sql
\unset ON_ERROR_STOP

create temp table live as select id, date from schedules;

select pg_temp.accepts('a draft can change a live shift',
  (select format($q$insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, replaces_schedule_id)
     values (%L, %s, '2026-10-19', 600, 1080, %s)$q$, org, e1, (select id from live where date = '2026-10-19')) from ids), true);
select pg_temp.accepts('only one draft per live shift',
  (select format($q$insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, replaces_schedule_id)
     values (%L, %s, '2026-10-21', 600, 1080, %s)$q$, org, e2, (select id from live where date = '2026-10-19')) from ids), false);
select pg_temp.accepts('a removal must name the live shift',
  (select format($q$insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, removes)
     values (%L, %s, '2026-10-22', 540, 1020, true)$q$, org, e2) from ids), false);
select pg_temp.accepts('a draft cannot change another org''s shift',
  (select format($q$insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, replaces_schedule_id)
     values (gen_random_uuid(), %s, '2026-10-20', 600, 1080, %s)$q$, e1, (select id from live where date = '2026-10-20')) from ids), false);
select pg_temp.accepts('a draft can remove a live shift',
  (select format($q$insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, replaces_schedule_id, removes)
     values (%L, %s, '2026-10-20', 540, 1020, %s, true)$q$, org, e1, (select id from live where date = '2026-10-20')) from ids), true);
insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes)
  select org, e2, date '2026-10-19', 540, 1020 from ids;

select pg_temp.check('existing drafts read as new shifts',
  (select bool_and(not removes) from draft_schedules where replaces_schedule_id is null));

-- Auto-schedule's replace leaves changes to live shifts alone.
create temp table args as select
  org,
  (select jsonb_agg(jsonb_build_array(id, employee_id, date, start_minutes, end_minutes) order by id)
     from draft_schedules where replaces_schedule_id is null) as expected,
  jsonb_build_array(jsonb_build_object('employee_id', e2, 'date', '2026-10-21', 'start_minutes', 540, 'end_minutes', 1020)) as rows
  from ids;
grant select on args to authenticated;
create temp table result (r jsonb);
grant insert on result to authenticated;
-- (The migration's own commit ended the test's transaction: session settings.)
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
insert into result
  select apply_generated_drafts(org, '2026-10-17', 'replace', null, expected, rows, 1, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb) from args;
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check('a replace run compares only new-shift drafts', (select r->>'status' = 'ok' from result));
select pg_temp.check('...removes the new-shift drafts it replaces', (select r->>'removed' = '1' from result));
select pg_temp.check('...and keeps the change and the removal',
  (select count(*) = 2 from draft_schedules where replaces_schedule_id is not null));
select pg_temp.check('...without snapshotting them for undo',
  (select jsonb_array_length(previous_drafts) = 1 from schedule_generation_runs order by id desc limit 1));

-- Deleting the live shift takes its drafted change with it.
delete from schedules where date = '2026-10-19';
select pg_temp.check('a change goes with its deleted live shift',
  (select count(*) = 1 from draft_schedules where replaces_schedule_id is not null));

rollback;
