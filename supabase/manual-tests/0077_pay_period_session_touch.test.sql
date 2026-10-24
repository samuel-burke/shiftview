-- Tests for 0077_pay_period_session_touch.sql. Run with scripts/test-sql.sh 0077.
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows that
-- under 0062 editing the next-morning clock-out of a Sunday night shift
-- leaves the Sunday week approved and signed off; part 2 applies 0077 (twice)
-- and checks the week is reopened.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../migrations/20261018000000_baseline.sql
\ir ../migrations/20261024000052_employee_delete_cascade.sql
\ir ../migrations/20261024000053_punch_history.sql
\ir ../migrations/20261024000054_archive_employees.sql
\ir ../migrations/20261024000060_pay_rules.sql
\ir ../migrations/20261024000062_pay_periods.sql
\ir ../migrations/20261024000070_shift_notes.sql
\ir ../migrations/20261024000071_draft_changes.sql
\ir ../migrations/20261024000072_time_off_ranges.sql
\ir ../migrations/20261024000073_calendar_feeds.sql
\ir ../migrations/20261024000074_punch_gps_required.sql
\ir ../migrations/20261024000075_live_punch_current_shift.sql
\ir ../migrations/20261024000076_callout_reason_privacy.sql
\unset ON_ERROR_STOP
\set ON_ERROR_STOP on
\ir ../migrations/20261024000078_draft_change_same_shift.sql
\ir ../migrations/20261024000078_draft_change_same_shift.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- Runs stmt as the signed-in user uid; returns 'ok' or the error.
create or replace function pg_temp.as_user(uid text, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate || ' ' || sqlerrm;
end $$;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
select id as org from organizations where slug = 'alder' \gset
insert into employees (org_id, name, email, user_id) values (:'org', 'e1', 'e1@alder.test', :e1::uuid);
insert into app_settings (org_id, key, value) values
  (:'org', 'timezone', 'America/New_York'), (:'org', 'pay_period_frequency', 'weekly');

-- Week A ran two weeks ago (Monday start); its Sunday night shift ends on
-- Monday morning, in week B.
select (date_trunc('week', (now() at time zone 'America/New_York')::date) - interval '14 days')::date as a_start \gset
select (:'a_start'::date + 6)::text as a_sun, (:'a_start'::date + 7)::text as b_mon \gset
insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
  select :'org', id, 'clock_in', (:'a_sun' || ' 22:00 America/New_York')::timestamptz, true, 'seed' from employees where name = 'e1';
insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
  select :'org', id, 'clock_out', (:'b_mon' || ' 06:00 America/New_York')::timestamptz, true, 'seed' from employees where name = 'e1';
select id as out_id from punch_records where punch_type = 'clock_out' \gset

create function pg_temp.approve_and_sign() returns void language plpgsql as $$
begin
  perform pg_temp.check('the manager approves week A',
    pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001',
      format($q$select pay_period_approve(%L, %L)$q$, (select id from organizations where slug = 'alder'),
             (date_trunc('week', (now() at time zone 'America/New_York')::date) - interval '14 days')::date)) = 'ok');
  perform pg_temp.check('e1 signs off week A',
    pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000001',
      format($q$select pay_period_sign(%L, %L, 'signed')$q$, (select id from organizations where slug = 'alder'),
             (date_trunc('week', (now() at time zone 'America/New_York')::date) - interval '14 days')::date)) = 'ok');
end $$;

create function pg_temp.week_a_reopened() returns boolean language sql as $$
  select exists (select 1 from pay_periods p where p.status = 'open'
                   and p.start_date = (date_trunc('week', (now() at time zone 'America/New_York')::date) - interval '14 days')::date)
     and not exists (select 1 from pay_period_signoffs)
$$;

-- Part 1: under 0062.
select pg_temp.approve_and_sign();
select pg_temp.check('under 0062 the manager moves the Monday clock-out',
  pg_temp.as_user(:ann, format($q$update punch_records set punched_at = punched_at + interval '1 hour', note = 'fix' where id = %s$q$, :out_id)) = 'ok');
select pg_temp.check('...and week A stays approved and signed off', not pg_temp.week_a_reopened());

-- Part 2: 0077.
\set ON_ERROR_STOP on
\ir ../migrations/20261024000077_pay_period_session_touch.sql
\ir ../migrations/20261024000077_pay_period_session_touch.sql
\unset ON_ERROR_STOP

select pg_temp.check('moving the Monday clock-out now works',
  pg_temp.as_user(:ann, format($q$update punch_records set punched_at = punched_at + interval '1 hour', note = 'fix' where id = %s$q$, :out_id)) = 'ok');
select pg_temp.check('...and reopens week A, clearing the sign-off', pg_temp.week_a_reopened());
select pg_temp.check('...with events saying why',
  (select count(*) = 1 from pay_period_events where action = 'approval_cleared')
  and (select count(*) = 1 from pay_period_events where action = 'signoff_cleared'));

select pg_temp.approve_and_sign();
select pg_temp.check('deleting the Monday clock-out works',
  pg_temp.as_user(:ann, format($q$select delete_punch(%s, 'wrong day')$q$, :out_id)) = 'ok');
select pg_temp.check('...and reopens week A too', pg_temp.week_a_reopened());

select pg_temp.check('a new clock-out on Monday for that shift',
  pg_temp.as_user(:ann, format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
    select org_id, id, 'clock_out', %L::timestamptz, true, 'fix' from employees where name = 'e1'$q$, :'b_mon' || ' 06:00 America/New_York')) = 'ok');
select pg_temp.approve_and_sign();
select pg_temp.check('a punch in week B after the shift closed leaves week A alone',
  pg_temp.as_user(:ann, format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
    select org_id, id, 'clock_in', %L::timestamptz, true, 'fix' from employees where name = 'e1'$q$, :'b_mon' || ' 09:00 America/New_York')) = 'ok'
  and not pg_temp.week_a_reopened());
