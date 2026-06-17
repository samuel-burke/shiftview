-- Per-shift note: a short free-text label a manager attaches to a scheduled
-- shift (e.g. "Training", "Lock up", "Truck delivery"). A nullable column on
-- schedules; no RLS change is needed (schedules already restricts writes to
-- managers and reads to org members).

begin;

alter table public.schedules
  add column if not exists note text;

commit;
