-- Tests for 0063_kiosk.sql. Run against a throwaway Postgres database (15 or
-- later) with pgcrypto available:
--
--   createdb kiosk_test
--   cd supabase/manual-tests && psql -q -d kiosk_test -f 0063_kiosk.test.sql
--   dropdb kiosk_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows the
-- gap on the schema before 0063: there is no kiosk, no PIN, and a punch the
-- service role writes skips every live-punch rule, so a kiosk API writing
-- with the service role would have no rules at all. Part 2 applies 0063
-- (twice) and checks PINs, kiosks, lockout and kiosk punches; part 3 checks
-- what still works.

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

-- Runs one statement as `uid` (a signed-in user) and keeps its effects.
-- Returns 'ok' or 'err:<sqlstate>'.
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

-- The first column of the first row of `query`, as `uid`; 'err:<sqlstate>'
-- on error. Effects are kept.
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

-- As `role` with no signed-in user (service_role: the kiosk API; anon).
create or replace function pg_temp.as_role(r text, stmt text)
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute format('set local role %I', r);
  execute stmt;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return 'err:' || sqlstate;
end $$;

create or replace function pg_temp.svc(stmt text) returns text language sql as $$
  select pg_temp.as_role('service_role', stmt)
$$;

-- A json result as the service role; {"err": sqlstate} on error.
create or replace function pg_temp.svcj(query text)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role service_role';
  execute query into v;
  execute 'reset role';
  return v;
exception when others then
  execute 'reset role';
  return jsonb_build_object('err', sqlstate);
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

-- Alder (UTC): e1 and e2 have accounts, e3 has none (no smartphone) and a
-- past punch, so archiving keeps them. Birch: b1.
do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  b uuid := (select id from organizations where slug = 'birch');
  emp bigint;
begin
  insert into fx values ('alder', a), ('birch', b);
  insert into app_settings (org_id, key, value) values (a, 'timezone', 'UTC'), (b, 'timezone', 'UTC')
    on conflict (org_id, key) do update set value = excluded.value;
  insert into employees (org_id, name, email, user_id)
    values (a, 'Erin One', 'e1@alder.test', 'eeeeeeee-0000-0000-0000-000000000001') returning id into emp;
  insert into fx values ('e1', emp);
  insert into employees (org_id, name, email, user_id)
    values (a, 'Eli Two', 'e2@alder.test', 'eeeeeeee-0000-0000-0000-000000000002') returning id into emp;
  insert into fx values ('e2', emp);
  insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
    values (a, emp, current_date, 480, 1200) returning id into emp;
  insert into fx values ('e2_shift', emp);
  insert into employees (org_id, name, email) values (a, 'Eve Three', 'e3@alder.test') returning id into emp;
  insert into fx values ('e3', emp);
  insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
    values (a, emp, 'clock_in', now() - interval '3 days', true, 'seed'),
           (a, emp, 'clock_out', now() - interval '3 days' + interval '1 hour', true, 'seed');
  insert into employees (org_id, name, email) values (b, 'Bo Birch', 'b1@birch.test') returning id into emp;
  insert into fx values ('b1', emp);
end $$;

\set alder  '(select v::uuid from fx where k = ''alder'')'
\set birch  '(select v::uuid from fx where k = ''birch'')'
\set e1_id  '(select v::bigint from fx where k = ''e1'')'
\set e2_id  '(select v::bigint from fx where k = ''e2'')'
\set e3_id  '(select v::bigint from fx where k = ''e3'')'
\set b1_id  '(select v::bigint from fx where k = ''b1'')'

-- ---------------------------------------------------------------------------
-- Part 1: before 0063.
-- ---------------------------------------------------------------------------
begin;
select pg_temp.expect('before 0063: the service role clocks e1 in',
  pg_temp.svc(format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_in')$q$, :alder, :e1_id)), 'ok');
select pg_temp.expect('before 0063: and clocks e1 in again — no live-punch rule for the service role',
  pg_temp.svc(format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_in')$q$, :alder, :e1_id)), 'ok');
select pg_temp.check('before 0063: punches have no source',
  not exists (select 1 from information_schema.columns where table_name = 'punch_records' and column_name = 'source'));
select pg_temp.check('before 0063: no kiosk or PIN tables',
  to_regclass('public.kiosks') is null and to_regclass('public.employee_pins') is null);
rollback;

-- ---------------------------------------------------------------------------
-- Part 2: apply 0063, twice.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP on
\ir ../migrations/0063_kiosk.sql
\ir ../migrations/0063_kiosk.sql
\unset ON_ERROR_STOP

select pg_temp.check('existing punches read as source app',
  not exists (select 1 from punch_records where source <> 'app' or kiosk_id is not null));
select pg_temp.expect('kiosk mode is off by default',
  (select value from app_settings where org_id = :alder and key = 'kiosk_enabled'), null);

-- ── PINs ────────────────────────────────────────────────────────────────────

select pg_temp.expect('e1 sets their own PIN',
  pg_temp.see(:e1, format($q$select set_employee_pin(%L, %s, '4821')$q$, :alder, :e1_id)), 'ok');
select pg_temp.expect('e1 cannot set a coworker''s PIN',
  pg_temp.see(:e1, format($q$select set_employee_pin(%L, %s, '5937')$q$, :alder, :e2_id)), 'err:42501');
select pg_temp.expect('a manager sets e2''s PIN',
  pg_temp.see(:ann, format($q$select set_employee_pin(%L, %s, '5937')$q$, :alder, :e2_id)), 'ok');
select pg_temp.expect('a manager sets a PIN for e3, who has no account',
  pg_temp.see(:ann, format($q$select set_employee_pin(%L, %s, '7316')$q$, :alder, :e3_id)), 'ok');
select pg_temp.expect('another store''s manager cannot set an Alder PIN',
  pg_temp.see(:ben, format($q$select set_employee_pin(%L, %s, '2468')$q$, :alder, :e3_id)), 'err:42501');
select pg_temp.expect('another store''s manager naming their own store cannot reach an Alder employee',
  pg_temp.see(:ben, format($q$select set_employee_pin(%L, %s, '2468')$q$, :birch, :e3_id)), 'err:P0002');
select pg_temp.expect('anon cannot set a PIN',
  pg_temp.as_role('anon', format($q$select set_employee_pin(%L, %s, '2468')$q$, :alder, :e3_id)), 'err:42501');

select pg_temp.expect('PIN "' || p || '" is refused (format)',
  pg_temp.see(:e1, format($q$select set_employee_pin(%L, %s, %L)$q$, :alder, :e1_id, p)), 'err:22023')
  from unnest(array['12a4', '123', '1234567', '', ' 4821', '48.1']) p;
select pg_temp.expect('PIN "' || p || '" is refused (too easy)',
  pg_temp.see(:e1, format($q$select set_employee_pin(%L, %s, %L)$q$, :alder, :e1_id, p)), 'err:22023')
  from unnest(array['1111', '000000', '1234', '3456', '987654', '7890']) p;
select pg_temp.expect('e1 still has their PIN after the refusals',
  (select count(*)::text from employee_pins where org_id = :alder and employee_id = :e1_id), '1');

select pg_temp.expect('e2 choosing e1''s PIN is told it is taken',
  pg_temp.see(:e2, format($q$select set_employee_pin(%L, %s, '4821')$q$, :alder, :e2_id)), 'taken');
select pg_temp.expect('a manager choosing a taken PIN is told too',
  pg_temp.see(:ann, format($q$select set_employee_pin(%L, %s, '4821')$q$, :alder, :e3_id)), 'taken');
select pg_temp.expect('the same PIN in another store is fine',
  pg_temp.see(:ben, format($q$select set_employee_pin(%L, %s, '4821')$q$, :birch, :b1_id)), 'ok');
select pg_temp.expect('setting your own PIN again to the same value is fine',
  pg_temp.see(:e1, format($q$select set_employee_pin(%L, %s, '4821')$q$, :alder, :e1_id)), 'ok');

do $$ begin
  for i in 1..4 loop
    perform pg_temp.see('eeeeeeee-0000-0000-0000-000000000002',
      format($q$select set_employee_pin(%L, %s, '4821')$q$,
             (select v from fx where k = 'alder'), (select v from fx where k = 'e2')));
  end loop;
end $$;
select pg_temp.expect('after 5 taken PINs in a day an employee must generate one',
  pg_temp.see(:e2, format($q$select set_employee_pin(%L, %s, '6150')$q$, :alder, :e2_id)), 'too_many');
select pg_temp.expect('a manager is not limited',
  pg_temp.see(:ann, format($q$select set_employee_pin(%L, %s, '4821')$q$, :alder, :e2_id)), 'taken');
select pg_temp.check('e2 can still generate a PIN: 6 digits',
  pg_temp.see(:e2, format($q$select generate_employee_pin(%L, %s)$q$, :alder, :e2_id)) ~ '^[0-9]{6}$');
select pg_temp.expect('e1 cannot generate a coworker''s PIN',
  pg_temp.see(:e1, format($q$select generate_employee_pin(%L, %s)$q$, :alder, :e2_id)), 'err:42501');
select pg_temp.expect('a manager resets e2 to a known PIN',
  pg_temp.see(:ann, format($q$select set_employee_pin(%L, %s, '5937')$q$, :alder, :e2_id)), 'ok');

select pg_temp.check('PINs are stored as bcrypt hashes, never the digits',
  (select bool_and(pin_hash like '$2a$10$%' and pin_hash !~ '^[0-9]+$' and length(pin_hash) = 60) from employee_pins));
select pg_temp.check('one salt per store',
  (select count(*) = 2 from kiosk_pin_salts));
select pg_temp.check('the same PIN hashes differently in different stores',
  (select count(distinct pin_hash) = 2 from employee_pins
    where (org_id, employee_id) in ((:alder, :e1_id), (:birch, :b1_id))));

select pg_temp.expect('employees cannot read ' || t, pg_temp.see(:e1, format('select count(*) from %I', t)), 'err:42501')
  from unnest(array['employee_pins', 'kiosk_pin_salts', 'kiosks', 'kiosk_pin_attempts', 'employee_pin_conflicts']) t;
select pg_temp.expect('managers cannot read ' || t, pg_temp.see(:ann, format('select count(*) from %I', t)), 'err:42501')
  from unnest(array['employee_pins', 'kiosk_pin_salts', 'kiosks', 'kiosk_pin_attempts']) t;
select pg_temp.expect('a manager cannot write a PIN hash directly',
  pg_temp.run(:ann, format($q$update employee_pins set pin_hash = 'x' where org_id = %L$q$, :alder)), 'err:42501');

select pg_temp.expect('e1 sees that they have a PIN',
  pg_temp.see(:e1, format($q$select employee_pin_status(%L, %s)->>'hasPin'$q$, :alder, :e1_id)), 'true');
select pg_temp.expect('e1 cannot see whether a coworker has one',
  pg_temp.see(:e1, format($q$select employee_pin_status(%L, %s)->>'hasPin'$q$, :alder, :e2_id)), 'err:42501');
select pg_temp.expect('a manager sees whether e3 has one',
  pg_temp.see(:ann, format($q$select employee_pin_status(%L, %s)->>'hasPin'$q$, :alder, :e3_id)), 'true');

-- ── Kiosks ──────────────────────────────────────────────────────────────────

select pg_temp.expect('an employee cannot register a kiosk',
  pg_temp.see(:e1, format($q$select kiosk_create(%L, 'Front', %L)$q$, :alder, repeat('a', 64))), 'err:42501');
select pg_temp.expect('another store''s manager cannot register one for Alder',
  pg_temp.see(:ben, format($q$select kiosk_create(%L, 'Front', %L)$q$, :alder, repeat('a', 64))), 'err:42501');
select pg_temp.expect('a token hash must be 64 hex characters',
  pg_temp.see(:ann, format($q$select kiosk_create(%L, 'Front', 'secret-token')$q$, :alder)), 'err:23514');
select pg_temp.expect('a kiosk needs a name',
  pg_temp.see(:ann, format($q$select kiosk_create(%L, '  ', %L)$q$, :alder, repeat('a', 64))), 'err:23514');
select pg_temp.check('Ann registers two kiosks',
  pg_temp.see(:ann, format($q$select kiosk_create(%L, 'Front counter', %L)$q$, :alder, repeat('a', 64))) ~ '^\d+$'
  and pg_temp.see(:ann, format($q$select kiosk_create(%L, 'Back room', %L)$q$, :alder, repeat('b', 64))) ~ '^\d+$');
select pg_temp.check('Ben registers one for Birch',
  pg_temp.see(:ben, format($q$select kiosk_create(%L, 'Birch tablet', %L)$q$, :birch, repeat('c', 64))) ~ '^\d+$');
select pg_temp.expect('a token can only belong to one kiosk',
  pg_temp.see(:ben, format($q$select kiosk_create(%L, 'Copy', %L)$q$, :birch, repeat('a', 64))), 'err:23505');
insert into fx select 'k1', id from kiosks where token_hash = repeat('a', 64);
insert into fx select 'k2', id from kiosks where token_hash = repeat('b', 64);
insert into fx select 'kb', id from kiosks where token_hash = repeat('c', 64);
\set k1 '(select v::bigint from fx where k = ''k1'')'
\set k2 '(select v::bigint from fx where k = ''k2'')'
\set kb '(select v::bigint from fx where k = ''kb'')'

select pg_temp.expect('Ann lists her two kiosks',
  pg_temp.see(:ann, format('select count(*) from kiosk_list(%L)', :alder)), '2');
select pg_temp.expect('an employee cannot list kiosks',
  pg_temp.see(:e1, format('select count(*) from kiosk_list(%L)', :alder)), 'err:42501');
select pg_temp.expect('Ben cannot list Alder''s kiosks',
  pg_temp.see(:ben, format('select count(*) from kiosk_list(%L)', :alder)), 'err:42501');
select pg_temp.expect('Ben cannot revoke an Alder kiosk through his own store',
  pg_temp.see(:ben, format('select kiosk_revoke(%L, %s)', :birch, :k1)), 'false');
select pg_temp.check('the kiosk is still active', (select revoked_at is null from kiosks where id = :k1));

select pg_temp.expect('employees cannot call kiosk_identify',
  pg_temp.see(:e1, format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64))), 'err:42501');
select pg_temp.expect('anon cannot call kiosk_identify',
  pg_temp.as_role('anon', format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64))), 'err:42501');
select pg_temp.expect('anon cannot call kiosk_status',
  pg_temp.as_role('anon', format($q$select kiosk_status(%L)$q$, repeat('a', 64))), 'err:42501');

select pg_temp.expect('kiosk mode off: the kiosk is refused',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64)))->>'status', 'disabled');
select pg_temp.expect('kiosk mode off: no attempt is counted',
  (select count(*)::text from kiosk_pin_attempts), '0');

insert into app_settings (org_id, key, value) values (:alder, 'kiosk_enabled', 'true'), (:birch, 'kiosk_enabled', 'true');

select pg_temp.expect('kiosk_status names the kiosk and store',
  pg_temp.svcj(format('select kiosk_status(%L)', repeat('a', 64)))->>'org_name', 'Alder Street');
select pg_temp.expect('an unknown token is no kiosk',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('d', 64)))->>'status', 'no_kiosk');

select pg_temp.expect('e1''s PIN at the Alder kiosk finds e1',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64)))->>'employee_id', (select v from fx where k = 'e1'));
select pg_temp.expect('and gives their name',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64)))->>'employee_name', 'Erin One');
select pg_temp.expect('the same digits at the Birch kiosk find Birch''s employee',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('c', 64)))->>'employee_id', (select v from fx where k = 'b1'));
select pg_temp.check('a successful identify marks the kiosk used',
  (select last_used_at is not null from kiosks where id = :k1));

select pg_temp.expect('Ben gives b1 a second PIN',
  pg_temp.see(:ben, format($q$select set_employee_pin(%L, %s, '6284')$q$, :birch, :b1_id)), 'ok');
select pg_temp.expect('a PIN from another store is refused at this kiosk',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '6284')$q$, repeat('a', 64)))->>'status', 'wrong');
select pg_temp.expect('a malformed PIN counts as wrong',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '12ab')$q$, repeat('a', 64)))->>'status', 'wrong');

-- Archived: the PIN is removed, and an archived employee's leftover PIN row
-- (written before this trigger existed) is still refused.
update employees set archived_at = now() where id = :e3_id;
select pg_temp.check('archiving e3 deletes their PIN',
  not exists (select 1 from employee_pins where org_id = :alder and employee_id = :e3_id));
insert into employee_pins (org_id, employee_id, pin_hash)
  values (:alder, :e3_id, kiosk_pin_hash(:alder, '7316'));
select pg_temp.expect('an archived employee''s PIN is refused',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '7316')$q$, repeat('a', 64)))->>'status', 'wrong');
select pg_temp.expect('a manager cannot give an archived employee a PIN',
  pg_temp.see(:ann, format($q$select set_employee_pin(%L, %s, '8024')$q$, :alder, :e3_id)), 'err:P0002');
delete from employee_pins where employee_id = :e3_id;

-- ── Lockout (the Back room kiosk) ──────────────────────────────────────────

select pg_temp.expect('wrong PIN ' || n || ' leaves ' || (5 - n),
  pg_temp.svcj(format($q$select kiosk_identify(%L, '0007')$q$, repeat('b', 64)))->>'attempts_left', (5 - n)::text)
  from generate_series(1, 5) n;
select pg_temp.expect('after 5 wrong PINs the right one is refused too',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('b', 64)))->>'status', 'locked');
select pg_temp.check('with a retry time within 5 minutes',
  (pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('b', 64)))->>'retry_after')::int between 1 and 300);
select pg_temp.expect('a locked attempt is not counted',
  (select count(*)::text from kiosk_pin_attempts where kiosk_id = :k2), '5');
select pg_temp.expect('the other kiosk is not locked',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64)))->>'status', 'ok');
select pg_temp.expect('kiosk_list shows it locked',
  pg_temp.see(:ann, format('select locked from kiosk_list(%L) where id = %s', :alder, :k2)), 'true');
update kiosk_pin_attempts set attempted_at = attempted_at - interval '6 minutes' where kiosk_id = :k2;
select pg_temp.expect('5 minutes later it works again',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('b', 64)))->>'status', 'ok');

-- 20 wrong in a day: locked until a manager unlocks.
insert into kiosk_pin_attempts (org_id, kiosk_id, ok, attempted_at)
  select :alder, :k2, false, now() - n * interval '20 minutes' from generate_series(1, 15) n;
select pg_temp.expect('20 wrong PINs in 24 hours lock the kiosk for a manager',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('b', 64)))->>'needs_manager', 'true');
select pg_temp.expect('an employee cannot unlock it',
  pg_temp.see(:e1, format('select kiosk_unlock(%L, %s)', :alder, :k2)), 'err:42501');
select pg_temp.expect('Ann unlocks it',
  pg_temp.see(:ann, format('select kiosk_unlock(%L, %s)', :alder, :k2)), 'true');
select pg_temp.expect('after the unlock it works',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('b', 64)))->>'status', 'ok');

-- Parallel guesses serialise on the kiosk row (FOR UPDATE): see the function.

-- ── Kiosk punches ───────────────────────────────────────────────────────────

create or replace function pg_temp.kpunch(emp bigint, kind text, kiosk bigint, org uuid default null, extra text default '')
returns text language sql as $$
  select pg_temp.svc(format(
    $q$insert into punch_records (org_id, employee_id, punch_type, source, kiosk_id%s)
       values (%L, %s, %L, 'kiosk', %s%s)$q$,
    case when extra = '' then '' else ', ' || split_part(extra, '=', 1) end,
    coalesce(org, (select v::uuid from fx where k = 'alder')), emp, kind, kiosk,
    case when extra = '' then '' else ', ' || split_part(extra, '=', 2) end))
$$;

select pg_temp.expect('a kiosk clocks e1 in',
  pg_temp.kpunch(:e1_id, 'clock_in', :k1), 'ok');
select pg_temp.check('the punch says kiosk and which one, with the server''s time',
  (select source = 'kiosk' and kiosk_id = :k1 and not is_manual and punched_at > now() - interval '1 minute'
     from punch_records where employee_id = :e1_id order by id desc limit 1));
select pg_temp.expect('a second clock-in is refused, as on the phone',
  pg_temp.kpunch(:e1_id, 'clock_in', :k2), 'err:23P01');
select pg_temp.expect('break start', pg_temp.kpunch(:e1_id, 'break_start', :k1), 'ok');
select pg_temp.expect('a second break start is refused', pg_temp.kpunch(:e1_id, 'break_start', :k1), 'err:23P01');
select pg_temp.expect('break end', pg_temp.kpunch(:e1_id, 'break_end', :k1), 'ok');
insert into app_settings (org_id, key, value) values (:alder, 'punch_max_breaks_per_shift', '1');
select pg_temp.expect('the break cap applies to kiosk punches', pg_temp.kpunch(:e1_id, 'break_start', :k1), 'err:23P01');
delete from app_settings where org_id = :alder and key = 'punch_max_breaks_per_shift';
select pg_temp.expect('clock out', pg_temp.kpunch(:e1_id, 'clock_out', :k1), 'ok');
select pg_temp.expect('a second clock-out is refused', pg_temp.kpunch(:e1_id, 'clock_out', :k1), 'err:23P01');
select pg_temp.expect('e2 cannot start a break without clocking in', pg_temp.kpunch(:e2_id, 'break_start', :k1), 'err:23P01');

-- Session limits (0051): a shift left open from yesterday (30 hours ago)
-- can't be continued; a new clock-in can start.
insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
  values (:alder, :e2_id, 'clock_in', now() - interval '30 hours', true, 'seed');
select pg_temp.expect('a forgotten shift from yesterday can''t be clocked out at the kiosk',
  pg_temp.kpunch(:e2_id, 'clock_out', :k1), 'err:23P01');
select pg_temp.expect('nor can a break start on it', pg_temp.kpunch(:e2_id, 'break_start', :k1), 'err:23P01');
delete from punch_records where employee_id = :e2_id;

select pg_temp.expect('e2 clocks in at the kiosk naming their own shift',
  pg_temp.kpunch(:e2_id, 'clock_in', :k1, null, 'schedule_id=' || (select v from fx where k = 'e2_shift')), 'ok');
select pg_temp.expect('e1 cannot name e2''s shift at the kiosk (0043)',
  pg_temp.kpunch(:e1_id, 'clock_in', :k1, null, 'schedule_id=' || (select v from fx where k = 'e2_shift')), 'err:23514');

select pg_temp.expect('Ann revokes the Back room kiosk',
  pg_temp.see(:ann, format('select kiosk_revoke(%L, %s)', :alder, :k2)), 'true');
select pg_temp.expect('revoking again is harmless',
  pg_temp.see(:ann, format('select kiosk_revoke(%L, %s)', :alder, :k2)), 'true');
select pg_temp.expect('a revoked kiosk''s token is refused',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('b', 64)))->>'status', 'no_kiosk');
select pg_temp.expect('a revoked kiosk''s status is no kiosk',
  pg_temp.svcj(format('select kiosk_status(%L)', repeat('b', 64)))->>'status', 'no_kiosk');
select pg_temp.expect('a revoked kiosk cannot punch', pg_temp.kpunch(:e1_id, 'clock_in', :k2), 'err:KP001');
select pg_temp.expect('Birch''s kiosk cannot punch for Alder', pg_temp.kpunch(:e1_id, 'clock_in', :kb), 'err:KP001');
select pg_temp.expect('an Alder kiosk cannot punch for a Birch employee',
  pg_temp.kpunch(:b1_id, 'clock_in', :k1, :birch), 'err:KP001');
select pg_temp.expect('source kiosk needs a kiosk',
  pg_temp.svc(format($q$insert into punch_records (org_id, employee_id, punch_type, source) values (%L, %s, 'clock_in', 'kiosk')$q$, :alder, :e1_id)), 'err:KP001');
select pg_temp.expect('a kiosk id needs source kiosk',
  pg_temp.svc(format($q$insert into punch_records (org_id, employee_id, punch_type, kiosk_id) values (%L, %s, 'clock_in', %s)$q$, :alder, :e1_id, :k1)), 'err:23514');
select pg_temp.expect('a kiosk punch cannot be manual',
  pg_temp.kpunch(:e1_id, 'clock_in', :k1, null, 'is_manual=true'), 'err:23514');

update app_settings set value = 'false' where org_id = :alder and key = 'kiosk_enabled';
select pg_temp.expect('kiosk mode off: kiosk punches are refused', pg_temp.kpunch(:e1_id, 'clock_in', :k1), 'err:KP001');
select pg_temp.expect('kiosk mode off: identify is refused',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64)))->>'status', 'disabled');
update app_settings set value = 'true' where org_id = :alder and key = 'kiosk_enabled';

update employees set archived_at = now() where id = :e3_id;
select pg_temp.expect('an archived employee cannot punch at a kiosk (0054)',
  pg_temp.kpunch(:e3_id, 'clock_in', :k1), 'err:42501');

-- Geofence on: a kiosk punch needs no GPS, and stores none.
insert into app_settings (org_id, key, value) values
  (:alder, 'gps_required', 'true'), (:alder, 'geofence_enabled', 'true'),
  (:alder, 'geofence_lat', '40.0'), (:alder, 'geofence_lng', '-75.0'), (:alder, 'geofence_radius', '100');
select pg_temp.expect('geofence on: a kiosk clock-in without GPS is accepted',
  pg_temp.kpunch(:e1_id, 'clock_in', :k1), 'ok');
select pg_temp.check('and stored without coordinates',
  (select lat is null and lng is null from punch_records where employee_id = :e1_id order by id desc limit 1));
select pg_temp.expect('geofence on: e1''s own phone clock-out still needs no GPS (only clock-in is fenced)',
  pg_temp.run(:e1, format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_out')$q$, :alder, :e1_id)), 'ok');
select pg_temp.expect('geofence on: e1''s phone clock-in without GPS is still refused',
  pg_temp.run(:e1, format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_in')$q$, :alder, :e1_id)), 'err:GF002');
delete from app_settings where org_id = :alder and key in ('gps_required', 'geofence_enabled', 'geofence_lat', 'geofence_lng', 'geofence_radius');

-- Signed-in users can't forge or relabel kiosk punches.
select pg_temp.expect('e1 cannot insert a kiosk punch with their own session',
  pg_temp.run(:e1, format($q$insert into punch_records (org_id, employee_id, punch_type, source, kiosk_id) values (%L, %s, 'clock_in', 'kiosk', %s)$q$, :alder, :e1_id, :k1)), 'err:42501');
select pg_temp.expect('a manager cannot insert a kiosk punch either',
  pg_temp.run(:ann, format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note, source, kiosk_id) values (%L, %s, 'clock_in', now() - interval '1 hour', true, 'x', 'kiosk', %s)$q$, :alder, :e2_id, :k1)), 'err:42501');
select pg_temp.expect('a manager cannot relabel a phone punch as a kiosk punch',
  pg_temp.run(:ann, format($q$update punch_records set source = 'kiosk', kiosk_id = %s where org_id = %L and source = 'app'$q$, :k1, :alder)), 'err:42501');
select pg_temp.expect('or a kiosk punch as a phone punch',
  pg_temp.run(:ann, format($q$update punch_records set source = 'app', kiosk_id = null where org_id = %L and source = 'kiosk'$q$, :alder)), 'err:42501');

-- History (0053): a kiosk punch is a live punch; edits to it are recorded.
select pg_temp.expect('kiosk punches are not recorded on insert',
  (select count(*)::text from punch_record_history h join punch_records p on p.id = h.punch_id
    where p.source = 'kiosk' and h.action = 'insert'), '0');
select pg_temp.expect('a manager edits a kiosk punch''s time',
  pg_temp.run(:ann, format($q$update punch_records set punched_at = punched_at - interval '5 minutes', note = 'Forgot to tap'
                            where id = (select max(id) from punch_records where source = 'kiosk' and employee_id = %s)$q$, :e1_id)), 'ok');
select pg_temp.check('the edit is in the punch''s history and it keeps its kiosk',
  exists (select 1 from punch_record_history h join punch_records p on p.id = h.punch_id
           where p.source = 'kiosk' and p.kiosk_id = :k1 and p.is_manual and h.action = 'update' and h.reason = 'Forgot to tap'));

-- ---------------------------------------------------------------------------
-- Part 3: what still works.
-- ---------------------------------------------------------------------------
delete from punch_records where employee_id = :e2_id;
select pg_temp.expect('e2 still clocks in on their phone',
  pg_temp.run(:e2, format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_in')$q$, :alder, :e2_id)), 'ok');
select pg_temp.check('a phone punch is source app with no kiosk',
  (select source = 'app' and kiosk_id is null from punch_records where employee_id = :e2_id order by id desc limit 1));
select pg_temp.expect('a second phone clock-in is still refused',
  pg_temp.run(:e2, format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_in')$q$, :alder, :e2_id)), 'err:23P01');
select pg_temp.expect('the service role still writes ordinary punches (demo seeding)',
  pg_temp.svc(format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual) values (%L, %s, 'clock_in', now() - interval '2 days', true)$q$, :alder, :e2_id)), 'ok');
select pg_temp.expect('a manager''s manual punch still works',
  pg_temp.run(:ann, format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note) values (%L, %s, 'clock_out', now() - interval '47 hours', true, 'Missed')$q$, :alder, :e2_id)), 'ok');
select pg_temp.expect('a manager deletes a kiosk punch with a reason',
  pg_temp.see(:ann, format($q$select delete_punch((select max(id) from punch_records where source = 'kiosk'), 'Test punch')::text$q$)), '');
select pg_temp.expect('e1 clears their own PIN',
  pg_temp.see(:e1, format($q$select clear_employee_pin(%L, %s)::text$q$, :alder, :e1_id)), '');
select pg_temp.expect('then their old PIN is wrong at the kiosk',
  pg_temp.svcj(format($q$select kiosk_identify(%L, '4821')$q$, repeat('a', 64)))->>'status', 'wrong');
select pg_temp.expect('Ann cannot remove a Birch employee',
  pg_temp.see(:ann, format($q$select employee_remove(%L, %s)$q$, :birch, :b1_id)), 'err:42501');
select pg_temp.expect('removing an employee with no history still deletes them',
  pg_temp.see(:ben, format($q$select employee_remove(%L, %s)$q$, :birch, :b1_id)), 'deleted');
select pg_temp.check('and their PIN goes with them',
  not exists (select 1 from employee_pins where org_id = :birch));
