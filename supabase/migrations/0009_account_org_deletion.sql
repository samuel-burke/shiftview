-- Self-serve deletion: organization owners can delete their organization.
--
-- Adds org_delete(p_org): atomically removes every tenant-scoped row for an
-- organization plus the organizations row itself. Mirrors reset_demo_org's
-- dependency order, but also deletes the org and its manager rows — including
-- the owner, which the managers_protect_owner trigger normally forbids.
--
-- Prerequisites: 0001–0008 applied.

begin;

-- 1. Owner-protection bypass. protect_org_owner (0007) blocks every write
--    path from removing or demoting the owner; whole-org deletion is the one
--    legitimate exception. org_delete sets a transaction-local GUC that the
--    trigger honors, so the bypass can never leak outside that transaction.
create or replace function public.protect_org_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Set (transaction-locally) only by org_delete while it tears down an
  -- entire organization; the owner row must go with it.
  if current_setting('app.allow_owner_removal', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
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

-- 2. Atomic organization deletion. Children before parents so composite FKs
--    never block. Auth users of members are deliberately NOT touched here:
--    they may belong to other orgs, and an org-less account can still create
--    its own organization via sign-up.
create or replace function public.org_delete(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- The seeded default and demo organizations must never be deletable.
  if p_org in ('00000000-0000-0000-0000-000000000001',
               '00000000-0000-0000-0000-000000000002') then
    raise exception 'org_delete: organization % cannot be deleted', p_org;
  end if;
  if not exists (select 1 from organizations where id = p_org) then
    raise exception 'org_delete: organization % does not exist', p_org;
  end if;

  perform set_config('app.allow_owner_removal', 'on', true);

  delete from punch_records           where org_id = p_org;
  delete from shift_swaps             where org_id = p_org;
  delete from draft_schedules         where org_id = p_org;
  delete from schedule_template_rows  where org_id = p_org;
  delete from schedule_templates      where org_id = p_org;
  delete from schedules               where org_id = p_org;
  delete from availability            where org_id = p_org;
  delete from time_off_requests       where org_id = p_org;
  delete from messages                where org_id = p_org;
  delete from notifications           where org_id = p_org;
  delete from audit_logs              where org_id = p_org;
  delete from coverage_profile_blocks where org_id = p_org;
  delete from coverage_date_overrides where org_id = p_org;
  delete from coverage_day_defaults   where org_id = p_org;
  delete from coverage_profiles       where org_id = p_org;
  delete from store_hours             where org_id = p_org;
  delete from app_settings            where org_id = p_org;
  delete from employees               where org_id = p_org;
  delete from managers                where org_id = p_org;
  delete from organizations           where id = p_org;
end;
$$;

-- Service-role only: ownership is verified by DELETE /api/organizations
-- before it invokes this through the admin client.
revoke all on function public.org_delete(uuid)
  from public, anon, authenticated;

commit;
