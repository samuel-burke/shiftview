-- Database audit fixes: RLS speed, integrity and privilege hardening.
--
-- An audit of the live database (2026-10-09) against this repo found:
--
--   1. RLS cost per row. Every policy called is_org_member / is_org_manager /
--      is_own_employee for each row it checked. They are SECURITY DEFINER, so
--      Postgres can't inline them, and each call runs its own lookup. On 50,000
--      schedules that is ~270 ms of policy checks for one org's rows. The
--      policies now compare against the caller's org and employee ids,
--      fetched once per query (my_org_ids, my_managed_org_ids, my_employees),
--      which takes the same scan to ~13 ms and a month's shifts or a quarter's
--      punches from 7-35 ms to ~1 ms. Who can see and write what is unchanged.
--      The per-user policies also read auth.uid() once per query instead of
--      once per row, and tables whose "write" policy was FOR ALL no longer
--      evaluate two policies on every SELECT.
--   2. The database was weaker than the API in four places:
--      * manager_promote / manager_demote let any manager change roles, and
--        promote any user id at all. The API lets only the owner change roles
--        (when the org has one) and only promotes members.
--      * approve_shift_swap swapped whatever the two shifts' owners were at
--        approval time; a swap filed for a shift the requester didn't own, or
--        whose shifts changed hands since, moved the wrong people's shifts.
--        It now returns 'stale' unless the requester still owns shift A and
--        the target shift B, and employees can only file swaps that way.
--      * messages: either party could rewrite a message's body, sender or
--        organization, and the stored conversation_id was trusted as given.
--        Now only the recipient can update, and only the read flag;
--        conversation_id must be the sender/recipient pair.
--      * notifications: a user could rewrite their own notifications' text
--        and type. Now only read / is_cleared can change.
--   3. audit_logs: the reports page subscribes to new audit entries, but the
--      table had no policy, so nothing was ever delivered. Managers now read
--      their own org's entries (the same rows /api/audit-log already returns
--      them); nobody else, and still no end-user writes.
--   4. Integrity:
--      * schedules kept a pre-repo check start_minutes > 0, so a shift
--        starting at 12:00 AM failed with a 500 although the API allows it.
--        It and four other checks are implied by schedules_shift_times (0033),
--        which, like the other *_shift_times checks, is now validated.
--      * open_shift_claims, coverage blocks / day defaults / date overrides,
--        and draft_schedules.generation_run_id could point at a row in another
--        organization. They now use (id, org_id) foreign keys like the rest
--        of the schema. punch_corrections.punch_id had no foreign key at all.
--      * The coverage tables and draft_schedules defaulted org_id to the
--        default organization, so a write that forgot org_id landed there
--        instead of failing.
--      * employees: one email per organization (case-insensitive), matching
--        the invite check, and the sign-up trigger matches emails without
--        regard to case and can no longer fail for every organization because
--        of one.
--   5. Indexes: added the ones per-employee punch queries, notification lists,
--      membership lookups and shift deletes need; dropped eight duplicates.
--   6. Privileges: trigger functions and the old RLS helpers are no longer
--      callable through the API; anon can't write any table; nobody but the
--      service role can TRUNCATE (which skips RLS).
--   7. employee_pay_rates(org): pay rates for managers, for the app to read
--      before 0042 hides employees.pay_rate from the API.
--
-- Works with the app code from before this branch: nothing here depends on a
-- deploy. Same conventions as 0035: no begin/commit around the file, and every
-- statement is safe to repeat.

-- ---------------------------------------------------------------------------
-- 1. Set-returning RLS helpers. Called as "x in (select helper())" so they run
--    once per query. SECURITY DEFINER so they can read managers / employees
--    without going through those tables' own policies.
-- ---------------------------------------------------------------------------

create or replace function public.my_org_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select org_id from public.managers  where user_id = auth.uid()
  union
  select org_id from public.employees where user_id = auth.uid()
$$;

create or replace function public.my_managed_org_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select org_id from public.managers where user_id = auth.uid()
$$;

-- The employee rows linked to the caller, with their org: a policy checks
-- (org_id, employee_id) against these, exactly like is_own_employee did.
create or replace function public.my_employees()
returns table (org_id uuid, employee_id bigint)
language sql stable security definer set search_path = public
as $$
  select e.org_id, e.id::bigint from public.employees e where e.user_id = auth.uid()
$$;

revoke all on function public.my_org_ids(), public.my_managed_org_ids(), public.my_employees()
  from public, anon;
grant execute on function public.my_org_ids(), public.my_managed_org_ids(), public.my_employees()
  to authenticated, service_role;

-- my_org_ids / my_managed_org_ids look managers up by user_id alone.
create index if not exists managers_user_idx on public.managers (user_id);

-- ---------------------------------------------------------------------------
-- 2. Policies. Same rules as before (README "Row Level Security"), written
--    against the helpers above, and for signed-in users only: anon has no
--    session, so every policy already evaluated to false for it.
-- ---------------------------------------------------------------------------

-- Members read; managers write.
do $$
declare
  t text;
begin
  foreach t in array array[
    'announcements', 'app_settings', 'coverage_date_overrides', 'coverage_day_defaults',
    'coverage_profile_blocks', 'coverage_profiles', 'employees', 'open_shifts', 'positions',
    'schedule_template_rows', 'schedule_templates', 'schedules', 'store_hours'
  ] loop
    execute format('drop policy if exists mt_select on public.%I', t);
    execute format('drop policy if exists mt_insert on public.%I', t);
    execute format('drop policy if exists mt_update on public.%I', t);
    execute format('drop policy if exists mt_delete on public.%I', t);
    execute format('drop policy if exists mt_write on public.%I', t);
    execute format(
      'create policy mt_select on public.%I for select to authenticated'
      || ' using (org_id in (select public.my_org_ids()))', t);
    execute format(
      'create policy mt_insert on public.%I for insert to authenticated'
      || ' with check (org_id in (select public.my_managed_org_ids()))', t);
    execute format(
      'create policy mt_update on public.%I for update to authenticated'
      || ' using (org_id in (select public.my_managed_org_ids()))'
      || ' with check (org_id in (select public.my_managed_org_ids()))', t);
    execute format(
      'create policy mt_delete on public.%I for delete to authenticated'
      || ' using (org_id in (select public.my_managed_org_ids()))', t);
  end loop;
end $$;

-- draft_schedules: managers only.
drop policy if exists mt_select on public.draft_schedules;
create policy mt_select on public.draft_schedules for select to authenticated
  using (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_insert on public.draft_schedules;
create policy mt_insert on public.draft_schedules for insert to authenticated
  with check (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_update on public.draft_schedules;
create policy mt_update on public.draft_schedules for update to authenticated
  using (org_id in (select public.my_managed_org_ids()))
  with check (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_delete on public.draft_schedules;
create policy mt_delete on public.draft_schedules for delete to authenticated
  using (org_id in (select public.my_managed_org_ids()));

-- organizations / managers: members read; no end-user writes.
drop policy if exists mt_select on public.organizations;
create policy mt_select on public.organizations for select to authenticated
  using (id in (select public.my_org_ids()));
drop policy if exists mt_select on public.managers;
create policy mt_select on public.managers for select to authenticated
  using (org_id in (select public.my_org_ids()));

-- availability, callouts: members read; your own rows or a manager write.
-- (callouts are narrowed further by the callouts_rules trigger.)
do $$
declare
  t text;
  own constant text :=
    '(org_id in (select public.my_managed_org_ids())'
    || ' or (org_id, employee_id) in (select org_id, employee_id from public.my_employees()))';
begin
  foreach t in array array['availability', 'callouts'] loop
    execute format('drop policy if exists mt_select on public.%I', t);
    execute format('drop policy if exists mt_write on public.%I', t);
    execute format('drop policy if exists mt_insert on public.%I', t);
    execute format('drop policy if exists mt_update on public.%I', t);
    execute format('drop policy if exists mt_delete on public.%I', t);
    execute format(
      'create policy mt_select on public.%I for select to authenticated'
      || ' using (org_id in (select public.my_org_ids()))', t);
    execute format('create policy mt_insert on public.%I for insert to authenticated with check %s', t, own);
    execute format('create policy mt_update on public.%I for update to authenticated using %s with check %s', t, own, own);
    execute format('create policy mt_delete on public.%I for delete to authenticated using %s', t, own);
  end loop;
end $$;

-- employee_preferences: your own, or a manager, for every action.
drop policy if exists mt_select on public.employee_preferences;
drop policy if exists mt_write on public.employee_preferences;
drop policy if exists mt_all on public.employee_preferences;
create policy mt_all on public.employee_preferences for all to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  )
  with check (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );

-- open_shift_claims: members read; your own claims, as pending; managers decide.
drop policy if exists mt_select on public.open_shift_claims;
create policy mt_select on public.open_shift_claims for select to authenticated
  using (org_id in (select public.my_org_ids()));
drop policy if exists mt_write on public.open_shift_claims;
drop policy if exists mt_insert on public.open_shift_claims;
create policy mt_insert on public.open_shift_claims for insert to authenticated
  with check (
    org_id in (select public.my_managed_org_ids())
    or ((org_id, employee_id) in (select org_id, employee_id from public.my_employees()) and status = 'pending')
  );
drop policy if exists mt_update on public.open_shift_claims;
create policy mt_update on public.open_shift_claims for update to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  )
  with check (
    org_id in (select public.my_managed_org_ids())
    or ((org_id, employee_id) in (select org_id, employee_id from public.my_employees()) and status = 'pending')
  );
drop policy if exists mt_delete on public.open_shift_claims;
create policy mt_delete on public.open_shift_claims for delete to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );

-- time_off_requests: members read; employees file their own as pending;
-- managers decide, edit and delete.
drop policy if exists mt_select on public.time_off_requests;
create policy mt_select on public.time_off_requests for select to authenticated
  using (org_id in (select public.my_org_ids()));
drop policy if exists mt_insert on public.time_off_requests;
create policy mt_insert on public.time_off_requests for insert to authenticated
  with check (
    org_id in (select public.my_managed_org_ids())
    or ((org_id, employee_id) in (select org_id, employee_id from public.my_employees())
        and coalesce(status, 'pending') = 'pending')
  );
drop policy if exists mt_update on public.time_off_requests;
create policy mt_update on public.time_off_requests for update to authenticated
  using (org_id in (select public.my_managed_org_ids()))
  with check (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_delete on public.time_off_requests;
create policy mt_delete on public.time_off_requests for delete to authenticated
  using (org_id in (select public.my_managed_org_ids()));

-- shift_swaps: members read. The requester files a pending swap of their own
-- shift (A) for the target's shift (B), as the API does; the target can only
-- accept or decline it (shift_swaps_response trigger); managers decide and
-- delete.
drop policy if exists mt_select on public.shift_swaps;
create policy mt_select on public.shift_swaps for select to authenticated
  using (org_id in (select public.my_org_ids()));
drop policy if exists mt_insert on public.shift_swaps;
create policy mt_insert on public.shift_swaps for insert to authenticated
  with check (
    org_id in (select public.my_managed_org_ids())
    or (
      (org_id, requester_id) in (select org_id, employee_id from public.my_employees())
      and coalesce(status, 'pending') = 'pending'
      and exists (
        select 1 from public.schedules a
         where a.id = shift_swaps.schedule_a_id and a.org_id = shift_swaps.org_id
           and a.employee_id = shift_swaps.requester_id
      )
      and exists (
        select 1 from public.schedules b
         where b.id = shift_swaps.schedule_b_id and b.org_id = shift_swaps.org_id
           and b.employee_id = shift_swaps.target_id
      )
    )
  );
drop policy if exists mt_update on public.shift_swaps;
create policy mt_update on public.shift_swaps for update to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, target_id) in (select org_id, employee_id from public.my_employees())
  )
  with check (
    org_id in (select public.my_managed_org_ids())
    or (org_id, target_id) in (select org_id, employee_id from public.my_employees())
  );
drop policy if exists mt_delete on public.shift_swaps;
create policy mt_delete on public.shift_swaps for delete to authenticated
  using (org_id in (select public.my_managed_org_ids()));

-- punch_records: your own punches or a manager read; employees add their own
-- live punches (punch_records_integrity trigger); managers edit and delete.
drop policy if exists mt_select on public.punch_records;
create policy mt_select on public.punch_records for select to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );
drop policy if exists mt_insert on public.punch_records;
create policy mt_insert on public.punch_records for insert to authenticated
  with check (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );
drop policy if exists mt_update on public.punch_records;
create policy mt_update on public.punch_records for update to authenticated
  using (org_id in (select public.my_managed_org_ids()))
  with check (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_delete on public.punch_records;
create policy mt_delete on public.punch_records for delete to authenticated
  using (org_id in (select public.my_managed_org_ids()));

-- punch_corrections: your own or a manager read; employees file their own as
-- pending; managers review and delete.
drop policy if exists mt_select on public.punch_corrections;
create policy mt_select on public.punch_corrections for select to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );
drop policy if exists mt_insert on public.punch_corrections;
create policy mt_insert on public.punch_corrections for insert to authenticated
  with check (
    (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
    and status = 'pending' and reviewed_by is null and reviewed_at is null and punch_id is null
  );
drop policy if exists mt_update on public.punch_corrections;
create policy mt_update on public.punch_corrections for update to authenticated
  using (org_id in (select public.my_managed_org_ids()))
  with check (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_delete on public.punch_corrections;
create policy mt_delete on public.punch_corrections for delete to authenticated
  using (org_id in (select public.my_managed_org_ids()));

-- schedule_generation_runs: managers read; written by apply_generated_drafts /
-- undo_generation_run; managers mark them published.
drop policy if exists mt_select on public.schedule_generation_runs;
create policy mt_select on public.schedule_generation_runs for select to authenticated
  using (org_id in (select public.my_managed_org_ids()));
drop policy if exists mt_update on public.schedule_generation_runs;
create policy mt_update on public.schedule_generation_runs for update to authenticated
  using (org_id in (select public.my_managed_org_ids()))
  with check (org_id in (select public.my_managed_org_ids()));

-- messages: sender and recipient read; send as yourself; only the recipient
-- updates, and section 6 limits that to the read flag.
drop policy if exists mt_select on public.messages;
create policy mt_select on public.messages for select to authenticated
  using (
    org_id in (select public.my_org_ids())
    and (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()))
  );
drop policy if exists mt_insert on public.messages;
create policy mt_insert on public.messages for insert to authenticated
  with check (org_id in (select public.my_org_ids()) and from_user_id = (select auth.uid()));
drop policy if exists mt_update on public.messages;
create policy mt_update on public.messages for update to authenticated
  using (org_id in (select public.my_org_ids()) and to_user_id = (select auth.uid()))
  with check (org_id in (select public.my_org_ids()) and to_user_id = (select auth.uid()));

-- notifications: your own, plus org-wide alerts (user_id null) for managers.
-- Created through notify_* (service role); section 6 limits updates to the
-- read / cleared flags.
drop policy if exists mt_select on public.notifications;
create policy mt_select on public.notifications for select to authenticated
  using (
    org_id in (select public.my_org_ids())
    and (user_id = (select auth.uid())
         or (user_id is null and org_id in (select public.my_managed_org_ids())))
  );
drop policy if exists mt_update on public.notifications;
create policy mt_update on public.notifications for update to authenticated
  using (
    org_id in (select public.my_org_ids())
    and (user_id = (select auth.uid())
         or (user_id is null and org_id in (select public.my_managed_org_ids())))
  )
  with check (
    org_id in (select public.my_org_ids())
    and (user_id = (select auth.uid())
         or (user_id is null and org_id in (select public.my_managed_org_ids())))
  );

-- audit_logs: managers read their own org's log (what /api/audit-log returns
-- them, and what the reports page's live feed listens for). Written only by
-- the service role.
drop policy if exists mt_select on public.audit_logs;
create policy mt_select on public.audit_logs for select to authenticated
  using (org_id in (select public.my_managed_org_ids()));

-- Per-user tables: one policy each, auth.uid() read once per query.
drop policy if exists dp_select on public.device_presence;
drop policy if exists dp_write on public.device_presence;
drop policy if exists dp_own on public.device_presence;
create policy dp_own on public.device_presence for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists users_own_notification_prefs on public.user_notification_preferences;
create policy users_own_notification_prefs on public.user_notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Functions.
-- ---------------------------------------------------------------------------

-- Roles: the API's rules, enforced for any caller. When the org has an owner,
-- only the owner changes roles; only members of the org can be promoted; the
-- demo's visitors can't demote each other.
create or replace function public.manager_promote(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_manager(p_org_id) then
    raise exception 'not authorized to manage roles for this organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.managers where org_id = p_org_id and is_owner)
     and not exists (
       select 1 from public.managers where org_id = p_org_id and user_id = auth.uid() and is_owner
     ) then
    raise exception 'only the organization owner can change manager roles' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where org_id = p_org_id and user_id = p_user_id)
     and not exists (select 1 from public.managers where org_id = p_org_id and user_id = p_user_id) then
    raise exception 'only members of this organization can be promoted' using errcode = '42501';
  end if;

  insert into public.managers (org_id, user_id)
  values (p_org_id, p_user_id)
  on conflict (org_id, user_id) do nothing;
end;
$$;

create or replace function public.manager_demote(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_manager(p_org_id) then
    raise exception 'not authorized to manage roles for this organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations where id = p_org_id and is_demo) then
    raise exception 'demoting managers is disabled in the demo organization' using errcode = '42501';
  end if;
  if exists (select 1 from public.managers where org_id = p_org_id and is_owner)
     and not exists (
       select 1 from public.managers where org_id = p_org_id and user_id = auth.uid() and is_owner
     ) then
    raise exception 'only the organization owner can change manager roles' using errcode = '42501';
  end if;

  -- The managers_protect_owner trigger rejects removing the org owner.
  delete from public.managers
  where org_id = p_org_id and user_id = p_user_id;
end;
$$;

-- Swap approval: only if the requester still owns shift A and the target
-- shift B. Otherwise returns 'stale' and changes nothing.
create or replace function public.approve_shift_swap(p_org uuid, p_swap_id bigint)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_swap   public.shift_swaps%rowtype;
  v_emp_a  bigint;
  v_emp_b  bigint;
begin
  -- Only a manager of this org may approve, however the RPC is reached.
  if not public.is_org_manager(p_org) then
    return 'forbidden';
  end if;

  -- Lock the swap so two approvals can't both apply.
  select * into v_swap
  from public.shift_swaps
  where id = p_swap_id and org_id = p_org
  for update;

  if not found then
    return 'not_found';
  end if;

  -- The consent gate: a swap can only be approved once the target accepted it.
  -- Any other state (pending / approved / denied / declined) is returned as-is
  -- so the caller can distinguish "still awaiting acceptance" from "resolved".
  if v_swap.status <> 'accepted' then
    return v_swap.status;
  end if;

  -- Lock both schedules and read their current owners.
  select employee_id into v_emp_a
  from public.schedules
  where id = v_swap.schedule_a_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  select employee_id into v_emp_b
  from public.schedules
  where id = v_swap.schedule_b_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  -- The shifts must still belong to the two people who agreed to the swap.
  if v_emp_a is distinct from v_swap.requester_id or v_emp_b is distinct from v_swap.target_id then
    return 'stale';
  end if;

  -- Exchange owners and resolve the swap — all or nothing.
  update public.schedules set employee_id = v_emp_b
    where id = v_swap.schedule_a_id and org_id = p_org;
  update public.schedules set employee_id = v_emp_a
    where id = v_swap.schedule_b_id and org_id = p_org;
  update public.shift_swaps set status = 'approved'
    where id = p_swap_id and org_id = p_org;

  return 'approved';
end;
$$;

-- Sign-up linking: emails compared without regard to case (auth lowercases
-- them; an invite keeps what the manager typed), and an org where the person
-- already has an employee row is skipped instead of failing the whole update,
-- which used to leave them unlinked everywhere.
create or replace function public.link_employee_on_signup()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.employees e
     set user_id = new.id
   where lower(e.email) = lower(new.email)
     and e.user_id is null
     and not exists (
       select 1 from public.employees o where o.org_id = e.org_id and o.user_id = new.id
     );
  return new;
exception when others then
  raise warning 'link_employee_on_signup failed: %', sqlerrm;
  return new;
end;
$$;

-- Pay rates for a manager of p_org; nothing for anyone else. The app reads
-- pay rates through this so 0042 can hide employees.pay_rate from the API.
create or replace function public.employee_pay_rates(p_org uuid)
returns table (employee_id bigint, pay_rate numeric)
language sql stable security definer set search_path = public
as $$
  select e.id::bigint, e.pay_rate
    from public.employees e
   where e.org_id = p_org
     and public.is_org_manager(p_org)
$$;
revoke all on function public.employee_pay_rates(uuid) from public, anon;
grant execute on function public.employee_pay_rates(uuid) to authenticated, service_role;

-- Fixed search_path (advisor: function_search_path_mutable).
alter function public.punch_corrections_stamp() set search_path = '';

-- Trigger functions run as triggers only, and no policy calls the old
-- per-row helpers any more (the SECURITY DEFINER functions that do run as
-- their owner). None of them needs to be callable through /rest/v1/rpc.
revoke all on function
  public.enforce_callout_rules(),
  public.enforce_punch_integrity(),
  public.enforce_swap_response(),
  public.link_employee_on_signup(),
  public.protect_employee_link(),
  public.protect_org_owner(),
  public.punch_corrections_stamp(),
  public.is_org_member(uuid),
  public.is_org_manager(uuid),
  public.is_own_employee(uuid, bigint)
from public, anon, authenticated;

-- Signed-in callers only; each checks the caller itself.
revoke all on function
  public.manager_promote(uuid, uuid),
  public.manager_demote(uuid, uuid),
  public.presence_set(text, boolean)
from public, anon;
grant execute on function
  public.manager_promote(uuid, uuid),
  public.manager_demote(uuid, uuid),
  public.presence_set(text, boolean)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Constraints and foreign keys.
-- ---------------------------------------------------------------------------

-- schedules: schedules_shift_times (0033) already says start in [0, 1440),
-- end after start, at most 16 hours. These pre-repo checks repeat it, and
-- start_minutes_positive wrongly rejects a shift starting at midnight.
-- chk_min_shift_length (at least 1 hour) stays: it matches the API.
alter table public.schedules drop constraint if exists start_minutes_positive;
alter table public.schedules drop constraint if exists end_minutes_positive;
alter table public.schedules drop constraint if exists chk_start_before_end;
alter table public.schedules drop constraint if exists chk_start_in_day;
alter table public.schedules drop constraint if exists chk_max_shift_length;

-- Every existing row satisfies these (checked 2026-10-09).
alter table public.schedules              validate constraint schedules_shift_times;
alter table public.draft_schedules        validate constraint draft_schedules_shift_times;
alter table public.schedule_template_rows validate constraint schedule_template_rows_shift_times;
alter table public.open_shifts            validate constraint open_shifts_shift_times;

-- schedules.employee_id had two single-column foreign keys to employees(id);
-- fk_employee (ON DELETE RESTRICT) and schedules_employee_org_fkey remain.
alter table public.schedules drop constraint if exists schedules_employee_id_fkey;

-- Same-org foreign keys, replacing single-column ones that let a row point
-- into another organization. ON DELETE behaviour is unchanged.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'open_shifts_id_org_key') then
    alter table public.open_shifts add constraint open_shifts_id_org_key unique (id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'open_shift_claims_open_shift_org_fkey') then
    alter table public.open_shift_claims add constraint open_shift_claims_open_shift_org_fkey
      foreign key (open_shift_id, org_id) references public.open_shifts (id, org_id) on delete cascade;
  end if;
  alter table public.open_shift_claims drop constraint if exists open_shift_claims_open_shift_id_fkey;

  if not exists (select 1 from pg_constraint where conname = 'coverage_profiles_id_org_key') then
    alter table public.coverage_profiles add constraint coverage_profiles_id_org_key unique (id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coverage_profile_blocks_profile_org_fkey') then
    alter table public.coverage_profile_blocks add constraint coverage_profile_blocks_profile_org_fkey
      foreign key (profile_id, org_id) references public.coverage_profiles (id, org_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coverage_day_defaults_profile_org_fkey') then
    alter table public.coverage_day_defaults add constraint coverage_day_defaults_profile_org_fkey
      foreign key (profile_id, org_id) references public.coverage_profiles (id, org_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coverage_date_overrides_profile_org_fkey') then
    alter table public.coverage_date_overrides add constraint coverage_date_overrides_profile_org_fkey
      foreign key (profile_id, org_id) references public.coverage_profiles (id, org_id) on delete cascade;
  end if;
  alter table public.coverage_profile_blocks drop constraint if exists coverage_profile_blocks_profile_id_fkey;
  alter table public.coverage_day_defaults   drop constraint if exists coverage_day_defaults_profile_id_fkey;
  alter table public.coverage_date_overrides drop constraint if exists coverage_date_overrides_profile_id_fkey;

  if not exists (select 1 from pg_constraint where conname = 'schedule_generation_runs_id_org_key') then
    alter table public.schedule_generation_runs
      add constraint schedule_generation_runs_id_org_key unique (id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'draft_schedules_generation_run_org_fkey') then
    alter table public.draft_schedules add constraint draft_schedules_generation_run_org_fkey
      foreign key (generation_run_id, org_id) references public.schedule_generation_runs (id, org_id)
      on delete set null (generation_run_id);
  end if;
  alter table public.draft_schedules drop constraint if exists draft_schedules_generation_run_fkey;

  -- A correction's resulting punch. Deleting the punch keeps the reviewed
  -- correction and clears the link.
  if not exists (select 1 from pg_constraint where conname = 'punch_corrections_punch_id_fkey') then
    alter table public.punch_corrections add constraint punch_corrections_punch_id_fkey
      foreign key (punch_id) references public.punch_records (id) on delete set null;
  end if;

  -- Requests between two different people about two different shifts.
  if not exists (select 1 from pg_constraint where conname = 'shift_swaps_distinct_check') then
    alter table public.shift_swaps add constraint shift_swaps_distinct_check
      check (requester_id <> target_id and schedule_a_id <> schedule_b_id);
  end if;

  -- conversation_id is derived from the pair (app/api/messages: the two user
  -- ids sorted and joined with "_"), so it must match them. "C" collation sorts
  -- like JavaScript's default sort.
  if not exists (select 1 from pg_constraint where conname = 'messages_conversation_pair_check') then
    alter table public.messages add constraint messages_conversation_pair_check check (
      from_user_id <> to_user_id
      and conversation_id =
        least(from_user_id::text collate "C", to_user_id::text collate "C")
        || '_' ||
        greatest(from_user_id::text collate "C", to_user_id::text collate "C")
    );
  end if;
end $$;

-- org_id must always be given; a forgotten one used to land in the default org.
alter table public.coverage_profiles       alter column org_id drop default;
alter table public.coverage_profile_blocks alter column org_id drop default;
alter table public.coverage_day_defaults   alter column org_id drop default;
alter table public.coverage_date_overrides alter column org_id drop default;
alter table public.draft_schedules         alter column org_id drop default;

-- created_at was nullable on these three; no row is null.
alter table public.shift_swaps        alter column created_at set not null;
alter table public.time_off_requests  alter column created_at set not null;
alter table public.schedule_templates alter column created_at set not null;

-- One employee row per email per organization, as the invite route checks
-- (case-insensitively, and racily). The sign-up trigger relies on it.
create unique index if not exists employees_org_email_unique
  on public.employees (org_id, lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- 5. Indexes.
-- ---------------------------------------------------------------------------

-- An employee's punches over a date range (clock, time card, payroll,
-- corrections), and the (employee_id, org_id) foreign key.
create index if not exists punch_records_org_employee_punched_idx
  on public.punch_records (org_id, employee_id, punched_at);
-- Deleting or replacing shifts: punch_records and shift_swaps reference them.
create index if not exists punch_records_schedule_idx
  on public.punch_records (schedule_id) where schedule_id is not null;
create index if not exists shift_swaps_schedule_a_idx on public.shift_swaps (schedule_a_id);
create index if not exists shift_swaps_schedule_b_idx on public.shift_swaps (schedule_b_id);
create index if not exists punch_corrections_punch_idx
  on public.punch_corrections (punch_id) where punch_id is not null;

-- The notification list: one user's (or the org-wide) notifications, newest first.
create index if not exists notifications_org_user_created_idx
  on public.notifications (org_id, user_id, created_at desc);
drop index if exists public.notifications_org_user_idx;

-- Duplicates: each is the same as, or a leading part of, a primary key or
-- unique index on the same table.
drop index if exists public.managers_org_user_idx;            -- managers_pkey (org_id, user_id)
drop index if exists public.employees_org_user_idx;           -- employees_org_user_unique
drop index if exists public.coverage_profiles_org_idx;        -- coverage_profiles_org_name_unique
drop index if exists public.coverage_day_defaults_org_idx;    -- coverage_day_defaults_pkey
drop index if exists public.coverage_date_overrides_org_idx;  -- coverage_date_overrides_pkey
drop index if exists public.callouts_org_employee_idx;        -- callouts (org_id, employee_id, date) unique
drop index if exists public.open_shift_claims_org_shift_idx;  -- open_shift_claims (org_id, open_shift_id, employee_id) unique
drop index if exists public.positions_org_idx;                -- positions (org_id, name) unique

-- ---------------------------------------------------------------------------
-- 6. Table privileges. RLS decides which rows; these decide which commands.
-- ---------------------------------------------------------------------------

-- TRUNCATE skips RLS; REFERENCES and TRIGGER are never needed by API roles.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
-- Signed-out requests never write.
revoke insert, update, delete on all tables in schema public from anon;
-- Same defaults for tables created later by this role.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;

-- audit_logs: read through the policy above; written by the service role only.
revoke insert, update, delete on public.audit_logs from authenticated;

-- messages: the recipient marks them read; nothing else changes after sending.
revoke update on public.messages from authenticated;
grant update (read) on public.messages to authenticated;

-- notifications: users mark them read or clear them.
revoke update on public.notifications from authenticated;
grant update (read, is_cleared) on public.notifications to authenticated;

notify pgrst, 'reload schema';
