-- Punch timestamps are server-authoritative.
--
-- punch_records is member-writable under RLS (0003) so the API can insert an
-- employee's punch with their own session. But the same JWT and anon key are
-- available in the browser, so without this guard an employee could skip the
-- API and write punch_records directly with any punched_at they like, punch
-- for a coworker, or edit/delete their own history.
--
-- This trigger enforces, for every end-user write (auth.uid() is set):
--   * live punches (is_manual = false) are stamped with the database clock —
--     any client-supplied punched_at is discarded;
--   * a non-manager may only insert punches for their own employee record;
--   * a non-manager's manual punch may not be in the future or older than 30
--     days, must be a valid next step from their previous punch, and may only
--     be placed before an existing punch to close a previous shift left open
--     (mirrors lib/manual-punch-rules.ts);
--   * only managers may update or delete punch rows, and an update that moves
--     a punch's time marks it manual.
-- The service role (cron, demo seeding, admin tooling) has no auth.uid() and
-- is trusted.

begin;

create or replace function public.enforce_punch_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_manager boolean;
  v_prev text;
  v_next text;
begin
  if v_uid is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if not public.is_org_manager(old.org_id) then
      raise exception 'Only managers can delete punches' using errcode = '42501';
    end if;
    return old;
  end if;

  v_is_manager := public.is_org_manager(new.org_id);

  if tg_op = 'UPDATE' then
    if not v_is_manager then
      raise exception 'Only managers can edit punches' using errcode = '42501';
    end if;
    if new.punched_at is distinct from old.punched_at then
      if new.punched_at > now() then
        raise exception 'punched_at cannot be in the future' using errcode = '22007';
      end if;
      new.is_manual := true;
    end if;
    return new;
  end if;

  -- INSERT
  if not v_is_manager and not exists (
    select 1 from public.employees
    where id = new.employee_id and org_id = new.org_id and user_id = v_uid
  ) then
    raise exception 'You can only record punches for yourself' using errcode = '42501';
  end if;

  if not coalesce(new.is_manual, false) then
    -- Live punch: the server clock is the only source of truth.
    new.punched_at := now();
    return new;
  end if;

  if new.punched_at is null then
    raise exception 'Manual punches require punched_at' using errcode = '23502';
  end if;
  if new.punched_at > now() then
    raise exception 'punched_at cannot be in the future' using errcode = '22007';
  end if;

  if not v_is_manager then
    if new.punched_at < now() - interval '30 days' then
      raise exception 'Manual punches must be within the last 30 days' using errcode = '22007';
    end if;
    select punch_type into v_prev
      from public.punch_records
      where org_id = new.org_id and employee_id = new.employee_id
        and punched_at < new.punched_at
      order by punched_at desc
      limit 1;
    select punch_type into v_next
      from public.punch_records
      where org_id = new.org_id and employee_id = new.employee_id
        and punched_at >= new.punched_at
      order by punched_at asc
      limit 1;

    v_prev := coalesce(v_prev, 'none');
    if not (
      (v_prev in ('none', 'clock_out') and new.punch_type = 'clock_in')
      or (v_prev in ('clock_in', 'break_end') and new.punch_type in ('clock_out', 'break_start'))
      or (v_prev = 'break_start' and new.punch_type = 'break_end')
    ) then
      raise exception 'Invalid manual punch sequence' using errcode = '22007';
    end if;

    if v_next is not null
       and not (v_prev not in ('none', 'clock_out') and v_next = 'clock_in') then
      raise exception 'A manual punch cannot be placed before existing punches' using errcode = '22007';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists punch_records_integrity on public.punch_records;
create trigger punch_records_integrity
  before insert or update or delete on public.punch_records
  for each row execute function public.enforce_punch_integrity();

commit;
