-- Multi-tenancy migration, phase 3 of 4: ROW LEVEL SECURITY.
--
-- Defense in depth: even if an application query forgets an org_id filter,
-- RLS guarantees a user's JWT can only ever see rows from organizations they
-- belong to. The service-role (admin) client bypasses RLS by design, so any
-- code path using lib/supabase-admin.ts must still filter explicitly.
--
-- IMPORTANT: review any pre-existing policies on these tables before running;
-- this file drops/recreates only the policies it owns (mt_* prefix). Old
-- single-tenant policies that grant broader access must be removed manually,
-- otherwise they OR together with these and defeat the isolation.

begin;

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so they can read managers/employees
-- without recursing through those tables' own RLS policies.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.managers  where user_id = auth.uid() and org_id = p_org
    union all
    select 1 from public.employees where user_id = auth.uid() and org_id = p_org
  );
$$;

create or replace function public.is_org_manager(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.managers where user_id = auth.uid() and org_id = p_org
  );
$$;

-- ---------------------------------------------------------------------------
-- Org-aware notification RPCs (replace the single-tenant versions).
-- ---------------------------------------------------------------------------

drop function if exists public.notify_insert(uuid, text, text, text, jsonb);
create or replace function public.notify_insert(
  p_org_id uuid, p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (org_id, user_id, type, title, body, data)
  values (p_org_id, p_user_id, p_type, p_title, p_body, p_data);
$$;

drop function if exists public.notify_get_manager_ids();
create or replace function public.notify_get_manager_ids(p_org_id uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public
as $$
  select user_id from public.managers where org_id = p_org_id;
$$;

-- notify_get_push_subs / notify_get_push_prefs / notify_delete_subs stay
-- user-keyed: push subscriptions and preferences are personal, not tenant data.

-- ---------------------------------------------------------------------------
-- Policies. Pattern:
--   read   -> any member of the row's org
--   write  -> org manager for admin-owned tables, org member for tables
--             employees legitimately write to (fine-grained rules such as
--             "only your own punch" remain enforced in the API layer; RLS is
--             the tenant-isolation backstop).
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'employees', 'managers', 'schedules', 'availability',
    'time_off_requests', 'punch_records', 'store_hours', 'app_settings',
    'messages', 'notifications', 'shift_swaps',
    'schedule_templates', 'schedule_template_rows', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- organizations: members can read their own orgs; creation/management happens
-- through the service role (sign-up / provisioning flow).
drop policy if exists mt_select on public.organizations;
create policy mt_select on public.organizations
  for select using (public.is_org_member(id));

-- Manager-writable tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'managers', 'schedules', 'store_hours', 'app_settings',
    'schedule_templates', 'schedule_template_rows'
  ]
  loop
    execute format('drop policy if exists mt_select on public.%I', t);
    execute format('create policy mt_select on public.%I for select using (public.is_org_member(org_id))', t);
    execute format('drop policy if exists mt_insert on public.%I', t);
    execute format('create policy mt_insert on public.%I for insert with check (public.is_org_manager(org_id))', t);
    execute format('drop policy if exists mt_update on public.%I', t);
    execute format('create policy mt_update on public.%I for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id))', t);
    execute format('drop policy if exists mt_delete on public.%I', t);
    execute format('create policy mt_delete on public.%I for delete using (public.is_org_manager(org_id))', t);
  end loop;
end $$;

-- Member-writable tables (employees create their own punches, requests, etc.).
do $$
declare
  t text;
begin
  foreach t in array array[
    'availability', 'time_off_requests', 'punch_records', 'shift_swaps'
  ]
  loop
    execute format('drop policy if exists mt_select on public.%I', t);
    execute format('create policy mt_select on public.%I for select using (public.is_org_member(org_id))', t);
    execute format('drop policy if exists mt_write on public.%I', t);
    execute format('create policy mt_write on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t);
  end loop;
end $$;

-- messages: only sender/recipient, and only within an org both belong to.
drop policy if exists mt_select on public.messages;
create policy mt_select on public.messages
  for select using (
    public.is_org_member(org_id)
    and (from_user_id = auth.uid() or to_user_id = auth.uid())
  );
drop policy if exists mt_insert on public.messages;
create policy mt_insert on public.messages
  for insert with check (
    public.is_org_member(org_id) and from_user_id = auth.uid()
  );
drop policy if exists mt_update on public.messages;
create policy mt_update on public.messages
  for update using (
    public.is_org_member(org_id)
    and (from_user_id = auth.uid() or to_user_id = auth.uid())
  );

-- notifications: personal rows for their owner; broadcast rows (user_id null)
-- for the org's managers. Inserts go through notify_insert (security definer).
drop policy if exists mt_select on public.notifications;
create policy mt_select on public.notifications
  for select using (
    public.is_org_member(org_id)
    and (user_id = auth.uid() or (user_id is null and public.is_org_manager(org_id)))
  );
drop policy if exists mt_update on public.notifications;
create policy mt_update on public.notifications
  for update using (
    public.is_org_member(org_id)
    and (user_id = auth.uid() or (user_id is null and public.is_org_manager(org_id)))
  );

-- audit_logs: written via service role only; no user-facing policies means
-- deny-by-default for anon/authenticated roles.

commit;
