-- Manager approval for employee punch corrections.
--
-- An employee who missed a punch no longer writes it straight into
-- punch_records: they file a request here, and only a manager's approval
-- turns it into a real (manual) punch. Pending and denied requests never
-- touch punch_records, so payroll, time cards and the live clock state only
-- ever see approved time.
--
-- Builds on 0030: the punch-integrity trigger is redefined so a non-manager
-- can no longer insert manual punches at all — only live, server-stamped ones.
-- Managers (including when approving a request) and the service role are
-- unaffected.

begin;

create table if not exists public.punch_corrections (
  id           bigint generated always as identity primary key,
  org_id       uuid   not null references public.organizations (id) on delete cascade,
  employee_id  bigint not null,
  punch_type   text   not null check (punch_type in ('clock_in', 'clock_out', 'break_start', 'break_end')),
  punched_at   timestamptz not null,
  note         text   not null check (length(btrim(note)) > 0),
  status       text   not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_by uuid,
  created_at   timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  review_note  text,
  -- The punch_records row created on approval.
  punch_id     bigint,
  -- Cascade so deleting an employee (or resetting the demo org) never trips
  -- over leftover requests.
  constraint punch_corrections_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade
);

create index if not exists punch_corrections_org_status_idx
  on public.punch_corrections (org_id, status, created_at desc);
create index if not exists punch_corrections_org_employee_idx
  on public.punch_corrections (org_id, employee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security. Unlike most member-writable tables the fine-grained
-- rules live here too, because this table decides what becomes paid time:
--   * employees see and file only their own requests, and only as 'pending';
--   * only managers can review (update) or delete them.
-- created_at is always the server clock (see trigger below).
-- ---------------------------------------------------------------------------
create or replace function public.is_own_employee(p_org uuid, p_employee bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.employees
    where id = p_employee and org_id = p_org and user_id = auth.uid()
  );
$$;

alter table public.punch_corrections enable row level security;

drop policy if exists mt_select on public.punch_corrections;
create policy mt_select on public.punch_corrections
  for select using (
    public.is_org_manager(org_id) or public.is_own_employee(org_id, employee_id)
  );

drop policy if exists mt_insert on public.punch_corrections;
create policy mt_insert on public.punch_corrections
  for insert with check (
    public.is_own_employee(org_id, employee_id)
    and status = 'pending'
    and reviewed_by is null and reviewed_at is null and punch_id is null
  );

drop policy if exists mt_update on public.punch_corrections;
create policy mt_update on public.punch_corrections
  for update using (public.is_org_manager(org_id)) with check (public.is_org_manager(org_id));

drop policy if exists mt_delete on public.punch_corrections;
create policy mt_delete on public.punch_corrections
  for delete using (public.is_org_manager(org_id));

create or replace function public.punch_corrections_stamp()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  if new.punched_at > now() then
    raise exception 'punched_at cannot be in the future' using errcode = '22007';
  end if;
  return new;
end;
$$;

drop trigger if exists punch_corrections_stamp on public.punch_corrections;
create trigger punch_corrections_stamp
  before insert on public.punch_corrections
  for each row execute function public.punch_corrections_stamp();

-- ---------------------------------------------------------------------------
-- Tighten 0030: non-managers may only insert live punches. Manual punches
-- come from managers — directly, or by approving a punch_corrections row.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_punch_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_manager boolean;
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
  if not v_is_manager then
    if not public.is_own_employee(new.org_id, new.employee_id) then
      raise exception 'You can only record punches for yourself' using errcode = '42501';
    end if;
    if coalesce(new.is_manual, false) then
      raise exception 'Punch corrections need manager approval' using errcode = '42501';
    end if;
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
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime — managers' request inbox and the employee's pending banner update
-- live.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'punch_corrections'
  ) then
    execute 'alter publication supabase_realtime add table public.punch_corrections';
  end if;
exception when undefined_object then
  null; -- no realtime publication (e.g. a plain Postgres test database)
end $$;

commit;
