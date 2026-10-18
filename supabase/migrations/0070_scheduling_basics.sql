-- Scheduling basics: part-day and multi-day time off, shift notes, and
-- subscribable calendar feeds.
--
--   * time_off_requests.start_minutes / end_minutes: a part-day request
--     ("leaving at 3"). Both null = the whole day, as every existing row is.
--     A part-day request is inside one day (0..1440).
--   * time_off_requests.group_id: the days of one multi-day request share it,
--     so they are approved or denied together. Null = a one-day request.
--   * schedules / draft_schedules / schedule_template_rows / open_shifts.note:
--     a short note on a shift ("truck at 7"), shown to the employee. At most
--     280 characters.
--   * calendar_feeds: one secret feed token per employee, stored as a SHA-256
--     hash. Only the service role reads or writes it (RLS on, no policies):
--     the API checks who is asking, and the public feed URL is looked up by
--     hash.
--
-- Safe to repeat.

begin;

-- ---------------------------------------------------------------------------
-- Time off: part days and multi-day requests
-- ---------------------------------------------------------------------------
alter table public.time_off_requests
  add column if not exists start_minutes integer,
  add column if not exists end_minutes integer,
  add column if not exists group_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'time_off_requests_part_day_check') then
    alter table public.time_off_requests
      add constraint time_off_requests_part_day_check check (
        (start_minutes is null and end_minutes is null)
        or (start_minutes is not null and end_minutes is not null
            and start_minutes >= 0 and end_minutes <= 1440
            and end_minutes - start_minutes >= 15)
      );
  end if;
end $$;

create index if not exists time_off_requests_group_idx
  on public.time_off_requests (org_id, group_id) where group_id is not null;

-- ---------------------------------------------------------------------------
-- Shift notes
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Calendar feeds
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_feeds (
  org_id      uuid not null,
  employee_id bigint not null,
  token_hash  text not null,
  created_at  timestamptz not null default now(),
  constraint calendar_feeds_pkey primary key (org_id, employee_id),
  constraint calendar_feeds_token_hash_key unique (token_hash),
  constraint calendar_feeds_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint calendar_feeds_employee_fkey foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete cascade
);

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;

commit;
