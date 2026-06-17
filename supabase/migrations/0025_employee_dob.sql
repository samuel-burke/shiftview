-- Employee date of birth, to power youth-labor compliance checks (flagging when
-- a minor is scheduled past allowed hours). Nullable; no RLS change (employees
-- already restricts writes to managers and reads to org members).

begin;

alter table public.employees
  add column if not exists date_of_birth date;

commit;
