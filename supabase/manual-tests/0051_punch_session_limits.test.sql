-- Tests for 0051_punch_session_limits.sql. Run against a throwaway Postgres
-- database:
--
--   createdb session_limits_test
--   cd supabase/manual-tests && psql -q -d session_limits_test -f 0051_punch_session_limits.test.sql
--   dropdb session_limits_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 reproduces
-- each gap on the schema before 0051; part 2 applies it (twice) and checks it.

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
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''

-- Runs one statement as a signed-in user; expect_error says whether it should
-- be rejected.
create or replace function pg_temp.run(label text, uid text, stmt text, expect_error boolean)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
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

-- A live punch by e1, as /api/punches (or a direct PostgREST call) makes it.
create or replace function pg_temp.live(kind text) returns text language sql as $$
  select format($q$insert into punch_records (org_id, employee_id, punch_type)
                  select org_id, id, %L from employees where user_id = 'eeeeeeee-0000-0000-0000-000000000001'$q$, kind)
$$;

-- A fresh scenario for e1: the store's clock reads `hour`:MM right now (an
-- Etc/GMT zone picked to make it so; Etc/GMT-N is UTC+N), and e1's punches
-- are `history`, each given as minutes from the store's latest midnight.
create or replace function pg_temp.scenario(hour int, history text[], offsets int[]) returns void
language plpgsql as $$
declare
  o int := hour - extract(hour from now() at time zone 'UTC')::int;
  v_org uuid := (select id from organizations where slug = 'alder');
  v_tz text;
  v_midnight timestamptz;
begin
  if o < -12 then o := o + 24; elsif o > 14 then o := o - 24; end if;
  v_tz := 'Etc/GMT' || case when o > 0 then '-' || o when o < 0 then '+' || -o else '' end;
  insert into app_settings (org_id, key, value) values (v_org, 'timezone', v_tz)
  on conflict (org_id, key) do update set value = excluded.value;
  delete from app_settings where org_id = v_org and key = 'punch_max_breaks_per_shift';
  delete from punch_records where org_id = v_org;
  delete from schedules where org_id = v_org;
  v_midnight := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  for i in 1 .. coalesce(array_length(history, 1), 0) loop
    insert into punch_records (org_id, employee_id, punch_type, punched_at)
    select org_id, id, history[i], v_midnight + make_interval(mins => offsets[i])
      from employees where user_id = 'eeeeeeee-0000-0000-0000-000000000001';
  end loop;
end $$;

create or replace function pg_temp.max_breaks(n int) returns void language sql as $$
  insert into app_settings (org_id, key, value)
  select id, 'punch_max_breaks_per_shift', n::text from organizations where slug = 'alder'
  on conflict (org_id, key) do update set value = excluded.value
$$;

-- Every check, run before 0051 (`fixed` false) and after it.
create or replace function pg_temp.checks(fixed boolean) returns void language plpgsql as $$
declare
  pre text := case when fixed then '' else 'before 0051: ' end;
begin
  -- Closer: clocked in 8:00 PM, break 11:30 PM – 12:15 AM, never clocked out.
  -- At noon the next day that shift is a forgotten clock-out.
  perform pg_temp.scenario(12, array['clock_in', 'break_start', 'break_end'], array[-240, -30, 15]);
  perform pg_temp.run(pre || 'a clock-in the next day after a forgotten shift with a break past midnight '
                      || case when fixed then 'is allowed' else 'was refused' end,
                      'eeeeeeee-0000-0000-0000-000000000001', pg_temp.live('clock_in'), not fixed);

  -- An abandoned shift from 4:00 PM yesterday (20 hours ago) can't be continued.
  perform pg_temp.scenario(12, array['clock_in'], array[-480]);
  perform pg_temp.run(pre || 'a clock-out on a shift abandoned 20 hours ago '
                      || case when fixed then 'is refused' else 'got through' end,
                      'eeeeeeee-0000-0000-0000-000000000001', pg_temp.live('clock_out'), fixed);
  perform pg_temp.scenario(12, array['clock_in'], array[-480]);
  perform pg_temp.run(pre || 'a break on a shift abandoned 20 hours ago '
                      || case when fixed then 'is refused' else 'got through' end,
                      'eeeeeeee-0000-0000-0000-000000000001', pg_temp.live('break_start'), fixed);

  -- The break cap.
  perform pg_temp.scenario(12, array['clock_in', 'break_start', 'break_end'], array[540, 600, 615]);
  perform pg_temp.max_breaks(1);
  perform pg_temp.run(pre || 'a second break over a cap of one '
                      || case when fixed then 'is refused' else 'got through' end,
                      'eeeeeeee-0000-0000-0000-000000000001', pg_temp.live('break_start'), fixed);

  -- 2:00 AM: a closer who clocked in at 9:00 PM is still on their shift.
  perform pg_temp.scenario(2, array['clock_in'], array[-180]);
  perform pg_temp.run(pre || 'a second clock-in at 2:00 AM over a shift from 9:00 PM '
                      || case when fixed then 'is refused' else 'got through' end,
                      'eeeeeeee-0000-0000-0000-000000000001', pg_temp.live('clock_in'), fixed);

  -- A request to fix a punch from 40 days ago, inserted directly.
  perform pg_temp.run(pre || 'a correction request for 40 days ago '
                      || case when fixed then 'is refused' else 'got through' end,
                      'eeeeeeee-0000-0000-0000-000000000001',
    $q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note)
       select org_id, id, 'clock_out', now() - interval '40 days', 'Forgot'
         from employees where user_id = 'eeeeeeee-0000-0000-0000-000000000001'$q$, fixed);
end $$;

begin;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
\set alder '(select id from organizations where slug = ''alder'')'
insert into employees (org_id, name, email, user_id) values (:alder, 'e1', 'e1@alder.test', :e1::uuid);

-- Part 1: before 0051.
select pg_temp.checks(false);

-- Part 2: 0051.
\set ON_ERROR_STOP on
\ir ../migrations/0051_punch_session_limits.sql
\ir ../migrations/0051_punch_session_limits.sql
\unset ON_ERROR_STOP

select pg_temp.checks(true);

-- What still works.
select pg_temp.scenario(2, array['clock_in', 'break_start', 'break_end'], array[-180, -30, 15]);
select pg_temp.run('a closer clocks out at 2:00 AM after a break past midnight', :e1, pg_temp.live('clock_out'), false);

select pg_temp.scenario(2, array['clock_in'], array[-180]);
select pg_temp.run('a closer takes a break at 2:00 AM', :e1, pg_temp.live('break_start'), false);

select pg_temp.scenario(2, array['clock_in'], array[-1320]);
select pg_temp.run('a clock-in at 2:00 AM over a shift begun 22 hours ago is allowed', :e1, pg_temp.live('clock_in'), false);

select pg_temp.scenario(5, array['clock_in'], array[-240]);
insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
select org_id, id, (now() at time zone public.store_timezone(org_id))::date - 1, 1200, 1800
  from employees where user_id = :e1::uuid;
select pg_temp.run('a scheduled overnight worker clocks out at 5:00 AM (within overnight grace)', :e1, pg_temp.live('clock_out'), false);

select pg_temp.scenario(12, array['clock_in'], array[-240]);
select pg_temp.run('a clock-in the next day after a forgotten shift is allowed', :e1, pg_temp.live('clock_in'), false);

select pg_temp.scenario(12, array['clock_in', 'clock_out'], array[480, 600]);
select pg_temp.run('a second shift the same day is allowed', :e1, pg_temp.live('clock_in'), false);

select pg_temp.scenario(12, array['clock_in'], array[480]);
select pg_temp.run('a second clock-in in the same shift is still refused', :e1, pg_temp.live('clock_in'), true);
select pg_temp.run('a break during today''s shift', :e1, pg_temp.live('break_start'), false);
select pg_temp.run('ending it', :e1, pg_temp.live('break_end'), false);
select pg_temp.run('another break with no cap set', :e1, pg_temp.live('break_start'), false);

select pg_temp.scenario(12, array['clock_in', 'break_start', 'break_end'], array[540, 600, 615]);
select pg_temp.max_breaks(2);
select pg_temp.run('a second break under a cap of two', :e1, pg_temp.live('break_start'), false);

select pg_temp.scenario(12, array[]::text[], array[]::int[]);
select pg_temp.run('a first clock-in ever', :e1, pg_temp.live('clock_in'), false);
select pg_temp.scenario(12, array[]::text[], array[]::int[]);
select pg_temp.run('a clock-out with no clock-in is refused', :e1, pg_temp.live('clock_out'), true);

select pg_temp.scenario(12, array['clock_in'], array[-480]);
select pg_temp.run('a manager can still close an abandoned shift by hand', :ann,
  $q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
     select org_id, id, 'clock_out', now() - interval '12 hours', true, 'fix' from employees where name = 'e1'$q$, false);

select pg_temp.run('a correction request for 10 days ago is accepted', :e1,
  $q$insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note)
     select org_id, id, 'clock_out', now() - interval '10 days', 'Forgot' from employees where name = 'e1'$q$, false);

rollback;
