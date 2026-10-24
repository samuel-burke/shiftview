-- Tests for 0078_draft_change_same_shift.sql. Run with scripts/test-sql.sh 0078.
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows that
-- under 0071 a change draft written for another person moves the wrong
-- person's live shift; part 2 applies 0078 (twice) and checks the refusal.

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
\ir ../migrations/0071_draft_changes.sql
\ir ../migrations/0072_time_off_ranges.sql
\ir ../migrations/0073_calendar_feeds.sql
\ir ../migrations/0074_punch_gps_required.sql
\ir ../migrations/0075_live_punch_current_shift.sql
\ir ../migrations/0076_callout_reason_privacy.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- Publishes every draft as the manager; returns the SQLSTATE, or 'ok'.
create or replace function pg_temp.publish() returns text language plpgsql as $$
declare v_org uuid := (select id from organizations where slug = 'alder');
        v_ids bigint[] := (select array_agg(id) from draft_schedules);
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform publish_drafts(v_org, v_ids);
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end $$;

insert into auth.users (id, email, email_confirmed_at) values (:ann, 'ann@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
insert into employees (org_id, name, email)
  select id, n, n || '@alder.test' from organizations, unnest(array['e1', 'e2']) n where slug = 'alder';
create temp table ids as select
  (select id from organizations where slug = 'alder') as org,
  (select id from employees where email = 'e1@alder.test') as e1,
  (select id from employees where email = 'e2@alder.test') as e2;
insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
  select org, e1, date '2026-10-19', 540, 1020 from ids;
create temp table live as select id from schedules;

-- e2's "change" on 2026-10-21 names e1's live shift on 2026-10-19.
create function pg_temp.mismatched_draft() returns void language sql as $$
  delete from draft_schedules;
  insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, replaces_schedule_id)
    select org, e2, date '2026-10-21', 600, 660, (select id from live) from ids;
$$;

-- Part 1: under 0071.
select pg_temp.mismatched_draft();
select pg_temp.check('under 0071 the mismatched draft publishes', pg_temp.publish() = 'ok');
select pg_temp.check('...and moves e1''s shift, though the draft was e2''s',
  (select s.start_minutes = 600 and s.employee_id = ids.e1 from schedules s, ids));
update schedules set start_minutes = 540;

-- Part 2: 0078.
\set ON_ERROR_STOP on
\ir ../migrations/0078_draft_change_same_shift.sql
\ir ../migrations/0078_draft_change_same_shift.sql
\unset ON_ERROR_STOP

select pg_temp.mismatched_draft();
select pg_temp.check('a change for another person is refused', pg_temp.publish() = '23514');
select pg_temp.check('...keeping the draft', (select count(*) = 1 from draft_schedules));
select pg_temp.check('...and leaving the live shift alone', (select start_minutes = 540 from schedules));

update draft_schedules set employee_id = (select e1 from ids), date = '2026-10-20';
select pg_temp.check('a change for the same person on another day is refused too', pg_temp.publish() = '23514');

update draft_schedules set date = '2026-10-19';
select pg_temp.check('a change that keeps the person and day publishes', pg_temp.publish() = 'ok');
select pg_temp.check('...and changes the live shift', (select start_minutes = 600 from schedules));
