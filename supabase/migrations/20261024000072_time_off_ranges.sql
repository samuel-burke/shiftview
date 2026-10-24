-- Part-day and multi-day time off.
--
--   * time_off_requests.start_minutes / end_minutes: a part-day request
--     ("leaving at 3"). Both null = the whole day, as every existing row is.
--     A part-day request is inside one day (0..1440).
--   * time_off_requests.group_id: the days of one multi-day request share it,
--     so they are approved or denied together. Null = a one-day request.
--
-- Safe to repeat.

begin;

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

commit;
