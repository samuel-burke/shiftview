-- Tests for 0064_pto.sql. Run against a throwaway Postgres database:
--
--   createdb pto_test
--   cd supabase/manual-tests && psql -q -d pto_test -f 0064_pto.test.sql
--   dropdb pto_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows the
-- gap before 0064 (a time-off day has no type, no hours and no balance);
-- part 2 applies it (twice) and checks it, including two approvals racing
-- for the same balance on two connections (dblink).

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
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''
\set e2   '''eeeeeeee-0000-0000-0000-000000000002'''

-- Runs one statement as `uid` and keeps its effects. Returns 'ok' or
-- 'err:<sqlstate>'.
create or replace function pg_temp.run(uid text, stmt text)
returns text language plpgsql as $$
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

-- What `uid` gets back: the first column of the first row of `query`, or
-- 'err:<sqlstate>'.
create or replace function pg_temp.see(uid text, query text)
returns text language plpgsql as $$
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
  else raise notice 'FAIL  % (got %, want %)', label, got, want; end if;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:ben, 'ben@birch.test', now()),
  (:e1, 'e1@alder.test', now()), (:e2, 'e2@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann Owner', 'ann@alder.test') is not null as alder;
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben Owner', 'ben@birch.test') is not null as birch;

create temp table fx (k text primary key, v text);
grant select on fx to public;

do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  b uuid := (select id from organizations where slug = 'birch');
  emp bigint;
begin
  insert into fx values ('alder', a), ('birch', b);
  insert into app_settings (org_id, key, value) values (a, 'timezone', 'UTC')
    on conflict (org_id, key) do update set value = excluded.value;
  insert into employees (org_id, name, email, user_id)
    values (a, 'e1', 'e1@alder.test', 'eeeeeeee-0000-0000-0000-000000000001') returning id into emp;
  insert into fx values ('e1', emp);
  insert into employees (org_id, name, email, user_id)
    values (a, 'e2', 'e2@alder.test', 'eeeeeeee-0000-0000-0000-000000000002') returning id into emp;
  insert into fx values ('e2', emp);
  insert into employees (org_id, name, email) values (b, 'b1', 'b1@birch.test') returning id into emp;
  insert into fx values ('b1', emp);
end $$;

\set alder  '(select v::uuid from fx where k = ''alder'')'
\set birch  '(select v::uuid from fx where k = ''birch'')'
\set e1_id  '(select v::bigint from fx where k = ''e1'')'
\set e2_id  '(select v::bigint from fx where k = ''e2'')'
\set b1_id  '(select v::bigint from fx where k = ''b1'')'

-- ---------------------------------------------------------------------------
-- Part 1: before 0064.

insert into time_off_requests (org_id, employee_id, date, status)
values (:alder, :e1_id, current_date + 20, 'approved'),
       (:alder, :e1_id, current_date + 21, 'pending');

select pg_temp.check('before 0064: a request has no type or paid hours',
  not exists (select 1 from information_schema.columns
               where table_name = 'time_off_requests' and column_name in ('leave_type', 'paid_hours')));
select pg_temp.check('before 0064: approving leaves no balance record anywhere',
  to_regclass('public.pto_ledger') is null and to_regclass('public.pto_balances') is null);
select pg_temp.expect('before 0064: a request cannot be cancelled',
  pg_temp.run(:e1, format($q$update time_off_requests set status = 'cancelled' where date = %L$q$, current_date + 21)),
  'ok');
select pg_temp.check('before 0064: (the employee''s update simply matches nothing)',
  (select status from time_off_requests where date = current_date + 21) = 'pending');

-- ---------------------------------------------------------------------------
-- Part 2: 0064, applied twice.

\set ON_ERROR_STOP on
\ir ../migrations/0064_pto.sql
\ir ../migrations/0064_pto.sql
\unset ON_ERROR_STOP

select pg_temp.check('existing requests stay unpaid with no hours',
  (select bool_and(leave_type = 'unpaid' and paid_hours is null) from time_off_requests)
  and (select count(*) from time_off_requests) = 2);
select pg_temp.check('the migration writes no ledger rows',
  not exists (select 1 from pto_ledger) and not exists (select 1 from pto_balances));
select pg_temp.check('existing statuses are kept',
  (select string_agg(status, ',' order by date) from time_off_requests) = 'approved,pending');
delete from time_off_requests;

-- Requests -------------------------------------------------------------------

select pg_temp.expect('an employee requests a PTO day with paid hours',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
                            values (%L, %s, %L, 'pto', 7.5)$q$, :alder, :e1_id, current_date + 10)), 'ok');
select pg_temp.expect('an employee cannot file a request already approved',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, status, leave_type, paid_hours)
                            values (%L, %s, %L, 'approved', 'pto', 8)$q$, :alder, :e1_id, current_date + 11)), 'err:42501');
select pg_temp.expect('paid hours over 24 are refused',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
                            values (%L, %s, %L, 'sick', 25)$q$, :alder, :e1_id, current_date + 11)), 'err:23514');
select pg_temp.expect('an unknown leave type is refused',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
                            values (%L, %s, %L, 'bereavement', 8)$q$, :alder, :e1_id, current_date + 11)), 'err:23514');
select pg_temp.expect('an unpaid request with hours is stored without them',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
                            values (%L, %s, %L, 'unpaid', 8)$q$, :alder, :e1_id, current_date + 12)), 'ok');
select pg_temp.check('(paid_hours is null on the unpaid day)',
  (select paid_hours is null from time_off_requests where date = current_date + 12));
select pg_temp.expect('a paid request with no hours gets a full day',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, leave_type)
                            values (%L, %s, %L, 'sick')$q$, :alder, :e1_id, current_date + 13)), 'ok');
select pg_temp.check('(8 hours)', (select paid_hours = 8 from time_off_requests where date = current_date + 13));

\set r1 '(select id from time_off_requests where date = current_date + 10 and employee_id = (select v::bigint from fx where k = ''e1''))'

-- Manual adjustments ---------------------------------------------------------

select pg_temp.expect('a manager adds 10 h of PTO with a reason',
  pg_temp.run(:ann, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
                             values (%L, %s, 'pto', 'adjustment', 10, current_date, 'Opening balance')$q$, :alder, :e1_id)), 'ok');
select pg_temp.check('the balance is 10 and the row records it',
  (select balance from pto_balances where employee_id = :e1_id and leave_type = 'pto') = 10
  and (select balance_after from pto_ledger where employee_id = :e1_id and kind = 'adjustment') = 10
  and (select created_by from pto_ledger where employee_id = :e1_id and kind = 'adjustment') = :ann);
select pg_temp.expect('an adjustment needs a reason',
  pg_temp.run(:ann, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
                             values (%L, %s, 'pto', 'adjustment', 5, current_date, '  ')$q$, :alder, :e1_id)), 'err:23514');
select pg_temp.expect('an employee cannot adjust their own balance',
  pg_temp.run(:e1, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
                            values (%L, %s, 'pto', 'adjustment', 40, current_date, 'please')$q$, :alder, :e1_id)), 'err:42501');
select pg_temp.expect('another organization''s manager cannot adjust it',
  pg_temp.run(:ben, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
                             values (%L, %s, 'pto', 'adjustment', 40, current_date, 'x')$q$, :alder, :e1_id)), 'err:42501');
select pg_temp.expect('nor by filing it under their own organization',
  pg_temp.run(:ben, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
                             values (%L, %s, 'pto', 'adjustment', 40, current_date, 'x')$q$, :birch, :e1_id)), 'err:23503');
select pg_temp.expect('a manager cannot write a usage row directly',
  pg_temp.run(:ann, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date)
                             values (%L, %s, 'pto', 'usage', -5, current_date)$q$, :alder, :e1_id)), 'err:42501');
select pg_temp.expect('a manager cannot write an accrual directly',
  pg_temp.run(:ann, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
                             values (%L, %s, 'pto', 'accrual', 50, current_date, 'x')$q$, :alder, :e1_id)), 'err:42501');
select pg_temp.expect('a manager cannot rewrite a ledger row',
  pg_temp.run(:ann, $q$update pto_ledger set hours = 100$q$), 'err:42501');
select pg_temp.expect('a manager cannot delete ledger rows',
  pg_temp.run(:ann, $q$delete from pto_ledger$q$), 'err:42501');
do $$ begin
  update pto_ledger set hours = 99;
  raise notice 'FAIL  an update to the ledger is refused even without RLS';
exception when others then
  raise notice 'PASS  an update to the ledger is refused even without RLS (%)', sqlerrm;
end $$;
select pg_temp.expect('nobody writes a balance directly',
  pg_temp.run(:ann, format($q$update pto_balances set balance = 999 where employee_id = %s$q$, :e1_id)), 'err:42501');
select pg_temp.expect('nor inserts one',
  pg_temp.run(:ann, format($q$insert into pto_balances (org_id, employee_id, leave_type, balance) values (%L, %s, 'sick', 99)$q$, :alder, :e2_id)), 'err:42501');

-- Who sees balances
select pg_temp.expect('the employee sees their own balance',
  pg_temp.see(:e1, 'select balance::text from pto_balances where leave_type = ''pto'''), '10.00');
select pg_temp.expect('another employee does not',
  pg_temp.see(:e2, 'select count(*)::text from pto_balances'), '0');
select pg_temp.expect('another employee does not see the ledger',
  pg_temp.see(:e2, 'select count(*)::text from pto_ledger'), '0');
select pg_temp.expect('another organization does not',
  pg_temp.see(:ben, 'select count(*)::text from pto_ledger'), '0');
select pg_temp.expect('the manager sees it',
  pg_temp.see(:ann, 'select count(*)::text from pto_balances'), '1');

-- Approving and cancelling ---------------------------------------------------

select pg_temp.expect('an employee cannot approve their own request',
  pg_temp.see(:e1, format('select decide_time_off(%s, ''approved'')->>''status''', :r1)), 'not_found');
select pg_temp.expect('another organization''s manager cannot approve it',
  pg_temp.see(:ben, format('select decide_time_off(%s, ''approved'')->>''status''', :r1)), 'not_found');
select pg_temp.expect('a bad status is refused',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''cancelled'')->>''status''', :r1)), 'invalid');
select pg_temp.expect('the manager approves 8 h (edited from 7.5)',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'', null, 8)->>''balance''', :r1)), '2.00');
select pg_temp.check('a usage row for -8 h records the balance after it',
  (select hours = -8 and balance_after = 2 and effective_date = current_date + 10
     from pto_ledger where request_id = :r1 and kind = 'usage')
  and (select paid_hours = 8 and status = 'approved' from time_off_requests where id = :r1));
select pg_temp.expect('approving again changes nothing',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'')->>''unchanged''', :r1)), 'true');
select pg_temp.check('(still one usage row)',
  (select count(*) from pto_ledger where request_id = :r1) = 1);

select pg_temp.expect('an approved request cannot be denied',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''denied'')->>''status''', :r1)), 'conflict');
select pg_temp.expect('nor have its hours changed directly',
  pg_temp.run(:ann, format('update time_off_requests set paid_hours = 2 where id = %s', :r1)), 'err:TO002');
select pg_temp.expect('nor be denied directly',
  pg_temp.run(:ann, format('update time_off_requests set status = ''denied'' where id = %s', :r1)), 'err:TO002');

-- Not enough balance
insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
values (:alder, :e1_id, current_date + 14, 'pto', 8), (:alder, :e1_id, current_date + 15, 'pto', 8);
\set r2 '(select id from time_off_requests where date = current_date + 14 and employee_id = (select v::bigint from fx where k = ''e1''))'
\set r3 '(select id from time_off_requests where date = current_date + 15 and employee_id = (select v::bigint from fx where k = ''e1''))'
select pg_temp.expect('approving 8 h against 2 h is refused with the balance',
  pg_temp.see(:ann, format('select (decide_time_off(%s, ''approved''))::text', :r2)),
  '{"hours": 8.00, "status": "insufficient", "balance": 2.00, "leave_type": "pto"}');
select pg_temp.check('(the request stays pending and nothing is deducted)',
  (select status from time_off_requests where id = :r2) = 'pending'
  and (select balance from pto_balances where employee_id = :e1_id and leave_type = 'pto') = 2);
select pg_temp.expect('a direct update past the balance is refused',
  pg_temp.run(:ann, format('update time_off_requests set status = ''approved'' where id = %s', :r2)), 'err:TO001');
select pg_temp.expect('the manager approves anyway',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'', null, null, true)->>''balance''', :r2)), '-6.00');
select pg_temp.check('the allow-negative setting does not outlive the call',
  coalesce(current_setting('app.pto_allow_negative', true), '') = '');
select pg_temp.expect('the next approval is strict again',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'')->>''status''', :r3)), 'insufficient');
select pg_temp.expect('approving it as unpaid needs no balance',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'', ''unpaid'')->>''status''', :r3)), 'ok');
select pg_temp.check('(no ledger row for the unpaid day; hours cleared)',
  not exists (select 1 from pto_ledger where request_id = :r3)
  and (select leave_type = 'unpaid' and paid_hours is null from time_off_requests where id = :r3));

-- Cancelling
select pg_temp.expect('another employee cannot cancel e1''s request',
  pg_temp.see(:e2, format('select cancel_time_off(%s)->>''status''', :r2)), 'not_found');
select pg_temp.expect('another organization''s manager cannot cancel it',
  pg_temp.see(:ben, format('select cancel_time_off(%s)->>''status''', :r2)), 'not_found');
select pg_temp.expect('the employee cancels their approved PTO day',
  pg_temp.see(:e1, format('select cancel_time_off(%s)->>''was''', :r2)), 'approved');
select pg_temp.check('a restore row gives the 8 h back',
  (select hours = 8 and balance_after = 2 from pto_ledger where request_id = :r2 and kind = 'restore')
  and (select balance from pto_balances where employee_id = :e1_id and leave_type = 'pto') = 2);
select pg_temp.expect('cancelling twice is a conflict',
  pg_temp.see(:e1, format('select cancel_time_off(%s)->>''status''', :r2)), 'conflict');
select pg_temp.expect('a cancelled request is final',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'')->>''status''', :r2)), 'conflict');
select pg_temp.expect('even to a direct update',
  pg_temp.run(:ann, format('update time_off_requests set status = ''approved'' where id = %s', :r2)), 'err:TO002');
select pg_temp.expect('the day can be requested again',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
                            values (%L, %s, %L, 'pto', 4)$q$, :alder, :e1_id, current_date + 14)), 'ok');
select pg_temp.expect('but not twice while live',
  pg_temp.run(:e1, format($q$insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
                            values (%L, %s, %L, 'pto', 4)$q$, :alder, :e1_id, current_date + 14)), 'err:23505');
select pg_temp.expect('the employee cancels a pending request',
  pg_temp.see(:e1, format('select cancel_time_off(id)->>''was'' from time_off_requests where date = %L and status = ''pending''', current_date + 14)), 'pending');
select pg_temp.check('(a pending cancel writes no ledger row)',
  (select count(*) from pto_ledger where kind = 'restore') = 1);

-- Past days: the employee can't take back time already taken; a manager can.
insert into time_off_requests (org_id, employee_id, date, status, leave_type, paid_hours)
values (:alder, :e1_id, current_date - 5, 'pending', 'sick', 6);
\set rp '(select id from time_off_requests where date = current_date - 5)'
select pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'', null, null, true)', :rp)) as approved_past \gset
select pg_temp.expect('the employee cannot cancel a past day',
  pg_temp.see(:e1, format('select cancel_time_off(%s)->>''status''', :rp)), 'past');
select pg_temp.expect('the manager can',
  pg_temp.see(:ann, format('select cancel_time_off(%s)->>''status''', :rp)), 'ok');
select pg_temp.check('sick and PTO are separate balances',
  (select balance from pto_balances where employee_id = :e1_id and leave_type = 'sick') = 0
  and (select balance from pto_balances where employee_id = :e1_id and leave_type = 'pto') = 2);

-- Deleting an approved request gives the hours back first.
insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
values (:alder, :e1_id, current_date + 30, 'pto', 2);
\set rd '(select id from time_off_requests where date = current_date + 30)'
select pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'')->>''balance''', :rd)) as after_rd \gset
select pg_temp.expect('(approved: balance 0)', :'after_rd', '0.00');
select pg_temp.see(:ann, format('select %s', :rd)) as rd_id \gset
select pg_temp.expect('a manager deletes the approved request',
  pg_temp.run(:ann, format('delete from time_off_requests where id = %s', :rd)), 'ok');
select pg_temp.check('its hours are restored and its rows kept, unlinked',
  (select balance from pto_balances where employee_id = :e1_id and leave_type = 'pto') = 2
  and (select count(*) from pto_ledger where request_id is null and kind in ('usage', 'restore')
         and effective_date = current_date + 30) = 2);

-- Accruals --------------------------------------------------------------------

select pg_temp.expect('an employee cannot post accruals',
  pg_temp.see(:e1, format($q$select post_pto_accruals(%L, 'sick', '2025-01-01', '2025-12-31', null, '[]')->>'status'$q$, :alder)), 'forbidden');
select pg_temp.expect('another organization''s manager cannot',
  pg_temp.see(:ben, format($q$select post_pto_accruals(%L, 'sick', '2025-01-01', '2025-12-31', null, '[]')->>'status'$q$, :alder)), 'forbidden');
select pg_temp.expect('a reversed window is invalid',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-12-31', '2025-01-01', null, '[]')->>'status'$q$, :alder)), 'invalid');
select pg_temp.expect('an entry outside the window is refused',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-06-01', '2025-12-31', null,
    jsonb_build_array(jsonb_build_object('employee_id', %s, 'period_start', '2025-01-06', 'period_end', '2025-01-12', 'hours', 1)))->>'status'$q$,
    :alder, :e2_id)), 'err:22023');
select pg_temp.expect('another organization''s employee cannot be credited',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-01-01', '2025-12-31', null,
    jsonb_build_array(jsonb_build_object('employee_id', %s, 'period_start', '2025-01-06', 'period_end', '2025-01-12', 'hours', 1)))->>'status'$q$,
    :alder, :b1_id)), 'err:23503');

\set entries '''[{"employee_id": EMP, "period_start": "2025-11-24", "period_end": "2025-11-30", "hours": 1.33, "worked_hours": 40}, {"employee_id": EMP, "period_start": "2025-12-01", "period_end": "2025-12-07", "hours": 1.00, "worked_hours": 30}]'''
select replace(:entries, 'EMP', (select v from fx where k = 'e2')) as e2_entries \gset
select pg_temp.expect('a manager posts two weeks of sick accrual',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-11-24', '2025-12-07', null, %L)->>'accrual_rows'$q$, :alder, :'e2_entries')), '2');
select pg_temp.check('each week has its row, dated its last day, with the hours that earned it',
  (select string_agg(hours || '@' || effective_date || '/' || worked_hours, ' ' order by effective_date)
     from pto_ledger where employee_id = :e2_id and kind = 'accrual')
  = '1.33@2025-11-30/40.00 1.00@2025-12-07/30.00'
  and (select balance from pto_balances where employee_id = :e2_id and leave_type = 'sick') = 2.33);
select pg_temp.expect('posting the same again adds nothing',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-11-24', '2025-12-07', null, %L)->>'accrual_rows'$q$, :alder, :'e2_entries')), '0');
select pg_temp.expect('a corrected week gets one correction row',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-11-24', '2025-12-07', null, %L)->>'accrual_rows'$q$,
    :alder, replace(:'e2_entries', '"hours": 1.00', '"hours": 1.25'))), '1');
select pg_temp.check('(+0.25 for the week of Dec 1)',
  (select hours from pto_ledger where employee_id = :e2_id and kind = 'accrual' order by id desc limit 1) = 0.25
  and (select balance from pto_balances where employee_id = :e2_id and leave_type = 'sick') = 2.58);
select pg_temp.expect('entries must be an array',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-11-24', '2025-12-07', null, %L)->>'status'$q$,
    :alder, (:'e2_entries'::jsonb -> 0)::text)), 'invalid');
select pg_temp.expect('a week that no longer earns anything goes back to zero',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-11-24', '2025-12-07', null, %L)->>'accrual_rows'$q$,
    :alder, jsonb_build_array(:'e2_entries'::jsonb -> 0)::text)), '1');
select pg_temp.check('(balance back to the first week''s 1.33)',
  (select balance from pto_balances where employee_id = :e2_id and leave_type = 'sick') = 1.33);
select pg_temp.check('periods outside the window are left alone',
  (select count(*) from pto_ledger where employee_id = :e2_id and kind = 'accrual') = 4);

-- Carryover at year end: e2 has 1.33 sick hours accrued in 2025; add 20 more
-- so the balance on Dec 31 is 21.33, and cap the carryover at 16.
select pg_temp.run(:ann, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
  values (%L, %s, 'sick', 'adjustment', 20, '2025-12-15', 'Transferred from paper records')$q$, :alder, :e2_id)) as adj \gset
-- A sick day taken in 2026 doesn't count against 2025's year-end balance.
insert into time_off_requests (org_id, employee_id, date, status, leave_type, paid_hours)
values (:alder, :e2_id, '2026-01-05', 'pending', 'sick', 4);
select pg_temp.see(:ann, 'select decide_time_off(id, ''approved'')->>''status'' from time_off_requests where date = ''2026-01-05''') as jan5 \gset
select pg_temp.expect('(the January day is approved)', :'jan5', 'ok');
select pg_temp.expect('a year-end run forfeits the excess over the carryover cap',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-12-08', '2026-01-04', 16, '[]')->>'carryover_rows'$q$, :alder)), '1');
select pg_temp.check('-5.33 h dated Dec 31, explained',
  (select hours = -5.33 and reason = 'Carryover cap 16 h' and period_start = '2025-01-01'
     from pto_ledger where employee_id = :e2_id and kind = 'carryover' and effective_date = '2025-12-31'));
select pg_temp.check('(e1 has no sick balance to forfeit: no row)',
  not exists (select 1 from pto_ledger where employee_id = :e1_id and kind = 'carryover'));
select pg_temp.expect('running it again forfeits nothing more',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-12-08', '2026-01-04', 16, '[]')->>'carryover_rows'$q$, :alder)), '0');
select pg_temp.expect('raising the cap gives back the difference',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2025-12-08', '2026-01-04', 20, '[]')->>'carryover_rows'$q$, :alder)), '1');
select pg_temp.check('(+4 h; 20 h carried into 2026, then the 4 h January day)',
  (select sum(hours) from pto_ledger where employee_id = :e2_id and kind = 'carryover') = -1.33
  and (select sum(hours) from pto_ledger where employee_id = :e2_id and leave_type = 'sick' and effective_date <= '2025-12-31') = 20
  and (select balance from pto_balances where employee_id = :e2_id and leave_type = 'sick') = 16);
select pg_temp.expect('a window without a year end applies no carryover',
  pg_temp.see(:ann, format($q$select post_pto_accruals(%L, 'sick', '2026-01-05', '2026-01-11', 0, '[]')->>'carryover_rows'$q$, :alder)), '0');
select pg_temp.expect('the PTO bank is untouched by the sick carryover',
  (select balance::text from pto_balances where employee_id = :e1_id and leave_type = 'pto'), '2.00');

-- The ledger explains every balance.
select pg_temp.check('every balance is the sum of its ledger rows',
  not exists (
    select 1 from pto_balances b
     where b.balance <> (select coalesce(sum(hours), 0) from pto_ledger l
                          where l.employee_id = b.employee_id and l.leave_type = b.leave_type)));
select pg_temp.check('each row''s balance_after is the running sum',
  not exists (
    select 1 from (
      select balance_after, sum(hours) over (partition by employee_id, leave_type order by id) as running
        from pto_ledger) x
     where balance_after <> running));

-- ---------------------------------------------------------------------------
-- Two approvals at once, on two connections. e1 has 2 h of PTO; give 6 more
-- for 8, then approve two 8-hour days at the same moment: one wins.

create extension if not exists dblink;
\set pghost ''
\set pgport ''
\set pguser ''
\set pgpassword ''
\getenv pghost PGHOST
\getenv pgport PGPORT
\getenv pguser PGUSER
\getenv pgpassword PGPASSWORD
select concat_ws(' ', 'dbname=' || current_database(),
                 'host=' || nullif(:'pghost', ''), 'port=' || nullif(:'pgport', ''),
                 'user=' || coalesce(nullif(:'pguser', ''), current_user),
                 'password=' || nullif(:'pgpassword', '')) as conninfo \gset

select pg_temp.run(:ann, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
  values (%L, %s, 'pto', 'adjustment', 6, current_date, 'Top up')$q$, :alder, :e1_id)) as topup \gset
insert into time_off_requests (org_id, employee_id, date, leave_type, paid_hours)
values (:alder, :e1_id, current_date + 40, 'pto', 8), (:alder, :e1_id, current_date + 41, 'pto', 8),
       (:alder, :e1_id, current_date + 42, 'pto', 1);
select id as c1 from time_off_requests where date = current_date + 40 \gset
select id as c2 from time_off_requests where date = current_date + 41 \gset
select id as c3 from time_off_requests where date = current_date + 42 \gset

select dblink_connect('other', :'conninfo');
select dblink_exec('other', format('set request.jwt.claim.sub = %L', :ann));
select dblink_exec('other', 'set role authenticated');

begin;
select set_config('request.jwt.claim.sub', :ann, true);
set local role authenticated;
select decide_time_off(:c1, 'approved')->>'status' as first_status \gset
reset role;
-- The other connection approves the second day while this one holds the lock.
select dblink_send_query('other', format('select decide_time_off(%s, ''approved'')::text', :c2));
do $$
declare i int := 0;
begin
  while i < 100 and not exists (select 1 from pg_stat_activity
                                 where wait_event_type = 'Lock' and query like '%decide_time_off%'
                                   and pid <> pg_backend_pid()) loop
    perform pg_sleep(0.05);
    i := i + 1;
  end loop;
  if i < 100 then raise notice 'PASS  the second approval waits for the first';
  else raise notice 'FAIL  the second approval did not wait for the first'; end if;
end $$;
commit;
select r as second_result from dblink_get_result('other') as t(r text) \gset
select pg_temp.expect('the first approval wins', :'first_status', 'ok');
select pg_temp.expect('the second sees the deduction and is refused',
  (:'second_result')::jsonb->>'status', 'insufficient');
select pg_temp.check('exactly one usage row, and the balance is 0',
  (select count(*) from pto_ledger where request_id in (:c1, :c2) and kind = 'usage') = 1
  and (select balance from pto_balances where employee_id = :e1_id and leave_type = 'pto') = 0
  and (select status from time_off_requests where id = :c2) = 'pending');
-- dblink_get_result needs one more call to finish the query.
select * from dblink_get_result('other') as t(r text);

-- The same request approved on two connections at once is deducted once.
select pg_temp.run(:ann, format($q$insert into pto_ledger (org_id, employee_id, leave_type, kind, hours, effective_date, reason)
  values (%L, %s, 'pto', 'adjustment', 5, current_date, 'Top up')$q$, :alder, :e1_id)) as topup2 \gset
begin;
select set_config('request.jwt.claim.sub', :ann, true);
set local role authenticated;
select decide_time_off(:c3, 'approved')->>'status' as first_same \gset
reset role;
select dblink_send_query('other', format('select decide_time_off(%s, ''approved'')::text', :c3));
select pg_sleep(0.3);
commit;
select r as second_same from dblink_get_result('other') as t(r text) \gset
select * from dblink_get_result('other') as t(r text);
select pg_temp.expect('the second approval of the same day finds it approved',
  (:'second_same')::jsonb->>'unchanged', 'true');
select pg_temp.check('one usage row for it, balance 4',
  (select count(*) from pto_ledger where request_id = :c3 and kind = 'usage') = 1
  and (select balance from pto_balances where employee_id = :e1_id and leave_type = 'pto') = 4);
select dblink_disconnect('other');

-- ---------------------------------------------------------------------------
-- What still works.

select pg_temp.expect('a manager still denies a pending request',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''denied'')->>''status''', :c2)), 'ok');
select pg_temp.expect('a denied day can still be approved later',
  pg_temp.see(:ann, format('select decide_time_off(%s, ''approved'', ''unpaid'')->>''status''', :c2)), 'ok');
select pg_temp.expect('an unpaid request is approved the old way, by update',
  pg_temp.run(:ann, format($q$update time_off_requests set status = 'approved' where employee_id = %s and date = %L$q$, :e1_id, current_date + 12)), 'ok');
select pg_temp.check('(no ledger row for it)',
  not exists (select 1 from pto_ledger l join time_off_requests r on r.id = l.request_id
               where r.date = current_date + 12));
select pg_temp.expect('archiving an employee keeps their ledger',
  pg_temp.see(:ann, format('select employee_remove(%L, %s)', :alder, :e2_id)), 'archived');
select pg_temp.check('(their rows are still there)',
  exists (select 1 from pto_ledger where employee_id = :e2_id));
select org_delete(:alder);
select pg_temp.check('deleting an organization deletes its requests, ledger and balances',
  not exists (select 1 from pto_ledger) and not exists (select 1 from pto_balances)
  and not exists (select 1 from time_off_requests));
