-- Employee certifications / credentials (food handler, alcohol service, first
-- aid, …) with an optional expiry date, so managers can track compliance and
-- catch credentials before they lapse.
--
-- Mirrors the callouts multitenancy shape (0013): org_id column, composite FK so
-- a row's org_id must match its employee's org, member-read / manager-write RLS.
-- reset_demo_org() is left unchanged (same rationale as positions/announcements)
-- — avoids compounding the parallel-migration redefinition of that function.

begin;

create table if not exists public.certifications (
  id          bigint generated always as identity primary key,
  org_id      uuid   not null references public.organizations (id),
  employee_id bigint not null,
  name        text   not null,
  issued_on   date,
  expires_on  date,
  created_at  timestamptz not null default now(),
  -- A cert's org must match its employee's org.
  constraint certifications_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists certifications_org_employee_idx on public.certifications (org_id, employee_id);
create index if not exists certifications_org_expires_idx  on public.certifications (org_id, expires_on);

-- ---------------------------------------------------------------------------
-- Row Level Security — member-readable/writable; the API enforces manager-only
-- writes on top of this tenant backstop.
-- ---------------------------------------------------------------------------
alter table public.certifications enable row level security;

drop policy if exists mt_select on public.certifications;
create policy mt_select on public.certifications
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.certifications;
create policy mt_write on public.certifications
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

commit;
