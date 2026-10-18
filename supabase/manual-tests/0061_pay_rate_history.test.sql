-- Tests for 0061_pay_rate_history.sql. Run against a throwaway Postgres
-- database (15 or later):
--
--   createdb pay_rate_test
--   cd supabase/manual-tests && psql -q -d pay_rate_test -f 0061_pay_rate_history.test.sql
--   dropdb pay_rate_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows the
-- gap on the schema before 0061 (a raise overwrites the only rate, so past
-- labor cost is restated); part 2 applies it (twice) and checks it; part 3 is
-- what still works. Statements run as a signed-in user, the way the API
-- makes them.

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
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- Runs one statement as `uid`; returns 'ok' or 'err:<sqlstate>'.
create or replace function pg_temp.run(uid text, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  execute stmt;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return 'ok';
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return 'err:' || sqlstate;
end $$;

-- A single value `uid` reads with `query`, as text ('err:<sqlstate>' on error).
create or replace function pg_temp.see(uid text, query text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  execute query into v;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return 'err:' || sqlstate;
end $$;

create or replace function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is not distinct from want then raise notice 'PASS  %', label;
  else raise notice 'FAIL  % (got %, want %)', label, coalesce(got, 'null'), coalesce(want, 'null'); end if;
end $$;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now()), (:ben, 'ben@birch.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben', 'ben@birch.test');
\set alder '(select id from organizations where slug = ''alder'')'
\set birch '(select id from organizations where slug = ''birch'')'
-- A store far from UTC, so "today" is the store's day, not the server's.
insert into app_settings (org_id, key, value) values (:alder, 'timezone', 'Pacific/Kiritimati')
  on conflict (org_id, key) do update set value = excluded.value;
insert into employees (org_id, name, email, user_id, pay_rate) values
  (:alder, 'e1', 'e1@alder.test', :e1::uuid, 15.00),
  (:alder, 'e2', null, null, 18.00),
  (:alder, 'e3', null, null, null);
select id as e1_id from employees where name = 'e1' \gset
select id as e2_id from employees where name = 'e2' \gset
select id as e3_id from employees where name = 'e3' \gset
insert into positions (org_id, name) values (:alder, 'Shift lead'), (:birch, 'Birch cook');
select id as lead_id from positions where name = 'Shift lead' \gset
select id as birch_pos from positions where name = 'Birch cook' \gset
select ((now() at time zone 'Pacific/Kiritimati')::date)::text as today \gset

-- ---------------------------------------------------------------------------
-- Part 1: before 0061.
-- ---------------------------------------------------------------------------
select pg_temp.expect('before 0061: a manager gives e2 a raise',
  pg_temp.run(:ann, 'update employees set pay_rate = 20 where id = ' || :e2_id), 'ok');
select pg_temp.check('before 0061: the old rate is gone, so last month''s cost is restated at the new one',
  to_regclass('public.employee_pay_rates') is null
  and (select pay_rate from employees where id = :e2_id) = 20);
select pg_temp.check('before 0061: there is no payroll ID to export',
  not exists (select 1 from information_schema.columns
               where table_name = 'employees' and column_name = 'payroll_id'));
update employees set pay_rate = 18 where id = :e2_id;

-- ---------------------------------------------------------------------------
-- Part 2: 0061, applied twice.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\ir ../migrations/0061_pay_rate_history.sql
\ir ../migrations/0061_pay_rate_history.sql
\unset ON_ERROR_STOP

select pg_temp.check('each existing rate is backfilled once, effective from the beginning',
  (select count(*) from employee_pay_rates) = 2
  and exists (select 1 from employee_pay_rates where employee_id = :e1_id and position_id is null
                and effective_from = '1900-01-01' and hourly_rate = 15)
  and exists (select 1 from employee_pay_rates where employee_id = :e2_id and position_id is null
                and effective_from = '1900-01-01' and hourly_rate = 18));
select pg_temp.check('an employee with no rate gets no row',
  not exists (select 1 from employee_pay_rates where employee_id = :e3_id));
select pg_temp.check('no past figure changes: every day in the past has the old rate',
  pay_rate_on(:e1_id, date '2020-01-01') = 15 and pay_rate_on(:e1_id, :'today'::date) = 15);

-- A raise through the old path (employees.pay_rate) adds a row from today.
select pg_temp.expect('a manager gives e2 a raise through employees.pay_rate',
  pg_temp.run(:ann, 'update employees set pay_rate = 20 where id = ' || :e2_id), 'ok');
select pg_temp.check('the raise is a new row from the store''s today; the old rate stays for the past',
  exists (select 1 from employee_pay_rates where employee_id = :e2_id and position_id is null
            and effective_from = :'today'::date and hourly_rate = 20 and created_by = :ann)
  and pay_rate_on(:e2_id, :'today'::date - 1) = 18
  and pay_rate_on(:e2_id, :'today'::date) = 20);
select pg_temp.expect('a manager writes the same rate again',
  pg_temp.run(:ann, 'update employees set pay_rate = 20 where id = ' || :e2_id), 'ok');
select pg_temp.expect('writing the same rate again adds nothing',
  (select count(*) from employee_pay_rates where employee_id = :e2_id)::text, '2');
-- (Each change is checked in a statement of its own: a statement sees the
-- data as it was when it started.)
select pg_temp.expect('a second change the same day',
  pg_temp.run(:ann, 'update employees set pay_rate = 21 where id = ' || :e2_id), 'ok');
select pg_temp.expect('replaces today''s row',
  (select count(*) from employee_pay_rates where employee_id = :e2_id)
  || ':' || pay_rate_on(:e2_id, :'today'::date), '2:21.00');
select pg_temp.expect('a manager sets e3''s first rate ever',
  pg_temp.run(:ann, 'update employees set pay_rate = 16 where id = ' || :e3_id), 'ok');
select pg_temp.expect('an employee''s first rate ever applies from the beginning',
  (select effective_from::text from employee_pay_rates where employee_id = :e3_id), '1900-01-01');

-- Changes in the history directly.
select pg_temp.expect('a manager schedules a raise for next week',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, 17)',
    (select id from organizations where slug = 'alder'), :e1_id, (:'today'::date + 7)::text)), 'ok');
select pg_temp.check('the rate in effect changes on its date, not before',
  pay_rate_on(:e1_id, :'today'::date + 6) = 15 and pay_rate_on(:e1_id, :'today'::date + 7) = 17
  and (select pay_rate from employees where id = :e1_id) = 15);
select pg_temp.expect('a manager back-dates a correction to last week',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, 15.50)',
    (select id from organizations where slug = 'alder'), :e1_id, (:'today'::date - 7)::text)), 'ok');
select pg_temp.check('the correction applies from its date and is copied to employees.pay_rate',
  pay_rate_on(:e1_id, :'today'::date - 8) = 15 and pay_rate_on(:e1_id, :'today'::date - 7) = 15.50
  and (select pay_rate from employees where id = :e1_id) = 15.50);
select pg_temp.check('the copy-back added no row of its own',
  (select count(*) from employee_pay_rates where employee_id = :e1_id) = 3);
select pg_temp.expect('a manager deletes the correction',
  pg_temp.run(:ann, format('delete from employee_pay_rates where employee_id = %s and effective_from = %L',
    :e1_id, (:'today'::date - 7)::text)), 'ok');
select pg_temp.check('employees.pay_rate goes back to the rate in effect today',
  (select pay_rate from employees where id = :e1_id) = 15);
select pg_temp.expect('employee_pay_rates(org) reads today''s rate from the history',
  pg_temp.see(:ann, format('select pay_rate::text from employee_pay_rates(%L) where employee_id = %s',
    (select id from organizations where slug = 'alder'), :e1_id)), '15.00');
select pg_temp.expect('two base rows on one day are refused',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, 99)',
    (select id from organizations where slug = 'alder'), :e1_id, (:'today'::date + 7)::text)), 'err:23505');

-- Position rates.
select pg_temp.expect('a manager adds a shift-lead rate for e1 from last month',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, position_id, effective_from, hourly_rate) values (%L, %s, %s, %L, 19)',
    (select id from organizations where slug = 'alder'), :e1_id, :lead_id, (:'today'::date - 30)::text)), 'ok');
select pg_temp.check('the position rate overrides the base rate in that position only, from its date',
  pay_rate_on(:e1_id, :'today'::date, :lead_id) = 19
  and pay_rate_on(:e1_id, :'today'::date) = 15
  and pay_rate_on(:e1_id, :'today'::date - 31, :lead_id) = 15
  and pay_rate_on(:e1_id, :'today'::date + 7, :lead_id) = 19);
select pg_temp.check('a position rate leaves employees.pay_rate alone',
  (select pay_rate from employees where id = :e1_id) = 15);
select pg_temp.check('a position with no rate of its own uses the base rate',
  pay_rate_on(:e2_id, :'today'::date, :lead_id) = 21);
select pg_temp.expect('a position rate needs a rate',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, position_id, effective_from, hourly_rate) values (%L, %s, %s, %L, null)',
    (select id from organizations where slug = 'alder'), :e2_id, :lead_id, :'today')), 'err:23514');
select pg_temp.expect('another store''s position can''t be used',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, position_id, effective_from, hourly_rate) values (%L, %s, %s, %L, 30)',
    (select id from organizations where slug = 'alder'), :e1_id, :birch_pos, :'today')), 'err:23503');
select pg_temp.expect('a negative rate is refused',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, -1)',
    (select id from organizations where slug = 'alder'), :e2_id, '2030-01-01')), 'err:23514');
select pg_temp.expect('a manager ends e2''s rate in 2030 (null rate)',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, null)',
     (select id from organizations where slug = 'alder'), :e2_id, '2030-01-01')), 'ok');
select pg_temp.check('a null base rate means no rate from that date',
  pay_rate_on(:e2_id, date '2030-01-02') is null
  and pay_rate_on(:e2_id, date '2029-12-31') = 21);

-- Managers only.
select pg_temp.expect('an employee reads no pay rates, not even their own',
  pg_temp.see(:e1, 'select count(*) from employee_pay_rates'), '0');
select pg_temp.expect('an employee can''t add a rate for themselves',
  pg_temp.run(:e1, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, 50)',
    (select id from organizations where slug = 'alder'), :e1_id, :'today')), 'err:42501');
select pg_temp.expect('an employee can''t change a rate',
  pg_temp.see(:e1, 'with u as (update employee_pay_rates set hourly_rate = 50 returning 1) select count(*) from u'), '0');
select pg_temp.expect('an employee can''t delete a rate',
  pg_temp.see(:e1, 'with d as (delete from employee_pay_rates returning 1) select count(*) from d'), '0');
select pg_temp.expect('an employee can''t raise their own employees.pay_rate',
  pg_temp.see(:e1, format('with u as (update employees set pay_rate = 50 where id = %s returning 1) select count(*) from u', :e1_id)), '0');
select pg_temp.check('nothing an employee tried changed a rate',
  pay_rate_on(:e1_id, :'today'::date) = 15 and (select count(*) from employee_pay_rates where hourly_rate = 50) = 0);
select pg_temp.expect('an employee still can''t select employees.pay_rate',
  pg_temp.see(:e1, 'select pay_rate::text from employees limit 1'), 'err:42501');
select pg_temp.expect('an employee can''t select employees.payroll_id',
  pg_temp.see(:e1, 'select payroll_id from employees limit 1'), 'err:42501');
select pg_temp.expect('employee_pay_rates(org) gives an employee nothing',
  pg_temp.see(:e1, format('select count(*) from employee_pay_rates(%L)', (select id from organizations where slug = 'alder'))), '0');
select pg_temp.expect('pay_rate_on is not callable through the API',
  pg_temp.see(:e1, format('select pay_rate_on(%s, current_date)', :e1_id)), 'err:42501');
select pg_temp.expect('anon reads nothing',
  (select case when (select pg_temp.see(null, 'select count(*) from employee_pay_rates')) like 'err:%'
               or (select pg_temp.see(null, 'select count(*) from employee_pay_rates')) = '0' then 'ok' else 'leak' end), 'ok');
select pg_temp.expect('another store''s manager reads none of Alder''s rates',
  pg_temp.see(:ben, 'select count(*) from employee_pay_rates'), '0');
select pg_temp.expect('another store''s manager can''t add one',
  pg_temp.run(:ben, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, 1)',
    (select id from organizations where slug = 'alder'), :e1_id, :'today')), 'err:42501');
select pg_temp.expect('nor move one of their own employees'' rows into Alder',
  pg_temp.run(:ben, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate) values (%L, %s, %L, 1)',
    (select id from organizations where slug = 'birch'), :e1_id, :'today')), 'err:23503');
select pg_temp.expect('Alder''s manager reads Alder''s rates',
  pg_temp.see(:ann, 'select (count(*) > 0)::text from employee_pay_rates'), 'true');
select pg_temp.expect('created_by is the caller, whatever the client sent',
  pg_temp.run(:ann, format('insert into employee_pay_rates (org_id, employee_id, effective_from, hourly_rate, created_by) values (%L, %s, %L, 22, %L)',
    (select id from organizations where slug = 'alder'), :e3_id, '2031-01-01', 'bbbbbbbb-0000-0000-0000-000000000001')), 'ok');
select pg_temp.expect('(created_by)',
  (select created_by::text from employee_pay_rates where employee_id = :e3_id and effective_from = '2031-01-01'),
  'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect('an update can''t move a row to another employee',
  pg_temp.run(:ann, format('update employee_pay_rates set employee_id = %s where employee_id = %s and effective_from = %L',
    :e2_id, :e3_id, '2031-01-01')), 'ok');
select pg_temp.expect('(still e3''s row)',
  (select employee_id::text from employee_pay_rates where effective_from = '2031-01-01' and hourly_rate = 22),
  :e3_id::text);

-- Payroll IDs.
select pg_temp.expect('a manager sets e1''s payroll ID',
  pg_temp.run(:ann, format('update employees set payroll_id = %L where id = %s', 'ADP-000123', :e1_id)), 'ok');
select pg_temp.expect('the manager reads it through employee_payroll_ids(org)',
  pg_temp.see(:ann, format('select payroll_id from employee_payroll_ids(%L) where employee_id = %s',
    (select id from organizations where slug = 'alder'), :e1_id)), 'ADP-000123');
select pg_temp.expect('employee_payroll_ids(org) gives an employee nothing',
  pg_temp.see(:e1, format('select count(*) from employee_payroll_ids(%L)', (select id from organizations where slug = 'alder'))), '0');
select pg_temp.expect('another store''s manager gets nothing from it',
  pg_temp.see(:ben, format('select count(*) from employee_payroll_ids(%L)', (select id from organizations where slug = 'alder'))), '0');
select pg_temp.expect('an employee can''t set their own payroll ID',
  pg_temp.see(:e1, format('with u as (update employees set payroll_id = %L where id = %s returning 1) select count(*) from u', 'X', :e1_id)), '0');
select pg_temp.expect('a payroll ID with a tab is refused (it would split an export record)',
  pg_temp.run(:ann, format('update employees set payroll_id = %L where id = %s', E'a\tb', :e1_id)), 'err:23514');

-- ---------------------------------------------------------------------------
-- Part 3: what still works.
-- ---------------------------------------------------------------------------
select pg_temp.expect('a manager adds an employee with a rate (the service role does too)',
  pg_temp.run(:ann, format('insert into employees (org_id, name, pay_rate) values (%L, %L, 12.5)',
    (select id from organizations where slug = 'alder'), 'e4')), 'ok');
select pg_temp.check('the new employee''s rate is in the history from the beginning',
  exists (select 1 from employee_pay_rates r join employees e on e.id = r.employee_id
           where e.name = 'e4' and r.effective_from = '1900-01-01' and r.hourly_rate = 12.5));
select pg_temp.expect('a manager clears a rate (null)',
  pg_temp.run(:ann, 'update employees set pay_rate = null where name = ''e4'''), 'ok');
select pg_temp.check('clearing adds a "no rate" row from today; the past keeps its rate',
  (select pay_rate_on(id, :'today'::date) is null and pay_rate_on(id, :'today'::date - 1) = 12.5
     from employees where name = 'e4'));
select pg_temp.expect('removing an employee with no time records still deletes them (rates go too)',
  pg_temp.see(:ann, format('select employee_remove(%L, id) from employees where name = %L',
    (select id from organizations where slug = 'alder'), 'e4')), 'deleted');
select pg_temp.check('their rate rows went with them',
  not exists (select 1 from employee_pay_rates r where not exists (select 1 from employees e where e.id = r.employee_id)));
select pg_temp.expect('a manager deletes a position',
  pg_temp.run(:ann, format('delete from positions where id = %s', :lead_id)), 'ok');
select pg_temp.expect('deleting a position removes its rates, not the base rate',
  (select count(*) from employee_pay_rates where position_id is not null)
  || ':' || pay_rate_on(:e1_id, :'today'::date), '0:15.00');
select pg_temp.expect('a manager still edits an employee''s name',
  pg_temp.run(:ann, format('update employees set name = %L where id = %s', 'e1 renamed', :e1_id)), 'ok');
select pg_temp.check('a name edit adds no rate row',
  (select count(*) from employee_pay_rates where employee_id = :e1_id) = 2);
select pg_temp.expect('an employee still reads the roster',
  pg_temp.see(:e1, 'select (count(*) >= 3)::text from employees'), 'true');
select pg_temp.expect('an employee still clocks in',
  pg_temp.run(:e1, format('insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, ''clock_in'')',
    (select id from organizations where slug = 'alder'), :e1_id)), 'ok');
