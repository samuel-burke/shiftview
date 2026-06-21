-- Daily sales totals (whole cents), to power the sales-per-labor-hour (SPLH)
-- productivity metric. One row per day. Member-readable; the API restricts
-- writes to managers. reset_demo_org() left unchanged.

begin;

create table if not exists public.daily_sales (
  id           bigint generated always as identity primary key,
  org_id       uuid   not null references public.organizations (id),
  date         date   not null,
  amount_cents integer not null,
  updated_at   timestamptz not null default now(),
  unique (org_id, date)
);

create index if not exists daily_sales_org_date_idx on public.daily_sales (org_id, date);

alter table public.daily_sales enable row level security;

drop policy if exists mt_select on public.daily_sales;
create policy mt_select on public.daily_sales
  for select using (public.is_org_member(org_id));

drop policy if exists mt_write on public.daily_sales;
create policy mt_write on public.daily_sales
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

commit;
