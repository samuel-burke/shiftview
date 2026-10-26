-- Tests for 0060_pay_rules.sql. Run against a throwaway Postgres database
-- (15 or later):
--
--   createdb pay_rules_test
--   cd supabase/manual-tests && psql -q -d pay_rules_test -f 0060_pay_rules.test.sql
--   dropdb pay_rules_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows the
-- gap on the schema before 0060 (no exempt flag; any pay-rule value is
-- stored, so payroll would read a typo as the default); part 2 applies it
-- (twice) and checks it, then what still works. Every statement runs as a
-- signed-in user, the way the API makes it.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../migrations/20261018000000_baseline.sql
\ir ../migrations/20261024000052_employee_delete_cascade.sql
\ir ../migrations/20261024000053_punch_history.sql
\ir ../migrations/20261024000054_archive_employees.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''

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
  (:ann, 'ann@alder.test', now()), (:ben, 'ben@birch.test', now()), (:e1, 'e1@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann Owner', 'ann@alder.test') is not null as alder;
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben Owner', 'ben@birch.test') is not null as birch;

create temp table fx (k text primary key, v text);
grant select on fx to public;

do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  emp bigint;
begin
  insert into fx values ('alder', a);
  insert into fx values ('birch', (select id from organizations where slug = 'birch'));
  insert into app_settings (org_id, key, value) values (a, 'timezone', 'UTC')
    on conflict (org_id, key) do update set value = excluded.value;
  insert into employees (org_id, name, email, user_id)
    values (a, 'e1', 'e1@alder.test', 'eeeeeeee-0000-0000-0000-000000000001') returning id into emp;
  insert into fx values ('e1', emp);
  insert into employees (org_id, name, email) values (a, 'Sal', 'sal@alder.test') returning id into emp;
  insert into fx values ('sal', emp);
end $$;

\set alder  '(select v from fx where k = ''alder'')'
\set e1_id  '(select v::bigint from fx where k = ''e1'')'
\set sal_id '(select v::bigint from fx where k = ''sal'')'

-- Inserts (or replaces) one Alder setting as `uid`.
create or replace function pg_temp.put(uid text, k text, v text) returns text language plpgsql as $$
begin
  return pg_temp.run(uid, format(
    'insert into app_settings (org_id, key, value) values (%L, %L, %L)
       on conflict (org_id, key) do update set value = excluded.value',
    (select fx.v from fx where fx.k = 'alder'), k, v));
end $$;

-- ---------------------------------------------------------------------------
-- Part 1: before 0060.
-- ---------------------------------------------------------------------------
begin;
select pg_temp.check('before 0060: employees has no exempt flag (the gap)',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'employees' and column_name = 'exempt'));
select pg_temp.expect('before 0060: a typo in the overtime rule is stored (payroll would read it as federal)',
  pg_temp.put(:ann, 'overtime_rule', 'califronia'), 'ok');
select pg_temp.expect('before 0060: a workweek start of 9 is stored',
  pg_temp.put(:ann, 'payroll_week_start', '9'), 'ok');
select pg_temp.expect('before 0060: 10-minute rounding is stored',
  pg_temp.put(:ann, 'punch_rounding_minutes', '10'), 'ok');
rollback;

-- Leave bad and non-canonical rows for the migration to clean up.
insert into app_settings (org_id, key, value) values
  ((select v::uuid from fx where k = 'alder'), 'overtime_rule', ' California '),
  ((select v::uuid from fx where k = 'alder'), 'punch_rounding_minutes', '10'),
  ((select v::uuid from fx where k = 'birch'), 'payroll_week_start', 'sunday');

-- ---------------------------------------------------------------------------
-- Part 2: apply 0060 (twice: it must be safe to repeat).
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\ir ../migrations/20261024000060_pay_rules.sql
\ir ../migrations/20261024000060_pay_rules.sql
\unset ON_ERROR_STOP

-- Existing rows.
select pg_temp.expect('a valid stored rule is made canonical',
  (select value from app_settings where org_id = (select v::uuid from fx where k = 'alder') and key = 'overtime_rule'),
  'california');
select pg_temp.check('a stored value payroll can''t read is removed (reads as the default)',
  not exists (select 1 from app_settings where key = 'punch_rounding_minutes')
  and not exists (select 1 from app_settings where key = 'payroll_week_start'));
select pg_temp.check('the timezone row is untouched',
  (select value from app_settings where org_id = (select v::uuid from fx where k = 'alder') and key = 'timezone') = 'UTC');

-- exempt.
select pg_temp.check('employees.exempt defaults to false for everyone',
  (select bool_and(not exempt) from employees));
select pg_temp.check('exempt is not null',
  (select is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'exempt'));
select pg_temp.expect('a manager marks an employee exempt',
  pg_temp.try(:ann, 'update employees set exempt = true where id = ' || :sal_id), 'ok:1');
select pg_temp.expect('an employee cannot mark themselves exempt (RLS: no row)',
  pg_temp.try(:e1, 'update employees set exempt = true where id = ' || :e1_id), 'ok:0');
select pg_temp.expect('another org''s manager cannot change Alder''s employee',
  pg_temp.try(:ben, 'update employees set exempt = true where id = ' || :sal_id), 'ok:0');
select pg_temp.expect('exempt can''t be set to null',
  pg_temp.try(:ann, 'update employees set exempt = null where id = ' || :sal_id), 'err:23502');
select pg_temp.expect('the payroll query reads exempt employees as a manager',
  pg_temp.run(:ann, 'update employees set exempt = true where id = ' || :sal_id), 'ok');
select pg_temp.expect('... and sees them',
  pg_temp.see(:ann, 'select string_agg(name, '','') from employees where exempt'), 'Sal');
select pg_temp.expect('an employee can read the roster''s exempt column (granted like the others)',
  pg_temp.see(:e1, 'select count(*)::text from employees where exempt'), '1');
select pg_temp.expect('pay_rate is still hidden from employees',
  pg_temp.try(:e1, 'select pay_rate from employees'), 'err:42501');

-- Pay-rule settings.
select pg_temp.expect('federal is accepted', pg_temp.put(:ann, 'overtime_rule', 'federal'), 'ok');
select pg_temp.expect('alaska is accepted', pg_temp.put(:ann, 'overtime_rule', 'alaska'), 'ok');
select pg_temp.expect('nevada is accepted', pg_temp.put(:ann, 'overtime_rule', 'nevada'), 'ok');
select pg_temp.expect('colorado is accepted', pg_temp.put(:ann, 'overtime_rule', 'colorado'), 'ok');
select pg_temp.expect('a mis-cased rule is accepted', pg_temp.put(:ann, 'overtime_rule', 'Colorado'), 'ok');
select pg_temp.expect('... and stored canonically',
  (select value from app_settings where key = 'overtime_rule' and org_id = (select v::uuid from fx where k = 'alder')), 'colorado');
select pg_temp.expect('an unknown rule is refused', pg_temp.put(:ann, 'overtime_rule', 'texas'), 'err:22023');
select pg_temp.expect('an empty rule is refused', pg_temp.put(:ann, 'overtime_rule', ''), 'err:22023');
select pg_temp.expect('the nevada flag takes true', pg_temp.put(:ann, 'overtime_nevada_daily', 'TRUE'), 'ok');
select pg_temp.expect('... stored as true',
  (select value from app_settings where key = 'overtime_nevada_daily'), 'true');
select pg_temp.expect('the nevada flag refuses yes', pg_temp.put(:ann, 'overtime_nevada_daily', 'yes'), 'err:22023');
select pg_temp.expect('workweek start 0 (Sunday) is accepted', pg_temp.put(:ann, 'payroll_week_start', '0'), 'ok');
select pg_temp.expect('workweek start 6 is accepted', pg_temp.put(:ann, 'payroll_week_start', '6'), 'ok');
select pg_temp.expect('workweek start 7 is refused', pg_temp.put(:ann, 'payroll_week_start', '7'), 'err:22023');
select pg_temp.expect('workweek start -1 is refused', pg_temp.put(:ann, 'payroll_week_start', '-1'), 'err:22023');
select pg_temp.expect('workweek start 1.0 is refused', pg_temp.put(:ann, 'payroll_week_start', '1.0'), 'err:22023');
select pg_temp.expect('rounding 0 is accepted', pg_temp.put(:ann, 'punch_rounding_minutes', '0'), 'ok');
select pg_temp.expect('rounding 5 is accepted', pg_temp.put(:ann, 'punch_rounding_minutes', '5'), 'ok');
select pg_temp.expect('rounding 6 is accepted', pg_temp.put(:ann, 'punch_rounding_minutes', '6'), 'ok');
select pg_temp.expect('rounding 15 is accepted', pg_temp.put(:ann, 'punch_rounding_minutes', '15'), 'ok');
select pg_temp.expect('rounding 10 is refused', pg_temp.put(:ann, 'punch_rounding_minutes', '10'), 'err:22023');
select pg_temp.expect('rounding 30 is refused', pg_temp.put(:ann, 'punch_rounding_minutes', '30'), 'err:22023');
select pg_temp.expect('an update to a bad value is refused too',
  pg_temp.run(:ann, 'update app_settings set value = ''weekly'' where key = ''overtime_rule'''), 'err:22023');
do $$
begin
  insert into app_settings (org_id, key, value)
    values ((select v::uuid from fx where k = 'birch'), 'overtime_rule', 'nowhere');
  raise notice 'FAIL  the service role can''t store a bad rule either';
exception when sqlstate '22023' then
  raise notice 'PASS  the service role can''t store a bad rule either';
end $$;

-- Who may change them.
select pg_temp.expect('an employee cannot change the overtime rule',
  pg_temp.put(:e1, 'overtime_rule', 'federal'), 'err:42501');
select pg_temp.expect('another org''s manager cannot change Alder''s rule',
  pg_temp.try(:ben, 'update app_settings set value = ''federal'' where key = ''overtime_rule'''), 'ok:0');
select pg_temp.expect('Alder''s rule is unchanged',
  (select value from app_settings where key = 'overtime_rule' and org_id = (select v::uuid from fx where k = 'alder')), 'colorado');

-- What still works.
select pg_temp.expect('other settings keep any value', pg_temp.put(:ann, 'punch_late_in_minutes', '7'), 'ok');
select pg_temp.expect('the timezone check still runs', pg_temp.put(:ann, 'timezone', 'Mars/Olympus'), 'err:22023');
select pg_temp.expect('a valid timezone is still canonicalised', pg_temp.put(:ann, 'timezone', 'america/chicago'), 'ok');
select pg_temp.expect('... to its real name',
  (select value from app_settings where key = 'timezone' and org_id = (select v::uuid from fx where k = 'alder')), 'America/Chicago');
select pg_temp.expect('a manager still renames an employee',
  pg_temp.try(:ann, 'update employees set name = ''Sally'' where id = ' || :sal_id), 'ok:1');
select pg_temp.expect('the employee still clocks in',
  pg_temp.run(:e1, format('insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, ''clock_in'')',
    (select v from fx where k = 'alder'), (select v from fx where k = 'e1'))), 'ok');
select pg_temp.expect('a new employee row still gets exempt = false',
  pg_temp.see(:ann, format('insert into employees (org_id, name) values (%L, ''New'') returning exempt::text',
    (select v from fx where k = 'alder'))), 'false');
