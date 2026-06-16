-- Employee call-outs: an employee notifying the team they can't make it to
-- work on a given day (an unplanned, same-day or near-term absence). Unlike
-- time_off_requests this is not an approval workflow — a call-out is a fact the
-- moment it is filed: managers are notified and the person immediately shows as
-- "Called Out" across the app. The row can be rescinded (deleted) by the
-- employee who filed it or by any manager.
--
-- Mirrors the time_off_requests multitenancy shape exactly: org_id column,
-- composite FK so a row's org_id must match its employee's org, is_org_member
-- RLS (member-writable — employees file their own), and Realtime publication so
-- the dashboard updates live.

begin;

create table if not exists public.callouts (
  id          bigint generated always as identity primary key,
  org_id      uuid   not null references public.organizations (id),
  employee_id bigint not null,
  date        date   not null,
  reason      text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  -- One active call-out per employee per day.
  unique (org_id, employee_id, date),
  -- A call-out's org must match its employee's org (employees has a
  -- (id, org_id) unique key from 0002_multitenancy_enforce.sql).
  constraint callouts_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists callouts_org_date_idx     on public.callouts (org_id, date);
create index if not exists callouts_org_employee_idx on public.callouts (org_id, employee_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — member-writable, identical to time_off_requests.
-- Fine-grained rules ("only your own call-out, or a manager") stay enforced in
-- the API layer; RLS is the tenant-isolation backstop.
-- ---------------------------------------------------------------------------
alter table public.callouts enable row level security;

drop policy if exists mt_select on public.callouts;
create policy mt_select on public.callouts
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.callouts;
create policy mt_write on public.callouts
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Demo reset — fold the new table into reset_demo_org() so nightly demo resets
-- clear call-outs too. Must run before employees (the composite org FK has no
-- ON DELETE CASCADE). Redefining the whole function keeps it the single source
-- of truth; this mirrors 0006_demo_org.sql with one added DELETE.
-- ---------------------------------------------------------------------------
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
  delete from callouts               where org_id = p_org;
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

revoke all on function public.reset_demo_org(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime — the team dashboard subscribes to callouts so "Called Out" status
-- appears the instant someone files (or rescinds) a call-out.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'callouts'
    ) then
      execute 'alter publication supabase_realtime add table public.callouts';
    end if;
  end if;
end $$;

commit;
