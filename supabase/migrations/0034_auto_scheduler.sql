-- Auto-scheduler foundations (see docs/AUTO_SCHEDULER.md).
--
--   * employees: employment type and weekly limits, the manager-owned rules
--     the generator must respect. NULL means "use the org default for the
--     type" (app_settings sched_* keys, parsed by lib/scheduling-rules.ts).
--   * employee_preferences: what an employee would like (preferred shift types
--     and days, days they'd rather not work, desired weekly hours). Only the
--     employee themself and managers can read or change it.
--   * schedule_generation_runs: one row per Auto-schedule run, with its inputs,
--     metrics and the drafts it removed, so the run can be undone.
--   * draft_schedules.generation_run_id: the run that created a draft.
--   * apply_generated_drafts() / undo_generation_run(): the draft writes, each
--     in a single transaction with its own manager check (same approach as
--     0028_swap_approve_atomic.sql).
--   * reset_demo_org() and org_delete() are redefined to clear the new tables.
--     org_delete() also gains the tenant tables added after 0009 (callouts,
--     open shifts, positions, announcements, punch corrections): their org
--     foreign keys don't cascade, so deleting an org that had any of those
--     rows used to fail.

begin;

-- ---------------------------------------------------------------------------
-- 1. Employee scheduling limits.
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists employment_type   text,
  add column if not exists min_weekly_hours  numeric(4, 1),
  add column if not exists max_weekly_hours  numeric(4, 1),
  add column if not exists max_days_per_week smallint;

alter table public.employees drop constraint if exists employees_employment_type_check;
alter table public.employees add constraint employees_employment_type_check
  check (employment_type is null or employment_type in ('full_time', 'part_time'));

alter table public.employees drop constraint if exists employees_weekly_hours_check;
alter table public.employees add constraint employees_weekly_hours_check
  check (
    (min_weekly_hours is null or min_weekly_hours between 0 and 80)
    and (max_weekly_hours is null or max_weekly_hours between 0 and 80)
    and (min_weekly_hours is null or max_weekly_hours is null or min_weekly_hours <= max_weekly_hours)
  );

alter table public.employees drop constraint if exists employees_max_days_per_week_check;
alter table public.employees add constraint employees_max_days_per_week_check
  check (max_days_per_week is null or max_days_per_week between 1 and 7);

-- ---------------------------------------------------------------------------
-- 2. Shift preferences. Days are 0 = Sunday … 6 = Saturday, like availability.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_preferences (
  org_id                uuid       not null references public.organizations (id),
  employee_id           bigint     not null,
  preferred_shift_types text[]     not null default '{}',
  preferred_days        smallint[] not null default '{}',
  avoid_days            smallint[] not null default '{}',
  desired_weekly_hours  numeric(4, 1),
  note                  text,
  updated_at            timestamptz not null default now(),
  primary key (org_id, employee_id),
  constraint employee_preferences_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  constraint employee_preferences_shift_types_check
    check (preferred_shift_types <@ array['opener', 'mid', 'closer']::text[]),
  constraint employee_preferences_days_check
    check (preferred_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
       and avoid_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  constraint employee_preferences_days_disjoint_check
    check (not (preferred_days && avoid_days)),
  constraint employee_preferences_desired_hours_check
    check (desired_weekly_hours is null or desired_weekly_hours between 0 and 80),
  constraint employee_preferences_note_check
    check (note is null or length(note) <= 500)
);

alter table public.employee_preferences enable row level security;

drop policy if exists mt_select on public.employee_preferences;
create policy mt_select on public.employee_preferences
  for select using (
    public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id)
  );

drop policy if exists mt_write on public.employee_preferences;
create policy mt_write on public.employee_preferences
  for all
  using (public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id))
  with check (public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id));

-- ---------------------------------------------------------------------------
-- 3. Generation runs. Written only through the functions below; managers can
--    read them, and the publish route marks a week's runs as published.
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_generation_runs (
  id              bigint generated always as identity primary key,
  org_id          uuid   not null references public.organizations (id),
  week_start      date   not null,
  mode            text   not null check (mode in ('fill', 'replace')),
  seed            bigint not null,
  rules           jsonb  not null default '{}'::jsonb,
  adjustments     jsonb  not null default '[]'::jsonb,
  metrics         jsonb  not null default '{}'::jsonb,
  -- Drafts this run deleted, restored on undo:
  -- [{employee_id, date, start_minutes, end_minutes, generation_run_id}]
  previous_drafts jsonb  not null default '[]'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  undone_at       timestamptz,
  published_at    timestamptz
);

create index if not exists schedule_generation_runs_org_week_idx
  on public.schedule_generation_runs (org_id, week_start, id desc);

alter table public.schedule_generation_runs enable row level security;

drop policy if exists mt_select on public.schedule_generation_runs;
create policy mt_select on public.schedule_generation_runs
  for select using (public.is_org_manager(org_id));

drop policy if exists mt_update on public.schedule_generation_runs;
create policy mt_update on public.schedule_generation_runs
  for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

-- ---------------------------------------------------------------------------
-- 4. Which run created a draft. A plain FK: the functions below only ever set
--    a run id from the draft's own org.
-- ---------------------------------------------------------------------------
alter table public.draft_schedules
  add column if not exists generation_run_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'draft_schedules_generation_run_fkey'
  ) then
    alter table public.draft_schedules
      add constraint draft_schedules_generation_run_fkey
      foreign key (generation_run_id) references public.schedule_generation_runs (id)
      on delete set null;
  end if;
end $$;

create index if not exists draft_schedules_generation_run_idx
  on public.draft_schedules (generation_run_id);

-- ---------------------------------------------------------------------------
-- 5. Apply a generated schedule to a week's drafts, atomically.
--
--   p_mode            'fill' keeps the week's drafts; 'replace' deletes them
--                     first (they're saved on the run for undo).
--   p_replace_run_id  "Try another version": delete only that run's drafts
--                     and inherit what it had removed, so undoing the new run
--                     still restores the manager's original drafts.
--   p_expected        The week's drafts as the generator read them,
--                     [[id, employee_id, date, start_minutes, end_minutes], …]
--                     sorted by id. If the week changed since, nothing is
--                     written and 'conflict' is returned.
--   p_rows            [{employee_id, date, start_minutes, end_minutes}, …]
--
-- Returns {status: 'ok', run_id, inserted, removed}, or a status of
-- 'forbidden' | 'invalid' | 'conflict' | 'stale' (the run to replace is not
-- the week's latest live run) with nothing written.
-- ---------------------------------------------------------------------------
create or replace function public.apply_generated_drafts(
  p_org            uuid,
  p_week_start     date,
  p_mode           text,
  p_replace_run_id bigint,
  p_expected       jsonb,
  p_rows           jsonb,
  p_seed           bigint,
  p_rules          jsonb,
  p_adjustments    jsonb,
  p_metrics        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end date;
  v_current  jsonb;
  v_previous jsonb := '[]'::jsonb;
  v_replaced public.schedule_generation_runs%rowtype;
  v_run_id   bigint;
  v_removed  int := 0;
  v_inserted int := 0;
begin
  if not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_week_start is null or p_mode is null or p_mode not in ('fill', 'replace')
     or jsonb_typeof(p_rows) is distinct from 'array' then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_week_end := p_week_start + 6;

  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(date date)
    where r.date is null or r.date not between p_week_start and v_week_end
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- One generation per org-week at a time.
  perform pg_advisory_xact_lock(
    hashtextextended('schedule_generation:' || p_org::text || ':' || p_week_start::text, 0)
  );

  -- The generator planned around the week's drafts as it read them; if they
  -- have changed since, its plan may no longer fit.
  perform 1 from public.draft_schedules
   where org_id = p_org and date between p_week_start and v_week_end
   for update;
  select coalesce(
           jsonb_agg(jsonb_build_array(id, employee_id, date, start_minutes, end_minutes) order by id),
           '[]'::jsonb)
    into v_current
    from public.draft_schedules
   where org_id = p_org and date between p_week_start and v_week_end;
  if v_current is distinct from coalesce(p_expected, '[]'::jsonb) then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_replace_run_id is not null then
    select * into v_replaced
      from public.schedule_generation_runs
     where id = p_replace_run_id and org_id = p_org and week_start = p_week_start
       for update;
    if not found
       or v_replaced.undone_at is not null
       or v_replaced.published_at is not null
       or exists (
         select 1 from public.schedule_generation_runs r
          where r.org_id = p_org and r.week_start = p_week_start
            and r.id > p_replace_run_id and r.undone_at is null
       ) then
      return jsonb_build_object('status', 'stale');
    end if;
    v_previous := v_replaced.previous_drafts;
  elsif p_mode = 'replace' then
    select coalesce(
             jsonb_agg(jsonb_build_object(
               'employee_id', employee_id,
               'date', date,
               'start_minutes', start_minutes,
               'end_minutes', end_minutes,
               'generation_run_id', generation_run_id) order by id),
             '[]'::jsonb)
      into v_previous
      from public.draft_schedules
     where org_id = p_org and date between p_week_start and v_week_end;
  end if;

  -- The writes. Any constraint failure rolls back everything in this block.
  begin
    if p_replace_run_id is not null then
      delete from public.draft_schedules
       where org_id = p_org and generation_run_id = p_replace_run_id;
      get diagnostics v_removed = row_count;
      update public.schedule_generation_runs set undone_at = now() where id = p_replace_run_id;
    elsif p_mode = 'replace' then
      delete from public.draft_schedules
       where org_id = p_org and date between p_week_start and v_week_end;
      get diagnostics v_removed = row_count;
    end if;

    insert into public.schedule_generation_runs
      (org_id, week_start, mode, seed, rules, adjustments, metrics, previous_drafts, created_by)
    values
      (p_org, p_week_start, p_mode, p_seed,
       coalesce(p_rules, '{}'::jsonb), coalesce(p_adjustments, '[]'::jsonb),
       coalesce(p_metrics, '{}'::jsonb), v_previous, auth.uid())
    returning id into v_run_id;

    insert into public.draft_schedules
      (org_id, employee_id, date, start_minutes, end_minutes, generation_run_id)
    select p_org, r.employee_id, r.date, r.start_minutes, r.end_minutes, v_run_id
      from jsonb_to_recordset(p_rows)
        as r(employee_id bigint, date date, start_minutes int, end_minutes int);
    get diagnostics v_inserted = row_count;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'conflict');
    when foreign_key_violation or check_violation or not_null_violation then
      return jsonb_build_object('status', 'invalid');
  end;

  return jsonb_build_object(
    'status', 'ok', 'run_id', v_run_id, 'inserted', v_inserted, 'removed', v_removed
  );
end;
$$;

revoke all on function public.apply_generated_drafts(uuid, date, text, bigint, jsonb, jsonb, bigint, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.apply_generated_drafts(uuid, date, text, bigint, jsonb, jsonb, bigint, jsonb, jsonb, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Undo a run: delete the drafts it created and restore the ones it removed.
--    Only the week's latest live run, and only before the week is published.
--    Restored drafts skip employees since deleted and employee-days that have
--    a draft again.
--
-- Returns {status: 'ok', week_start, removed, restored}, or a status of
-- 'forbidden' | 'not_found' | 'already_undone' | 'published' | 'not_latest'.
-- ---------------------------------------------------------------------------
create or replace function public.undo_generation_run(p_org uuid, p_run_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run      public.schedule_generation_runs%rowtype;
  v_removed  int := 0;
  v_restored int := 0;
begin
  if not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select * into v_run
    from public.schedule_generation_runs
   where id = p_run_id and org_id = p_org;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('schedule_generation:' || p_org::text || ':' || v_run.week_start::text, 0)
  );
  select * into v_run
    from public.schedule_generation_runs
   where id = p_run_id and org_id = p_org
     for update;

  if v_run.undone_at is not null then
    return jsonb_build_object('status', 'already_undone');
  end if;
  if v_run.published_at is not null then
    return jsonb_build_object('status', 'published');
  end if;
  if exists (
    select 1 from public.schedule_generation_runs r
     where r.org_id = p_org and r.week_start = v_run.week_start
       and r.id > v_run.id and r.undone_at is null
  ) then
    return jsonb_build_object('status', 'not_latest');
  end if;

  delete from public.draft_schedules
   where org_id = p_org and generation_run_id = p_run_id;
  get diagnostics v_removed = row_count;

  insert into public.draft_schedules
    (org_id, employee_id, date, start_minutes, end_minutes, generation_run_id)
  select p_org, d.employee_id, d.date, d.start_minutes, d.end_minutes, d.generation_run_id
    from jsonb_to_recordset(v_run.previous_drafts)
      as d(employee_id bigint, date date, start_minutes int, end_minutes int, generation_run_id bigint)
   where exists (
     select 1 from public.employees e where e.id = d.employee_id and e.org_id = p_org
   )
  on conflict (org_id, employee_id, date) do nothing;
  get diagnostics v_restored = row_count;

  update public.schedule_generation_runs set undone_at = now() where id = p_run_id;

  return jsonb_build_object(
    'status', 'ok', 'week_start', v_run.week_start, 'removed', v_removed, 'restored', v_restored
  );
end;
$$;

revoke all on function public.undo_generation_run(uuid, bigint) from public, anon;
grant execute on function public.undo_generation_run(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Demo reset: 0015's definition plus the new tables. Drafts go before the
--    runs they point at; preferences before employees.
-- ---------------------------------------------------------------------------
create or replace function public.reset_demo_org(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    raise exception 'reset_demo_org: % is not a demo organization', p_org;
  end if;

  delete from open_shift_claims        where org_id = p_org;
  delete from open_shifts              where org_id = p_org;
  delete from punch_records            where org_id = p_org;
  delete from shift_swaps              where org_id = p_org;
  delete from draft_schedules          where org_id = p_org;
  delete from schedule_generation_runs where org_id = p_org;
  delete from schedule_template_rows   where org_id = p_org;
  delete from schedule_templates       where org_id = p_org;
  delete from schedules                where org_id = p_org;
  delete from availability             where org_id = p_org;
  delete from employee_preferences     where org_id = p_org;
  delete from time_off_requests        where org_id = p_org;
  delete from callouts                 where org_id = p_org;
  delete from messages                 where org_id = p_org;
  delete from notifications            where org_id = p_org;
  delete from audit_logs               where org_id = p_org;
  delete from coverage_profile_blocks  where org_id = p_org;
  delete from coverage_date_overrides  where org_id = p_org;
  delete from coverage_day_defaults    where org_id = p_org;
  delete from coverage_profiles        where org_id = p_org;
  delete from store_hours              where org_id = p_org;
  delete from app_settings             where org_id = p_org;
  delete from employees                where org_id = p_org;
  delete from managers                 where org_id = p_org;
end;
$$;

revoke all on function public.reset_demo_org(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Organization deletion: 0009's definition with every tenant table, children
--    before parents.
-- ---------------------------------------------------------------------------
create or replace function public.org_delete(p_org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- The seeded default and demo organizations must never be deletable.
  if p_org in ('00000000-0000-0000-0000-000000000001',
               '00000000-0000-0000-0000-000000000002') then
    raise exception 'org_delete: organization % cannot be deleted', p_org;
  end if;
  if not exists (select 1 from organizations where id = p_org) then
    raise exception 'org_delete: organization % does not exist', p_org;
  end if;

  perform set_config('app.allow_owner_removal', 'on', true);

  delete from open_shift_claims        where org_id = p_org;
  delete from open_shifts              where org_id = p_org;
  delete from punch_corrections        where org_id = p_org;
  delete from punch_records            where org_id = p_org;
  delete from shift_swaps              where org_id = p_org;
  delete from draft_schedules          where org_id = p_org;
  delete from schedule_generation_runs where org_id = p_org;
  delete from schedule_template_rows   where org_id = p_org;
  delete from schedule_templates       where org_id = p_org;
  delete from schedules                where org_id = p_org;
  delete from positions                where org_id = p_org;
  delete from availability             where org_id = p_org;
  delete from employee_preferences     where org_id = p_org;
  delete from time_off_requests        where org_id = p_org;
  delete from callouts                 where org_id = p_org;
  delete from messages                 where org_id = p_org;
  delete from notifications            where org_id = p_org;
  delete from announcements            where org_id = p_org;
  delete from audit_logs               where org_id = p_org;
  delete from coverage_profile_blocks  where org_id = p_org;
  delete from coverage_date_overrides  where org_id = p_org;
  delete from coverage_day_defaults    where org_id = p_org;
  delete from coverage_profiles        where org_id = p_org;
  delete from store_hours              where org_id = p_org;
  delete from app_settings             where org_id = p_org;
  delete from employees                where org_id = p_org;
  delete from managers                 where org_id = p_org;
  delete from organizations            where id = p_org;
end;
$$;

-- Service-role only: ownership is verified by DELETE /api/organizations
-- before it invokes this through the admin client.
revoke all on function public.org_delete(uuid)
  from public, anon, authenticated;

commit;
