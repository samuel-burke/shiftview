-- Tests for 0041_database_audit_fixes.sql and 0042_pay_rate_managers_only.sql.
-- Run against a throwaway Postgres database (15 or later):
--
--   createdb audit_fixes_test
--   cd supabase/manual-tests && psql -q -d audit_fixes_test -f 0041_database_audit_fixes.test.sql
--   dropdb audit_fixes_test
--
-- Any line containing FAIL (or any ERROR) is a regression.
--
-- Part 1 proves the policy rewrite changed nothing it shouldn't: it records
-- what every test user can select, insert, update and delete in every public
-- table of two organizations, applies 0041 (twice: it must be repeatable),
-- records again and compares. Only the intended differences are allowed.
-- Part 2 checks each fix. Part 3 applies 0042 and checks pay rates.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../baseline.sql
\ir ../migrations/0038_notify_service_role_only.sql
\ir ../migrations/0039_link_existing_accounts.sql
\ir ../migrations/0040_remove_legacy_demo_job.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set mia  '''aaaaaaaa-0000-0000-0000-000000000002'''
\set cara '''aaaaaaaa-0000-0000-0000-000000000003'''
\set dan  '''aaaaaaaa-0000-0000-0000-000000000004'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set eve  '''bbbbbbbb-0000-0000-0000-000000000002'''
\set zed  '''cccccccc-0000-0000-0000-000000000001'''

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

-- Like try(), but keeps the statement's effects when it succeeds.
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

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: Alder (owner Ann, manager Mia, employees Cara and Dan) and Birch
-- (owner Ben, employee Eve); Zed belongs to neither. One row of every kind
-- in each organization.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:mia, 'mia@alder.test', now()),
  (:cara, 'cara@alder.test', now()), (:dan, 'dan@alder.test', now()),
  (:ben, 'ben@birch.test', now()), (:eve, 'eve@birch.test', now()),
  (:zed, 'zed@nowhere.test', now());
select org_signup_create('Alder Street', 'alder', :ann, 'Ann Owner', 'ann@alder.test');
select org_signup_create('Birch Lane', 'birch', :ben, 'Ben Owner', 'ben@birch.test');

create temp table fx (k text primary key, v text);
grant select on fx to public;

do $$
declare
  a uuid := (select id from organizations where slug = 'alder');
  b uuid := (select id from organizations where slug = 'birch');
  o uuid;
  w1 bigint; w2 bigint; s1 bigint; s2 bigint; p bigint; t bigint; os bigint; pr bigint;
  u1 uuid; u2 uuid; mgr uuid;
begin
  insert into fx values ('alder', a), ('birch', b);
  insert into employees (org_id, name, email, user_id, pay_rate) values
    (a, 'Mia Manager', 'mia@alder.test', 'aaaaaaaa-0000-0000-0000-000000000002', 21),
    (a, 'Cara Clerk',  'cara@alder.test', 'aaaaaaaa-0000-0000-0000-000000000003', 17.5),
    (a, 'Dan Driver',  'dan@alder.test',  'aaaaaaaa-0000-0000-0000-000000000004', 16),
    (b, 'Eve Early',   'eve@birch.test',  'bbbbbbbb-0000-0000-0000-000000000002', 19);
  insert into managers (org_id, user_id) values (a, 'aaaaaaaa-0000-0000-0000-000000000002');

  foreach o in array array[a, b] loop
    if o = a then
      u1 := 'aaaaaaaa-0000-0000-0000-000000000003'; u2 := 'aaaaaaaa-0000-0000-0000-000000000004';
      mgr := 'aaaaaaaa-0000-0000-0000-000000000001';
    else
      u1 := 'bbbbbbbb-0000-0000-0000-000000000002'; u2 := 'bbbbbbbb-0000-0000-0000-000000000001';
      mgr := 'bbbbbbbb-0000-0000-0000-000000000001';
    end if;
    w1 := (select id from employees where org_id = o and user_id = u1);
    w2 := (select id from employees where org_id = o and user_id = u2);
    insert into fx values ('w1:' || o, w1), ('w2:' || o, w2);

    insert into positions (org_id, name) values (o, 'Cashier');
    insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
      values (o, w1, '2030-01-15', 540, 1020) returning id into s1;
    insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
      values (o, w2, '2030-01-16', 540, 1020) returning id into s2;
    insert into fx values ('s1:' || o, s1), ('s2:' || o, s2);
    insert into schedule_templates (org_id, name) values (o, 'Week') returning id into t;
    insert into schedule_template_rows (org_id, template_id, employee_id, day_of_week, start_minutes, end_minutes)
      values (o, t, w1, 1, 540, 1020);
    insert into store_hours (org_id, day_of_week, open_minutes, close_minutes) values (o, 1, 480, 1200)
      on conflict do nothing;
    insert into app_settings (org_id, key, value) values (o, 'timezone', 'America/Chicago')
      on conflict do nothing;
    insert into availability (org_id, employee_id, day_of_week, start_minutes, end_minutes)
      values (o, w1, 1, 540, 1020);
    insert into callouts (org_id, employee_id, date) values (o, w1, '2030-01-15');
    insert into coverage_profiles (org_id, name) values (o, 'Day') returning id into p;
    insert into fx values ('profile:' || o, p);
    insert into coverage_profile_blocks (org_id, profile_id, start_minutes, end_minutes, headcount)
      values (o, p, 540, 1020, 1);
    insert into coverage_day_defaults (org_id, day_of_week, profile_id) values (o, 1, p);
    insert into coverage_date_overrides (org_id, date, profile_id) values (o, '2030-01-15', p);
    insert into schedule_generation_runs (org_id, week_start, mode, seed) values (o, '2030-01-20', 'fill', 1)
      returning id into pr;
    insert into fx values ('run:' || o, pr);
    insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes, generation_run_id)
      values (o, w1, '2030-01-22', 540, 1020, pr);
    insert into employee_preferences (org_id, employee_id) values (o, w1);
    insert into open_shifts (org_id, date, start_minutes, end_minutes) values (o, '2030-01-20', 540, 1020)
      returning id into os;
    insert into fx values ('open:' || o, os);
    insert into open_shift_claims (org_id, open_shift_id, employee_id) values (o, os, w1);
    insert into punch_records (org_id, employee_id, punch_type, punched_at)
      values (o, w1, 'clock_in', now() - interval '2 days');
    insert into punch_corrections (org_id, employee_id, punch_type, punched_at, note, requested_by)
      values (o, w1, 'clock_out', now() - interval '1 day', 'forgot', u1);
    insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id)
      values (o, w1, w2, s1, s2);
    insert into time_off_requests (org_id, employee_id, date) values (o, w1, '2030-02-01');
    insert into announcements (org_id, title, body, created_by) values (o, 'Hi', 'Welcome', mgr);
    insert into messages (org_id, conversation_id, from_user_id, to_user_id, body) values
      (o, least(u1::text, u2::text) || '_' || greatest(u1::text, u2::text), u1, u2, 'enc1'),
      (o, least(u1::text, u2::text) || '_' || greatest(u1::text, u2::text), u2, u1, 'enc2');
    insert into notifications (org_id, user_id, type, title, body) values
      (o, u1, 'message', 'From a coworker', 'hello'), (o, null, 'late_punch', 'Late', 'late');
    insert into audit_logs (org_id, actor_id, action) values (o, mgr, 'employee.update');
  end loop;

  insert into device_presence (endpoint, user_id) values
    ('https://push.test/cara', 'aaaaaaaa-0000-0000-0000-000000000003'),
    ('https://push.test/eve',  'bbbbbbbb-0000-0000-0000-000000000002');
  insert into push_subscriptions (user_id, endpoint, p256dh, auth_key) values
    ('aaaaaaaa-0000-0000-0000-000000000003', 'https://push.test/cara', 'p', 'a'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'https://push.test/eve', 'p', 'a');
  insert into user_notification_preferences (user_id) values
    ('aaaaaaaa-0000-0000-0000-000000000003'), ('bbbbbbbb-0000-0000-0000-000000000002');
end $$;

\set alder '(select v::uuid from fx where k = ''alder'')'
\set birch '(select v::uuid from fx where k = ''birch'')'

-- ---------------------------------------------------------------------------
-- Part 1: the access matrix, before and after 0041.
-- ---------------------------------------------------------------------------
create temp table matrix (phase text, who text, tbl text, scope text, op text, result text);

create or replace function pg_temp.record_matrix(p_phase text) returns void language plpgsql as $$
declare
  users text[][] := array[
    ['ann',  'aaaaaaaa-0000-0000-0000-000000000001'], ['mia', 'aaaaaaaa-0000-0000-0000-000000000002'],
    ['cara', 'aaaaaaaa-0000-0000-0000-000000000003'], ['dan', 'aaaaaaaa-0000-0000-0000-000000000004'],
    ['ben',  'bbbbbbbb-0000-0000-0000-000000000001'], ['eve', 'bbbbbbbb-0000-0000-0000-000000000002'],
    ['zed',  'cccccccc-0000-0000-0000-000000000001'], ['anon', '']];
  t record;
  sc text;
  scope_sql text;
  tmpl text;
  upd_col text;
  i int;
  who text; uid text; role text;
begin
  for t in
    select c.relname as tbl,
           exists (select 1 from pg_attribute where attrelid = c.oid and attname = 'org_id') as has_org,
           exists (select 1 from pg_attribute where attrelid = c.oid and attname = 'id' and not attisdropped
                     and atttypid in ('int4'::regtype, 'int8'::regtype)) as has_id
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     order by 1
  loop
    foreach sc in array array['alder', 'birch'] loop
      scope_sql := case
        when t.tbl = 'organizations' then format('id = %L', (select v from fx where k = sc))
        when t.has_org then format('org_id = %L', (select v from fx where k = sc))
        else format('user_id = %L', case sc when 'alder' then 'aaaaaaaa-0000-0000-0000-000000000003'
                                            else 'bbbbbbbb-0000-0000-0000-000000000002' end)
      end;
      -- A copy of one of the scope's rows, under a fresh id, as the insert to try.
      execute format(
        'select to_jsonb(x)%s from (select * from public.%I where %s order by ctid limit 1) x',
        case when t.has_id then ' || jsonb_build_object(''id'', (x.id + 100000))' else '' end,
        t.tbl, scope_sql)
        into tmpl;
      upd_col := case t.tbl
        when 'messages' then 'read' when 'notifications' then 'read'
        when 'organizations' then 'name'
        else case when t.has_org then 'org_id' else 'user_id' end end;

      for i in 1 .. array_length(users, 1) loop
        who := users[i][1];
        uid := nullif(users[i][2], '');
        role := case when who = 'anon' then 'anon' else 'authenticated' end;
        insert into matrix values
          (p_phase, who, t.tbl, sc, 'select',
           pg_temp.try(uid, format('select 1 from public.%I where %s', t.tbl, scope_sql), role)),
          (p_phase, who, t.tbl, sc, 'insert',
           pg_temp.try(uid, format(
             'insert into public.%I overriding system value select * from jsonb_populate_record(null::public.%I, %L)',
             t.tbl, t.tbl, tmpl), role)),
          (p_phase, who, t.tbl, sc, 'update',
           pg_temp.try(uid, format('update public.%I set %I = %I where %s', t.tbl, upd_col, upd_col, scope_sql), role)),
          (p_phase, who, t.tbl, sc, 'delete',
           pg_temp.try(uid, format('delete from public.%I where %s', t.tbl, scope_sql), role));
      end loop;
    end loop;
  end loop;
end $$;

select pg_temp.record_matrix('before');

\ir ../migrations/0041_database_audit_fixes.sql
\ir ../migrations/0041_database_audit_fixes.sql

select pg_temp.record_matrix('after');

-- Differences 0041 is meant to make.
create temp table expected_diff (who text, tbl text, scope text, op text, before text, after text);
insert into expected_diff values
  -- Managers read their own org's audit log.
  ('ann', 'audit_logs', 'alder', 'select', 'ok:0', 'ok:1'),
  ('mia', 'audit_logs', 'alder', 'select', 'ok:0', 'ok:1'),
  ('ben', 'audit_logs', 'birch', 'select', 'ok:0', 'ok:1'),
  -- Only a message's recipient updates it (each has sent one and received one).
  ('cara', 'messages', 'alder', 'update', 'ok:2', 'ok:1'),
  ('dan',  'messages', 'alder', 'update', 'ok:2', 'ok:1'),
  ('ben',  'messages', 'birch', 'update', 'ok:2', 'ok:1'),
  ('eve',  'messages', 'birch', 'update', 'ok:2', 'ok:1');

select pg_temp.check('0041 changes no access outside the intended fixes ('
    || (select count(*) from matrix where phase = 'after') || ' checks)',
  not exists (
    select 1
      from matrix b join matrix a using (who, tbl, scope, op)
     where b.phase = 'before' and a.phase = 'after' and a.result is distinct from b.result
       -- Signed-out callers, and everyone on audit_logs, now lack the
       -- privilege instead of matching no rows.
       and not ((who = 'anon' or tbl = 'audit_logs') and op in ('update', 'delete')
                and b.result = 'ok:0' and a.result = 'err:42501')
       and not exists (
         select 1 from expected_diff e
          where (e.who, e.tbl, e.scope, e.op, e.before, e.after) = (who, tbl, scope, op, b.result, a.result))
  ));

-- List any unexpected difference.
do $$
declare r record;
begin
  for r in
    select who, tbl, scope, op, b.result as before, a.result as after
      from matrix b join matrix a using (who, tbl, scope, op)
     where b.phase = 'before' and a.phase = 'after' and a.result is distinct from b.result
       and not ((who = 'anon' or tbl = 'audit_logs') and op in ('update', 'delete')
                and b.result = 'ok:0' and a.result = 'err:42501')
       and not exists (select 1 from expected_diff e
                        where (e.who, e.tbl, e.scope, e.op, e.before, e.after) = (who, tbl, scope, op, b.result, a.result))
  loop
    raise notice 'FAIL    unexpected: % % % % : % -> %', r.who, r.op, r.tbl, r.scope, r.before, r.after;
  end loop;
end $$;

select pg_temp.check('every expected difference happened',
  (select count(*) from expected_diff e
     join matrix b on (b.who, b.tbl, b.scope, b.op, b.result) = (e.who, e.tbl, e.scope, e.op, e.before) and b.phase = 'before'
     join matrix a on (a.who, a.tbl, a.scope, a.op, a.result) = (e.who, e.tbl, e.scope, e.op, e.after) and a.phase = 'after')
  = (select count(*) from expected_diff));

select pg_temp.check('the matrix exercised real access (members read rows, managers write)',
  (select count(*) from matrix where phase = 'after' and who = 'cara' and op = 'select' and scope = 'alder' and result <> 'ok:0') > 15
  and (select count(*) from matrix where phase = 'after' and who = 'ann' and op = 'delete' and scope = 'alder' and result like 'ok:%' and result <> 'ok:0') > 10
  and not exists (select 1 from matrix where phase = 'after' and who in ('zed', 'anon') and op = 'select' and result <> 'ok:0'));

-- ---------------------------------------------------------------------------
-- Part 2: the fixes.
-- ---------------------------------------------------------------------------

-- Policies.
select pg_temp.check('no policy calls the per-row helpers any more',
  not exists (select 1 from pg_policies where schemaname = 'public'
               and (qual ~ 'is_org_member|is_org_manager|is_own_employee'
                    or with_check ~ 'is_org_member|is_org_manager|is_own_employee')));
select pg_temp.check('every public policy is for signed-in users only',
  not exists (select 1 from pg_policies where schemaname = 'public' and roles <> '{authenticated}'));
select pg_temp.check('no table has two permissive policies for the same command',
  not exists (
    select 1 from pg_policies p1 join pg_policies p2
      on p1.schemaname = p2.schemaname and p1.tablename = p2.tablename and p1.policyname < p2.policyname
     where p1.schemaname = 'public'
       and (p1.cmd = p2.cmd or p1.cmd = 'ALL' or p2.cmd = 'ALL')));

-- Schedules at midnight.
select pg_temp.run('a manager schedules a shift starting at 12:00 AM', :ann,
  format($q$insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
            values (%L, %s, '2030-03-01', 0, 480)$q$, (select v from fx where k = 'alder'),
            (select v from fx where k = 'w1:' || (select v from fx where k = 'alder'))), false);
select pg_temp.run('a shift still must not exceed 16 hours', :ann,
  format($q$insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
            values (%L, %s, '2030-03-02', 0, 1000)$q$, (select v from fx where k = 'alder'),
            (select v from fx where k = 'w1:' || (select v from fx where k = 'alder'))), true);
select pg_temp.check('the *_shift_times checks are validated',
  (select bool_and(convalidated) from pg_constraint where conname like '%\_shift\_times'));

-- Roles.
select pg_temp.run('a non-owner manager cannot promote anyone', :mia,
  format('select manager_promote(%L, %L)', (select v from fx where k = 'alder'), :cara), true);
select pg_temp.run('a non-owner manager cannot demote another manager', :mia,
  format('select manager_demote(%L, %L)', (select v from fx where k = 'alder'), :mia), true);
select pg_temp.run('the owner cannot promote someone outside the org', :ann,
  format('select manager_promote(%L, %L)', (select v from fx where k = 'alder'), :eve), true);
select pg_temp.run('the owner promotes a member', :ann,
  format('select manager_promote(%L, %L)', (select v from fx where k = 'alder'), :cara), false);
select pg_temp.run('the owner demotes a manager', :ann,
  format('select manager_demote(%L, %L)', (select v from fx where k = 'alder'), :cara), false);
select pg_temp.run('the owner still cannot be demoted', :ann,
  format('select manager_demote(%L, %L)', (select v from fx where k = 'alder'), :ann), true);
insert into managers (org_id, user_id) values ('00000000-0000-0000-0000-000000000002', :cara),
                                              ('00000000-0000-0000-0000-000000000002', :dan);
select pg_temp.run('demo visitors cannot demote each other', :cara,
  $q$select manager_demote('00000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004')$q$, true);
select pg_temp.run('signed-out callers cannot call manager_promote', null,
  format('select manager_promote(%L, %L)', (select v from fx where k = 'alder'), :cara), true, 'anon');

-- Swaps.
select pg_temp.run('an employee cannot file a swap for a coworker''s shift', :dan,
  format($q$insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id)
            values (%L, %s, %s, %s, %s)$q$, (select v from fx where k = 'alder'),
            (select v from fx where k = 'w2:' || (select v from fx where k = 'alder')),
            (select v from fx where k = 'w1:' || (select v from fx where k = 'alder')),
            (select v from fx where k = 's1:' || (select v from fx where k = 'alder')),
            (select v from fx where k = 's2:' || (select v from fx where k = 'alder'))), true);
select pg_temp.run('an employee files a swap of their own shift for the target''s', :dan,
  format($q$insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id)
            values (%L, %s, %s, %s, %s)$q$, (select v from fx where k = 'alder'),
            (select v from fx where k = 'w2:' || (select v from fx where k = 'alder')),
            (select v from fx where k = 'w1:' || (select v from fx where k = 'alder')),
            (select v from fx where k = 's2:' || (select v from fx where k = 'alder')),
            (select v from fx where k = 's1:' || (select v from fx where k = 'alder'))), false);
update shift_swaps set status = 'accepted' where org_id = :alder;
-- Shift A changes hands after the request.
update schedules set employee_id = (select id from employees where user_id = :mia)
 where id = (select v::bigint from fx where k = 's1:' || (select v from fx where k = 'alder'));
select pg_temp.check('approving a swap whose shift changed hands returns stale and changes nothing',
  (select approve_shift_swap(:alder, (select min(id) from shift_swaps where org_id = :alder))
     from (select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true)) x) = 'stale'
  and (select status from shift_swaps where id = (select min(id) from shift_swaps where org_id = :alder)) = 'accepted');
select set_config('request.jwt.claim.sub', '', true);
update schedules set employee_id = (select id from employees where user_id = :cara)
 where id = (select v::bigint from fx where k = 's1:' || (select v from fx where k = 'alder'));
select pg_temp.check('approving it once the owners match succeeds',
  (select approve_shift_swap(:alder, (select min(id) from shift_swaps where org_id = :alder))
     from (select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true)) x) = 'approved');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.check('and swaps the shifts',
  (select employee_id from schedules where id = (select v::bigint from fx where k = 's1:' || (select v from fx where k = 'alder')))
    = (select id from employees where user_id = :dan));

-- Messages and notifications.
select pg_temp.run('the recipient marks a message read', :dan,
  $q$update messages set read = true where to_user_id = 'aaaaaaaa-0000-0000-0000-000000000004'$q$, false);
select pg_temp.run('the recipient cannot rewrite a message', :dan,
  $q$update messages set body = 'forged' where to_user_id = 'aaaaaaaa-0000-0000-0000-000000000004'$q$, true);
select pg_temp.run('the recipient cannot re-attribute a message', :dan,
  $q$update messages set from_user_id = 'aaaaaaaa-0000-0000-0000-000000000001' where to_user_id = 'aaaaaaaa-0000-0000-0000-000000000004'$q$, true);
select pg_temp.check('the sender cannot change a sent message',
  pg_temp.try(:cara, $q$update messages set read = true where from_user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$q$) = 'ok:0');
select pg_temp.run('a message must carry its own conversation id', :cara,
  format($q$insert into messages (org_id, conversation_id, from_user_id, to_user_id, body)
            values (%L, 'someone-else_entirely', %L, %L, 'x')$q$, (select v from fx where k = 'alder'), :cara, :dan), true);
select pg_temp.run('a message with the right conversation id is sent', :cara,
  format($q$insert into messages (org_id, conversation_id, from_user_id, to_user_id, body)
            values (%L, %L, %L, %L, 'x')$q$, (select v from fx where k = 'alder'),
            least(:cara::text, :dan::text) || '_' || greatest(:cara::text, :dan::text), :cara, :dan), false);
select pg_temp.run('a user marks a notification read and clears it', :cara,
  $q$update notifications set read = true, is_cleared = true where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$q$, false);
select pg_temp.run('a user cannot rewrite a notification', :cara,
  $q$update notifications set title = 'forged' where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$q$, true);

-- Audit log.
select pg_temp.run('nobody but the service role writes the audit log', :ann,
  format($q$insert into audit_logs (org_id, action) values (%L, 'forged')$q$, (select v from fx where k = 'alder')), true);
select pg_temp.check('employees and other orgs'' managers read no audit entries',
  pg_temp.try(:cara, 'select 1 from audit_logs') = 'ok:0'
  and pg_temp.try(:ben, format('select 1 from audit_logs where org_id = %L', (select v from fx where k = 'alder'))) = 'ok:0');

-- Same-org references.
select pg_temp.run('a claim cannot point at another org''s open shift', :cara,
  format($q$insert into open_shift_claims (org_id, open_shift_id, employee_id) values (%L, %s, %s)$q$,
         (select v from fx where k = 'alder'), (select v from fx where k = 'open:' || (select v from fx where k = 'birch')),
         (select v from fx where k = 'w1:' || (select v from fx where k = 'alder'))), true);
select pg_temp.run('a coverage default cannot use another org''s profile', :ann,
  format($q$update coverage_day_defaults set profile_id = %s where org_id = %L$q$,
         (select v from fx where k = 'profile:' || (select v from fx where k = 'birch')), (select v from fx where k = 'alder')), true);
select pg_temp.run('a draft cannot cite another org''s generation run', :ann,
  format($q$update draft_schedules set generation_run_id = %s where org_id = %L$q$,
         (select v from fx where k = 'run:' || (select v from fx where k = 'birch')), (select v from fx where k = 'alder')), true);
select pg_temp.run('a manager deletes a coverage profile', :ann,
  format('delete from coverage_profiles where org_id = %L', (select v from fx where k = 'alder')), false);
select pg_temp.check('which still removes its blocks, day defaults and date overrides',
  (select count(*) from coverage_profile_blocks where org_id = :alder) = 0
  and (select count(*) from coverage_day_defaults where org_id = :alder) = 0
  and (select count(*) from coverage_date_overrides where org_id = :alder) = 0);
select pg_temp.check('org_id has no default on the coverage tables or draft_schedules',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and column_name = 'org_id' and column_default is not null));

-- Employees.
select pg_temp.run('the same email cannot be added twice to one team', :ann,
  format($q$insert into employees (org_id, name, email) values (%L, 'Cara Again', 'CARA@alder.test')$q$,
         (select v from fx where k = 'alder')), true);
insert into employees (org_id, name, email) values (:birch, 'Fay', 'Fay@Birch.test');
insert into auth.users (id, email) values ('bbbbbbbb-0000-0000-0000-000000000003', 'fay@birch.test');
select pg_temp.check('sign-up links an invite whose email differs only in case',
  (select user_id from employees where email = 'Fay@Birch.test') = 'bbbbbbbb-0000-0000-0000-000000000003');

-- Function privileges.
select pg_temp.run('signed-in users cannot call trigger functions or the old helpers', :ann,
  format('select is_org_manager(%L)', (select v from fx where k = 'alder')), true);
select pg_temp.run('triggers still run for signed-in users', :cara,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_in')$q$,
         (select v from fx where k = 'alder'), (select v from fx where k = 'w1:' || (select v from fx where k = 'alder'))), false);
select pg_temp.run('and still enforce their rules', :cara,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, %s, 'clock_in')$q$,
         (select v from fx where k = 'alder'), (select v from fx where k = 'w1:' || (select v from fx where k = 'alder'))), true);
select pg_temp.run('signed-in users cannot truncate a table', :ann, 'truncate public.schedules', true);
select pg_temp.run('signed-out callers cannot write', null,
  $q$delete from public.schedules$q$, true, 'anon');

-- Pay rates through the function (0041).
select pg_temp.check('a manager reads their org''s pay rates through employee_pay_rates',
  pg_temp.try(:ann, format('select * from employee_pay_rates(%L) where pay_rate is not null', (select v from fx where k = 'alder'))) = 'ok:3');
select pg_temp.check('an employee and another org''s manager get none',
  pg_temp.try(:cara, format('select * from employee_pay_rates(%L)', (select v from fx where k = 'alder'))) = 'ok:0'
  and pg_temp.try(:ben, format('select * from employee_pay_rates(%L)', (select v from fx where k = 'alder'))) = 'ok:0');
select pg_temp.check('signed-out callers cannot call it',
  pg_temp.try(null, format('select * from employee_pay_rates(%L)', (select v from fx where k = 'alder')), 'anon') = 'err:42501');

-- ---------------------------------------------------------------------------
-- Part 3: 0042, pay rates hidden from the API.
-- ---------------------------------------------------------------------------
select pg_temp.check('before 0042 any coworker can read pay rates directly (the bug)',
  pg_temp.try(:dan, 'select pay_rate from employees where pay_rate is not null') = 'ok:3');

\ir ../migrations/0042_pay_rate_managers_only.sql
\ir ../migrations/0042_pay_rate_managers_only.sql

select pg_temp.check('an employee cannot read pay_rate',
  pg_temp.try(:dan, 'select pay_rate from employees') = 'err:42501');
select pg_temp.check('nor can a manager read it from the table',
  pg_temp.try(:ann, 'select pay_rate from employees') = 'err:42501');
select pg_temp.check('the roster columns the app selects are still readable',
  pg_temp.try(:dan, 'select id, name, email, user_id, employment_type, min_weekly_hours, max_weekly_hours, max_days_per_week, hire_date from employees') = 'ok:4');
select pg_temp.run('a manager still sets a pay rate', :ann,
  format($q$update employees set pay_rate = 22.25 where org_id = %L and user_id = %L$q$, (select v from fx where k = 'alder'), :dan), false);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.check('and reads it back through employee_pay_rates',
  (select r.pay_rate from employee_pay_rates(:alder) r join employees e on e.id = r.employee_id
    where e.user_id = :dan) = 22.25);
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.run('an employee cannot set a pay rate', :dan,
  format($q$update employees set pay_rate = 99 where org_id = %L and user_id = %L$q$, (select v from fx where k = 'alder'), :dan), false);
select pg_temp.check('(RLS leaves the row unchanged)',
  (select pay_rate from employees where user_id = :dan) = 22.25);
select pg_temp.check('Realtime can still filter employees on the roster columns',
  has_column_privilege('authenticated', 'public.employees', 'org_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.employees', 'pay_rate', 'SELECT')
  and has_column_privilege('service_role', 'public.employees', 'pay_rate', 'SELECT'));

rollback;
