-- Overnight shifts.
--
-- A shift belongs to the date it starts on, and its end may now run past
-- midnight: end_minutes > 1440 means the next day (10 PM–6 AM is 1320–1800).
-- See lib/shift-times.ts.
--
-- The original schedules table predates this repo's migrations, so it may
-- carry a check capping end_minutes at 1440. Drop any such cap on the shift
-- tables, then add one consistent rule: start within the day, end after start,
-- at most 16 hours. NOT VALID applies it to new and changed rows without
-- re-checking existing ones (which already satisfy it).

begin;

do $$
declare
  t text;
  c record;
begin
  foreach t in array array['schedules', 'draft_schedules', 'schedule_template_rows', 'open_shifts'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    for c in
      select conname
      from pg_constraint
      where conrelid = ('public.' || t)::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ~ 'end_minutes'
        and pg_get_constraintdef(oid) ~ '1440'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_shift_times');
    execute format(
      'alter table public.%I add constraint %I check ('
      || 'start_minutes >= 0 and start_minutes < 1440 '
      || 'and end_minutes > start_minutes and end_minutes - start_minutes <= 960'
      || ') not valid',
      t, t || '_shift_times'
    );
  end loop;
end $$;

commit;
