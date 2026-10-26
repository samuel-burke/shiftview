-- Demo organization migration.
--
-- Replaces the fixture-based demo mode (data/demo-fixtures.ts served from API
-- fallbacks) with a real "Demo" tenant that rides the same org_id + RLS stack
-- as every customer org. See docs/DEMO_ORG.md for the full design.
--
-- Prerequisites: 0001–0005 applied. Also enable "Allow anonymous sign-ins" in
-- Supabase Auth settings — demo visitors authenticate anonymously via
-- POST /api/demo/start.

begin;

-- 1. Flag column. Drives side-effect suppression (email, push, invites) and
--    lets cron jobs exclude demo tenants without hardcoding ids in SQL.
alter table public.organizations
  add column if not exists is_demo boolean not null default false;

-- 2. The demo org itself. Fixed UUID so application code can reference it
--    deterministically (lib/demo-org.ts DEMO_ORG_ID must match).
insert into public.organizations (id, name, slug, is_demo)
values ('00000000-0000-0000-0000-000000000002', 'Demo Organization', 'demo', true)
on conflict (id) do update set is_demo = true;

-- 3. Reset: wipe every tenant-owned row for a demo org, children before
--    parents (the composite org FKs from 0002/0005 have no ON DELETE CASCADE).
--    Hard-fails on non-demo orgs so this can never be pointed at customer data.
create or replace function public.reset_demo_org(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    raise exception 'reset_demo_org: % is not a demo organization', p_org;
  end if;

  delete from punch_records          where org_id = p_org;
  delete from shift_swaps            where org_id = p_org;
  delete from draft_schedules        where org_id = p_org;
  delete from schedule_template_rows where org_id = p_org;
  delete from schedule_templates     where org_id = p_org;
  delete from schedules              where org_id = p_org;
  delete from availability           where org_id = p_org;
  delete from time_off_requests      where org_id = p_org;
  delete from messages               where org_id = p_org;
  delete from notifications          where org_id = p_org;
  delete from audit_logs             where org_id = p_org;
  delete from coverage_profile_blocks where org_id = p_org;
  delete from coverage_date_overrides where org_id = p_org;
  delete from coverage_day_defaults  where org_id = p_org;
  delete from coverage_profiles      where org_id = p_org;
  delete from store_hours            where org_id = p_org;
  delete from app_settings           where org_id = p_org;
  delete from employees              where org_id = p_org;
  delete from managers               where org_id = p_org;
end;
$$;

-- Service-role only: the reset/reseed cron uses the admin client. Demo
-- visitors are org managers, so without this revoke they could call it.
revoke all on function public.reset_demo_org(uuid) from public, anon, authenticated;

commit;
