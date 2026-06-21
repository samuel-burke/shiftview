-- Private manager notes about an employee (coaching / performance log). Unlike
-- the other feature tables these are NOT member-readable — they're sensitive HR
-- records, so RLS restricts every operation to managers via is_org_manager().
-- The API additionally only ever serves them through manager-gated routes.
--
-- Composite (employee_id, org_id) FK keeps a note in its employee's org.
-- reset_demo_org() left unchanged (consistent with the other parallel feature
-- migrations).

begin;

create table if not exists public.employee_notes (
  id          bigint generated always as identity primary key,
  org_id      uuid   not null references public.organizations (id),
  employee_id bigint not null,
  author_id   uuid,
  body        text   not null,
  created_at  timestamptz not null default now(),
  constraint employee_notes_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists employee_notes_org_employee_idx on public.employee_notes (org_id, employee_id);

alter table public.employee_notes enable row level security;

-- Manager-only for ALL operations — these notes must never be visible to the
-- employee they're about, or to any non-manager.
drop policy if exists mgr_select on public.employee_notes;
create policy mgr_select on public.employee_notes
  for select using (public.is_org_manager(org_id));

drop policy if exists mgr_write on public.employee_notes;
create policy mgr_write on public.employee_notes
  for all using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

commit;
