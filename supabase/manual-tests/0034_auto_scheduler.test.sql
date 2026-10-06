-- Behavioural tests for supabase/migrations/0034_auto_scheduler.sql.
--
-- Self-contained: builds a minimal stand-in schema, applies the migration,
-- then runs each case as a non-superuser role so row-level security applies,
-- printing PASS/FAIL notices. Run against a throwaway Postgres database:
--
--   createdb auto_scheduler_test
--   cd supabase/manual-tests && psql -q -d auto_scheduler_test -f 0034_auto_scheduler.test.sql
--   dropdb auto_scheduler_test
--
-- Any line containing FAIL is a regression.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- Supabase's API roles, which the migration's grants name.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create table public.organizations (id uuid primary key, is_demo boolean not null default false);
create table public.employees (
  id bigint primary key,
  org_id uuid not null references public.organizations (id),
  user_id uuid,
  name text,
  unique (id, org_id)
);
create table public.managers (user_id uuid not null, org_id uuid not null references public.organizations (id));
create table public.draft_schedules (
  id            bigint generated always as identity primary key,
  org_id        uuid   not null references public.organizations (id),
  employee_id   bigint not null,
  date          date   not null,
  start_minutes int    not null,
  end_minutes   int    not null,
  constraint draft_schedules_org_employee_date_unique unique (org_id, employee_id, date),
  foreign key (employee_id, org_id) references public.employees (id, org_id),
  constraint draft_schedules_shift_times check (
    start_minutes >= 0 and start_minutes < 1440
    and end_minutes > start_minutes and end_minutes - start_minutes <= 960)
);

-- The other tables reset_demo_org() and org_delete() touch, with production's
-- non-cascading org foreign keys.
do $$
declare t text;
begin
  foreach t in array array[
    'punch_records', 'shift_swaps', 'schedule_template_rows', 'schedule_templates', 'schedules',
    'availability', 'time_off_requests', 'messages', 'notifications', 'audit_logs',
    'coverage_profile_blocks', 'coverage_date_overrides', 'coverage_day_defaults', 'coverage_profiles',
    'store_hours', 'app_settings', 'positions', 'announcements', 'open_shifts'
  ] loop
    execute format(
      'create table public.%I (id bigint generated always as identity primary key, org_id uuid not null references public.organizations (id))', t);
  end loop;
end $$;
create table public.callouts (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id),
  employee_id bigint not null,
  foreign key (employee_id, org_id) references public.employees (id, org_id)
);
create table public.open_shift_claims (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id),
  open_shift_id bigint not null references public.open_shifts (id) on delete cascade,
  employee_id bigint not null,
  foreign key (employee_id, org_id) references public.employees (id, org_id)
);
create table public.punch_corrections (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id bigint not null,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);

create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.managers where user_id = auth.uid() and org_id = p_org);
$$;
create or replace function public.is_own_employee(p_org uuid, p_employee bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where id = p_employee and org_id = p_org and user_id = auth.uid());
$$;

insert into organizations values
  ('00000000-0000-0000-0000-00000000000a', false),
  ('00000000-0000-0000-0000-00000000000b', false),
  ('00000000-0000-0000-0000-00000000000d', true);
insert into employees values
  (1,  '00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Alice'),
  (2,  '00000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Bob'),
  (3,  '00000000-0000-0000-0000-00000000000a', null,                                   'Carol'),
  (20, '00000000-0000-0000-0000-00000000000b', null,                                   'Dana'),
  (30, '00000000-0000-0000-0000-00000000000d', null,                                   'Demo Dee');
insert into managers values
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000a'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000b');

\ir ../migrations/0034_auto_scheduler.sql

-- An app-like role: RLS applies to it (superusers bypass RLS).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then create role app_user; end if;
end $$;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
-- Signed-in API requests run as Supabase's authenticated role.
grant authenticated to app_user;

create or replace function pg_temp.run(label text, uid text, stmt text, expect_error boolean) returns void language plpgsql as $$
declare n int;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute 'set local role app_user';
  execute stmt;
  get diagnostics n = row_count;
  execute 'reset role';
  if expect_error then
    raise notice 'FAIL  % (no error raised, % rows)', label, n;
  else
    raise notice 'PASS  %', label;
  end if;
exception when others then
  execute 'reset role';
  if expect_error then raise notice 'PASS  % (rejected: %)', label, sqlerrm;
  else raise notice 'FAIL  % (unexpected error: %)', label, sqlerrm; end if;
end $$;

-- Runs a statement returning one jsonb value as the given user.
create or replace function pg_temp.call(uid text, stmt text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute 'set local role app_user';
  execute stmt into result;
  execute 'reset role';
  return result;
exception when others then
  execute 'reset role';
  return jsonb_build_object('status', 'error', 'error', sqlerrm);
end $$;

-- Counts rows visible to the given user.
create or replace function pg_temp.visible(uid text, stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute 'set local role app_user';
  execute stmt into n;
  execute 'reset role';
  return n;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- The week's drafts in the shape apply_generated_drafts() expects as p_expected.
create or replace function pg_temp.expected(p_org uuid, p_week date) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(id, employee_id, date, start_minutes, end_minutes) order by id), '[]'::jsonb)
    from public.draft_schedules where org_id = p_org and date between p_week and p_week + 6;
$$;

\set alice '''11111111-1111-1111-1111-111111111111'''
\set bob   '''22222222-2222-2222-2222-222222222222'''
\set mia   '''33333333-3333-3333-3333-333333333333'''
\set orgA  '''00000000-0000-0000-0000-00000000000a'''
\set orgB  '''00000000-0000-0000-0000-00000000000b'''
\set demo  '''00000000-0000-0000-0000-00000000000d'''
\set week  '''2026-10-12'''

begin;

-- ---------------------------------------------------------------------------
-- Employee limits
-- ---------------------------------------------------------------------------
select pg_temp.run('employment type accepts full_time', :mia,
  $q$update employees set employment_type = 'full_time' where id = 1$q$, false);
select pg_temp.run('employment type rejects other values', :mia,
  $q$update employees set employment_type = 'contractor' where id = 1$q$, true);
select pg_temp.run('weekly hours accept a 30–37.5 h range', :mia,
  $q$update employees set min_weekly_hours = 30, max_weekly_hours = 37.5 where id = 1$q$, false);
select pg_temp.run('min weekly hours cannot exceed max', :mia,
  $q$update employees set min_weekly_hours = 38 where id = 1$q$, true);
select pg_temp.run('weekly hours are capped at 80', :mia,
  $q$update employees set max_weekly_hours = 81 where id = 2$q$, true);
select pg_temp.run('max days per week must be 1–7', :mia,
  $q$update employees set max_days_per_week = 0 where id = 2$q$, true);

-- ---------------------------------------------------------------------------
-- Preferences: only the employee themself and managers.
-- ---------------------------------------------------------------------------
select pg_temp.run('employee can save their own preferences', :alice,
  format($q$insert into employee_preferences (org_id, employee_id, preferred_shift_types, preferred_days, avoid_days, desired_weekly_hours)
            values (%L, 1, '{opener}', '{1,2}', '{0}', 24)$q$, :orgA), false);
select pg_temp.run('employee cannot save a coworker''s preferences', :alice,
  format($q$insert into employee_preferences (org_id, employee_id) values (%L, 2)$q$, :orgA), true);
select pg_temp.run('manager can save anyone''s preferences', :mia,
  format($q$insert into employee_preferences (org_id, employee_id, preferred_shift_types) values (%L, 2, '{closer}')$q$, :orgA), false);
select pg_temp.check('a coworker cannot read alice''s preferences',
  pg_temp.visible(:bob, 'select count(*) from employee_preferences where employee_id = 1') = 0);
select pg_temp.check('alice reads her own preferences',
  pg_temp.visible(:alice, 'select count(*) from employee_preferences') = 1);
select pg_temp.check('the manager reads everyone''s preferences',
  pg_temp.visible(:mia, 'select count(*) from employee_preferences') = 2);
select pg_temp.run('unknown shift types are rejected', :alice,
  $q$update employee_preferences set preferred_shift_types = '{overnight}' where employee_id = 1$q$, true);
select pg_temp.run('days must be 0–6', :alice,
  $q$update employee_preferences set preferred_days = '{7}' where employee_id = 1$q$, true);
select pg_temp.run('a day cannot be both preferred and avoided', :alice,
  $q$update employee_preferences set avoid_days = '{1}' where employee_id = 1$q$, true);

-- ---------------------------------------------------------------------------
-- apply_generated_drafts()
-- ---------------------------------------------------------------------------
select pg_temp.check('signed-out (anon) callers cannot execute either function',
  not has_function_privilege('anon',
    'public.apply_generated_drafts(uuid, date, text, bigint, jsonb, jsonb, bigint, jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.undo_generation_run(uuid, bigint)', 'execute'));

-- A manager-made draft that "fill" must keep.
insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes)
values (:orgA, 3, '2026-10-12', 540, 1020);

select pg_temp.check('a non-manager is forbidden',
  pg_temp.call(:alice, format($q$select apply_generated_drafts(%L, %L, 'fill', null, %L, '[]', 1, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week)))->>'status' = 'forbidden');
select pg_temp.check('a manager of another org is forbidden',
  pg_temp.call('44444444-4444-4444-4444-444444444444', format($q$select apply_generated_drafts(%L, %L, 'fill', null, %L, '[]', 1, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week)))->>'status' = 'forbidden');
select pg_temp.check('an unknown mode is invalid',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'merge', null, %L, '[]', 1, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week)))->>'status' = 'invalid');
select pg_temp.check('rows outside the week are invalid',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', null, %L,
    '[{"employee_id":1,"date":"2026-10-19","start_minutes":540,"end_minutes":1020}]', 1, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week)))->>'status' = 'invalid');
select pg_temp.check('drafts changed since the generator read them is a conflict',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', null, '[]',
    '[{"employee_id":1,"date":"2026-10-13","start_minutes":540,"end_minutes":1020}]', 1, '{}', '[]', '{}')$q$,
    :orgA, :week))->>'status' = 'conflict');
select pg_temp.check('…and nothing was written', (select count(*) = 0 from schedule_generation_runs)
  and (select count(*) = 1 from draft_schedules));
select pg_temp.check('a generated row on a kept draft''s employee-day is a conflict',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', null, %L,
    '[{"employee_id":1,"date":"2026-10-13","start_minutes":540,"end_minutes":1020},
      {"employee_id":3,"date":"2026-10-12","start_minutes":600,"end_minutes":900}]', 1, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week)))->>'status' = 'conflict');
select pg_temp.check('…and the partial write was rolled back',
  (select count(*) = 0 from schedule_generation_runs) and (select count(*) = 1 from draft_schedules));
select pg_temp.check('a shift that breaks the shift-time rules is invalid',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', null, %L,
    '[{"employee_id":1,"date":"2026-10-13","start_minutes":900,"end_minutes":600}]', 1, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week)))->>'status' = 'invalid');

-- Fill: run 1 adds two shifts and keeps carol's draft.
select pg_temp.check('fill adds the generated drafts',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', null, %L,
    '[{"employee_id":1,"date":"2026-10-13","start_minutes":540,"end_minutes":1020},
      {"employee_id":2,"date":"2026-10-14","start_minutes":1320,"end_minutes":1800}]', 7, '{"overtimePolicy":"never"}', '[]', '{"coverageScore":91}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week))) @> '{"status":"ok","inserted":2,"removed":0}');
select pg_temp.check('…keeps the manager''s own draft', (select count(*) = 1 from draft_schedules where employee_id = 3 and generation_run_id is null));
select pg_temp.check('…tags the new drafts with the run', (select count(*) = 2 from draft_schedules where generation_run_id is not null));
select pg_temp.check('…records the run with its seed, rules and metrics', (
  select count(*) = 1 from schedule_generation_runs
   where mode = 'fill' and seed = 7 and rules->>'overtimePolicy' = 'never'
     and (metrics->>'coverageScore')::int = 91 and created_by = :mia and previous_drafts = '[]'::jsonb));
select pg_temp.run('managers cannot write runs directly', :mia,
  format($q$insert into schedule_generation_runs (org_id, week_start, mode, seed) values (%L, '2026-10-12', 'fill', 1)$q$, :orgA), true);
select pg_temp.check('employees cannot read runs', pg_temp.visible(:alice, 'select count(*) from schedule_generation_runs') = 0);
select pg_temp.check('managers can read runs', pg_temp.visible(:mia, 'select count(*) from schedule_generation_runs') = 1);

-- Try another version of run 1.
select pg_temp.check('another version replaces only the previous run''s drafts',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', (select max(id) from schedule_generation_runs), %L,
    '[{"employee_id":2,"date":"2026-10-13","start_minutes":480,"end_minutes":960}]', 8, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week))) @> '{"status":"ok","inserted":1,"removed":2}');
select pg_temp.check('…marks the replaced run undone',
  (select undone_at is not null from schedule_generation_runs order by id limit 1));
select pg_temp.check('…and keeps the manager''s draft',
  (select count(*) = 2 from draft_schedules) and (select count(*) = 1 from draft_schedules where employee_id = 3));
select pg_temp.check('replacing a run that is no longer the latest is stale',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', (select min(id) from schedule_generation_runs), %L,
    '[]', 9, '{}', '[]', '{}')$q$, :orgA, :week, pg_temp.expected(:orgA, :week)))->>'status' = 'stale');

-- Replace: run 3 wipes the week, saving what it removed.
select pg_temp.check('replace removes the week''s drafts first',
  pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'replace', null, %L,
    '[{"employee_id":3,"date":"2026-10-12","start_minutes":600,"end_minutes":1080},
      {"employee_id":1,"date":"2026-10-15","start_minutes":540,"end_minutes":1020}]', 10, '{}', '[]', '{}')$q$,
    :orgA, :week, pg_temp.expected(:orgA, :week))) @> '{"status":"ok","inserted":2,"removed":2}');
select pg_temp.check('…and saves them on the run for undo', (
  select jsonb_array_length(previous_drafts) = 2
         and previous_drafts @> '[{"employee_id":3,"date":"2026-10-12","start_minutes":540,"end_minutes":1020}]'
    from schedule_generation_runs order by id desc limit 1));

-- ---------------------------------------------------------------------------
-- undo_generation_run()
-- ---------------------------------------------------------------------------
select pg_temp.check('a non-manager cannot undo',
  pg_temp.call(:alice, format($q$select undo_generation_run(%L, (select max(id) from schedule_generation_runs))$q$, :orgA))->>'status' = 'forbidden');
select pg_temp.check('an older run cannot be undone while a newer one is live',
  pg_temp.call(:mia, format($q$select undo_generation_run(%L, (select id from schedule_generation_runs order by id offset 1 limit 1))$q$, :orgA))->>'status' = 'not_latest');
-- Bob gets a hand-made draft on a day the undo would restore for him.
insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes)
values (:orgA, 2, '2026-10-13', 600, 900);
select pg_temp.check('undo removes the run''s drafts and restores the ones it removed',
  pg_temp.call(:mia, format($q$select undo_generation_run(%L, (select max(id) from schedule_generation_runs))$q$, :orgA))
    @> '{"status":"ok","removed":2,"restored":1}');
select pg_temp.check('…restoring carol''s 9–5 draft', (
  select count(*) = 1 from draft_schedules where employee_id = 3 and date = '2026-10-12' and start_minutes = 540));
select pg_temp.check('…and skipping bob''s day, which has a draft again', (
  select count(*) = 1 from draft_schedules where employee_id = 2 and date = '2026-10-13' and start_minutes = 600));
select pg_temp.check('undoing twice is refused',
  pg_temp.call(:mia, format($q$select undo_generation_run(%L, (select max(id) from schedule_generation_runs))$q$, :orgA))->>'status' = 'already_undone');
select pg_temp.check('an unknown run is not found',
  pg_temp.call(:mia, format($q$select undo_generation_run(%L, 999999)$q$, :orgA))->>'status' = 'not_found');

-- A published run cannot be undone.
select pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, %L, 'fill', null, %L,
  '[{"employee_id":1,"date":"2026-10-16","start_minutes":540,"end_minutes":1020}]', 11, '{}', '[]', '{}')$q$,
  :orgA, :week, pg_temp.expected(:orgA, :week)));
select pg_temp.run('managers can mark a week''s runs published', :mia,
  $q$update schedule_generation_runs set published_at = now() where undone_at is null$q$, false);
select pg_temp.check('a published run cannot be undone',
  pg_temp.call(:mia, format($q$select undo_generation_run(%L, (select max(id) from schedule_generation_runs))$q$, :orgA))->>'status' = 'published');

-- Undo skips employees deleted since the run.
update schedule_generation_runs set published_at = null;
select pg_temp.call(:mia, format($q$select apply_generated_drafts(%L, '2026-10-19', 'replace', null, '[]',
  '[{"employee_id":1,"date":"2026-10-20","start_minutes":540,"end_minutes":1020}]', 12, '{}', '[]', '{}')$q$, :orgA));
update schedule_generation_runs
   set previous_drafts = '[{"employee_id":3,"date":"2026-10-21","start_minutes":540,"end_minutes":1020,"generation_run_id":null}]'
 where id = (select max(id) from schedule_generation_runs);
delete from draft_schedules where employee_id = 3;
delete from employees where id = 3;
select pg_temp.check('undo skips drafts of employees deleted since',
  pg_temp.call(:mia, format($q$select undo_generation_run(%L, (select max(id) from schedule_generation_runs))$q$, :orgA))
    @> '{"status":"ok","removed":1,"restored":0}');

-- ---------------------------------------------------------------------------
-- Cascades, demo reset and org deletion
-- ---------------------------------------------------------------------------
delete from draft_schedules where employee_id = 2;
delete from employees where id = 2;
select pg_temp.check('deleting an employee removes their preferences',
  (select count(*) = 0 from employee_preferences where employee_id = 2));

insert into employee_preferences (org_id, employee_id) values (:demo, 30);
select pg_temp.call(null, 'select null::jsonb');
insert into managers values ('55555555-5555-5555-5555-555555555555', :demo);
select pg_temp.call('55555555-5555-5555-5555-555555555555', format($q$select apply_generated_drafts(%L, %L, 'fill', null, '[]',
  '[{"employee_id":30,"date":"2026-10-12","start_minutes":540,"end_minutes":1020}]', 1, '{}', '[]', '{}')$q$, :demo, :week));
select reset_demo_org(:demo);
select pg_temp.check('reset_demo_org() clears preferences, runs and generated drafts', (
  select count(*) = 0 from (
    select 1 from employee_preferences where org_id = :demo
    union all select 1 from schedule_generation_runs where org_id = :demo
    union all select 1 from draft_schedules where org_id = :demo) x));

-- Org B has a row in every table whose org FK doesn't cascade.
insert into positions (org_id) values (:orgB);
insert into announcements (org_id) values (:orgB);
insert into callouts (org_id, employee_id) values (:orgB, 20);
insert into open_shifts (org_id) values (:orgB);
insert into open_shift_claims (org_id, open_shift_id, employee_id)
  select :orgB, id, 20 from open_shifts where org_id = :orgB;
insert into punch_corrections (org_id, employee_id) values (:orgB, 20);
insert into employee_preferences (org_id, employee_id) values (:orgB, 20);
select pg_temp.call('44444444-4444-4444-4444-444444444444', format($q$select apply_generated_drafts(%L, %L, 'fill', null, '[]',
  '[{"employee_id":20,"date":"2026-10-12","start_minutes":540,"end_minutes":1020}]', 1, '{}', '[]', '{}')$q$, :orgB, :week));
do $$
begin
  perform org_delete('00000000-0000-0000-0000-00000000000b');
  raise notice 'PASS  org_delete() succeeds with callouts, open shifts, positions, announcements, corrections, preferences and runs';
exception when others then
  raise notice 'FAIL  org_delete() (unexpected error: %)', sqlerrm;
end $$;
select pg_temp.check('…and the organization is gone',
  (select count(*) = 0 from organizations where id = :orgB));

rollback;
