-- Employee hire date, to compute tenure and upcoming work anniversaries.
-- Nullable; no RLS change (employees already restricts writes to managers).

begin;

alter table public.employees
  add column if not exists hire_date date;

commit;
