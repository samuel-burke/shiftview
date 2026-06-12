-- Self-serve org sign-up + organization owner.
--
-- Adds the "owner" role: the manager who created the organization via the
-- sign-up flow (POST /api/organizations). The owner is a regular manager in
-- every respect except that nobody — not other managers, not the legacy
-- manager_demote RPC, not even service-role code — can demote or remove them.
--
-- Prerequisites: 0001–0006 applied.

begin;

-- 1. Owner flag. At most one owner per organization. Existing orgs (default,
--    demo) keep ownerless managers — only sign-up-created orgs get an owner.
alter table public.managers
  add column if not exists is_owner boolean not null default false;

create unique index if not exists managers_org_owner_uniq
  on public.managers (org_id)
  where is_owner;

-- 2. Owner protection. A trigger rather than RLS so it binds every write
--    path: the legacy manager_demote RPC (defined in the live database),
--    direct deletes by org managers under RLS, and service-role code that
--    bypasses RLS (e.g. the employee-delete cleanup). reset_demo_org is
--    unaffected because demo managers are never owners.
create or replace function public.protect_org_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_owner then
      raise exception 'the organization owner cannot be removed';
    end if;
    return old;
  end if;
  if old.is_owner and not new.is_owner then
    raise exception 'the organization owner cannot be demoted';
  end if;
  return new;
end;
$$;

drop trigger if exists managers_protect_owner on public.managers;
create trigger managers_protect_owner
  before update or delete on public.managers
  for each row execute function public.protect_org_owner();

-- 3. Atomic sign-up provisioning: organization + owner manager row + linked
--    employee row in one transaction, so a half-created org can never exist.
--    Raises unique_violation (23505) on slug collision; the API route retries
--    with a new suffix.
create or replace function public.org_signup_create(
  p_name text,
  p_slug text,
  p_user_id uuid,
  p_owner_name text,
  p_owner_email text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
begin
  insert into organizations (name, slug)
  values (p_name, p_slug)
  returning id into v_org;

  insert into managers (org_id, user_id, is_owner)
  values (v_org, p_user_id, true);

  -- Linked employee row so My Schedule and the clock page work for the owner.
  insert into employees (org_id, user_id, name, email)
  values (v_org, p_user_id, p_owner_name, p_owner_email);

  return v_org;
end;
$$;

-- Service-role only: callers could otherwise provision orgs for arbitrary
-- user ids. POST /api/organizations invokes this through the admin client
-- after authenticating the user itself.
revoke all on function public.org_signup_create(text, text, uuid, text, text)
  from public, anon, authenticated;

commit;
