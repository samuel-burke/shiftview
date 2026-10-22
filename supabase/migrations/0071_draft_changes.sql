-- Changing a published week in Draft mode.
--
-- Until now a draft could only add a shift: publishing skipped any draft for
-- a person who already had a live shift that day, so every change to a
-- published week was made live, one alert at a time. A draft can now stand
-- for a change to a live shift:
--
--   * draft_schedules.replaces_schedule_id: the live shift this draft changes
--     (same person and day). Publishing updates that shift to the draft's
--     times and note. If the live shift is deleted first, the draft goes with it.
--   * draft_schedules.removes: the draft takes the live shift off the
--     schedule when published (its times are the live shift's, for display).
--
-- At most one draft per live shift. Auto-schedule plans around these changes
-- as if published: apply_generated_drafts() below no longer counts, replaces
-- or snapshots them (only drafts of new shifts). Safe to repeat.

begin;

alter table public.draft_schedules
  add column if not exists replaces_schedule_id bigint,
  add column if not exists removes boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'draft_schedules_replaces_fkey') then
    alter table public.draft_schedules
      add constraint draft_schedules_replaces_fkey foreign key (replaces_schedule_id, org_id)
        references public.schedules (id, org_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'draft_schedules_removes_needs_shift') then
    alter table public.draft_schedules
      add constraint draft_schedules_removes_needs_shift check (not removes or replaces_schedule_id is not null);
  end if;
end $$;

create unique index if not exists draft_schedules_replaces_key
  on public.draft_schedules (replaces_schedule_id) where replaces_schedule_id is not null;

-- Same as before (baseline.sql / 0034) except every read and delete of the
-- week's drafts skips changes to live shifts.
CREATE OR REPLACE FUNCTION public.apply_generated_drafts(p_org uuid, p_week_start date, p_mode text, p_replace_run_id bigint, p_expected jsonb, p_rows jsonb, p_seed bigint, p_rules jsonb, p_adjustments jsonb, p_metrics jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_week_end date;
  v_current  jsonb;
  v_previous jsonb := '[]'::jsonb;
  -- record, not %rowtype: a %rowtype declaration needs the table to exist
  -- when the function is created, so applying the statements out of order
  -- or in pieces would fail. A record only needs it when the function runs.
  v_replaced record;
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
     and replaces_schedule_id is null
   for update;
  select coalesce(
           jsonb_agg(jsonb_build_array(id, employee_id, date, start_minutes, end_minutes) order by id),
           '[]'::jsonb)
    into v_current
    from public.draft_schedules
   where org_id = p_org and date between p_week_start and v_week_end
     and replaces_schedule_id is null;
  if v_current is distinct from coalesce(p_expected, '[]'::jsonb) then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_replace_run_id is not null then
    select * into v_replaced
      from public.schedule_generation_runs
     where id = p_replace_run_id and org_id = p_org and week_start = p_week_start
       for update;
    if not found then
      return jsonb_build_object('status', 'stale');
    end if;
    if v_replaced.undone_at is not null
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
     where org_id = p_org and date between p_week_start and v_week_end
     and replaces_schedule_id is null;
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
       where org_id = p_org and date between p_week_start and v_week_end
     and replaces_schedule_id is null;
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
$function$;

commit;
