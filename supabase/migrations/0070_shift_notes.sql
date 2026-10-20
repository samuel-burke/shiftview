-- Shift notes: a short note on a shift ("truck at 7"), shown to the
-- employee, on schedules, draft_schedules, schedule_template_rows and
-- open_shifts. At most 280 characters.
--
-- Safe to repeat.

begin;

do $$
declare
  t text;
begin
  foreach t in array array['schedules', 'draft_schedules', 'schedule_template_rows', 'open_shifts'] loop
    -- open_shifts.note already exists; there only the length rule is new.
    execute format('alter table public.%I add column if not exists note text', t);
    if not exists (select 1 from pg_constraint where conname = t || '_note_length') then
      execute format(
        'alter table public.%I add constraint %I check (note is null or char_length(note) <= 280) not valid',
        t, t || '_note_length'
      );
      -- Validate where it can't fail (new column); open_shifts may hold older,
      -- longer notes, which stay but can't be written again.
      if t <> 'open_shifts' then
        execute format('alter table public.%I validate constraint %I', t, t || '_note_length');
      end if;
    end if;
  end loop;
end $$;

commit;
