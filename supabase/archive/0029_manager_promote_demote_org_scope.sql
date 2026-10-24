-- Org-scope the manager promote/demote RPCs.
--
-- manager_promote / manager_demote predate multi-tenancy: they were written
-- when managers was keyed on user_id alone (see 0002, which changed the
-- primary key to (org_id, user_id)). The single-tenant bodies — referenced
-- as "the legacy ... RPC (defined in the live database)" in 0007 — take only
-- the target user id and resolve no organization, so on a multi-tenant
-- database they cannot reliably target the right org's row.
--
-- The visible symptom: after demoting a manager, promoting someone fails with
-- an internal server error. The legacy demote does not remove the intended
-- org's managers row (it is not org-scoped), so the row survives; the next
-- promote then INSERTs a duplicate and violates managers_pkey (23505), which
-- the API surfaces as a 500.
--
-- This migration replaces both with explicit-org, idempotent versions:
--   * the caller's org is passed in (the API already resolves it via
--     getOrgContext) rather than guessed from auth.uid(),
--   * promote is idempotent — re-promoting an existing manager is a no-op
--     instead of a duplicate-key error,
--   * both verify the caller manages the target org (defense in depth; the
--     SECURITY DEFINER bypass means RLS would not otherwise gate a direct
--     call). Owner immunity on demote is still backstopped by the
--     managers_protect_owner trigger (0007/0009).
--
-- Prerequisites: 0001–0028 applied.

begin;

-- Drop the legacy single-argument versions so only the org-scoped signatures
-- remain. IF EXISTS keeps this safe whether or not they were ever migrated.
drop function if exists public.manager_promote(uuid);
drop function if exists public.manager_demote(uuid);

create or replace function public.manager_promote(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_manager(p_org_id) then
    raise exception 'not authorized to manage roles for this organization';
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
    raise exception 'not authorized to manage roles for this organization';
  end if;

  -- The managers_protect_owner trigger rejects removing the org owner.
  delete from public.managers
  where org_id = p_org_id and user_id = p_user_id;
end;
$$;

commit;
