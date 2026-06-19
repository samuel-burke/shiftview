-- Cash-drawer (till) counts at open/close, with the over/short variance against
-- the expected amount. Member-writable (whoever counts the drawer records it);
-- the API records the counter and computes the variance. Money in whole cents.
--
-- Mirrors the callouts multitenancy shape: org_id, composite FK so a row's org
-- matches its (counting) employee's org. reset_demo_org() left unchanged.

begin;

create table if not exists public.till_counts (
  id             bigint generated always as identity primary key,
  org_id         uuid   not null references public.organizations (id),
  employee_id    bigint not null,
  date           date   not null,
  count_type     text   not null check (count_type in ('open', 'close')),
  expected_cents integer not null,
  counted_cents  integer not null,
  variance_cents integer not null,
  note           text,
  created_at     timestamptz not null default now(),
  constraint till_counts_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id)
);

create index if not exists till_counts_org_date_idx on public.till_counts (org_id, date);

alter table public.till_counts enable row level security;

drop policy if exists mt_select on public.till_counts;
create policy mt_select on public.till_counts
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.till_counts;
create policy mt_write on public.till_counts
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

commit;
