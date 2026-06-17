-- Workplace incident / injury reports (slip, burn, near-miss). Any staff member
-- may FILE one (so incidents actually get reported), but the records are
-- sensitive — reading is restricted to managers. This asymmetric policy is the
-- point of the table, so it does not reuse the member-readable mt_select default.
--
-- Composite (employee_id, org_id) FK is optional (the person involved may be a
-- customer or unspecified), so it's enforced only when employee_id is set via a
-- nullable composite FK (MATCH SIMPLE). reset_demo_org() left unchanged.

begin;

create table if not exists public.incidents (
  id          bigint generated always as identity primary key,
  org_id      uuid   not null references public.organizations (id),
  employee_id bigint,
  reported_by uuid,
  date        date   not null,
  severity    text   not null check (severity in ('minor', 'moderate', 'severe')),
  description text   not null,
  created_at  timestamptz not null default now(),
  -- When an employee is named, they must be in the same org.
  constraint incidents_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists incidents_org_date_idx on public.incidents (org_id, date);

alter table public.incidents enable row level security;

-- Anyone in the org may report an incident…
drop policy if exists member_insert on public.incidents;
create policy member_insert on public.incidents
  for insert with check (public.is_org_member(org_id));

-- …but only managers may read, edit, or delete them.
drop policy if exists mgr_select on public.incidents;
create policy mgr_select on public.incidents
  for select using (public.is_org_manager(org_id));

drop policy if exists mgr_update on public.incidents;
create policy mgr_update on public.incidents
  for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

drop policy if exists mgr_delete on public.incidents;
create policy mgr_delete on public.incidents
  for delete using (public.is_org_manager(org_id));

commit;
