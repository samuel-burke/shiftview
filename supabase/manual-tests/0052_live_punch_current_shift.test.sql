-- Direct authenticated inserts must obey the same current-shift window as
-- lib/punch-sessions.ts and lib/current-shift-server.ts. Disposable database:
--   scripts/test-sql.sh 0052
-- Every attempted live punch is rolled back; PASS/FAIL includes SQLSTATE.
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
\ir ../migrations/0052_live_punch_current_shift.sql
\ir ../migrations/0052_live_punch_current_shift.sql

begin;
insert into auth.users (id, email, email_confirmed_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ann@alder.test', now()),
  ('eeeeeeee-0000-0000-0000-000000000001', 'e1@alder.test', now());
select org_signup_create('Alder Street', 'alder', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ann', 'ann@alder.test');
insert into employees (org_id, name, user_id)
select id, 'e1', 'eeeeeeee-0000-0000-0000-000000000001' from organizations where slug = 'alder';

-- Replace only the trigger's clock read in this transaction so exact cutoff,
-- age and DST boundaries are reproducible. Every other line is production SQL.
do $$
declare definition text := pg_get_functiondef('public.enforce_punch_integrity()'::regprocedure);
begin
  if position('v_now := clock_timestamp();' in definition) = 0 then
    raise exception 'Expected trigger clock read is missing';
  end if;
  execute replace(definition, 'v_now := clock_timestamp();',
    'v_now := current_setting(''test.punch_now'')::timestamptz;');
end $$;

create function pg_temp.scenario(p_now timestamptz, p_in timestamptz, p_end int default null,
                                 p_tz text default 'America/New_York') returns void language plpgsql as $$
declare o uuid := (select id from organizations where slug = 'alder');
begin
  perform set_config('test.punch_now', p_now::text, true);
  delete from punch_records where org_id = o;
  delete from schedules where org_id = o;
  insert into app_settings (org_id, key, value) values (o, 'timezone', p_tz)
    on conflict (org_id, key) do update set value = excluded.value;
  if p_in is not null then
    insert into punch_records (org_id, employee_id, punch_type, punched_at)
      select org_id, id, 'clock_in', p_in from employees where name = 'e1';
  end if;
  if p_end is not null then
    insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
      select org_id, id, (p_now at time zone p_tz)::date - 1, 1320, p_end
        from employees where name = 'e1';
  end if;
end $$;

create function pg_temp.try_punch(kind text) returns text language plpgsql as $$
declare stamped timestamptz;
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);
  set local role authenticated;
  -- An attempted backdate cannot change eligibility or the accepted timestamp.
  insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual)
    select org_id, id, kind, '2020-01-01Z', false from employees where name = 'e1'
    returning punched_at into stamped;
  raise exception using errcode = 'P0123', message = case
    when stamped = current_setting('test.punch_now')::timestamptz then 'ok'
    else 'incorrect server stamp' end;
exception when others then
  if sqlstate = 'P0123' then return sqlerrm; end if;
  return sqlstate;
end $$;

create function pg_temp.expect(label text, kind text, want text) returns void language plpgsql as $$
declare got text := pg_temp.try_punch(kind);
begin
  if got = want then raise notice 'PASS  % (%)', label, got;
  else raise notice 'FAIL  % (got %, want %)', label, got, want; end if;
end $$;

-- A closer's abandoned shift is younger than 18 hours. This was exploitable.
select pg_temp.scenario('2026-01-16 12:00-05', '2026-01-15 20:00-05');
select pg_temp.expect('abandoned closer cannot clock out directly', 'clock_out', '23P01');
select pg_temp.expect('abandoned closer cannot start a break', 'break_start', '23P01');
select pg_temp.expect('abandoned closer may start a new shift', 'clock_in', 'ok');

-- A break after midnight must not restart the window or its age limit.
insert into punch_records (org_id, employee_id, punch_type, punched_at)
  select org_id, id, 'break_start', '2026-01-15 23:30-05' from employees where name = 'e1';
select pg_temp.expect('abandoned closer cannot end an unfinished break', 'break_end', '23P01');
insert into punch_records (org_id, employee_id, punch_type, punched_at)
  select org_id, id, 'break_end', '2026-01-16 00:15-05' from employees where name = 'e1';
select pg_temp.expect('break after midnight cannot extend an abandoned shift', 'clock_out', '23P01');

select pg_temp.scenario('2026-01-16 03:59:59.999-05', '2026-01-15 20:00-05');
select pg_temp.expect('closer may clock out just before 4 AM', 'clock_out', 'ok');
select pg_temp.expect('closer cannot clock in twice before cutoff', 'clock_in', '23P01');
select set_config('test.punch_now', '2026-01-16 04:00-05', true);
select pg_temp.expect('4 AM cutoff is exclusive', 'clock_out', '23P01');

select pg_temp.scenario('2026-01-16 01:00-05', '2026-01-15 09:00-05');
select pg_temp.expect('unscheduled 16 hour boundary is inclusive', 'clock_out', 'ok');
select set_config('test.punch_now', '2026-01-16 01:00:00.001-05', true);
select pg_temp.expect('unscheduled shift expires after 16 hours even before 4 AM', 'clock_out', '23P01');

select pg_temp.scenario('2026-01-16 05:00-05', '2026-01-15 22:00-05', 1800);
select pg_temp.expect('scheduled overnight may clock out after 4 AM without schedule_id', 'clock_out', 'ok');
select pg_temp.expect('scheduled overnight may take a break', 'break_start', 'ok');
select pg_temp.expect('scheduled overnight cannot clock in again while current', 'clock_in', '23P01');
select set_config('test.punch_now', '2026-01-16 08:00-05', true);
select pg_temp.expect('two hour scheduled grace boundary is inclusive', 'clock_out', 'ok');
select set_config('test.punch_now', '2026-01-16 08:00:00.001-05', true);
select pg_temp.expect('scheduled shift expires immediately after its grace', 'clock_out', '23P01');

-- An unrelated employee's schedule cannot authorize a continuation.
select pg_temp.scenario('2026-01-16 05:00-05', '2026-01-15 22:00-05', 1800);
update schedules set employee_id = (select id from employees where name = 'Ann');
select pg_temp.expect('coworker overnight schedule gives no grace', 'clock_out', '23P01');

-- Same org and employee, but the wrong schedule day, also gives no grace.
select pg_temp.scenario('2026-01-16 05:00-05', '2026-01-15 22:00-05', 1800);
update schedules set date = date + 1;
select pg_temp.expect('today overnight schedule gives no grace to yesterday shift', 'clock_out', '23P01');

select pg_temp.scenario('2026-01-16 07:00-05', '2026-01-15 13:00-05', 1800);
select pg_temp.expect('scheduled 18 hour boundary is inclusive', 'clock_out', 'ok');
select set_config('test.punch_now', '2026-01-16 07:00:00.001-05', true);
select pg_temp.expect('scheduled age cap applies even during grace', 'clock_out', '23P01');

select pg_temp.scenario('2026-01-16 01:00-05', '2026-01-14 23:00-05', 1800);
select pg_temp.expect('older calendar day cannot be revived by yesterday schedule', 'clock_out', '23P01');
select pg_temp.scenario('2026-01-16 23:00-05', '2026-01-16 01:00-05');
select pg_temp.expect('same store day follows existing application behavior', 'clock_out', 'ok');
select pg_temp.scenario('2026-01-16 12:00-05', null);
select pg_temp.expect('orphan clock-out is rejected', 'clock_out', '23P01');

-- Latest overnight end wins, regardless of the incoming schedule label.
select pg_temp.scenario('2026-01-16 08:30-05', '2026-01-15 22:00-05', 1800);
insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
  select org_id, employee_id, date, start_minutes, 1860 from schedules;
select pg_temp.expect('latest of multiple overnight ends supplies grace', 'clock_out', 'ok');

-- Store-local midnight, not the database session date, determines eligibility.
select pg_temp.scenario('2026-01-16 04:00+09', '2026-01-15 22:00+09', null, 'Asia/Tokyo');
select pg_temp.expect('cutoff uses the store timezone east of UTC', 'clock_out', '23P01');

-- On fall-back day, 2:30 AM is ambiguous in Berlin. The app uses the FIRST
-- occurrence (00:30 UTC); its two real hours of grace end at 02:30 UTC.
-- The 17-hour-old clock-in needs scheduled grace even before 4 AM.
select pg_temp.scenario('2026-10-25 02:30Z', '2026-10-24 11:30+02', 1590, 'Europe/Berlin');
select pg_temp.expect('fall-back scheduled grace includes its exact end', 'clock_out', 'ok');
select set_config('test.punch_now', '2026-10-25 02:30:00.001Z', true);
select pg_temp.expect('fall-back second occurrence must not extend scheduled grace', 'clock_out', '23P01');
-- Spring-forward skips 2:30 AM: the app shifts the end forward to 3:30 AM
-- (01:30 UTC); its grace ends at 03:30 UTC.
select pg_temp.scenario('2026-03-29 03:30Z', '2026-03-28 20:00+01', 1590, 'Europe/Berlin');
select pg_temp.expect('spring-forward skipped end shifts forward', 'clock_out', 'ok');
select set_config('test.punch_now', '2026-03-29 03:30:00.001Z', true);
select pg_temp.expect('spring-forward scheduled grace expires', 'clock_out', '23P01');

rollback;
