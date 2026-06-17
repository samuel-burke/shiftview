-- Employee pay rate, to power scheduled labor-cost reporting.
--
-- A nullable hourly rate (dollars/hour). NULL means "rate not set" — the labor
-- cost report surfaces those employees as missing a rate rather than counting
-- them as $0. No RLS change is needed: the employees table already restricts
-- writes to managers (see README) and reads to org members.

begin;

alter table public.employees
  add column if not exists pay_rate numeric(10, 2);

commit;
