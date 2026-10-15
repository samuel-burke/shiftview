-- Tests for 0047_store_timezone.sql. Run against a throwaway Postgres database:
--
--   createdb store_tz_test
--   cd supabase/manual-tests && psql -q -d store_tz_test -f 0047_store_timezone.test.sql
--   dropdb store_tz_test
--
-- Any line containing FAIL (or any ERROR) is a regression. Part 1 reproduces
-- the gap on the schema before 0047; part 2 applies it (twice) and checks it.

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
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set e1   '''eeeeeeee-0000-0000-0000-000000000001'''
\set e2   '''eeeeeeee-0000-0000-0000-000000000002'''
\set e3   '''eeeeeeee-0000-0000-0000-000000000003'''

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

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- A live clock-in by `uid`, as /api/punches (or a direct PostgREST call) makes it.
create or replace function pg_temp.clock_in(uid text) returns text language sql as $$
  select format($q$insert into punch_records (org_id, employee_id, punch_type)
                  select org_id, id, 'clock_in' from employees where user_id = %L$q$, uid)
$$;

-- A punch for `uid`'s employee at a given time, written as the service role
-- does (seeding, history) so it keeps that time.
create or replace function pg_temp.punch_at(uid text, kind text, at timestamptz) returns void language sql as $$
  insert into punch_records (org_id, employee_id, punch_type, punched_at)
  select org_id, id, kind, at from employees where user_id = uid::uuid
$$;

-- The scenario: a store one hour east of New York (Etc/GMT+3 or +2, against
-- EST/EDT), saved in lower case as the settings API accepts it. Its last punch
-- is a clock-in a minute before New York's latest midnight: yesterday in New
-- York, but already today in the store. A second clock-in now is a second
-- clock-in in the same store day, which the API refuses.
--   ny_off: New York's current UTC offset in hours (-5 or -4)
--   last_at: one minute before New York's latest midnight
--   usable: false in New York's last hour of the day, when the store (an hour
--           ahead) has already rolled over too.
create temp table scenario as
select ny_off, ny_mid - interval '1 minute' as last_at,
       format('etc/gmt+%s', -(ny_off + 1)) as store_tz_lower,
       now() - ny_mid < interval '23 hours' as usable
  from (select (extract(epoch from (now() at time zone 'America/New_York') - (now() at time zone 'UTC')) / 3600)::int as ny_off,
               (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York') as ny_mid) s;
grant select on scenario to authenticated;

begin;

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:e1, 'e1@alder.test', now()),
  (:e2, 'e2@alder.test', now()), (:e3, 'e3@alder.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann', 'ann@alder.test');
select org_signup_create('Birch Road', 'birch', :e3, 'Cy', 'e3@alder.test');
\set alder '(select id from organizations where slug = ''alder'')'
\set birch '(select id from organizations where slug = ''birch'')'
insert into employees (org_id, name, email, user_id)
select :alder, n, n || '@alder.test', u::uuid
  from (values ('e1', :e1), ('e2', :e2)) v(n, u);

insert into app_settings (org_id, key, value)
select :alder, 'timezone', store_tz_lower from scenario
on conflict (org_id, key) do update set value = excluded.value;
-- An unusable value already stored for another org (written before 0047).
insert into app_settings (org_id, key, value) values (:birch, 'timezone', 'XYZ-3')
on conflict (org_id, key) do update set value = excluded.value;

-- Part 1: before 0047, the lower-case name made the trigger judge the store
-- day in New York, so the second clock-in got through.
select pg_temp.punch_at(:e1, 'clock_in', (select last_at from scenario));
select case when (select usable from scenario)
  then pg_temp.run('before 0047: a second clock-in in the same store day got through (lower-case timezone)',
                   :e1, pg_temp.clock_in(:e1), false)
  else pg_temp.check('before 0047: skipped in New York''s last hour of the day', true) end;

-- Part 2: 0047.
\set ON_ERROR_STOP on
\ir ../migrations/0047_store_timezone.sql
\ir ../migrations/0047_store_timezone.sql
\unset ON_ERROR_STOP

select pg_temp.check('a stored lower-case timezone is normalised',
  (select value from app_settings where org_id = :alder and key = 'timezone')
    = (select format('Etc/GMT+%s', -(ny_off + 1)) from scenario));
select pg_temp.check('a stored unusable timezone becomes the app''s default',
  (select value from app_settings where org_id = :birch and key = 'timezone') = 'America/New_York');
select pg_temp.check('store_timezone() reads the org''s zone',
  public.store_timezone(:alder) = (select format('Etc/GMT+%s', -(ny_off + 1)) from scenario));
select pg_temp.check('store_timezone() defaults to America/New_York with no setting',
  public.store_timezone('00000000-0000-0000-0000-000000000000') = 'America/New_York');

select pg_temp.punch_at(:e2, 'clock_in', (select last_at from scenario));
select case when (select usable from scenario)
  then pg_temp.run('a second clock-in in the same store day is refused (lower-case timezone)',
                   :e2, pg_temp.clock_in(:e2), true)
  else pg_temp.check('skipped in New York''s last hour of the day', true) end;

-- Writing the setting.
select pg_temp.run('a manager saves a timezone in any capitalisation', :ann,
  format($q$update app_settings set value = 'ASIA/TOKYO' where org_id = %L and key = 'timezone'$q$,
         (select id from organizations where slug = 'alder')), false);
select pg_temp.check('… and it is stored canonically',
  (select value from app_settings where org_id = :alder and key = 'timezone') = 'Asia/Tokyo');
select pg_temp.run('an unknown zone is refused', :ann,
  format($q$update app_settings set value = 'Not/AZone' where org_id = %L and key = 'timezone'$q$,
         (select id from organizations where slug = 'alder')), true);
select pg_temp.run('a POSIX rule string (accepted by AT TIME ZONE, not by the app) is refused', :ann,
  format($q$update app_settings set value = 'XYZ-3' where org_id = %L and key = 'timezone'$q$,
         (select id from organizations where slug = 'alder')), true);
select pg_temp.run('Factory (in pg_timezone_names, not a real zone) is refused', :ann,
  format($q$update app_settings set value = 'Factory' where org_id = %L and key = 'timezone'$q$,
         (select id from organizations where slug = 'alder')), true);
select pg_temp.run('other settings are untouched by the check', :ann,
  format($q$insert into app_settings (org_id, key, value) values (%L, 'first_day_of_week', 'Not/AZone')
            on conflict (org_id, key) do update set value = excluded.value$q$,
         (select id from organizations where slug = 'alder')), false);
do $$
begin
  update app_settings set value = 'Nowhere/Land'
   where org_id = (select id from organizations where slug = 'alder') and key = 'timezone';
  raise notice 'FAIL  the service role is held to the same rule (no error raised)';
exception when others then
  raise notice 'PASS  the service role is held to the same rule (rejected: %)', sqlerrm;
end $$;

-- store_timezone() reads any org's settings, so users can't call it directly.
select pg_temp.run('a signed-in user cannot call store_timezone() for another org', :e1,
  format($q$select public.store_timezone(%L)$q$, (select id from organizations where slug = 'birch')), true);

-- Unchanged behaviour from 0046.
delete from punch_records where employee_id = (select id from employees where user_id = :e2);
select pg_temp.run('a first clock-in still works', :e2, pg_temp.clock_in(:e2), false);
select pg_temp.run('a second clock-in minutes later is still refused', :e2, pg_temp.clock_in(:e2), true);
select pg_temp.run('managers still record punches directly', :ann,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
            select org_id, id, 'clock_out', now() - interval '1 minute', true, 'fix' from employees where user_id = %L$q$, :e1), false);

rollback;
