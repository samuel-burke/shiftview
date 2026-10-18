-- Punch notes, the geofence, break types and minor-labor data.
--
-- 1. punch_records.employee_note: an employee's optional short note on a live
--    punch ("covering for Sam", "register 2 was down"). Kept apart from
--    `note`, which holds a manager's reason for a manual punch (0053 copies it
--    into the punch's history), so a manager's later edit never overwrites
--    what the employee wrote. The punch_records_integrity_note trigger cleans
--    it for every writer: control, zero-width and bidi-override characters
--    become spaces, runs of whitespace collapse, the ends are trimmed, and an
--    empty note is stored as null; then punch_records_employee_note_length
--    allows at most 140 characters. Once written it can't be changed by a
--    signed-in user (managers edit punches, not what employees said); the
--    service role can.
--
-- DEPLOY THIS BEFORE THE APP: the app reads and writes the new columns.
-- Safe to repeat.

begin;

-- ── 1. Employee notes on live punches ──────────────────────────────────────

alter table public.punch_records add column if not exists employee_note text;

alter table public.punch_records drop constraint if exists punch_records_employee_note_length;
alter table public.punch_records add constraint punch_records_employee_note_length
  check (employee_note is null or char_length(employee_note) between 1 and 140);

-- The same cleaning as lib/punch-note.ts cleanPunchNote.
create or replace function public.clean_punch_note(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(p, '[\u0001-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;

create or replace function public.enforce_punch_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.employee_note := old.employee_note;
    return new;
  end if;
  new.employee_note := public.clean_punch_note(new.employee_note);
  return new;
end;
$$;

revoke all on function public.enforce_punch_note() from public, anon, authenticated;

drop trigger if exists punch_records_integrity_note on public.punch_records;
create trigger punch_records_integrity_note
  before insert or update on public.punch_records
  for each row execute function public.enforce_punch_note();

commit;
