-- Employee skills/capabilities (Keyholder, Barista, Forklift, …). Durable
-- capabilities — distinct from positions (per-shift roles) and certifications
-- (expiring credentials). Member-readable (the whole team benefits from "who can
-- do X?"); the API restricts writes to managers.
--
-- Mirrors the callouts multitenancy shape: org_id, composite FK so a row's org
-- matches its employee's org. reset_demo_org() left unchanged (consistent with
-- the other parallel feature migrations).

begin;

create table if not exists public.employee_skills (
  id          bigint generated always as identity primary key,
  org_id      uuid   not null references public.organizations (id),
  employee_id bigint not null,
  name        text   not null,
  created_at  timestamptz not null default now(),
  -- One of each skill per employee.
  unique (org_id, employee_id, name),
  constraint employee_skills_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists employee_skills_org_employee_idx on public.employee_skills (org_id, employee_id);
create index if not exists employee_skills_org_name_idx     on public.employee_skills (org_id, name);

alter table public.employee_skills enable row level security;

drop policy if exists mt_select on public.employee_skills;
create policy mt_select on public.employee_skills
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.employee_skills;
create policy mt_write on public.employee_skills
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

commit;
