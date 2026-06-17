-- Soft shift-type preferences per employee (which of opener/mid/closer they'd
-- rather work). Stored as a comma-separated string; empty/null = no preference.
-- Unlike availability this is advisory, so it lives as a simple column. No RLS
-- change (employees already restricts writes appropriately; the API lets an
-- employee set their own and a manager set anyone's).

begin;

alter table public.employees
  add column if not exists preferred_shift_types text;

commit;
