-- Authorization hardening: make the database enforce what the API enforces.
--
-- The browser holds the anon key and the user's JWT, so anyone signed in can
-- skip the API and call PostgREST directly. Until now several tables relied
-- on the API alone for "managers only" rules: RLS let any member of the org
-- write them. With nothing but a session, an employee could approve their own
-- time off, mark a coworker's swap as accepted, post or delete announcements,
-- cancel open shifts, or edit positions; any org manager (every demo visitor
-- is one) could add or remove managers rows and link any user id to an
-- employee row. (The notify_* functions, callable by every role, are locked
-- down separately in 0038, which has to wait for the app change it needs.)
--
--   1. Member-writable tables: managers write; employees write only their own
--      rows, in the states the API allows.
--   2. shift_swaps: the target employee may only move a pending swap to
--      accepted or declined (trigger), nothing else.
--   3. managers: no direct writes from end users. Roles change through
--      manager_promote / manager_demote (0029), sign-up through
--      org_signup_create (0007), and everything else through the service role.
--   4. employees.user_id: an end user can link an employee row only to their
--      own account (or unlink it).
--   5. punch_records: employees read only their own punches; managers read
--      the org's. draft_schedules: managers only, as the drafts migration
--      intended (0005 had widened reads to every member).
--   6. Live punches are serialized per employee and re-checked against the
--      latest punch, so a double tap, a retry or two devices racing through
--      the API's check-then-insert can't record the same step twice.
--
-- Works with the app code from before this branch: nothing here depends on
-- a deploy.
--
-- Same conventions as 0034: no begin/commit around the file, and every
-- statement is safe to repeat. Needs 0020 (announcements) and 0031
-- (is_own_employee) applied first.

-- ---------------------------------------------------------------------------
-- 1. Member-writable tables.
-- ---------------------------------------------------------------------------

-- availability: your own rows, or a manager.
drop policy if exists mt_write on public.availability;
create policy mt_write on public.availability
  for all
  using (public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id))
  with check (public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id));

-- time_off_requests: employees file their own requests as pending; only
-- managers decide, edit or delete them.
drop policy if exists mt_write on public.time_off_requests;
drop policy if exists mt_insert on public.time_off_requests;
create policy mt_insert on public.time_off_requests
  for insert with check (
    public.is_org_manager(org_id)
    or (public.is_own_employee(org_id, employee_id) and coalesce(status, 'pending') = 'pending')
  );
drop policy if exists mt_update on public.time_off_requests;
create policy mt_update on public.time_off_requests
  for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));
drop policy if exists mt_delete on public.time_off_requests;
create policy mt_delete on public.time_off_requests
  for delete using (public.is_org_manager(org_id));

-- shift_swaps: the requester files a pending swap for their own shift; the
-- target answers it (narrowed further by the trigger in section 2); managers
-- decide and may delete.
drop policy if exists mt_write on public.shift_swaps;
drop policy if exists mt_insert on public.shift_swaps;
create policy mt_insert on public.shift_swaps
  for insert with check (
    public.is_org_manager(org_id)
    or (public.is_own_employee(org_id, requester_id) and coalesce(status, 'pending') = 'pending')
  );
drop policy if exists mt_update on public.shift_swaps;
create policy mt_update on public.shift_swaps
  for update
  using (public.is_org_manager(org_id) or public.is_own_employee(org_id, target_id))
  with check (public.is_org_manager(org_id) or public.is_own_employee(org_id, target_id));
drop policy if exists mt_delete on public.shift_swaps;
create policy mt_delete on public.shift_swaps
  for delete using (public.is_org_manager(org_id));

-- callouts: your own call-outs, or a manager. enforce_callout_rules (0032)
-- still applies the day rules to inserts and updates.
drop policy if exists mt_write on public.callouts;
create policy mt_write on public.callouts
  for all
  using (public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id))
  with check (public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id));

-- open_shift_claims: employees file (and re-file) their own claims as
-- pending; managers approve or deny.
drop policy if exists mt_write on public.open_shift_claims;
create policy mt_write on public.open_shift_claims
  for all
  using (public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id))
  with check (
    public.is_org_manager(org_id)
    or (public.is_own_employee(org_id, employee_id) and status = 'pending')
  );

-- Manager-only tables: members read, managers write.
do $$
declare
  t text;
begin
  foreach t in array array['open_shifts', 'positions', 'announcements'] loop
    execute format('drop policy if exists mt_write on public.%I', t);
    execute format('drop policy if exists mt_insert on public.%I', t);
    execute format('create policy mt_insert on public.%I for insert with check (public.is_org_manager(org_id))', t);
    execute format('drop policy if exists mt_update on public.%I', t);
    execute format('create policy mt_update on public.%I for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id))', t);
    execute format('drop policy if exists mt_delete on public.%I', t);
    execute format('create policy mt_delete on public.%I for delete using (public.is_org_manager(org_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A target employee answers a swap; they can't rewrite it.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_swap_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_org_manager(old.org_id) then
    return new;
  end if;
  -- RLS lets only the target employee get this far.
  if old.status is distinct from 'pending'
     or new.status not in ('accepted', 'declined')
     or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'You can only accept or decline a pending swap' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists shift_swaps_response on public.shift_swaps;
create trigger shift_swaps_response
  before update on public.shift_swaps
  for each row execute function public.enforce_swap_response();

-- ---------------------------------------------------------------------------
-- 3. managers: no direct writes by end users.
-- ---------------------------------------------------------------------------
drop policy if exists mt_insert on public.managers;
drop policy if exists mt_update on public.managers;
drop policy if exists mt_delete on public.managers;

-- ---------------------------------------------------------------------------
-- 4. employees.user_id: link only yourself.
--
-- A manager linking someone else's account to an employee row would make
-- that person a member of the manager's org, and deleting the row used to
-- delete their account. The invite flow, sign-up and the demo link run as the
-- service role (no auth.uid()) and are unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.protect_employee_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;
  if (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and new.user_id is not null and new.user_id <> v_uid then
    raise exception 'You can only link an employee record to your own account' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_protect_link on public.employees;
create trigger employees_protect_link
  before insert or update on public.employees
  for each row execute function public.protect_employee_link();

-- ---------------------------------------------------------------------------
-- 5. punch_records: your own punches, or a manager.
--
-- 0003's mt_write was FOR ALL, which also granted SELECT to every member, so
-- it is split up here. enforce_punch_integrity (0030/0031, redefined below)
-- still decides which writes are allowed.
-- ---------------------------------------------------------------------------
drop policy if exists mt_write on public.punch_records;
drop policy if exists mt_select on public.punch_records;
create policy mt_select on public.punch_records
  for select using (
    public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id)
  );
drop policy if exists mt_insert on public.punch_records;
create policy mt_insert on public.punch_records
  for insert with check (
    public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id)
  );
drop policy if exists mt_update on public.punch_records;
create policy mt_update on public.punch_records
  for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));
drop policy if exists mt_delete on public.punch_records;
create policy mt_delete on public.punch_records
  for delete using (public.is_org_manager(org_id));

-- Unpublished drafts are a manager's plan; employees see shifts once published.
drop policy if exists mt_select on public.draft_schedules;
create policy mt_select on public.draft_schedules
  for select using (public.is_org_manager(org_id));

-- ---------------------------------------------------------------------------
-- 6. Live punches: one at a time per employee, each a valid next step.
--
-- 0031's function plus the block marked below. The API checks the step
-- before inserting; this repeats the check under a per-employee lock so two
-- requests can't both pass it. Rules match the API's state machine:
--   break_start, clock_out  after clock_in or break_end
--   break_end               after break_start
--   clock_in                after clock_out or nothing, or when the open
--                           punch is over a minute old (the API lets a new
--                           shift start once yesterday's was left open).
-- Managers' manual punches and the service role are not checked here.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_punch_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_manager boolean;
  v_last_type text;
  v_last_at timestamptz;
  v_valid boolean;
begin
  if v_uid is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if not public.is_org_manager(old.org_id) then
      raise exception 'Only managers can delete punches' using errcode = '42501';
    end if;
    return old;
  end if;

  v_is_manager := public.is_org_manager(new.org_id);

  if tg_op = 'UPDATE' then
    if not v_is_manager then
      raise exception 'Only managers can edit punches' using errcode = '42501';
    end if;
    if new.punched_at is distinct from old.punched_at then
      if new.punched_at > now() then
        raise exception 'punched_at cannot be in the future' using errcode = '22007';
      end if;
      new.is_manual := true;
    end if;
    return new;
  end if;

  -- INSERT
  if not v_is_manager then
    if not public.is_own_employee(new.org_id, new.employee_id) then
      raise exception 'You can only record punches for yourself' using errcode = '42501';
    end if;
    if coalesce(new.is_manual, false) then
      raise exception 'Punch corrections need manager approval' using errcode = '42501';
    end if;
  end if;

  if not coalesce(new.is_manual, false) then
    -- New in 0035: serialize and re-check.
    perform pg_advisory_xact_lock(
      hashtextextended('punch:' || new.org_id::text || ':' || new.employee_id::text, 0)
    );
    -- clock_timestamp(), not now(): a punch committed while this one waited
    -- for the lock may carry a later transaction start than ours.
    select punch_type, punched_at into v_last_type, v_last_at
      from public.punch_records
     where org_id = new.org_id and employee_id = new.employee_id
       and punched_at <= clock_timestamp()
     order by punched_at desc, id desc
     limit 1;
    v_valid := case new.punch_type
      when 'clock_in'    then v_last_type is null or v_last_type = 'clock_out'
                              or v_last_at < clock_timestamp() - interval '1 minute'
      when 'break_start' then coalesce(v_last_type in ('clock_in', 'break_end'), false)
      when 'break_end'   then coalesce(v_last_type = 'break_start', false)
      when 'clock_out'   then coalesce(v_last_type in ('clock_in', 'break_end'), false)
      else true
    end;
    if not v_valid then
      raise exception 'Punch conflicts with the latest punch (%)', coalesce(v_last_type, 'none')
        using errcode = '23P01';
    end if;

    -- Live punch: the server clock is the only source of truth. Stamped
    -- after the lock so punches are in the order they were accepted.
    new.punched_at := clock_timestamp();
    return new;
  end if;

  if new.punched_at is null then
    raise exception 'Manual punches require punched_at' using errcode = '23502';
  end if;
  if new.punched_at > now() then
    raise exception 'punched_at cannot be in the future' using errcode = '22007';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
