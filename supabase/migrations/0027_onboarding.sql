-- Per-employee onboarding checklist items (a new hire's tasks: "Sign W-4",
-- "Uniform issued", "POS training"). Member-readable so an employee can see
-- their own progress; the API restricts writes to managers.
--
-- Mirrors the callouts multitenancy shape (0013): org_id column, composite FK so
-- a row's org_id matches its employee's org, member-read RLS. reset_demo_org()
-- left unchanged (consistent with the other parallel feature migrations).

begin;

create table if not exists public.onboarding_items (
  id          bigint generated always as identity primary key,
  org_id      uuid   not null references public.organizations (id),
  employee_id bigint not null,
  label       text   not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint onboarding_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists onboarding_org_employee_idx on public.onboarding_items (org_id, employee_id);

alter table public.onboarding_items enable row level security;

drop policy if exists mt_select on public.onboarding_items;
create policy mt_select on public.onboarding_items
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.onboarding_items;
create policy mt_write on public.onboarding_items
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

commit;
