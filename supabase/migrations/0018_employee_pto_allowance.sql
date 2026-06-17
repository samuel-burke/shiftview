-- Annual PTO allowance per employee, to power time-off balance tracking.
--
-- An integer number of days. NULL means PTO isn't tracked for that employee
-- (the balance view shows days taken but no remaining figure). No RLS change is
-- needed: the employees table already restricts writes to managers and reads to
-- org members.

begin;

alter table public.employees
  add column if not exists pto_allowance_days integer;

commit;
