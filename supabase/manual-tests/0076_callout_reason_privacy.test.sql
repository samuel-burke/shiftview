-- Reproduce the direct-table reason disclosure, then check database privacy,
-- authorized reads/writes, Realtime privileges and repeat application of 0076.
-- Run with scripts/test-sql.sh 0076 against disposable PostgreSQL databases.

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
\ir ../migrations/0060_pay_rules.sql
\ir ../migrations/0062_pay_periods.sql
\ir ../migrations/0070_shift_notes.sql
\ir ../migrations/0072_time_off_ranges.sql
\ir ../migrations/0073_calendar_feeds.sql
\unset ON_ERROR_STOP

\set ann  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set cara '''cccccccc-0000-0000-0000-000000000001'''
\set dan  '''dddddddd-0000-0000-0000-000000000001'''
\set ben  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set eve  '''eeeeeeee-0000-0000-0000-000000000001'''
\set zed  '''ffffffff-0000-0000-0000-000000000001'''

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

insert into auth.users (id, email, email_confirmed_at) values
  (:ann, 'ann@alder.test', now()), (:cara, 'cara@alder.test', now()),
  (:dan, 'dan@alder.test', now()), (:ben, 'ben@birch.test', now()),
  (:eve, 'eve@birch.test', now()), (:zed, 'zed@outside.test', now());
select org_signup_create('Alder', 'alder', :ann, 'Ann', 'ann@alder.test');
select org_signup_create('Birch', 'birch', :ben, 'Ben', 'ben@birch.test');
\set alder '(select id from organizations where slug = ''alder'')'
\set birch '(select id from organizations where slug = ''birch'')'
insert into employees (org_id, name, user_id) values
  (:alder, 'Cara', :cara), (:alder, 'Dan', :dan), (:alder, 'Ben', :ben),
  (:birch, 'Eve', :eve);
\set cara_id '(select id from employees where user_id = ' :cara ' and org_id = ' :alder ')'
\set dan_id '(select id from employees where user_id = ' :dan ' and org_id = ' :alder ')'
\set eve_id '(select id from employees where user_id = ' :eve ' and org_id = ' :birch ')'
\set tomorrow '((now() at time zone ''America/New_York'')::date + 1)'
insert into schedules (org_id, employee_id, date, start_minutes, end_minutes)
  select org_id, id, :tomorrow, 540, 1020 from employees where user_id in (:cara, :dan, :eve);
insert into callouts (org_id, employee_id, date, reason)
  values (:alder, :cara_id, :tomorrow, 'Cara private'),
         (:alder, :dan_id, :tomorrow, 'Dan private'),
         (:birch, :eve_id, :tomorrow, 'Eve private');

select pg_temp.check('before 0076 an employee reads a coworker''s private reason directly',
  pg_temp.try(:dan, $$select reason from callouts where reason = 'Cara private'$$) = 'ok:1');

\set ON_ERROR_STOP on
\ir ../migrations/0076_callout_reason_privacy.sql
\ir ../migrations/0076_callout_reason_privacy.sql
\unset ON_ERROR_STOP

-- Column permissions protect projections, wildcards, predicates and RETURNING.
select pg_temp.check('an employee cannot select reasons directly',
  pg_temp.try(:dan, 'select reason from callouts') = 'err:42501');
select pg_temp.check('a manager cannot select reasons directly either',
  pg_temp.try(:ann, 'select reason from callouts') = 'err:42501');
select pg_temp.check('wildcard reads cannot disclose reasons',
  pg_temp.try(:dan, 'select * from callouts') = 'err:42501');
select pg_temp.check('a predicate cannot probe a coworker''s reason',
  pg_temp.try(:dan, $$select id from callouts where reason like 'Cara%'$$) = 'err:42501');
select pg_temp.check('an update cannot return a private reason',
  pg_temp.try(:dan, 'update callouts set reason = null returning reason') = 'err:42501');
select pg_temp.check('anonymous callers cannot read reasons or invoke the read RPC',
  pg_temp.try(null, 'select reason from callouts', 'anon') = 'err:42501'
  and pg_temp.try(null, format('select * from callouts_for_org(%L)', :alder), 'anon') = 'err:42501');
select pg_temp.check('all shared status columns remain readable to members',
  pg_temp.try(:dan, 'select id, org_id, employee_id, date, created_by, created_at from callouts') = 'ok:2');
select pg_temp.check('other organizations cannot read shared statuses',
  pg_temp.try(:eve, format('select id from callouts where org_id = %L', :alder)) = 'ok:0');

-- The read RPC scopes membership and redacts before client-side filtering.
select pg_temp.check('an employee sees every team status through the RPC',
  pg_temp.try(:cara, format('select * from callouts_for_org(%L)', :alder)) = 'ok:2');
select pg_temp.check('an employee reads only their own non-null reason',
  pg_temp.try(:cara, format('select * from callouts_for_org(%L) where reason is not null', :alder)) = 'ok:1'
  and pg_temp.try(:cara, format($q$select * from callouts_for_org(%L) where reason = 'Cara private'$q$, :alder)) = 'ok:1');
select pg_temp.check('RPC predicates cannot probe a hidden reason',
  pg_temp.try(:dan, format($q$select * from callouts_for_org(%L) where reason like 'Cara%%'$q$, :alder)) = 'ok:0');
select pg_temp.check('a manager reads every reason in their own organization',
  pg_temp.try(:ann, format('select * from callouts_for_org(%L) where reason is not null', :alder)) = 'ok:2');
select pg_temp.check('managing another organization grants no extra reason access',
  pg_temp.try(:ben, format('select * from callouts_for_org(%L) where reason is not null', :alder)) = 'ok:0'
  and pg_temp.try(:ben, format('select * from callouts_for_org(%L) where reason is not null', :birch)) = 'ok:1');
select pg_temp.check('an outsider and an authenticated request without a user see nothing',
  pg_temp.try(:zed, format('select * from callouts_for_org(%L)', :alder)) = 'ok:0'
  and pg_temp.try(null, format('select * from callouts_for_org(%L)', :alder)) = 'ok:0');
select pg_temp.check('an employee or manager cannot read an unrelated organization',
  pg_temp.try(:cara, format('select * from callouts_for_org(%L)', :birch)) = 'ok:0'
  and pg_temp.try(:ann, format('select * from callouts_for_org(%L)', :birch)) = 'ok:0');

-- Existing reasons survive; only the checked RPC can perform the atomic upsert.
select pg_temp.check('the service role retains direct access and existing reasons are preserved',
  pg_temp.try(null, 'select reason from callouts where reason is not null', 'service_role') = 'ok:3');
select id as original_id from callouts where employee_id = :cara_id \gset
select pg_temp.run('an employee re-files their own call-out', :cara,
  format('select save_callout(%L, %s, %L, %L)', :alder, :cara_id, :tomorrow, 'Updated private'), false);
select pg_temp.check('re-filing preserves the id and stamps the caller',
  (select id = :original_id and reason = 'Updated private' and created_by = :cara
   from callouts where employee_id = :cara_id));
select pg_temp.run('an employee can clear their own reason', :cara,
  format('select save_callout(%L, %s, %L, null)', :alder, :cara_id, :tomorrow), false);
select pg_temp.check('clearing the reason preserves shared status',
  (select reason is null from callouts where employee_id = :cara_id));
select pg_temp.check('an employee cannot re-file for a coworker',
  pg_temp.try(:dan, format('select save_callout(%L, %s, %L, %L)', :alder, :cara_id, :tomorrow, 'Tampered')) = 'err:42501');
select pg_temp.check('an employee cannot spoof an organization or employee pairing',
  pg_temp.try(:cara, format('select save_callout(%L, %s, %L, null)', :birch, :cara_id, :tomorrow)) = 'err:42501');
select pg_temp.check('a manager cannot write another organization',
  pg_temp.try(:ann, format('select save_callout(%L, %s, %L, null)', :birch, :eve_id, :tomorrow)) = 'err:42501');
select pg_temp.check('an outsider cannot invoke the write RPC successfully',
  pg_temp.try(:zed, format('select save_callout(%L, %s, %L, null)', :alder, :cara_id, :tomorrow)) = 'err:42501');
select pg_temp.check('anonymous callers cannot execute the write RPC',
  pg_temp.try(null, format('select save_callout(%L, %s, %L, null)', :alder, :cara_id, :tomorrow), 'anon') = 'err:42501');
select pg_temp.check('the write RPC still enforces the call-out date rules',
  pg_temp.try(:cara, format('select save_callout(%L, %s, %L, null)', :alder, :cara_id, :tomorrow + 1)) = 'err:22007');
select pg_temp.check('the write RPC still requires a scheduled shift',
  pg_temp.try(:cara, format('select save_callout(%L, %s, %L, null)', :alder, :cara_id, :tomorrow - 1)) = 'err:22007');
select pg_temp.run('a manager retains the ability to edit their team''s call-outs', :ann,
  format('select save_callout(%L, %s, %L, %L)', :alder, :cara_id, :tomorrow, 'Manager edit'), false);
select pg_temp.run('an employee can rescind their own call-out', :cara,
  format('delete from callouts where employee_id = %s', :cara_id), false);
select pg_temp.run('an employee can file a new call-out', :cara,
  format('select save_callout(%L, %s, %L, %L)', :alder, :cara_id, :tomorrow, 'New private'), false);
select pg_temp.check('the newly filed reason is stored',
  (select reason = 'New private' from callouts where employee_id = :cara_id));

-- Realtime apply_rls uses these column privileges for both record and old_record.
select pg_temp.check('Realtime still publishes callout status with a readable primary key',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'callouts')
  and has_column_privilege('authenticated', 'public.callouts', 'id', 'SELECT'));
select pg_temp.check('Realtime cannot send reasons to API roles, including old records',
  not has_column_privilege('authenticated', 'public.callouts', 'reason', 'SELECT')
  and not has_column_privilege('anon', 'public.callouts', 'reason', 'SELECT'));

rollback;
