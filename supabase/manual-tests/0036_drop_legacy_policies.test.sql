-- Behavioural tests for supabase/migrations/0036_drop_legacy_policies.sql.
--
-- Self-contained: builds a stand-in schema carrying both the org-scoped mt_*
-- policies and the single-tenant policies that were still live in production
-- (copied from pg_policies), shows that the old ones let a manager of one
-- organization (e.g. a demo visitor) read and write another's data, applies
-- 0036, and checks that the leak is gone while normal access still works.
-- Run against a throwaway Postgres database:
--
--   createdb legacy_test
--   cd supabase/manual-tests && psql -q -d legacy_test -f 0036_drop_legacy_policies.test.sql
--   dropdb legacy_test
--
-- Any line containing FAIL is a regression.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select case when auth.uid() is null then 'anon' else 'authenticated' end
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create table public.organizations (id uuid primary key);
create table public.employees (id bigint primary key, org_id uuid not null, user_id uuid, name text, pay_rate numeric);
create table public.managers (org_id uuid not null, user_id uuid not null, primary key (org_id, user_id));
create table public.schedules (id bigserial primary key, org_id uuid not null, employee_id bigint not null,
  date date not null, start_minutes int not null, end_minutes int not null);
create table public.punch_records (id bigserial primary key, org_id uuid not null, employee_id bigint not null,
  punch_type text not null, punched_at timestamptz not null default now());
create table public.audit_logs (id bigserial primary key, org_id uuid not null, action text);
create table public.notifications (id bigserial primary key, org_id uuid not null, user_id uuid, title text);
create table public.store_hours (org_id uuid not null, day_of_week int not null, open_minutes int, close_minutes int,
  primary key (org_id, day_of_week));

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.managers  where user_id = auth.uid() and org_id = p_org
    union all
    select 1 from public.employees where user_id = auth.uid() and org_id = p_org
  );
$$;
create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.managers where user_id = auth.uid() and org_id = p_org);
$$;

do $$
declare t text;
begin
  foreach t in array array['employees', 'managers', 'schedules', 'punch_records', 'audit_logs', 'notifications', 'store_hours'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  -- The org-scoped policies (0003).
  foreach t in array array['employees', 'managers', 'schedules', 'store_hours'] loop
    execute format('create policy mt_select on public.%I for select using (public.is_org_member(org_id))', t);
    execute format('create policy mt_insert on public.%I for insert with check (public.is_org_manager(org_id))', t);
    execute format('create policy mt_update on public.%I for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id))', t);
    execute format('create policy mt_delete on public.%I for delete using (public.is_org_manager(org_id))', t);
  end loop;
end $$;
create policy mt_select on public.punch_records for select using (public.is_org_member(org_id));
create policy mt_write on public.punch_records for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy mt_select on public.notifications for select using (
  public.is_org_member(org_id) and (user_id = auth.uid() or (user_id is null and public.is_org_manager(org_id))));

-- The leftover single-tenant policies, as they appear in production.
create policy "auth read employees" on public.employees for select using (auth.role() = 'authenticated');
create policy authenticated_can_read_employees on public.employees for select using (auth.role() = 'authenticated');
create policy managers_can_update_employees on public.employees for update using (auth.uid() in (select managers.user_id from managers));
create policy managers_delete_employees on public.employees for delete using (exists (select 1 from managers where managers.user_id = auth.uid()));
create policy "auth read schedules" on public.schedules for select using (auth.role() = 'authenticated');
create policy "Auth Update" on public.schedules for update using (auth.uid() is not null);
create policy managers_can_insert_schedules on public.schedules for insert with check (auth.uid() in (select managers.user_id from managers));
create policy punch_records_managers_all on public.punch_records for all
  using (exists (select 1 from managers where managers.user_id = auth.uid()))
  with check (exists (select 1 from managers where managers.user_id = auth.uid()));
create policy audit_logs_managers_select on public.audit_logs for select using (exists (select 1 from managers where managers.user_id = auth.uid()));
create policy notifications_manager_broadcast_select on public.notifications for select
  using (user_id is null and exists (select 1 from managers where managers.user_id = auth.uid()));
create policy "users can read own manager row" on public.managers for select using (auth.uid() = user_id);
create policy "public read" on public.store_hours for select using (true);

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

\set alice   '''11111111-1111-1111-1111-111111111111'''
\set mia     '''33333333-3333-3333-3333-333333333333'''
\set visitor '''99999999-9999-9999-9999-999999999999'''
\set store   '''00000000-0000-0000-0000-00000000000a'''
\set demo    '''00000000-0000-0000-0000-000000000002'''

-- A customer store (Alice works there, Mia manages it) and the demo org,
-- where an anonymous visitor is a manager.
insert into organizations values (:store), (:demo);
insert into employees values (1, :store, :alice, 'Alice', 21.50), (2, :demo, null, 'Jordan', 15);
insert into managers values (:store, :mia), (:demo, :visitor);
insert into schedules (org_id, employee_id, date, start_minutes, end_minutes) values (:store, 1, '2030-01-10', 540, 1020);
insert into punch_records (org_id, employee_id, punch_type) values (:store, 1, 'clock_in');
insert into audit_logs (org_id, action) values (:store, 'employee.update');
insert into notifications (org_id, user_id, title) values (:store, null, 'Late Clock-In');
insert into store_hours values (:store, 1, 540, 1260);

-- Rows `uid` can see in `tbl` that belong to org `org`.
create or replace function pg_temp.visible(uid text, tbl text, org text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  execute format('select count(*) from public.%I where org_id = %L', tbl, org) into n;
  execute 'reset role';
  return n;
end $$;

-- Rows changed by a statement run as `uid` (errors count as 0).
create or replace function pg_temp.changed(uid text, stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  execute stmt;
  get diagnostics n = row_count;
  execute 'reset role';
  return n;
exception when others then
  execute 'reset role';
  return 0;
end $$;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

begin;

-- Before 0036: the demo visitor reaches into the customer store.
select pg_temp.check('before: a demo visitor reads the store''s employees',
  pg_temp.visible(:visitor, 'employees', :store) = 1);
select pg_temp.check('before: …its punches', pg_temp.visible(:visitor, 'punch_records', :store) = 1);
select pg_temp.check('before: …and its audit log', pg_temp.visible(:visitor, 'audit_logs', :store) = 1);
select pg_temp.check('before: …and can rewrite its schedule',
  pg_temp.changed(:visitor, $q$update schedules set start_minutes = 0 where org_id = '00000000-0000-0000-0000-00000000000a'$q$) = 1);
update schedules set start_minutes = 540;

\ir ../migrations/0036_drop_legacy_policies.sql

-- After: nothing outside your own organizations.
select pg_temp.check('after: the demo visitor sees none of the store''s employees',
  pg_temp.visible(:visitor, 'employees', :store) = 0);
select pg_temp.check('…schedules', pg_temp.visible(:visitor, 'schedules', :store) = 0);
select pg_temp.check('…punches', pg_temp.visible(:visitor, 'punch_records', :store) = 0);
select pg_temp.check('…audit log', pg_temp.visible(:visitor, 'audit_logs', :store) = 0);
select pg_temp.check('…manager alerts', pg_temp.visible(:visitor, 'notifications', :store) = 0);
select pg_temp.check('…store hours', pg_temp.visible(:visitor, 'store_hours', :store) = 0);
select pg_temp.check('…and can no longer change its schedule',
  pg_temp.changed(:visitor, $q$update schedules set start_minutes = 0 where org_id = '00000000-0000-0000-0000-00000000000a'$q$) = 0);
select pg_temp.check('…or its employees',
  pg_temp.changed(:visitor, $q$update employees set user_id = auth.uid() where org_id = '00000000-0000-0000-0000-00000000000a'$q$) = 0);
select pg_temp.check('…or add shifts to it',
  pg_temp.changed(:visitor, $q$insert into schedules (org_id, employee_id, date, start_minutes, end_minutes) values ('00000000-0000-0000-0000-00000000000a', 1, '2030-01-11', 540, 1020)$q$) = 0);
select pg_temp.check('a signed-in user outside the org can''t read its employees either',
  pg_temp.visible('55555555-5555-5555-5555-555555555555', 'employees', :store) = 0);

-- Own-org access is unchanged.
select pg_temp.check('the demo visitor still sees the demo org', pg_temp.visible(:visitor, 'employees', :demo) = 1);
select pg_temp.check('the store''s manager sees its employees', pg_temp.visible(:mia, 'employees', :store) = 1);
select pg_temp.check('…its punches', pg_temp.visible(:mia, 'punch_records', :store) = 1);
select pg_temp.check('…its manager alerts', pg_temp.visible(:mia, 'notifications', :store) = 1);
select pg_temp.check('…and still edits its schedule',
  pg_temp.changed(:mia, $q$update schedules set end_minutes = 1000$q$) = 1);
select pg_temp.check('the employee sees their own store''s schedule', pg_temp.visible(:alice, 'schedules', :store) = 1);
select pg_temp.check('…and can read the store''s roster',
  pg_temp.visible(:alice, 'employees', :store) = 1);
select pg_temp.check('the manager can read their own managers row', pg_temp.visible(:mia, 'managers', :store) = 1);

rollback;
