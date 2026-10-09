-- Behavioural tests for supabase/migrations/0035_authorization_hardening.sql
-- and 0038_notify_service_role_only.sql (applied on top of 0030 and 0031).
--
-- Self-contained: builds a minimal stand-in schema with the pre-0035 policies
-- (members write the member-writable tables, managers write managers), applies
-- the migrations, then runs each case as the `authenticated` role so
-- row-level security applies, printing PASS/FAIL notices. Run against a
-- throwaway Postgres database:
--
--   createdb authz_test
--   cd supabase/manual-tests && psql -q -d authz_test -f 0035_authorization_hardening.test.sql
--   dropdb authz_test
--
-- Any line containing FAIL is a regression.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- Supabase's API roles.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls; -- as on Supabase

create table public.organizations (id uuid primary key);
create table public.employees (
  id bigint primary key, org_id uuid not null references public.organizations (id),
  user_id uuid, name text, email text, unique (id, org_id)
);
create table public.managers (org_id uuid not null, user_id uuid not null, is_owner boolean not null default false,
  primary key (org_id, user_id));
create table public.punch_records (
  id bigserial primary key, org_id uuid not null, employee_id bigint not null, schedule_id int,
  punch_type text not null, punched_at timestamptz not null default now(),
  is_manual boolean not null default false, note text, lat double precision, lng double precision
);
create table public.availability (id bigserial primary key, org_id uuid not null, employee_id bigint not null,
  day_of_week int not null, start_minutes int, end_minutes int, note text);
create table public.time_off_requests (id bigserial primary key, org_id uuid not null, employee_id bigint not null,
  date date not null, status text not null default 'pending', note text);
create table public.shift_swaps (id bigserial primary key, org_id uuid not null, requester_id bigint not null,
  target_id bigint not null, schedule_a_id bigint not null, schedule_b_id bigint not null,
  status text not null default 'pending', created_at timestamptz not null default now());
create table public.callouts (id bigserial primary key, org_id uuid not null, employee_id bigint not null,
  date date not null, reason text);
create table public.open_shifts (id bigserial primary key, org_id uuid not null, date date not null,
  start_minutes int not null, end_minutes int not null, status text not null default 'open', filled_by bigint);
create table public.open_shift_claims (id bigserial primary key, org_id uuid not null, open_shift_id bigint not null,
  employee_id bigint not null, status text not null default 'pending', unique (org_id, open_shift_id, employee_id));
create table public.positions (id bigserial primary key, org_id uuid not null, name text not null);
create table public.announcements (id bigserial primary key, org_id uuid not null, title text not null, body text not null);
create table public.draft_schedules (id bigserial primary key, org_id uuid not null, employee_id bigint not null,
  date date not null, start_minutes int not null, end_minutes int not null);
create table public.notifications (id bigserial primary key, org_id uuid not null, user_id uuid, type text,
  title text, body text, data jsonb);

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

-- notify RPCs as 0003 left them (callable by anyone), plus a stand-in for one
-- of the pre-repo functions.
create or replace function public.notify_insert(
  p_org_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, type, title, body, data)
  values (p_org_id, p_user_id, p_type, p_title, p_body, p_data);
$$;
create or replace function public.notify_get_push_subs(p_user_id uuid)
returns table (endpoint text) language sql stable security definer set search_path = public as $$
  select 'https://push.example/' || p_user_id::text;
$$;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Policies as they stood before 0035.
do $$
declare t text;
begin
  foreach t in array array['employees', 'managers', 'punch_records', 'availability', 'time_off_requests',
    'shift_swaps', 'callouts', 'open_shifts', 'open_shift_claims', 'positions', 'announcements',
    'draft_schedules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy mt_select on public.%I for select using (public.is_org_member(org_id))', t);
  end loop;
  foreach t in array array['employees', 'managers', 'draft_schedules'] loop
    execute format('create policy mt_insert on public.%I for insert with check (public.is_org_manager(org_id))', t);
    execute format('create policy mt_update on public.%I for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id))', t);
    execute format('create policy mt_delete on public.%I for delete using (public.is_org_manager(org_id))', t);
  end loop;
  foreach t in array array['punch_records', 'availability', 'time_off_requests', 'shift_swaps', 'callouts',
    'open_shifts', 'open_shift_claims', 'positions', 'announcements'] loop
    execute format('create policy mt_write on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t);
  end loop;
end $$;

\set alice '''11111111-1111-1111-1111-111111111111'''
\set bob   '''22222222-2222-2222-2222-222222222222'''
\set mia   '''33333333-3333-3333-3333-333333333333'''
\set zoe   '''44444444-4444-4444-4444-444444444444'''
\set org   '''00000000-0000-0000-0000-00000000000a'''
\set orgb  '''00000000-0000-0000-0000-00000000000b'''

insert into organizations values (:org), (:orgb);
insert into employees values
  (1, :org,  :alice, 'Alice', 'alice@example.com'),
  (2, :org,  :bob,   'Bob',   'bob@example.com'),
  (3, :org,  null,   'Unlinked', null),
  (4, :orgb, :zoe,   'Zoe',   'zoe@example.com');
insert into managers (org_id, user_id) values (:org, :mia);

\ir ../migrations/0030_punch_timestamp_integrity.sql
\ir ../migrations/0031_punch_correction_requests.sql
\ir ../migrations/0035_authorization_hardening.sql
\ir ../migrations/0038_notify_service_role_only.sql

grant usage on schema public, auth to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Seed rows as the table owner (no auth.uid(): the trusted path).
insert into time_off_requests (org_id, employee_id, date) values (:org, 1, '2030-01-10'), (:org, 2, '2030-01-11');
insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id) values (:org, 1, 2, 10, 20);
insert into callouts (org_id, employee_id, date) values (:org, 2, '2030-01-12');
insert into open_shifts (org_id, date, start_minutes, end_minutes) values (:org, '2030-01-13', 540, 1020);
insert into availability (org_id, employee_id, day_of_week, start_minutes, end_minutes) values (:org, 1, 1, 540, 1020), (:org, 2, 1, 540, 1020);
insert into announcements (org_id, title, body) values (:org, 'Welcome', 'Hi');
insert into punch_records (org_id, employee_id, punch_type, punched_at) values (:org, 2, 'clock_in', now() - interval '3 hours');
insert into draft_schedules (org_id, employee_id, date, start_minutes, end_minutes) values (:org, 1, '2030-01-15', 540, 1020);

-- Runs one statement as `role` with auth.uid() = uid; expect_error says
-- whether it should be rejected. "0 rows" outcomes are checked separately.
create or replace function pg_temp.run(label text, uid text, stmt text, expect_error boolean, role text default 'authenticated')
returns void language plpgsql as $$
declare n int;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute format('set local role %I', role);
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

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

-- Rows `uid` can see in `tbl` that match `cond`.
create or replace function pg_temp.visible(uid text, tbl text, cond text default 'true') returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(uid, ''), true);
  execute 'set local role authenticated';
  execute format('select count(*) from public.%I where %s', tbl, cond) into n;
  execute 'reset role';
  return n;
end $$;

begin;

-- Time off: file your own as pending; only a manager decides.
select pg_temp.run('employee files their own pending time off', :alice,
  format($q$insert into time_off_requests (org_id, employee_id, date) values (%L, 1, '2030-02-01')$q$, :org), false);
select pg_temp.run('employee cannot file pre-approved time off', :alice,
  format($q$insert into time_off_requests (org_id, employee_id, date, status) values (%L, 1, '2030-02-02', 'approved')$q$, :org), true);
select pg_temp.run('employee cannot file time off for a coworker', :alice,
  format($q$insert into time_off_requests (org_id, employee_id, date) values (%L, 2, '2030-02-03')$q$, :org), true);
select pg_temp.run('employee approving their own time off changes nothing', :alice,
  $q$update time_off_requests set status = 'approved' where employee_id = 1$q$, false);
select pg_temp.check('…it is still pending', (select bool_and(status = 'pending') from time_off_requests where employee_id = 1));
select pg_temp.run('employee deleting a coworker''s request changes nothing', :alice,
  $q$delete from time_off_requests where employee_id = 2$q$, false);
select pg_temp.check('…it still exists', (select count(*) = 1 from time_off_requests where employee_id = 2));
select pg_temp.run('manager approves time off', :mia,
  $q$update time_off_requests set status = 'approved' where employee_id = 2$q$, false);
select pg_temp.check('…it is approved', (select status = 'approved' from time_off_requests where employee_id = 2));

-- Swaps: requester files, target answers, manager decides.
select pg_temp.run('requester files a pending swap for their own shift', :alice,
  format($q$insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id) values (%L, 1, 2, 11, 21)$q$, :org), false);
select pg_temp.run('employee cannot file a swap for a coworker''s shift', :alice,
  format($q$insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id) values (%L, 2, 1, 21, 11)$q$, :org), true);
select pg_temp.run('employee cannot file a pre-accepted swap', :alice,
  format($q$insert into shift_swaps (org_id, requester_id, target_id, schedule_a_id, schedule_b_id, status) values (%L, 1, 2, 12, 22, 'accepted')$q$, :org), true);
select pg_temp.run('requester marking their own swap accepted changes nothing', :alice,
  $q$update shift_swaps set status = 'accepted' where schedule_a_id = 10$q$, false);
select pg_temp.check('…it is still pending', (select status = 'pending' from shift_swaps where schedule_a_id = 10));
select pg_temp.run('target cannot approve a swap', :bob,
  $q$update shift_swaps set status = 'approved' where schedule_a_id = 10$q$, true);
select pg_temp.run('target cannot swap in a different shift while answering', :bob,
  $q$update shift_swaps set status = 'accepted', schedule_b_id = 99 where schedule_a_id = 10$q$, true);
select pg_temp.run('target accepts a pending swap', :bob,
  $q$update shift_swaps set status = 'accepted' where schedule_a_id = 10$q$, false);
select pg_temp.run('target cannot change their answer afterwards', :bob,
  $q$update shift_swaps set status = 'declined' where schedule_a_id = 10$q$, true);
select pg_temp.run('manager approves the accepted swap', :mia,
  $q$update shift_swaps set status = 'approved' where schedule_a_id = 10$q$, false);
select pg_temp.check('…it is approved', (select status = 'approved' from shift_swaps where schedule_a_id = 10));
select pg_temp.run('employee deleting a swap changes nothing', :bob, $q$delete from shift_swaps$q$, false);
select pg_temp.check('…both swaps still exist', (select count(*) = 2 from shift_swaps));

-- Manager-only tables.
select pg_temp.run('employee cannot post an announcement', :alice,
  format($q$insert into announcements (org_id, title, body) values (%L, 'Free pizza', 'x')$q$, :org), true);
select pg_temp.run('employee deleting an announcement changes nothing', :alice, $q$delete from announcements$q$, false);
select pg_temp.check('…it still exists', (select count(*) = 1 from announcements));
select pg_temp.run('manager posts an announcement', :mia,
  format($q$insert into announcements (org_id, title, body) values (%L, 'Inventory', 'Saturday')$q$, :org), false);
select pg_temp.run('employee cannot create a position', :alice,
  format($q$insert into positions (org_id, name) values (%L, 'Boss')$q$, :org), true);
select pg_temp.run('manager creates a position', :mia,
  format($q$insert into positions (org_id, name) values (%L, 'Cashier')$q$, :org), false);
select pg_temp.run('employee cannot post an open shift', :alice,
  format($q$insert into open_shifts (org_id, date, start_minutes, end_minutes) values (%L, '2030-01-14', 540, 1020)$q$, :org), true);
select pg_temp.run('employee filling an open shift for themselves changes nothing', :alice,
  $q$update open_shifts set status = 'filled', filled_by = 1$q$, false);
select pg_temp.check('…it is still open', (select bool_and(status = 'open') from open_shifts));

-- Open shift claims: your own, pending.
select pg_temp.run('employee claims an open shift', :alice,
  format($q$insert into open_shift_claims (org_id, open_shift_id, employee_id) values (%L, 1, 1)$q$, :org), false);
select pg_temp.run('employee re-files their claim (upsert) as pending', :alice,
  format($q$insert into open_shift_claims (org_id, open_shift_id, employee_id, status) values (%L, 1, 1, 'pending')
           on conflict (org_id, open_shift_id, employee_id) do update set status = 'pending'$q$, :org), false);
select pg_temp.run('employee cannot approve their own claim', :alice,
  $q$update open_shift_claims set status = 'approved' where employee_id = 1$q$, true);
select pg_temp.run('employee cannot claim for a coworker', :alice,
  format($q$insert into open_shift_claims (org_id, open_shift_id, employee_id) values (%L, 1, 2)$q$, :org), true);
select pg_temp.run('manager approves a claim', :mia,
  $q$update open_shift_claims set status = 'approved' where employee_id = 1$q$, false);

-- Availability and call-outs: your own, or a manager.
select pg_temp.run('employee edits their own availability', :alice,
  $q$update availability set end_minutes = 960 where employee_id = 1$q$, false);
select pg_temp.check('…saved', (select end_minutes = 960 from availability where employee_id = 1));
select pg_temp.run('employee editing a coworker''s availability changes nothing', :alice,
  $q$update availability set end_minutes = 600 where employee_id = 2$q$, false);
select pg_temp.check('…unchanged', (select end_minutes = 1020 from availability where employee_id = 2));
select pg_temp.run('employee cannot add availability for a coworker', :alice,
  format($q$insert into availability (org_id, employee_id, day_of_week) values (%L, 2, 3)$q$, :org), true);
select pg_temp.run('employee deleting a coworker''s call-out changes nothing', :alice,
  $q$delete from callouts where employee_id = 2$q$, false);
select pg_temp.check('…it still exists', (select count(*) = 1 from callouts));
select pg_temp.run('the employee rescinds their own call-out', :bob,
  $q$delete from callouts where employee_id = 2$q$, false);
select pg_temp.check('…it is gone', (select count(*) = 0 from callouts));

-- Managers: no direct writes.
select pg_temp.run('manager cannot add a manager row directly', :mia,
  format($q$insert into managers (org_id, user_id) values (%L, %L)$q$, :org, :alice), true);
select pg_temp.run('manager deleting manager rows directly changes nothing', :mia, $q$delete from managers$q$, false);
select pg_temp.check('…the manager row still exists', (select count(*) = 1 from managers));
select pg_temp.check('managers can still read the org''s managers', pg_temp.visible(:mia, 'managers') = 1);

-- Employee links: yourself only.
select pg_temp.run('manager cannot link another user to an employee row', :mia,
  $q$update employees set user_id = '44444444-4444-4444-4444-444444444444' where id = 3$q$, true);
select pg_temp.run('manager cannot insert an employee linked to another user', :mia,
  format($q$insert into employees (id, org_id, user_id, name) values (5, %L, %L, 'Zoe again')$q$, :org, :zoe), true);
select pg_temp.run('manager can still rename an employee', :mia,
  $q$update employees set name = 'Alice B' where id = 1$q$, false);
select pg_temp.run('manager can link a row to their own account', :mia,
  $q$update employees set user_id = '33333333-3333-3333-3333-333333333333' where id = 3$q$, false);
select pg_temp.run('manager can unlink a row', :mia, $q$update employees set user_id = null where id = 3$q$, false);
select pg_temp.run('the service role can link anyone (invites, demo)', null,
  $q$update employees set user_id = '44444444-4444-4444-4444-444444444444' where id = 3$q$, false, 'service_role');
select pg_temp.check('…linked', (select user_id = '44444444-4444-4444-4444-444444444444' from employees where id = 3));
update employees set user_id = null where id = 3;

-- Punch visibility.
select pg_temp.check('an employee only sees their own punches', pg_temp.visible(:alice, 'punch_records') = 0);
select pg_temp.check('…the coworker sees theirs', pg_temp.visible(:bob, 'punch_records') = 1);
select pg_temp.check('the manager sees the org''s punches', pg_temp.visible(:mia, 'punch_records') = 1);
select pg_temp.check('another org sees none', pg_temp.visible(:zoe, 'punch_records') = 0);
select pg_temp.check('employees don''t see unpublished drafts, even their own', pg_temp.visible(:alice, 'draft_schedules') = 0);
select pg_temp.check('the manager sees drafts', pg_temp.visible(:mia, 'draft_schedules') = 1);

-- Live punches follow the state machine.
select pg_temp.run('clock in', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'clock_in')$q$, :org), false);
select pg_temp.run('a second clock-in right after is rejected (double submit)', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'clock_in')$q$, :org), true);
select pg_temp.run('ending a break that never started is rejected', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'break_end')$q$, :org), true);
select pg_temp.run('start a break', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'break_start')$q$, :org), false);
select pg_temp.run('a second break start is rejected', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'break_start')$q$, :org), true);
select pg_temp.run('clocking out mid-break is rejected', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'clock_out')$q$, :org), true);
select pg_temp.run('end the break', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'break_end')$q$, :org), false);
select pg_temp.run('clock out', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'clock_out')$q$, :org), false);
select pg_temp.run('a second clock-out is rejected', :alice,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 1, 'clock_out')$q$, :org), true);
select pg_temp.check('alice''s punches are in accepted order',
  (select array_agg(punch_type order by punched_at, id) = array['clock_in', 'break_start', 'break_end', 'clock_out']
     from punch_records where employee_id = 1));
select pg_temp.run('a new shift can start after an old one was left open', :bob,
  format($q$insert into punch_records (org_id, employee_id, punch_type) values (%L, 2, 'clock_in')$q$, :org), false);
select pg_temp.run('managers can still add manual punches out of sequence', :mia,
  format($q$insert into punch_records (org_id, employee_id, punch_type, punched_at, is_manual, note)
           values (%L, 2, 'clock_in', now() - interval '2 hours', true, 'fix')$q$, :org), false);

-- notify_* functions: service role only.
select pg_temp.run('a signed-in user cannot write notifications into another org', :alice,
  format($q$select public.notify_insert(%L, %L, 'message', 'Hi', 'x', null)$q$, :orgb, :zoe), true);
select pg_temp.run('an anonymous caller cannot either', null,
  format($q$select public.notify_insert(%L, %L, 'message', 'Hi', 'x', null)$q$, :orgb, :zoe), true, 'anon');
select pg_temp.run('a signed-in user cannot read someone''s push subscriptions', :alice,
  format($q$select * from public.notify_get_push_subs(%L)$q$, :zoe), true);
select pg_temp.run('the service role can notify', null,
  format($q$select public.notify_insert(%L, %L, 'message', 'Hi', 'x', null)$q$, :orgb, :zoe), false, 'service_role');
select pg_temp.check('…one notification written', (select count(*) = 1 from notifications));

rollback;
