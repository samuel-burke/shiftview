-- Tests for 0062_pay_periods.sql. Run against a throwaway Postgres database:
--
--   createdb pay_periods_test
--   cd supabase/manual-tests && psql -q -d pay_periods_test -f 0062_pay_periods.test.sql
--   dropdb pay_periods_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows that
-- before 0062 a paid period's punches stay editable by anyone who could edit
-- them before; part 2 applies it (twice) and checks it.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../migrations/20261018000000_baseline.sql
\ir ../migrations/20261024000052_employee_delete_cascade.sql
\ir ../migrations/20261024000053_punch_history.sql
\ir ../migrations/20261024000054_archive_employees.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''
\set e2   '''eeeeeeee-0000-0000-0000-000000000002'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''

-- Runs one statement as `role` with auth.uid() = uid; expect_error says
-- whether it should be rejected.
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

-- Like run, but also checks the SQLSTATE the rejection carries.
create or replace function pg_temp.refused(label text, uid text, stmt text, code text, role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute format('set local role %I', role);
  execute stmt;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'FAIL  % (no error raised)', label;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  if sqlstate = code then raise notice 'PASS  % (rejected: %)', label, sqlerrm;
  else raise notice 'FAIL  % (wrong error % %, wanted %)', label, sqlstate, sqlerrm, code; end if;
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

-- A manual punch for the employee linked to `uid`, made by the service role,
-- at `at`. Returns its id.
create or replace function pg_temp.punch(uid uuid, kind text, at timestamptz)
returns bigint language sql as $$
  insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
  select org_id, id, kind, at, true, 'seed' from employees where user_id = uid
  returning id
$$;

begin;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now()),
  (:e2, 'e2@alder.test', now()), (:ben, 'ben@birch.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben', 'ben@birch.test');
\set alder '(select id from organizations where slug = ''alder'')'
select id as alder_id from organizations where slug = 'alder' \gset
insert into employees (org_id, name, email, user_id) values
  (:alder, 'e1', 'e1@alder.test', :e1::uuid), (:alder, 'e2', 'e2@alder.test', :e2::uuid);
insert into app_settings (org_id, key, value) values (:alder, 'timezone', 'America/New_York');

-- A punch in the store's previous week and last week's dates (Monday start).
select (date_trunc('week', (now() at time zone 'America/New_York')::date) - interval '7 days')::date as last_start \gset
select (:'last_start'::date + 6) as last_end \gset
select (:'last_start'::date + 2)::text as last_wed \gset

-- Part 1: before 0062.
select pg_temp.punch(:e1, 'clock_in', (:'last_wed' || ' 09:00 America/New_York')::timestamptz) as p1 \gset
select pg_temp.run('before 0062: a manager moves a punch in last week, long after payroll ran', :ann,
  format($q$update punch_records set punched_at = punched_at - interval '1 hour', note = 'late fix' where id = %s$q$, :p1), false);
select pg_temp.check('before 0062: there is nothing to close a pay period with',
  to_regclass('public.pay_periods') is null);
delete from punch_records;

-- Part 2: 0062.
\set ON_ERROR_STOP on
\ir ../migrations/20261024000062_pay_periods.sql
\ir ../migrations/20261024000062_pay_periods.sql
\unset ON_ERROR_STOP

-- ── Period math (lib/pay-periods.test.ts checks the same dates) ─────────────
select pg_temp.check('weekly with no anchor: Monday to Sunday',
  (select (start_date, end_date) = ('2026-10-12'::date, '2026-10-18'::date) from pay_period_bounds('weekly', null, '2026-10-18')));
select pg_temp.check('weekly on a Monday starts that day',
  (select (start_date, end_date) = ('2026-10-12'::date, '2026-10-18'::date) from pay_period_bounds('weekly', null, '2026-10-12')));
select pg_temp.check('weekly with a Wednesday anchor: Wednesday to Tuesday',
  (select (start_date, end_date) = ('2026-10-14'::date, '2026-10-20'::date) from pay_period_bounds('weekly', '2026-10-07', '2026-10-18')));
select pg_temp.check('biweekly counts from the anchor',
  (select (start_date, end_date) = ('2026-10-12'::date, '2026-10-25'::date) from pay_period_bounds('biweekly', '2026-09-28', '2026-10-25')));
select pg_temp.check('biweekly before the anchor',
  (select (start_date, end_date) = ('2026-09-14'::date, '2026-09-27'::date) from pay_period_bounds('biweekly', '2026-09-28', '2026-09-27')));
select pg_temp.check('biweekly across a year end',
  (select (start_date, end_date) = ('2026-12-21'::date, '2027-01-03'::date) from pay_period_bounds('biweekly', '2026-09-28', '2027-01-01')));
select pg_temp.check('biweekly with no anchor has no periods',
  (select start_date is null from pay_period_bounds('biweekly', null, '2026-10-18')));
select pg_temp.check('none has no periods',
  (select start_date is null from pay_period_bounds('none', '2026-09-28', '2026-10-18')));
select pg_temp.check('semimonthly: the 15th ends the first half',
  (select (start_date, end_date) = ('2026-10-01'::date, '2026-10-15'::date) from pay_period_bounds('semimonthly', null, '2026-10-15')));
select pg_temp.check('semimonthly: the 16th starts the second half, to the 31st',
  (select (start_date, end_date) = ('2026-10-16'::date, '2026-10-31'::date) from pay_period_bounds('semimonthly', null, '2026-10-16')));
select pg_temp.check('semimonthly: February in a leap year ends on the 29th',
  (select (start_date, end_date) = ('2028-02-16'::date, '2028-02-29'::date) from pay_period_bounds('semimonthly', null, '2028-02-29')));
select pg_temp.check('semimonthly: February in a common year ends on the 28th',
  (select (start_date, end_date) = ('2027-02-16'::date, '2027-02-28'::date) from pay_period_bounds('semimonthly', null, '2027-02-20')));
select pg_temp.check('semimonthly: a 30-day month ends on the 30th',
  (select (start_date, end_date) = ('2026-11-16'::date, '2026-11-30'::date) from pay_period_bounds('semimonthly', null, '2026-11-30')));

-- ── Settings ────────────────────────────────────────────────────────────────
select pg_temp.refused('a frequency the app doesn''t know is refused', :ann,
  format($q$insert into app_settings (org_id, key, value) values (%L, 'pay_period_frequency', 'monthly')$q$, :'alder_id'), '22023');
select pg_temp.refused('an impossible anchor date is refused', :ann,
  format($q$insert into app_settings (org_id, key, value) values (%L, 'pay_period_anchor', '2026-02-30')$q$, :'alder_id'), '22023');
select pg_temp.refused('an anchor that isn''t a date is refused', :ann,
  format($q$insert into app_settings (org_id, key, value) values (%L, 'pay_period_anchor', 'next monday')$q$, :'alder_id'), '22023');
select pg_temp.run('no pay periods by default: approving is refused', :ann,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_wed'), true);
select pg_temp.run('a manager turns on weekly pay periods (any spacing or case)', :ann,
  format($q$insert into app_settings (org_id, key, value) values (%L, 'pay_period_frequency', ' Weekly ')$q$, :'alder_id'), false);
select pg_temp.check('the frequency is stored normalised',
  (select value = 'weekly' from app_settings where org_id = :'alder_id' and key = 'pay_period_frequency'));

-- ── Approve, sign, lock ─────────────────────────────────────────────────────
select pg_temp.punch(:e1, 'clock_in',  (:'last_wed' || ' 09:00 America/New_York')::timestamptz) as p1 \gset
select pg_temp.punch(:e1, 'clock_out', (:'last_wed' || ' 17:00 America/New_York')::timestamptz) as p2 \gset
select pg_temp.punch(:e2, 'clock_in',  (:'last_wed' || ' 10:00 America/New_York')::timestamptz) as p3 \gset

-- e2 hasn't clocked out yet: the period's hours aren't known.
select pg_temp.refused('a period with a shift still open cannot be approved, and says whose', :ann,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_wed'), '55000');
do $$ begin
  perform 1 from pay_periods where status <> 'open';
  if found then raise notice 'FAIL  the refused approval changed nothing'; else raise notice 'PASS  the refused approval changed nothing'; end if;
end $$;
select pg_temp.check('the open shift is named with its day',
  pay_period_open_shifts(:'alder_id', :'last_start', :'last_end') = 'e2 (from ' || :'last_wed' || ')');
select pg_temp.punch(:e2, 'clock_out', (:'last_wed' || ' 18:00 America/New_York')::timestamptz) as p4 \gset
select pg_temp.check('once clocked out, nobody is open in the period',
  pay_period_open_shifts(:'alder_id', :'last_start', :'last_end') is null);

select pg_temp.refused('an employee cannot approve a pay period', :e1,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_wed'), '42501');
select pg_temp.refused('another organization''s manager cannot approve it', :ben,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_wed'), '42501');
select pg_temp.refused('the current period cannot be approved before it ends', :ann,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', (now() at time zone 'America/New_York')::date), '22023');
select pg_temp.refused('a period cannot be locked before it is approved', :ann,
  format($q$select pay_period_lock(%L, %L)$q$, :'alder_id', :'last_wed'), '55000');
select pg_temp.run('the manager approves last week', :ann,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_wed'), false);
select pg_temp.check('the period is last week, approved, by the manager',
  exists (select 1 from pay_periods where org_id = :'alder_id' and start_date = :'last_start' and end_date = :'last_end'
            and status = 'approved' and approved_by = :ann and approved_at is not null and locked_at is null));
select pg_temp.run('approving again is a no-op', :ann,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_start'), false);
select pg_temp.check('one approve event', (select count(*) = 1 from pay_period_events where action = 'approve'));

select pg_temp.run('e1 signs off their hours', :e1,
  format($q$select pay_period_sign(%L, %L, 'signed')$q$, :'alder_id', :'last_wed'), false);
select pg_temp.refused('e2 cannot dispute without saying why', :e2,
  format($q$select pay_period_sign(%L, %L, 'disputed', '  ')$q$, :'alder_id', :'last_wed'), '22023');
select pg_temp.run('e2 disputes with a note', :e2,
  format($q$select pay_period_sign(%L, %L, 'disputed', 'Missing Thursday')$q$, :'alder_id', :'last_wed'), false);
select pg_temp.refused('nobody can sign another status', :e1,
  format($q$select pay_period_sign(%L, %L, 'approved')$q$, :'alder_id', :'last_wed'), '22023');
select pg_temp.refused('another organization''s manager cannot sign in this one', :ben,
  format($q$select pay_period_sign(%L, %L, 'signed')$q$, :'alder_id', :'last_wed'), '42501');
select pg_temp.refused('a period cannot be signed before its last day', :e1,
  format($q$select pay_period_sign(%L, %L, 'signed')$q$, :'alder_id',
         (now() at time zone 'America/New_York')::date + 7), '22023');
select pg_temp.check('each employee''s sign-off is their own, with a timestamp',
  exists (select 1 from pay_period_signoffs s join employees e on e.id = s.employee_id
           where e.user_id = :e1 and s.status = 'signed' and s.signed_by = :e1 and s.signed_at is not null)
  and exists (select 1 from pay_period_signoffs s join employees e on e.id = s.employee_id
               where e.user_id = :e2 and s.status = 'disputed' and s.note = 'Missing Thursday'));

-- Who sees what.
select pg_temp.check('the manager sees every sign-off', pg_temp.visible(:ann, 'pay_period_signoffs') = 2);
select pg_temp.check('an employee sees only their own sign-off',
  pg_temp.visible(:e1, 'pay_period_signoffs') = 1
  and pg_temp.visible(:e1, 'pay_period_signoffs', format('employee_id = (select id from employees where user_id = %L)', :e1)) = 1);
select pg_temp.check('employees see the org''s periods; another org sees none',
  pg_temp.visible(:e1, 'pay_periods') = 1 and pg_temp.visible(:ben, 'pay_periods') = 0
  and pg_temp.visible(:ben, 'pay_period_signoffs') = 0 and pg_temp.visible(:ben, 'pay_period_events') = 0);
select pg_temp.check('an employee sees their own events only',
  pg_temp.visible(:e1, 'pay_period_events') = 1 and pg_temp.visible(:ann, 'pay_period_events') = 3);

-- Nobody writes the tables directly.
select pg_temp.run('a manager cannot lock a period by writing the table', :ann,
  format($q$update pay_periods set status = 'locked', locked_at = now() where org_id = %L$q$, :'alder_id'), true);
select pg_temp.run('a manager cannot insert a period', :ann,
  format($q$insert into pay_periods (org_id, start_date, end_date) values (%L, '2020-01-01', '2020-01-07')$q$, :'alder_id'), true);
select pg_temp.run('a manager cannot delete a period', :ann, $q$delete from pay_periods$q$, true);
select pg_temp.run('an employee cannot write a sign-off directly', :e1,
  $q$update pay_period_signoffs set status = 'signed'$q$, true);
select pg_temp.run('an employee cannot add events', :e1,
  format($q$insert into pay_period_events (org_id, period_id, action) select %L, id, 'lock' from pay_periods$q$, :'alder_id'), true);
select pg_temp.run('the service role cannot delete a period directly', null, $q$delete from pay_periods$q$, true, 'service_role');

-- A punch change after approval clears the approval and that employee's
-- sign-off.
select pg_temp.run('the manager fixes e1''s clock-out after approving', :ann,
  format($q$update punch_records set punched_at = punched_at + interval '30 minutes', note = 'Stayed to close' where id = %s$q$, :p2), false);
select pg_temp.check('the period is open again',
  (select status = 'open' and approved_at is null from pay_periods where start_date = :'last_start'));
select pg_temp.check('e1''s sign-off is cleared; e2''s dispute stays',
  not exists (select 1 from pay_period_signoffs s join employees e on e.id = s.employee_id where e.user_id = :e1)
  and exists (select 1 from pay_period_signoffs s join employees e on e.id = s.employee_id where e.user_id = :e2));
select pg_temp.check('both are logged',
  exists (select 1 from pay_period_events where action = 'signoff_cleared' and actor = :ann and details->>'status' = 'signed')
  and exists (select 1 from pay_period_events where action = 'approval_cleared' and actor = :ann));

select pg_temp.run('e1 signs again, the manager approves and locks', :e1,
  format($q$select pay_period_sign(%L, %L, 'signed')$q$, :'alder_id', :'last_wed'), false);
select pg_temp.run('approve', :ann, format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_wed'), false);
select pg_temp.run('lock', :ann, format($q$select pay_period_lock(%L, %L)$q$, :'alder_id', :'last_wed'), false);
select pg_temp.check('the period is locked, by the manager',
  (select status = 'locked' and locked_by = :ann and approved_at is not null from pay_periods where start_date = :'last_start'));
select pg_temp.refused('a locked period cannot be approved again', :ann,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', :'last_wed'), '55000');

-- ── The lock ────────────────────────────────────────────────────────────────
-- Direct PostgREST-style writes, as each role.
select pg_temp.refused('locked: a manager cannot move a punch', :ann,
  format($q$update punch_records set punched_at = punched_at - interval '5 minutes', note = 'x' where id = %s$q$, :p1), 'PP001');
select pg_temp.refused('locked: a manager cannot change only a punch''s note', :ann,
  format($q$update punch_records set note = 'changed' where id = %s$q$, :p1), 'PP001');
select pg_temp.refused('locked: a manager cannot move a punch out of the period', :ann,
  format($q$update punch_records set punched_at = now() - interval '1 minute', note = 'x' where id = %s$q$, :p1), 'PP001');
select pg_temp.refused('locked: a manager cannot add a manual punch', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'break_start', %L::timestamptz, true, 'missed' from employees where user_id = %L$q$,
         :'last_wed' || ' 12:00 America/New_York', :e1), 'PP001');
select pg_temp.refused('locked: a manager cannot delete a punch', :ann,
  format($q$select delete_punch(%s, 'duplicate')$q$, :p3), 'PP001');
select pg_temp.refused('locked: a manager cannot move a punch into the period', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'clock_in', now() - interval '1 minute', true, 'x' from employees where user_id = %L
            returning id$q$, :e1) || '; ' ||
  format($q$update punch_records set punched_at = %L::timestamptz, note = 'y'
             where id = (select max(id) from punch_records)$q$, :'last_wed' || ' 11:00 America/New_York'), 'PP001');
select pg_temp.refused('locked: an employee cannot file a correction for that time', :e1,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note)
            select org_id, id, 'break_start', %L::timestamptz, 'forgot' from employees where user_id = %L$q$,
         :'last_wed' || ' 12:00 America/New_York', :e1), 'PP001');
select pg_temp.refused('locked: the service role cannot add a punch either', null,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual)
            select org_id, id, 'break_start', %L::timestamptz, true from employees where user_id = %L$q$,
         :'last_wed' || ' 12:00 America/New_York', :e1), 'PP001', 'service_role');
select pg_temp.refused('locked: the service role cannot delete a punch', null,
  format($q$delete from punch_records where id = %s$q$, :p3), 'PP001', 'service_role');
select pg_temp.check('the period''s punches are as they were',
  (select count(*) = 4 from punch_records where org_id = :'alder_id'));

-- A correction filed before the lock can't be approved after it.
alter table punch_corrections disable trigger punch_corrections_zz_pay_period_lock;
insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note)
select org_id, id, 'clock_out', (:'last_wed' || ' 18:00 America/New_York')::timestamptz, 'forgot'
  from employees where user_id = :e2;
alter table punch_corrections enable trigger punch_corrections_zz_pay_period_lock;
select pg_temp.refused('locked: a manager cannot approve a correction for that time', :ann,
  $q$update punch_corrections set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()$q$, 'PP001');
select pg_temp.run('locked: a manager can still deny it', :ann,
  $q$update punch_corrections set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now()$q$, false);

-- What still works while it's locked.
select pg_temp.run('locked: e1 clocks in today', :e1,
  $q$insert into punch_records (org_id, employee_id, punch_type)
     select org_id, id, 'clock_in' from employees where user_id = 'eeeeeeee-0000-0000-0000-000000000001'$q$, false);
select pg_temp.run('locked: a manager adds a missed punch in the current period', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'clock_in', now() - interval '2 minutes', true, 'forgot' from employees where user_id = %L$q$, :e2), false);
select pg_temp.run('locked: e2 files a correction for today', :e2,
  $q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note)
     select org_id, id, 'break_start', now() - interval '1 minute', 'forgot' from employees where user_id = 'eeeeeeee-0000-0000-0000-000000000002'$q$, false);
insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
select org_id, id, :'last_wed'::date, 540, 1020 from employees where user_id = :e1;
alter table punch_records disable trigger punch_records_zz_pay_period_lock;
update punch_records set schedule_id = (select max(id) from schedules) where id = :p1;
alter table punch_records enable trigger punch_records_zz_pay_period_lock;
select pg_temp.run('locked: deleting a shift still unlinks its punch (no hours move)', :ann,
  $q$delete from schedules where id = (select max(id) from schedules)$q$, false);
select pg_temp.check('the punch is unlinked and otherwise unchanged',
  (select schedule_id is null and note = 'seed' from punch_records where id = :p1));
select pg_temp.run('locked: an employee can still dispute a locked period', :e2,
  format($q$select pay_period_sign(%L, %L, 'disputed', 'Still missing Thursday')$q$, :'alder_id', :'last_wed'), false);

-- ── Reopen ──────────────────────────────────────────────────────────────────
select pg_temp.refused('reopening needs a reason', :ann,
  format($q$select pay_period_reopen(%L, %L, '   ')$q$, :'alder_id', :'last_wed'), '22023');
select pg_temp.refused('an employee cannot reopen', :e1,
  format($q$select pay_period_reopen(%L, %L, 'please')$q$, :'alder_id', :'last_wed'), '42501');
select pg_temp.refused('another organization''s manager cannot reopen', :ben,
  format($q$select pay_period_reopen(%L, %L, 'please')$q$, :'alder_id', :'last_wed'), '42501');
select pg_temp.refused('an open period cannot be reopened', :ann,
  format($q$select pay_period_reopen(%L, %L, 'why')$q$, :'alder_id', '2020-01-01'), '55000');
select pg_temp.run('the manager reopens it with a reason', :ann,
  format($q$select pay_period_reopen(%L, %L, 'Missed break on Wednesday')$q$, :'alder_id', :'last_wed'), false);
select pg_temp.check('the period is open, and the reopen is logged with who, why and what it was',
  (select status = 'open' and approved_at is null and locked_at is null from pay_periods where start_date = :'last_start')
  and exists (select 1 from pay_period_events where action = 'reopen' and actor = :ann
               and reason = 'Missed break on Wednesday' and details->>'previous_status' = 'locked'
               and (details->>'locked_by')::uuid = :ann));
select pg_temp.run('reopened: the manager adds the missed punch', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'break_start', %L::timestamptz, true, 'Missed break on Wednesday' from employees where user_id = %L$q$,
         :'last_wed' || ' 13:00 America/New_York', :e2), false);
select pg_temp.check('the fix is in the punch history (0053), and e2''s dispute is cleared',
  exists (select 1 from punch_record_history where action = 'insert' and changed_by = :ann and reason = 'Missed break on Wednesday')
  and not exists (select 1 from pay_period_signoffs s join employees e on e.id = s.employee_id where e.user_id = :e2));
select pg_temp.run('approve and lock again', :ann,
  format($q$select pay_period_approve(%1$L, %2$L); select pay_period_lock(%1$L, %2$L)$q$, :'alder_id', :'last_wed'), false);

-- ── Overlap and DST ─────────────────────────────────────────────────────────
select pg_temp.run('the manager switches to biweekly periods starting this week', :ann,
  format($q$insert into app_settings (org_id, key, value) values (%1$L, 'pay_period_anchor', %2$L);
            update app_settings set value = 'biweekly' where org_id = %1$L and key = 'pay_period_frequency'$q$,
         :'alder_id', (:'last_start'::date + 7)::text), false);
select pg_temp.refused('a new period overlapping a recorded one is refused', :ann,
  format($q$select pay_period_approve(%L, %L)$q$, :'alder_id', (:'last_start'::date - 1)::text), '23P01');
select pg_temp.check('the recorded period keeps its dates under the new setting',
  (select count(*) = 1 from pay_periods where org_id = :'alder_id' and start_date = :'last_start' and end_date = :'last_end'));

-- The week of the 2025 fall-back (Sun 2 Nov, 25 hours long) in New York.
update app_settings set value = 'weekly' where org_id = :'alder_id' and key = 'pay_period_frequency';
delete from app_settings where org_id = :'alder_id' and key = 'pay_period_anchor';
select pg_temp.punch(:e1, 'clock_in', '2025-11-02 23:30 America/New_York') as dst_in \gset
select pg_temp.punch(:e1, 'clock_in', '2025-11-03 00:30 America/New_York') as dst_after \gset
select pg_temp.punch(:e1, 'clock_in', '2025-10-27 00:15 America/New_York') as dst_first \gset
select pg_temp.run('approve and lock the fall-back week', :ann,
  format($q$select pay_period_approve(%1$L, '2025-11-02'); select pay_period_lock(%1$L, '2025-11-02')$q$, :'alder_id'), false);
select pg_temp.check('the fall-back week is Monday 27 October to Sunday 2 November',
  exists (select 1 from pay_periods where start_date = '2025-10-27' and end_date = '2025-11-02' and status = 'locked'));
select pg_temp.refused('DST: 11:30 PM on the last (25-hour) day is in the locked week', :ann,
  format($q$update punch_records set note = 'x' where id = %s$q$, :dst_in), 'PP001');
select pg_temp.refused('DST: 12:15 AM on the first day is in the locked week', :ann,
  format($q$update punch_records set note = 'x' where id = %s$q$, :dst_first), 'PP001');
select pg_temp.run('DST: 12:30 AM the next Monday is not', :ann,
  format($q$update punch_records set note = 'x' where id = %s$q$, :dst_after), false);
-- 2026-03-08 springs forward; a punch at 11:30 PM that Sunday is 03:30 UTC Monday.
select pg_temp.punch(:e1, 'clock_in', '2026-03-08 23:30 America/New_York') as spring_in \gset
select pg_temp.run('approve and lock the spring-forward week', :ann,
  format($q$select pay_period_approve(%1$L, '2026-03-08'); select pay_period_lock(%1$L, '2026-03-08')$q$, :'alder_id'), false);
select pg_temp.refused('DST: 11:30 PM on the spring-forward Sunday is in its week, by store time', :ann,
  format($q$delete from punch_records where id = %s$q$, :spring_in), 'PP001', 'service_role');
select pg_temp.check('in UTC the same punch is already Monday (store time decides, not UTC)',
  (select (punched_at at time zone 'UTC')::date = '2026-03-09' from punch_records where id = :spring_in));

-- ── An overnight shift across the period boundary ───────────────────────────
-- Week Mon 10 to Sun 16 November 2025. Ann (who has no later punches)
-- clocks in Sunday 10:00 PM and is still on the clock at midnight.
select pg_temp.punch(:ann, 'clock_in', '2025-11-16 22:00 America/New_York') as night_in \gset
select pg_temp.refused('overnight: the week cannot be approved while Sunday night''s shift is open', :ann,
  format($q$select pay_period_approve(%L, '2025-11-16')$q$, :'alder_id'), '55000');
select pg_temp.punch(:ann, 'clock_out', '2025-11-17 06:00 America/New_York') as night_out \gset
select pg_temp.run('overnight: once clocked out Monday 6:00 AM, the week can be approved', :ann,
  format($q$select pay_period_approve(%L, '2025-11-16')$q$, :'alder_id'), false);
-- A forgotten clock-in shows up between approving and locking (set up as the
-- table owner, so the approval stays).
insert into employees (org_id, name, email) values (:alder, 'e3', 'e3@alder.test');
insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual)
select org_id, id, 'clock_in', '2025-11-14 09:00 America/New_York', true from employees where email = 'e3@alder.test';
update pay_periods set status = 'approved', approved_at = now() where start_date = '2025-11-10';
select pg_temp.refused('a period cannot be locked while a shift begun in it is open', :ann,
  format($q$select pay_period_lock(%L, '2025-11-16')$q$, :'alder_id'), '55000');
select pg_temp.check('the lock refusal changed nothing',
  (select status = 'approved' from pay_periods where start_date = '2025-11-10'));
select pg_temp.check('the lock refusal names the open shift',
  pay_period_open_shifts(:'alder_id', '2025-11-10', '2025-11-16') = 'e3 (from 2025-11-14)');
select pg_temp.run('the manager adds e3''s missing clock-out', :ann,
  $q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
     select org_id, id, 'clock_out', '2025-11-14 17:00 America/New_York', true, 'Forgot' from employees where email = 'e3@alder.test'$q$, false);
select pg_temp.run('approve and lock the week', :ann,
  format($q$select pay_period_approve(%1$L, '2025-11-16'); select pay_period_lock(%1$L, '2025-11-16')$q$, :'alder_id'), false);

select pg_temp.refused('overnight: Monday''s 6:00 AM clock-out of the locked week''s shift cannot move', :ann,
  format($q$update punch_records set punched_at = punched_at + interval '1 hour', note = 'x' where id = %s$q$, :night_out), 'PP001');
select pg_temp.refused('overnight: nor be deleted', :ann,
  format($q$select delete_punch(%s, 'wrong')$q$, :night_out), 'PP001');
select pg_temp.refused('overnight: nor can a break be added to that shift on Monday', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'break_start', '2025-11-17 02:00 America/New_York', true, 'x' from employees where user_id = %L$q$, :ann), 'PP001');
select pg_temp.refused('overnight: the service role is held too', null,
  format($q$update punch_records set punched_at = punched_at - interval '1 hour' where id = %s$q$, :night_out), 'PP001', 'service_role');
alter table punch_corrections disable trigger punch_corrections_stamp;
select pg_temp.refused('overnight: a correction for that shift on Monday cannot be filed', :ann,
  format($q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note)
            select org_id, id, 'break_start', '2025-11-17 02:00 America/New_York', 'forgot' from employees where user_id = %L$q$, :ann), 'PP001');
alter table punch_corrections enable trigger punch_corrections_stamp;
select pg_temp.run('overnight: a new shift on Monday is not part of it', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'clock_in', '2025-11-17 09:00 America/New_York', true, 'x' from employees where user_id = %1$L;
            insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'clock_out', '2025-11-17 17:00 America/New_York', true, 'x' from employees where user_id = %1$L$q$, :ann), false);
select pg_temp.run('overnight: a stray clock-out after the shift was closed is not part of it', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'clock_out', '2025-11-17 07:00 America/New_York', true, 'x' from employees where user_id = %L$q$, :ann), false);
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  update punch_records set note = 'x' where punched_at = '2025-11-17 06:00 America/New_York';
  raise notice 'FAIL  overnight: the refusal says the shift began in a locked period (no error)';
exception when others then
  if sqlerrm like 'That punch belongs to a shift that began in a locked pay period (2025-11-10 to 2025-11-16)%' then
    raise notice 'PASS  overnight: the refusal says the shift began in a locked period';
  else raise notice 'FAIL  overnight: the refusal says the shift began in a locked period (%)', sqlerrm; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.check('the locked week''s overnight shift is as it was',
  (select punched_at = '2025-11-17 06:00 America/New_York' from punch_records where id = :night_out));

-- ── Semimonthly, and frequency none ─────────────────────────────────────────
update app_settings set value = 'semimonthly' where org_id = :'alder_id' and key = 'pay_period_frequency';
select pg_temp.run('approve the second half of February 2024 (a leap year)', :ann,
  format($q$select pay_period_approve(%L, '2024-02-20')$q$, :'alder_id'), false);
select pg_temp.check('it runs 16 to 29 February',
  exists (select 1 from pay_periods where start_date = '2024-02-16' and end_date = '2024-02-29' and status = 'approved'));
update app_settings set value = 'none' where org_id = :'alder_id' and key = 'pay_period_frequency';
select pg_temp.refused('frequency none: no new periods', :ann,
  format($q$select pay_period_approve(%L, '2024-03-20')$q$, :'alder_id'), '22023');
select pg_temp.refused('frequency none: a period locked earlier still holds', :ann,
  format($q$update punch_records set note = 'x' where id = %s$q$, :dst_in), 'PP001');

-- ── Archived employees, the demo reset and org deletion ─────────────────────
update employees set archived_at = now() where user_id = :e2;
select pg_temp.refused('an archived employee cannot sign off', :e2,
  format($q$select pay_period_sign(%L, '2025-11-02', 'signed')$q$, :'alder_id'), '42501');

insert into employees (org_id, name, email) values ('00000000-0000-0000-0000-000000000002', 'demo', 'demo@demo.test');
insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual)
select org_id, id, 'clock_in', '2025-11-01 09:00 America/New_York', true from employees where email = 'demo@demo.test';
insert into pay_periods (org_id, start_date, end_date, status, approved_at, locked_at)
values ('00000000-0000-0000-0000-000000000002', '2025-10-27', '2025-11-02', 'locked', now(), now());
select pg_temp.run('the service role''s demo reset clears punches in a locked period', null,
  $q$select reset_demo_org('00000000-0000-0000-0000-000000000002')$q$, false, 'service_role');
select pg_temp.run('and the demo''s pay periods', null,
  $q$select pay_periods_reset_demo('00000000-0000-0000-0000-000000000002')$q$, false, 'service_role');
select pg_temp.check('the demo has no punches or periods left',
  not exists (select 1 from punch_records where org_id = '00000000-0000-0000-0000-000000000002')
  and not exists (select 1 from pay_periods where org_id = '00000000-0000-0000-0000-000000000002'));
select pg_temp.run('a signed-in user cannot call the demo reset', :ann,
  $q$select pay_periods_reset_demo('00000000-0000-0000-0000-000000000002')$q$, true);
select pg_temp.run('the demo reset refuses a real organization', null,
  format($q$select pay_periods_reset_demo(%L)$q$, :'alder_id'), true, 'service_role');

select pg_temp.run('deleting an organization with locked periods works', null,
  format($q$select org_delete(%L)$q$, :'alder_id'), false, 'service_role');
select pg_temp.check('its punches, periods, sign-offs and events are gone',
  not exists (select 1 from punch_records where org_id = :'alder_id')
  and not exists (select 1 from pay_periods where org_id = :'alder_id')
  and not exists (select 1 from pay_period_signoffs where org_id = :'alder_id')
  and not exists (select 1 from pay_period_events where org_id = :'alder_id'));

rollback;
