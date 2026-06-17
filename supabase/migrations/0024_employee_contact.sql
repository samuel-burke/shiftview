-- Employee contact details: a personal phone and an emergency contact. The
-- employee model previously had only name/email/user_id, so there was nowhere to
-- record who to call. All nullable; no RLS change (the API restricts writes to
-- the employee themselves or a manager).

begin;

alter table public.employees
  add column if not exists phone text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text;

commit;
