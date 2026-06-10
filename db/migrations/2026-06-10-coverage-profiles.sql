-- Coverage profiles migration — replaces optimal/minimum coverage with
-- per-day target coverage curves (15-minute resolution).
-- Run this in the Supabase SQL editor.

-- 1. Named coverage profiles (e.g. "Weekday", "Saturday", "Holiday").
create table if not exists coverage_profiles (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- 2. The curve itself: contiguous time blocks with a target headcount.
--    Blocks snap to 15-minute boundaries and must not overlap (enforced in the API).
create table if not exists coverage_profile_blocks (
  id            bigint generated always as identity primary key,
  profile_id    bigint  not null references coverage_profiles (id) on delete cascade,
  start_minutes integer not null check (start_minutes >= 0 and start_minutes < 1440 and start_minutes % 15 = 0),
  end_minutes   integer not null check (end_minutes > 0 and end_minutes <= 1440 and end_minutes % 15 = 0),
  headcount     integer not null check (headcount >= 0 and headcount <= 99),
  check (start_minutes < end_minutes)
);

-- 3. Default profile per day of week.
create table if not exists coverage_day_defaults (
  day_of_week integer primary key check (day_of_week between 0 and 6),
  profile_id  bigint not null references coverage_profiles (id) on delete cascade
);

-- 4. Date-specific overrides (holidays, special events).
create table if not exists coverage_date_overrides (
  date       date primary key,
  profile_id bigint not null references coverage_profiles (id) on delete cascade
);

-- RLS: everyone signed in can read (the Team page shows coverage status to all
-- employees); only managers can write.
alter table coverage_profiles       enable row level security;
alter table coverage_profile_blocks enable row level security;
alter table coverage_day_defaults   enable row level security;
alter table coverage_date_overrides enable row level security;

do $$
declare t text;
begin
  foreach t in array array['coverage_profiles', 'coverage_profile_blocks', 'coverage_day_defaults', 'coverage_date_overrides']
  loop
    execute format('create policy "Authenticated read" on %I for select to authenticated using (true)', t);
    execute format($p$create policy "Managers insert" on %I for insert to authenticated
      with check (exists (select 1 from managers where managers.user_id = auth.uid()))$p$, t);
    execute format($p$create policy "Managers update" on %I for update to authenticated
      using (exists (select 1 from managers where managers.user_id = auth.uid()))
      with check (exists (select 1 from managers where managers.user_id = auth.uid()))$p$, t);
    execute format($p$create policy "Managers delete" on %I for delete to authenticated
      using (exists (select 1 from managers where managers.user_id = auth.uid()))$p$, t);
  end loop;
end $$;

-- 5. Retire the old system: daily budgets are now derived from the coverage
--    curve, and the flat optimal/minimum settings are replaced by it.
alter table store_hours drop column if exists budget_hours;
delete from app_settings where key in ('optimal_coverage', 'minimum_coverage');
