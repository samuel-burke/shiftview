-- Tests for 0053_punch_history.sql. Run against a throwaway Postgres
-- database:
--
--   createdb punch_history_test
--   cd supabase/manual-tests && psql -q -d punch_history_test -f 0053_punch_history.test.sql
--   dropdb punch_history_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 shows that
-- before 0053 a manager's edit or delete leaves no trace; part 2 applies it
-- (twice) and checks it.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../migrations/20261018000000_baseline.sql
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

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- History rows `uid` can see that match `cond`.
create or replace function pg_temp.visible(uid text, cond text default 'true') returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  execute format('select count(*) from public.punch_record_history where %s', cond) into n;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- A punch for the employee linked to `uid`, made by the service role (as the
-- demo seed does), `ago` before now. Returns its id.
create or replace function pg_temp.punch(uid uuid, kind text, ago interval, manual boolean default false)
returns bigint language sql as $$
  insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual)
  select org_id, id, kind, now() - ago, manual from employees where user_id = uid
  returning id
$$;

begin;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now()),
  (:e2, 'e2@alder.test', now()), (:ben, 'ben@birch.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben', 'ben@birch.test');
\set alder '(select id from organizations where slug = ''alder'')'
insert into employees (org_id, name, email, user_id) values
  (:alder, 'e1', 'e1@alder.test', :e1::uuid), (:alder, 'e2', 'e2@alder.test', :e2::uuid);

-- Part 1: before 0053.
select pg_temp.punch(:e1, 'clock_in', '3 hours') as p1 \gset
select pg_temp.punch(:e2, 'clock_in', '3 hours') as p2 \gset
select pg_temp.run('before 0053: a manager moves a punch with no reason', :ann,
  format($q$update punch_records set punched_at = now() - interval '4 hours' where id = %s$q$, :p1), false);
select pg_temp.run('before 0053: a manager deletes a punch directly', :ann,
  format($q$delete from punch_records where id = %s$q$, :p2), false);
select pg_temp.check('before 0053: neither leaves any record of the punch as it was',
  to_regclass('public.punch_record_history') is null
  and (select punched_at < now() - interval '3 hours 30 minutes' from punch_records where id = :p1)
  and not exists (select 1 from punch_records where id = :p2));
delete from punch_records;

-- Part 2: 0053.
\set ON_ERROR_STOP on
\ir ../migrations/20261024000053_punch_history.sql
\ir ../migrations/20261024000053_punch_history.sql
\unset ON_ERROR_STOP

select pg_temp.punch(:e1, 'clock_in', '3 hours') as p1 \gset
select pg_temp.punch(:e2, 'clock_in', '3 hours') as p2 \gset
select pg_temp.check('a live punch is not recorded on insert',
  not exists (select 1 from punch_record_history));

-- A manager adds a missed punch; the API stores the reason in note.
select pg_temp.run('a manager adds a missed clock-out with a reason', :ann,
  $q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
     select org_id, id, 'clock_out', now() - interval '1 hour', true, 'Forgot to clock out' from employees where name = 'e1'$q$, false);
select pg_temp.check('the manual insert is recorded with who and why',
  exists (select 1 from punch_record_history
           where action = 'insert' and changed_by = :ann and reason = 'Forgot to clock out'
             and old_row is null and new_row->>'punch_type' = 'clock_out'));

-- A manager moves e1's clock-in.
select punched_at as p1_was from punch_records where id = :p1 \gset
select pg_temp.run('a manager moves a clock-in with a reason', :ann,
  format($q$update punch_records set punched_at = now() - interval '4 hours', note = 'Clocked in on paper' where id = %s$q$, :p1), false);
select pg_temp.check('the update is recorded with the old and new times, who and why',
  exists (select 1 from punch_record_history
           where punch_id = :p1 and action = 'update' and changed_by = :ann and reason = 'Clocked in on paper'
             and (old_row->>'punched_at')::timestamptz = :'p1_was'::timestamptz
             and (new_row->>'punched_at')::timestamptz < now() - interval '3 hours 30 minutes'
             and (new_row->>'is_manual')::boolean and not (old_row->>'is_manual')::boolean));

select pg_temp.punch(:e1, 'break_start', '2 hours') as p3 \gset
select pg_temp.run('a manager changes only a punch''s type', :ann,
  format($q$update punch_records set punch_type = 'break_end' where id = %s$q$, :p3), false);
select pg_temp.check('changing a punch''s type marks it manual and is recorded',
  (select is_manual from punch_records where id = :p3)
  and exists (select 1 from punch_record_history where punch_id = :p3 and action = 'update'
                and old_row->>'punch_type' = 'break_start' and new_row->>'punch_type' = 'break_end'));

-- Deletes.
select pg_temp.run('a manager can no longer delete a punch directly', :ann,
  format($q$delete from punch_records where id = %s$q$, :p2), true);
select pg_temp.run('delete_punch needs a reason', :ann,
  format($q$select delete_punch(%s, '  ')$q$, :p2), true);
select pg_temp.run('an employee cannot delete their own punch', :e2,
  format($q$select delete_punch(%s, 'oops')$q$, :p2), true);
select pg_temp.run('another organization''s manager cannot delete it', :ben,
  format($q$select delete_punch(%s, 'oops')$q$, :p2), true);
select pg_temp.check('the punch is still there', exists (select 1 from punch_records where id = :p2));
select pg_temp.run('a manager deletes a punch with a reason, then edits another', :ann,
  format($q$select delete_punch(%s, 'Duplicate punch');
            update punch_records set punched_at = punched_at - interval '1 minute', note = null where id = %s$q$, :p2, :p3), false);
select pg_temp.check('the delete is recorded with the punch as it was, who and why',
  not exists (select 1 from punch_records where id = :p2)
  and exists (select 1 from punch_record_history
               where punch_id = :p2 and action = 'delete' and changed_by = :ann and reason = 'Duplicate punch'
                 and old_row->>'punch_type' = 'clock_in' and new_row is null));
select pg_temp.check('the delete''s reason does not carry onto a later edit in the same transaction',
  (select reason from punch_record_history where punch_id = :p3 order by id desc limit 1) is null);

-- The service role: recorded, with no user.
select pg_temp.run('the service role moves a punch', null,
  format($q$update punch_records set punched_at = punched_at - interval '1 minute' where id = %s$q$, :p1), false, 'service_role');
select pg_temp.check('the service role''s update is recorded with changed_by null',
  exists (select 1 from punch_record_history where punch_id = :p1 and action = 'update' and changed_by is null));

-- Deleting an employee still removes their punches, and records it.
select pg_temp.punch(:e2, 'clock_in', '30 minutes') as p4 \gset
select pg_temp.run('a manager deletes an employee who has punches', :ann,
  $q$delete from employees where name = 'e2'$q$, false);
select pg_temp.check('the cascade is recorded',
  not exists (select 1 from punch_records where id = :p4)
  and exists (select 1 from punch_record_history where punch_id = :p4 and action = 'delete' and changed_by = :ann));

-- Who sees what.
select pg_temp.check('a manager sees all of their organization''s history',
  pg_temp.visible(:ann) = (select count(*) from punch_record_history) and pg_temp.visible(:ann) >= 6);
select pg_temp.check('an employee sees the history of their own punches only',
  pg_temp.visible(:e1) = (select count(*) from punch_record_history
                           where employee_id = (select id from employees where user_id = :e1))
  and pg_temp.visible(:e1) > 0
  and pg_temp.visible(:e1, format('punch_id = %s', :p2)) = 0);
select pg_temp.check('another organization sees none of it', pg_temp.visible(:ben) = 0);

-- Nobody writes history but the trigger.
select pg_temp.run('an employee cannot add history', :e1,
  format($q$insert into punch_record_history (org_id, punch_id, employee_id, action) values (%L, 1, 1, 'insert')$q$,
         (select id from organizations where slug = 'alder')), true);
select pg_temp.run('a manager cannot rewrite history', :ann,
  $q$update punch_record_history set reason = 'nothing to see'$q$, true);
select pg_temp.run('a manager cannot delete history', :ann,
  $q$delete from punch_record_history$q$, true);
select pg_temp.run('the service role cannot delete history', null,
  $q$delete from punch_record_history$q$, true, 'service_role');

-- The nightly demo wipe isn't recorded.
insert into employees (org_id, name, email) values ('00000000-0000-0000-0000-000000000002', 'demo', 'demo@demo.test');
insert into punch_records (org_id, employee_id, punch_type, punched_at)
select org_id, id, 'clock_in', now() - interval '1 hour' from employees where email = 'demo@demo.test';
delete from punch_records where org_id = '00000000-0000-0000-0000-000000000002';
select pg_temp.check('the service role''s demo reset leaves no history',
  not exists (select 1 from punch_record_history where org_id = '00000000-0000-0000-0000-000000000002'));

-- Deleting an organization takes its history with it.
select org_delete((select id from organizations where slug = 'alder'));
select pg_temp.check('deleting an organization deletes its history',
  not exists (select 1 from punch_record_history));

rollback;
