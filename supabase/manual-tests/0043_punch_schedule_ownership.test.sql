-- Tests for 0043_punch_schedule_ownership.sql.
-- Run against a throwaway Postgres database (15 or later):
--
--   createdb punch_schedule_test
--   cd supabase/manual-tests && psql -q -d punch_schedule_test -f 0043_punch_schedule_ownership.test.sql
--   dropdb punch_schedule_test
--
-- Any line containing FAIL (or any ERROR) is a regression.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../baseline.sql
\ir ../migrations/0038_notify_service_role_only.sql
\ir ../migrations/0039_link_existing_accounts.sql
\ir ../migrations/0040_remove_legacy_demo_job.sql
\ir ../migrations/0041_database_audit_fixes.sql
\ir ../migrations/0042_pay_rate_managers_only.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set cara '''aaaaaaaa-0000-0000-0000-000000000003'''
\set dan  '''aaaaaaaa-0000-0000-0000-000000000004'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set eve  '''bbbbbbbb-0000-0000-0000-000000000002'''

-- Runs one statement as `role` with auth.uid() = uid, always rolled back.
-- Returns 'ok:<rows>' or 'err:<sqlstate>'.
create or replace function pg_temp.try(uid text, stmt text, role text default 'authenticated')
returns text language plpgsql as $$
declare n bigint;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
    execute format('set local role %I', role);
    execute stmt;
    get diagnostics n = row_count;
    raise exception using errcode = 'P0123', message = n::text;
  exception when others then
    if sqlstate = 'P0123' then return 'ok:' || sqlerrm; end if;
    return 'err:' || sqlstate;
  end;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- A punch insert for `emp` linked to shift `shift`; live unless `manual_at`.
create or replace function pg_temp.punch(emp text, shift text, manual_at text default null)
returns text language plpgsql as $$
begin
  return format(
    $q$insert into punch_records (org_id, employee_id, schedule_id, punch_type, is_manual, punched_at)
       values ((select v::uuid from fx where k = 'alder'), %s, %s, 'clock_in', %L, %s)$q$,
    (select v from fx where k = emp), coalesce((select v from fx where k = shift), 'null'),
    manual_at is not null, coalesce(quote_literal(manual_at) || '::timestamptz', 'now()'));
end $$;

begin;

-- Fixtures: Alder (owner Ann, employees Cara and Dan), Birch (owner Ben,
-- employee Eve). Store time is America/Chicago.
insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:cara, 'cara@alder.test', now()),
  (:dan, 'dan@alder.test', now()), (:ben, 'ben@birch.test', now()),
  (:eve, 'eve@birch.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann Owner', 'ann@alder.test');
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben Owner', 'ben@birch.test');

create temp table fx (k text primary key, v text);
grant select on fx to public;

do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  b uuid := (select id from organizations where slug = 'birch');
  today date := (now() at time zone 'America/Chicago')::date;
  cara bigint; dan bigint; eve bigint; s bigint;
begin
  insert into app_settings (org_id, key, value) values
    (a, 'timezone', 'America/Chicago'), (b, 'timezone', 'America/Chicago')
    on conflict (org_id, key) do update set value = excluded.value;
  insert into employees (org_id, name, email, user_id) values
    (a, 'Cara Clerk', 'cara@alder.test', 'aaaaaaaa-0000-0000-0000-000000000003'),
    (a, 'Dan Driver', 'dan@alder.test',  'aaaaaaaa-0000-0000-0000-000000000004'),
    (b, 'Eve Early',  'eve@birch.test',  'bbbbbbbb-0000-0000-0000-000000000002');
  cara := (select id from employees where email = 'cara@alder.test');
  dan  := (select id from employees where email = 'dan@alder.test');
  eve  := (select id from employees where email = 'eve@birch.test');
  insert into fx values ('alder', a), ('cara', cara), ('dan', dan), ('eve', eve);

  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, cara, today, 540, 1020) returning id into s;
  insert into fx values ('cara_today', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, cara, today - 10, 540, 1020) returning id into s;
  insert into fx values ('cara_old', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, dan, today, 540, 1020) returning id into s;
  insert into fx values ('dan_today', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (b, eve, today, 540, 1020) returning id into s;
  insert into fx values ('eve_today', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, cara, today - 1, 540, 1020) returning id into s;
  insert into fx values ('cara_yesterday', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, cara, today - 1, 1320, 1800) returning id into s;
  insert into fx values ('cara_overnight', s);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, cara, today + 1, 540, 1020) returning id into s;
  insert into fx values ('cara_tomorrow', s);
  insert into fx values ('no_such_shift', '987654321');
end $$;

select pg_temp.check('before 0043 an employee can clock in to a coworker''s shift (the bug)',
  pg_temp.try(:cara, pg_temp.punch('cara', 'dan_today')) = 'ok:1');

\ir ../migrations/0043_punch_schedule_ownership.sql
\ir ../migrations/0043_punch_schedule_ownership.sql

-- Live punches by the employee.
select pg_temp.check('an employee clocks in to their own shift today',
  pg_temp.try(:cara, pg_temp.punch('cara', 'cara_today')) = 'ok:1');
select pg_temp.check('an employee clocks in with no shift',
  pg_temp.try(:cara, pg_temp.punch('cara', 'no_shift')) = 'ok:1');
select pg_temp.check('an employee cannot clock in to a coworker''s shift',
  pg_temp.try(:cara, pg_temp.punch('cara', 'dan_today')) = 'err:23514');
select pg_temp.check('nor to another organization''s shift',
  pg_temp.try(:cara, pg_temp.punch('cara', 'eve_today')) like 'err:%');
select pg_temp.check('nor to a shift id that doesn''t exist',
  pg_temp.try(:cara, pg_temp.punch('cara', 'no_such_shift')) like 'err:%');
select pg_temp.check('nor to their own shift from ten days ago',
  pg_temp.try(:cara, pg_temp.punch('cara', 'cara_old')) = 'err:23514');
select pg_temp.check('nor to yesterday''s day shift',
  pg_temp.try(:cara, pg_temp.punch('cara', 'cara_yesterday')) = 'err:23514');
select pg_temp.check('nor to tomorrow''s shift',
  pg_temp.try(:cara, pg_temp.punch('cara', 'cara_tomorrow')) = 'err:23514');
select pg_temp.check('an employee clocks in to last night''s overnight shift',
  pg_temp.try(:cara, pg_temp.punch('cara', 'cara_overnight')) = 'ok:1');

-- Managers and the service role.
select pg_temp.check('a manager cannot file a punch on a coworker''s shift',
  pg_temp.try(:ann, pg_temp.punch('cara', 'dan_today', (now() - interval '1 minute')::text)) = 'err:23514');
select pg_temp.check('a manager files a past punch on that day''s own shift',
  pg_temp.try(:ann, pg_temp.punch('cara', 'cara_old', (now() - interval '10 days')::text)) = 'ok:1');
select pg_temp.check('the service role is held to the same rule',
  pg_temp.try(null, pg_temp.punch('cara', 'dan_today'), 'service_role') = 'err:23514');

-- Updates.
insert into punch_records (org_id, employee_id, schedule_id, punch_type, is_manual, punched_at)
  values ((select v::uuid from fx where k = 'alder'), (select v::bigint from fx where k = 'cara'), (select v::bigint from fx where k = 'cara_today'),
          'clock_in', true, now() - interval '2 hours');
select pg_temp.check('a manager cannot move a punch onto a coworker''s shift',
  pg_temp.try(:ann, format('update punch_records set schedule_id = %s where employee_id = %s',
    (select v from fx where k = 'dan_today'), (select v from fx where k = 'cara'))) = 'err:23514');
select pg_temp.check('nor move a linked punch to a coworker',
  pg_temp.try(:ann, format('update punch_records set employee_id = %s where employee_id = %s',
    (select v from fx where k = 'dan'), (select v from fx where k = 'cara'))) = 'err:23514');
select pg_temp.check('a manager still edits a linked punch''s time',
  pg_temp.try(:ann, format('update punch_records set punched_at = now() - interval ''3 hours'' where employee_id = %s',
    (select v from fx where k = 'cara'))) = 'ok:1');
select pg_temp.check('a shift with punches can still be swapped to a coworker',
  pg_temp.try(:ann, format('update schedules set employee_id = %s where id = %s',
    (select v from fx where k = 'dan'), (select v from fx where k = 'cara_today'))) = 'ok:1');

rollback;
