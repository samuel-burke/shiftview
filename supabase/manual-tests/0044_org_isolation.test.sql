-- Tests for 0044_org_isolation.sql, and a standing cross-tenant check of the
-- whole schema. Run against a throwaway Postgres database (15 or later):
--
--   createdb org_isolation_test
--   cd supabase/manual-tests && psql -q -d org_isolation_test -f 0044_org_isolation.test.sql
--   dropdb org_isolation_test
--
-- Any line containing FAIL (or any ERROR) is a regression.
--
-- Two disposable organizations, Alder and Birch (the same fixtures as
-- 0041_database_audit_fixes.test.sql). Part 1 attacks each organization from
-- the other with every role: reads, updates, deletes, inserts and moving rows
-- across, on every table, plus the security-definer functions with the other
-- organization's ids. Part 2 references the other organization's rows from
-- one's own. Part 3 reproduces what 0044 fixes, applies it (twice: it must be
-- repeatable) and checks the fix and the paths that must keep working.

\set ON_ERROR_STOP on
\ir supabase-stubs.sql
\ir ../baseline.sql
\ir ../migrations/0038_notify_service_role_only.sql
\ir ../migrations/0039_link_existing_accounts.sql
\ir ../migrations/0040_remove_legacy_demo_job.sql
\ir ../migrations/0041_database_audit_fixes.sql
\ir ../migrations/0042_pay_rate_managers_only.sql
\ir ../migrations/0043_punch_schedule_ownership.sql
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
-- Part 1: every role of one organization against every table of the other.
-- ---------------------------------------------------------------------------
-- One row of `tbl` in `org`, as jsonb (read as the table owner).
create or replace function pg_temp.one_row(tbl text, org uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  execute format('select to_jsonb(x) from %I x where org_id = %L limit 1', tbl, org) into j;
  return j;
end $$;

create or replace function pg_temp.attack_tables() returns void language plpgsql as $$
declare
  attackers text[][] := array[
    ['ann (Alder owner)',    'aaaaaaaa-0000-0000-0000-000000000001', 'alder', 'birch'],
    ['mia (Alder manager)',  'aaaaaaaa-0000-0000-0000-000000000002', 'alder', 'birch'],
    ['cara (Alder employee)','aaaaaaaa-0000-0000-0000-000000000003', 'alder', 'birch'],
    ['ben (Birch owner)',    'bbbbbbbb-0000-0000-0000-000000000001', 'birch', 'alder'],
    ['eve (Birch employee)', 'bbbbbbbb-0000-0000-0000-000000000002', 'birch', 'alder'],
    ['zed (no org)',         'cccccccc-0000-0000-0000-000000000001', 'birch', 'alder']];
  t text;
  i int;
  who text; uid text; own uuid; victim uuid;
  cols text;
  r text;
  sample jsonb;
  checks int := 0; failures int := 0;
  ok boolean;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb using (table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'org_id' and tb.table_type = 'BASE TABLE'
    order by 1
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name not in ('id', 'created_at', 'updated_at') and is_generated = 'NEVER';

    for i in 1 .. array_length(attackers, 1) loop
      who := attackers[i][1]; uid := attackers[i][2];
      own := (select v::uuid from fx where k = attackers[i][3]);
      victim := (select v::uuid from fx where k = attackers[i][4]);
      sample := pg_temp.one_row(t, victim);

      foreach r in array array[
        'read:'   || pg_temp.try(uid, format('select 1 from %I where org_id = %L', t, victim)),
        'update:' || pg_temp.try(uid, format('update %I set org_id = org_id where org_id = %L', t, victim)),
        'delete:' || pg_temp.try(uid, format('delete from %I where org_id = %L', t, victim)),
        'move:'   || pg_temp.try(uid, format('update %I set org_id = %L where org_id = %L', t, victim, own)),
        'insert:' || case when sample is null then 'err:skipped' else pg_temp.try(uid, format(
          'insert into %1$I (%2$s) select %2$s from jsonb_populate_record(null::%1$I, %3$L)',
          t, cols, sample)) end
      ] loop
        checks := checks + 1;
        -- Reads, updates and deletes must match nothing; inserts and moves
        -- must be refused.
        ok := case split_part(r, ':', 1)
                when 'insert' then split_part(r, ':', 2) = 'err'
                when 'move'   then split_part(r, ':', 2) = 'err' or r = 'move:ok:0'
                else r like '%:ok:0' or split_part(r, ':', 2) = 'err'
              end;
        if not ok then
          failures := failures + 1;
          raise notice 'FAIL  % reached % of the other org (%)', who, t, r;
        end if;
      end loop;
    end loop;
  end loop;
  perform pg_temp.check(format('no role reaches another org''s rows (%s attempts, %s tables)',
    checks, checks / 30), failures = 0);
end $$;

-- Tables without org_id are per user: nobody else's rows are reachable.
create or replace function pg_temp.attack_user_tables() returns void language plpgsql as $$
declare
  t text; r text;
begin
  foreach t in array array['push_subscriptions', 'device_presence', 'user_notification_preferences'] loop
    r := pg_temp.try('bbbbbbbb-0000-0000-0000-000000000002', format('select 1 from %I where user_id = %L', t, 'aaaaaaaa-0000-0000-0000-000000000003'));
    perform pg_temp.check(format('eve cannot read cara''s %s (%s)', t, r), r = 'ok:0');
    r := pg_temp.try('bbbbbbbb-0000-0000-0000-000000000002', format('delete from %I where user_id = %L', t, 'aaaaaaaa-0000-0000-0000-000000000003'));
    perform pg_temp.check(format('eve cannot delete cara''s %s (%s)', t, r), r = 'ok:0');
  end loop;
  r := pg_temp.try('bbbbbbbb-0000-0000-0000-000000000001', format('select 1 from organizations where id = %L', (select v from fx where k = 'alder')));
  perform pg_temp.check(format('ben cannot read the Alder organization (%s)', r), r = 'ok:0');
end $$;

select pg_temp.attack_tables();
select pg_temp.attack_user_tables();

-- Runs a query returning one value as `uid`, always rolled back. Returns
-- 'ok:<value>' or 'err:<sqlstate>'.
create or replace function pg_temp.val(uid text, stmt text) returns text language plpgsql as $$
declare v text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
    set local role authenticated;
    execute stmt into v;
    raise exception using errcode = 'P0123', message = coalesce(v, '<null>');
  exception when others then
    if sqlstate = 'P0123' then return 'ok:' || sqlerrm; end if;
    return 'err:' || sqlstate;
  end;
end $$;

-- Guessing ids: Birch's owner calls each security-definer function with
-- Alder's organization and row ids.
select pg_temp.check('approve_shift_swap refuses another org''s swap (' || r || ')', r = 'ok:forbidden')
  from (select pg_temp.val(:ben, format('select approve_shift_swap(%L, %s)', :alder,
          (select id from shift_swaps where org_id = :alder limit 1)))) _(r);
select pg_temp.check('approve_shift_swap with own org but another org''s swap id finds nothing (' || r || ')', r = 'ok:not_found')
  from (select pg_temp.val(:ben, format('select approve_shift_swap(%L, %s)', :birch,
          (select id from shift_swaps where org_id = :alder limit 1)))) _(r);
select pg_temp.check('employee_pay_rates returns nothing for another org (' || r || ')', r = 'ok:0')
  from (select pg_temp.val(:ben, format('select count(*) from employee_pay_rates(%L)', :alder))) _(r);
select pg_temp.check('manager_promote refuses another org (' || r || ')', r = 'err:42501')
  from (select pg_temp.val(:ben, format('select manager_promote(%L, %L)::text', :alder, :ben))) _(r);
select pg_temp.check('manager_promote refuses a non-member in one''s own org (' || r || ')', r = 'err:42501')
  from (select pg_temp.val(:ben, format('select manager_promote(%L, %L)::text', :birch, :cara))) _(r);
select pg_temp.check('manager_demote refuses another org (' || r || ')', r = 'err:42501')
  from (select pg_temp.val(:ben, format('select manager_demote(%L, %L)::text', :alder, :mia))) _(r);
select pg_temp.check('undo_generation_run refuses another org (' || r || ')', r like 'ok:%forbidden%')
  from (select pg_temp.val(:ben, format('select undo_generation_run(%L, %s)::text', :alder,
          (select v from fx where k = 'run:' || :alder)))) _(r);
select pg_temp.check('undo_generation_run with own org but another org''s run finds nothing (' || r || ')', r like 'ok:%not_found%')
  from (select pg_temp.val(:ben, format('select undo_generation_run(%L, %s)::text', :birch,
          (select v from fx where k = 'run:' || :alder)))) _(r);
select pg_temp.check('apply_generated_drafts refuses another org (' || r || ')', r like 'ok:%forbidden%')
  from (select pg_temp.val(:ben, format(
          'select apply_generated_drafts(%L, %L, ''fill'', null, ''[]'', ''[]'', 1, null, null, null)::text',
          :alder, '2030-01-20'))) _(r);
select pg_temp.check('the service-role-only functions are closed to signed-in users (' || r || ')', r = 'err:42501')
  from (select pg_temp.val(:ben, format('select org_delete(%L)::text', :alder))) _(r);
select pg_temp.check('link_employee_account is closed to signed-in users (' || r || ')', r = 'err:42501')
  from (select pg_temp.val(:ben, format('select count(*) from link_employee_account(%L, 1)', :alder))) _(r);

-- ---------------------------------------------------------------------------
-- Part 2: a row in one's own org that points at another org's row.
-- ---------------------------------------------------------------------------
\set aw1 '(select v from fx where k = ''w1:'' || ' :alder ')'
\set bw1 '(select v from fx where k = ''w1:'' || ' :birch ')'
\set bw2 '(select v from fx where k = ''w2:'' || ' :birch ')'
\set as1 '(select v from fx where k = ''s1:'' || ' :alder ')'
\set as2 '(select v from fx where k = ''s2:'' || ' :alder ')'
\set bs1 '(select v from fx where k = ''s1:'' || ' :birch ')'

select pg_temp.check('a schedule cannot name another org''s employee (' || r || ')', r = 'err:23503')
  from (select pg_temp.try(:ben, format(
    'insert into schedules (org_id, employee_id, date, start_minutes, end_minutes) values (%L, %s, ''2030-03-01'', 540, 1020)',
    :birch, :aw1))) _(r);
select pg_temp.check('a draft cannot name another org''s employee (' || r || ')', r = 'err:23503')
  from (select pg_temp.try(:ben, format(
    'insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes) values (%L, %s, ''2030-03-01'', 540, 1020)',
    :birch, :aw1))) _(r);
select pg_temp.check('a swap cannot name another org''s shifts (' || r || ')', r = 'err:23503')
  from (select pg_temp.try(:ben, format(
    'insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id) values (%L, %s, %s, %s, %s)',
    :birch, :bw1, :bw2, :as1, :as2))) _(r);
-- 0043 refuses a shift that isn't the employee's own (23514) before the
-- foreign key (23503) gets to it; either refusal keeps the punch out.
select pg_temp.check('a punch cannot name another org''s shift (' || r || ')', r in ('err:23503', 'err:23514'))
  from (select pg_temp.try(:ben, format(
    'insert into punch_records (org_id, employee_id, punch_type, punched_at, schedule_id) values (%L, %s, ''clock_in'', now(), %s)',
    :birch, :bw1, :as1))) _(r);
select pg_temp.check('a claim cannot name another org''s open shift (' || r || ')', r = 'err:23503')
  from (select pg_temp.try(:ben, format(
    'insert into open_shift_claims (org_id, open_shift_id, employee_id) values (%L, %s, %s)',
    :birch, (select v from fx where k = 'open:' || :alder), :bw1))) _(r);
select pg_temp.check('a time-off request cannot name another org''s employee (' || r || ')', r = 'err:23503')
  from (select pg_temp.try(:ben, format(
    'insert into time_off_requests (org_id, employee_id, date) values (%L, %s, ''2030-03-01'')', :birch, :aw1))) _(r);
select pg_temp.check('an employee cannot be linked to someone else''s account (' || r || ')', r = 'err:42501')
  from (select pg_temp.try(:ben, format('update employees set user_id = %L where id = %s', :cara, :bw1))) _(r);

-- ---------------------------------------------------------------------------
-- Part 3: 0044.
-- ---------------------------------------------------------------------------
-- messages.conversation_id is the two user ids, sorted, joined by '_'.
create or replace function pg_temp.send(org uuid, from_user uuid, to_user uuid) returns text language sql as $$
  select format('insert into messages (org_id, conversation_id, from_user_id, to_user_id, body) values (%L, %L, %L, %L, ''enc'')',
    org, least(from_user::text collate "C", to_user::text collate "C") || '_' || greatest(from_user::text collate "C", to_user::text collate "C"),
    from_user, to_user)
$$;
\set cross_message 'select pg_temp.send(' :birch ', ' :eve ', ' :cara ')'
\set cross_notification 'select notify_insert(' :birch ', ' :cara ', ''message'', ''Eve'', ''hi'', null)'
\set cross_chess 'select notify_upsert_chess(' :birch ', ' :cara ', ''Your move!'', ''x'', ''{"convId": "x"}'')'
-- Ids are looked up here, as the table owner, and passed as literals: inside
-- try() the attacker's RLS would turn a subquery for them into null.
\set alder_punch '(select id from punch_records where org_id = ' :alder ' limit 1)'
\set birch_punch '(select id from punch_records where org_id = ' :birch ' limit 1)'
\set cross_punch '(select format(''update punch_corrections set punch_id = %s where org_id = %L'', ' :alder_punch ', ' :birch '))'

select pg_temp.check('before 0044 a member can message a user of another org (the bug)',
  pg_temp.try(:eve, (:cross_message)) = 'ok:1');
select pg_temp.check('before 0044 the service role notifies a user of another org (the bug)',
  pg_temp.try(null, :'cross_notification', 'service_role') = 'ok:1');
select pg_temp.check('before 0044 a manager can link a correction to another org''s punch (the bug)',
  pg_temp.try(:ben, :cross_punch) = 'ok:1');

\set ON_ERROR_STOP on
\ir ../migrations/0044_org_isolation.sql
\ir ../migrations/0044_org_isolation.sql
\unset ON_ERROR_STOP

select pg_temp.check('a member cannot message a user of another org (' || r || ')', r = 'err:42501')
  from (select pg_temp.try(:eve, (:cross_message))) _(r);
select pg_temp.check('nor can the service role (' || r || ')', r = 'err:42501')
  from (select pg_temp.try(null, (:cross_message), 'service_role')) _(r);
select pg_temp.check('the service role cannot notify a user of another org (' || r || ')', r = 'err:42501')
  from (select pg_temp.try(null, :'cross_notification', 'service_role')) _(r);
select pg_temp.check('nor send them a chess notification (' || r || ')', r = 'err:42501')
  from (select pg_temp.try(null, :'cross_chess', 'service_role')) _(r);
select pg_temp.check('a recipient cannot be moved to another org''s user (' || r || ')', r like 'err:%')
  from (select pg_temp.try(null, format('update notifications set user_id = %L where org_id = %L and user_id is not null',
          :cara, :birch), 'service_role')) _(r);
select pg_temp.check('a correction cannot be linked to another org''s punch (' || r || ')', r = 'err:23503')
  from (select pg_temp.try(:ben, :cross_punch)) _(r);

select pg_temp.check('an employee still messages their manager (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(:eve, pg_temp.send(:birch, :eve, :ben))) _(r);
select pg_temp.check('a manager still messages an employee (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(:mia, pg_temp.send(:alder, :mia, :cara))) _(r);
select pg_temp.check('a member is still notified (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(null, format('select notify_insert(%L, %L, ''message'', ''t'', ''b'', null)', :birch, :eve),
          'service_role')) _(r);
select pg_temp.check('a manager who is not an employee is still notified (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(null, format('select notify_insert(%L, %L, ''message'', ''t'', ''b'', null)', :alder, :ann),
          'service_role')) _(r);
select pg_temp.check('an org-wide broadcast still works (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(null, format('select notify_insert(%L, null, ''late_punch'', ''t'', ''b'', null)', :birch),
          'service_role')) _(r);
select pg_temp.check('chess notifications between members still work (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(null, format('select notify_upsert_chess(%L, %L, ''t'', ''b'', ''{"convId": "x"}'')', :birch, :eve),
          'service_role')) _(r);
select pg_temp.check('a recipient still marks a notification read (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(:cara, format('update notifications set read = true where org_id = %L and user_id = %L', :alder, :cara))) _(r);
select pg_temp.check('a correction still links to its own org''s punch (' || r || ')', r = 'ok:1')
  from (select pg_temp.try(:ben, format('update punch_corrections set punch_id = %s where org_id = %L', :birch_punch, :birch))) _(r);
select pg_temp.attack_tables();

rollback;
