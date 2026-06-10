-- Draft schedule maker migration
-- Run this in the Supabase SQL editor before using the /draft page.

-- 1. Draft shifts — staging area for unpublished schedules.
--    Only managers can see or modify drafts; employees never see them.
create table if not exists draft_schedules (
  id            bigint generated always as identity primary key,
  employee_id   bigint  not null references employees (id) on delete cascade,
  date          date    not null,
  start_minutes integer not null,
  end_minutes   integer not null,
  created_at    timestamptz not null default now(),
  unique (employee_id, date)
);

alter table draft_schedules enable row level security;

create policy "Managers manage draft schedules"
  on draft_schedules
  for all
  using (exists (select 1 from managers where managers.user_id = auth.uid()))
  with check (exists (select 1 from managers where managers.user_id = auth.uid()));

-- 2. Daily labor budget (hours) per day of week, alongside store hours.
alter table store_hours add column if not exists budget_hours integer not null default 0;
