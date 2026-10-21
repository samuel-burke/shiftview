-- Tests for 0052_employee_delete_cascade.sql. Run against a throwaway Postgres
-- database (15 or later):
--
--   createdb emp_delete_test
--   cd supabase/manual-tests && psql -q -d emp_delete_test -f 0052_employee_delete_cascade.test.sql
--   dropdb emp_delete_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 reproduces
-- the bug on the schema before 0052; part 2 applies it (twice) and checks it.
-- Each delete runs as the org's manager, the way DELETE /api/employees does.

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
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''

-- Runs one statement as `uid`, always rolled back. Returns 'ok:<rows>' or
-- 'err:<sqlstate>'.
create or replace function pg_temp.try(uid text, stmt text)
returns text language plpgsql as $$
declare n bigint;
begin
  begin
    perform set_config('request.jwt.claim.sub', uid, true);
    execute 'set local role authenticated';
    execute stmt;
    get diagnostics n = row_count;
    raise exception using errcode = 'P0123', message = n::text;
  exception when others then
    if sqlstate = 'P0123' then return 'ok:' || sqlerrm; end if;
    return 'err:' || sqlstate;
  end;
end $$;

create or replace function pg_temp.expect(label text, got text, want text) returns void language plpgsql as $$
begin
  if got = want then raise notice 'PASS  %', label;
  else raise notice 'FAIL  % (got %, want %)', label, got, want; end if;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:ben, 'ben@birch.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann Owner', 'ann@alder.test') is not null as alder;
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben Owner', 'ben@birch.test') is not null as birch;

create temp table fx (k text primary key, v text);
grant select on fx to public;

-- Alder: four employees, each with a shift and one kind of history.
do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  e bigint; s bigint; os bigint;
begin
  insert into fx values ('alder', a);
  foreach e in array array[1, 2, 3, 4] loop
    insert into employees (org_id, name, email)
      values (a, 'Emp ' || e, 'emp' || e || '@alder.test') returning id into s;
    insert into fx values ('emp' || e, s);
    insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
      values (a, s, current_date + 2, 540, 1020);
  end loop;

  -- emp1: a punch (already cascaded before 0052).
  insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual)
    select a, v::bigint, 'clock_in', now() - interval '3 days', true from fx where k = 'emp1';
  -- emp2: a call-out.
  insert into callouts (org_id, employee_id, date)
    select a, v::bigint, current_date + 2 from fx where k = 'emp2';
  -- emp3: a pending claim on an open shift.
  insert into open_shifts (org_id, date, start_minutes, end_minutes)
    values (a, current_date + 5, 540, 1020) returning id into os;
  insert into fx values ('os_claimed', os);
  insert into open_shift_claims (org_id, open_shift_id, employee_id)
    select a, os, v::bigint from fx where k = 'emp3';
  -- emp4: picked up an open shift.
  insert into open_shifts (org_id, date, start_minutes, end_minutes, status, filled_by)
    select a, current_date + 6, 540, 1020, 'filled', v::bigint from fx where k = 'emp4'
    returning id into os;
  insert into fx values ('os_filled', os);
end $$;

-- What the route does: delete the person's schedules, then the employee row.
create or replace function pg_temp.delete_with_schedules(emp text) returns text language sql as $$
  select pg_temp.try('aaaaaaaa-0000-0000-0000-000000000001', format(
    'delete from public.schedules where employee_id = (select v::bigint from fx where k = %L);'
    ' delete from public.employees where id = (select v::bigint from fx where k = %L)', emp, emp))
$$;
-- The employee row alone (what the route does once 0052 has run).
create or replace function pg_temp.delete_row(emp text) returns text language sql as $$
  select pg_temp.try('aaaaaaaa-0000-0000-0000-000000000001', format(
    'delete from public.employees where id = (select v::bigint from fx where k = %L)', emp))
$$;

-- ---------------------------------------------------------------------------
-- Part 1: before 0052.
-- ---------------------------------------------------------------------------
select pg_temp.expect('before 0052: an employee with punches can be deleted', pg_temp.delete_with_schedules('emp1'), 'ok:1');
select pg_temp.expect('before 0052: an employee with a call-out cannot be deleted (the bug)', pg_temp.delete_with_schedules('emp2'), 'err:23503');
select pg_temp.expect('before 0052: an employee with an open-shift claim cannot be deleted (the bug)', pg_temp.delete_with_schedules('emp3'), 'err:23503');
select pg_temp.expect('before 0052: an employee who filled an open shift cannot be deleted (the bug)', pg_temp.delete_with_schedules('emp4'), 'err:23503');
select pg_temp.expect('before 0052: the row alone is blocked by the person''s shifts', pg_temp.delete_row('emp1'), 'err:23503');

-- ---------------------------------------------------------------------------
-- Part 2: apply 0052 (twice: it must be safe to repeat).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\ir ../migrations/0052_employee_delete_cascade.sql
\ir ../migrations/0052_employee_delete_cascade.sql
\unset ON_ERROR_STOP

select pg_temp.expect('an employee with punches can be deleted', pg_temp.delete_row('emp1'), 'ok:1');
select pg_temp.expect('an employee with a call-out can be deleted', pg_temp.delete_row('emp2'), 'ok:1');
select pg_temp.expect('an employee with an open-shift claim can be deleted', pg_temp.delete_row('emp3'), 'ok:1');
select pg_temp.expect('an employee who filled an open shift can be deleted', pg_temp.delete_row('emp4'), 'ok:1');
select pg_temp.expect('the route''s schedules-first order still works', pg_temp.delete_with_schedules('emp2'), 'ok:1');

-- Commit real deletes to check what is left behind.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
delete from public.employees where id in (select v::bigint from fx where k in ('emp2', 'emp3', 'emp4'));
reset role;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.check('their shifts are gone',
  not exists (select 1 from schedules where employee_id in (select v::bigint from fx where k in ('emp2', 'emp3', 'emp4'))));
select pg_temp.check('their call-out is gone',
  not exists (select 1 from callouts where employee_id = (select v::bigint from fx where k = 'emp2')));
select pg_temp.check('their claim is gone, the open shift stays open',
  not exists (select 1 from open_shift_claims where employee_id = (select v::bigint from fx where k = 'emp3'))
  and (select status from open_shifts where id = (select v::bigint from fx where k = 'os_claimed')) = 'open');
select pg_temp.check('the shift they picked up stays filled, with filled_by cleared and org kept',
  (select status = 'filled' and filled_by is null and org_id = (select v::uuid from fx where k = 'alder')
     from open_shifts where id = (select v::bigint from fx where k = 'os_filled')));
select pg_temp.check('the rest of the roster is untouched',
  exists (select 1 from employees where id = (select v::bigint from fx where k = 'emp1'))
  and exists (select 1 from schedules where employee_id = (select v::bigint from fx where k = 'emp1')));

-- Still org-scoped: the other team's owner cannot delete Alder's employee.
select pg_temp.expect('another org''s manager deletes nothing',
  pg_temp.try('bbbbbbbb-0000-0000-0000-000000000001',
    'delete from public.employees where id = (select v::bigint from fx where k = ''emp1'')'), 'ok:0');
select pg_temp.check('the delete actions are what 0052 says',
  (select string_agg(conname || '=' || confdeltype::text, ',' order by conname) from pg_constraint
    where conname in ('callouts_employee_org_fkey', 'open_shift_claims_employee_org_fkey',
                      'open_shifts_filled_by_org_fkey', 'fk_employee', 'schedules_employee_org_fkey'))
  = 'callouts_employee_org_fkey=c,fk_employee=c,open_shift_claims_employee_org_fkey=c,open_shifts_filled_by_org_fkey=n,schedules_employee_org_fkey=c');
