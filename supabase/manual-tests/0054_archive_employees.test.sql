-- Tests for 0054_archive_employees.sql. Run against a throwaway Postgres
-- database (15 or later):
--
--   createdb archive_test
--   cd supabase/manual-tests && psql -q -d archive_test -f 0054_archive_employees.test.sql
--   dropdb archive_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 reproduces
-- the bug on the schema before 0054 (deleting an employee erases their time
-- cards); part 2 applies it (twice) and checks it. Every statement runs as a
-- signed-in user, the way the API makes it.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../migrations/20261018000000_baseline.sql
\ir ../migrations/20261024000052_employee_delete_cascade.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''
\set e2   '''eeeeeeee-0000-0000-0000-000000000002'''

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

-- Runs one statement as `uid` and keeps its effects. Returns 'ok' or
-- 'err:<sqlstate>'.
create or replace function pg_temp.run(uid text, stmt text)
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
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

-- What `uid` sees: the first column of the first row of `query`.
create or replace function pg_temp.see(uid text, query text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
  execute query into v;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
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

-- Alder (UTC, so "today" is current_date):
--   e1, linked: worked yesterday (punches, a correction, a shift), has time
--       off and a shift next week.
--   e2, linked: same history, used for the delete-refused checks.
--   new: added by mistake, only a shift next week.
do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  emp bigint;
  k text;
begin
  insert into fx values ('alder', a);
  insert into app_settings (org_id, key, value) values (a, 'timezone', 'UTC')
    on conflict (org_id, key) do update set value = excluded.value;
  foreach k in array array['e1', 'e2'] loop
    insert into employees (org_id, name, email, user_id)
      values (a, k, k || '@alder.test',
              case k when 'e1' then 'eeeeeeee-0000-0000-0000-000000000001'::uuid
                     else 'eeeeeeee-0000-0000-0000-000000000002'::uuid end)
      returning id into emp;
    insert into fx values (k, emp);
    insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
      values (a, emp, current_date - 1, 540, 1020), (a, emp, current_date + 7, 540, 1020);
    insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
      values (a, emp, 'clock_in',  now() - interval '1 day', true, 'seed'),
             (a, emp, 'clock_out', now() - interval '1 day' + interval '8 hours', true, 'seed');
    insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note)
      values (a, emp, 'clock_out', now() - interval '20 hours', 'Left late');
    insert into time_off_requests (org_id, employee_id, date, status)
      values (a, emp, current_date - 3, 'approved');
  end loop;
  insert into employees (org_id, name, email) values (a, 'New', 'new@alder.test') returning id into emp;
  insert into fx values ('new', emp);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, emp, current_date + 7, 540, 1020);
end $$;

\set e1_id  '(select v::bigint from fx where k = ''e1'')'
\set e2_id  '(select v::bigint from fx where k = ''e2'')'
\set new_id '(select v::bigint from fx where k = ''new'')'

-- ---------------------------------------------------------------------------
-- Part 1: before 0054.
-- ---------------------------------------------------------------------------
begin;
-- Time off already blocked the delete: its same-org key (no action) happens to
-- be checked before the cascading one removes the rows.
select pg_temp.expect('before 0054: time off blocks deleting e1',
  pg_temp.try(:ann, 'delete from schedules where employee_id = ' || :e1_id || '; delete from employees where id = ' || :e1_id), 'err:23503');
select pg_temp.expect('before 0054: without time off, deleting e1 succeeds',
  pg_temp.run(:ann, 'delete from time_off_requests where employee_id = ' || :e1_id
                    || '; delete from schedules where employee_id = ' || :e1_id
                    || '; delete from employees where id = ' || :e1_id), 'ok');
select pg_temp.check('before 0054: deleting e1 erased their punches and correction (the bug)',
  (select count(*) from punch_records) = 2
  and (select count(*) from punch_corrections) = 1
  and not exists (select 1 from punch_records where employee_id = :e1_id));
rollback;

-- ---------------------------------------------------------------------------
-- Part 2: apply 0054 (twice: it must be safe to repeat).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\ir ../migrations/20261024000054_archive_employees.sql
\ir ../migrations/20261024000054_archive_employees.sql
\unset ON_ERROR_STOP

-- Hard deletes of anyone with time records are refused, by the manager or the
-- service role.
select pg_temp.expect('deleting an employee with punches is refused',
  pg_temp.try(:ann, 'delete from employees where id = ' || :e2_id), 'err:23503');
select pg_temp.expect('even with their punches gone, their correction and time off refuse it',
  pg_temp.try(:ann, 'delete from punch_records where employee_id = ' || :e2_id
                    || '; delete from employees where id = ' || :e2_id), 'err:23503');
do $$
begin
  delete from employees where id = (select v::bigint from fx where k = 'e2');
  raise notice 'FAIL  the service role can''t delete an employee with time records either';
exception when foreign_key_violation then
  raise notice 'PASS  the service role can''t delete an employee with time records either';
end $$;

-- Who may remove.
select pg_temp.expect('an employee cannot remove a coworker',
  pg_temp.try(:e2, 'select employee_remove(' || quote_literal((select v from fx where k = 'alder')) || ', ' || :e1_id || ')'), 'err:42501');
select pg_temp.expect('another org''s manager cannot remove Alder''s employee',
  pg_temp.try(:ben, 'select employee_remove(' || quote_literal((select v from fx where k = 'alder')) || ', ' || :e1_id || ')'), 'err:42501');

-- Archive e1: they have history.
select pg_temp.expect('removing e1 archives them',
  pg_temp.see(:ann, 'select employee_remove(' || quote_literal((select v from fx where k = 'alder')) || ', ' || :e1_id || ')'), 'archived');
select pg_temp.check('e1 is archived, still linked to their account',
  (select archived_at is not null and user_id = 'eeeeeeee-0000-0000-0000-000000000001' from employees where id = :e1_id));
select pg_temp.check('e1''s punches, correction and time off are kept',
  (select count(*) from punch_records where employee_id = :e1_id) = 2
  and (select count(*) from punch_corrections where employee_id = :e1_id) = 1
  and (select count(*) from time_off_requests where employee_id = :e1_id) = 1);
select pg_temp.check('e1''s past shift is kept, next week''s is removed',
  exists (select 1 from schedules where employee_id = :e1_id and date = current_date - 1)
  and not exists (select 1 from schedules where employee_id = :e1_id and date > current_date));
select pg_temp.expect('removing e1 again is a no-op',
  pg_temp.see(:ann, 'select employee_remove(' || quote_literal((select v from fx where k = 'alder')) || ', ' || :e1_id || ')'), 'already_archived');

-- The manager still sees them for reports.
select pg_temp.expect('the manager still reads e1''s punches',
  pg_temp.see(:ann, 'select count(*) from punch_records where employee_id = ' || :e1_id), '2');
select pg_temp.expect('the manager reads archived_at',
  pg_temp.see(:ann, 'select (archived_at is not null)::text from employees where id = ' || :e1_id), 'true');

-- e1 is no longer a member.
select pg_temp.expect('an archived employee can''t live-punch',
  pg_temp.try(:e1, format('insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, ''clock_in'')', (select v from fx where k = 'alder'), :e1_id)), 'err:42501');
do $$
begin
  insert into punch_records (org_id, employee_id, punch_type)
    select org_id, id, 'clock_in' from employees where name = 'e1';
  raise notice 'FAIL  nor can the service role live-punch for them';
exception when insufficient_privilege then
  raise notice 'PASS  nor can the service role live-punch for them';
end $$;
select pg_temp.expect('an archived employee can''t request a correction',
  pg_temp.try(:e1, format('insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note) values (%L, %s, ''clock_out'', now() - interval ''1 hour'', ''x'')', (select v from fx where k = 'alder'), :e1_id)), 'err:42501');
select pg_temp.expect('an archived employee no longer sees the org''s roster',
  pg_temp.see(:e1, 'select count(*) from employees'), '0');
select pg_temp.expect('an archived employee no longer sees the org''s schedule',
  pg_temp.see(:e1, 'select count(*) from schedules'), '0');
select pg_temp.expect('the manager can still add a manual punch to finish their time card',
  pg_temp.try(:ann, 'insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) select org_id, id, ''clock_out'', now() - interval ''2 hours'', true, ''final'' from employees where id = ' || :e1_id), 'ok:1');
select pg_temp.expect('an archived employee can''t be scheduled',
  pg_temp.try(:ann, 'insert into schedules (org_id, employee_id, date, start_minutes, end_minutes) select org_id, id, current_date + 8, 540, 1020 from employees where id = ' || :e1_id), 'err:23514');
select pg_temp.expect('an archived employee can''t be promoted to manager',
  pg_temp.try(:ann, 'select manager_promote(' || quote_literal((select v from fx where k = 'alder')) || ', ''eeeeeeee-0000-0000-0000-000000000001'')'), 'err:42501');

-- Restore.
select pg_temp.expect('a manager restores e1',
  pg_temp.run(:ann, 'update employees set archived_at = null where id = ' || :e1_id), 'ok');
select pg_temp.expect('a restored employee can clock in again',
  pg_temp.try(:e1, format('insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, ''clock_in'')', (select v from fx where k = 'alder'), :e1_id)), 'ok:1');
select pg_temp.expect('a restored employee sees the roster again',
  pg_temp.see(:e1, 'select count(*) > 0 from employees')::text, 'true');
select pg_temp.expect('a restored employee can be scheduled again',
  pg_temp.try(:ann, 'insert into schedules (org_id, employee_id, date, start_minutes, end_minutes) select org_id, id, current_date + 8, 540, 1020 from employees where id = ' || :e1_id), 'ok:1');

-- A mistaken add, with no history, is deleted outright.
select pg_temp.expect('removing an employee with no history deletes them',
  pg_temp.see(:ann, 'select employee_remove(' || quote_literal((select v from fx where k = 'alder')) || ', ' || :new_id || ')'), 'deleted');
select pg_temp.check('the row and their future shift are gone',
  not exists (select 1 from employees where id = :new_id)
  and not exists (select 1 from schedules where employee_id = :new_id));

-- Owner and self rules hold for direct calls.
select pg_temp.expect('a manager can''t remove themselves',
  pg_temp.try(:ann, 'select employee_remove(e.org_id, e.id) from employees e where e.user_id = ''aaaaaaaa-0000-0000-0000-000000000001'''), 'err:42501');

select pg_temp.check('the delete actions are what 0054 says',
  (select string_agg(conrelid::regclass || '=' || confdeltype::text, ',' order by conrelid::regclass::text, conname)
     from pg_constraint
    where confrelid = 'public.employees'::regclass
      and conrelid::regclass::text in ('punch_records', 'punch_corrections', 'time_off_requests', 'callouts'))
  = 'callouts=a,punch_corrections=a,punch_records=a,time_off_requests=a');
