-- Pay periods: approval, employee sign-off and locking.
--
-- Payroll was any date range, and punches stayed editable after payroll ran,
-- so hours could change after they were paid with nothing showing which
-- version was paid, and employees had no way to confirm their hours.
--
-- 1. Settings (app_settings, validated here because managers write them
--    directly):
--      pay_period_frequency  none (default: today's behavior) | weekly |
--                            biweekly | semimonthly
--      pay_period_anchor     YYYY-MM-DD, the first day of any one period.
--                            Required for biweekly; weekly defaults to
--                            Mondays (the payroll workweek); semimonthly
--                            ignores it (1st-15th, 16th-end of month).
--    Periods are calendar dates in the store's timezone (store_timezone).
--    lib/pay-periods.ts does the same math for the app.
-- 2. pay_periods: one row per period a manager or employee has acted on
--    (open -> approved -> locked). Rows are created and changed only by the
--    functions below, which compute the period's dates from the setting, so
--    a client can't invent overlapping or odd-sized periods.
--    pay_period_signoffs: an employee's "these hours are correct" (signed)
--    or a dispute with a note, per period. pay_period_events: who did what
--    and why (approve, lock, reopen with its reason, sign, dispute, and the
--    automatic clearing below). Nobody writes these tables directly.
-- 3. Locking: while a period is locked, punch_records rows whose time falls
--    in it can't be inserted, updated or deleted (delete_punch included), and
--    a punch correction for that time can't be filed or approved: for
--    managers, employees and the service role alike. Changing only a punch's
--    schedule_id (a deleted shift sets it null) is still allowed: it moves no
--    hours. To change hours after a lock, a manager reopens the period with a
--    required reason (pay_period_events keeps it), fixes the punch (0053's
--    history records the edit), then approves and locks again. That's simpler
--    and safer than adjustment punches dated into a later period: payroll
--    always pays a period from its own punches, and the event log shows the
--    period was reopened, when, by whom and why.
--    Payroll counts a shift on its clock-in's day, so the lock also covers a
--    punch outside the period that belongs to a shift begun inside it: the
--    6:00 AM Monday clock-out (or a break) of a shift that started Sunday
--    10:00 PM in a locked week can't be added, moved or deleted. And a period
--    can't be approved or locked while a shift that began in it is still open
--    (a clock-in with no clock-out yet): its hours aren't known.
-- 4. A punch change in a period that isn't locked clears that employee's
--    sign-off for the period (they confirmed different hours), and moves an
--    approved period back to open (the manager approved different hours).
--    Both are logged as events.
--
-- Exempt: the nightly demo reset and org_delete, both run by the service
-- role (no auth.uid()). pay_periods_reset_demo clears the demo's periods.
--
-- Safe to repeat.

begin;

-- ── Settings ────────────────────────────────────────────────────────────────

create or replace function public.enforce_pay_period_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key = 'pay_period_frequency' then
    new.value := lower(btrim(new.value));
    if new.value not in ('none', 'weekly', 'biweekly', 'semimonthly') then
      raise exception 'pay_period_frequency must be none, weekly, biweekly or semimonthly' using errcode = '22023';
    end if;
  elsif new.key = 'pay_period_anchor' then
    new.value := btrim(new.value);
    if new.value <> '' and (new.value !~ '^\d{4}-\d{2}-\d{2}$'
                            or to_char(to_date(new.value, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> new.value) then
      raise exception 'pay_period_anchor must be a date (YYYY-MM-DD)' using errcode = '22023';
    end if;
  end if;
  return new;
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'pay_period_anchor must be a date (YYYY-MM-DD)' using errcode = '22023';
end;
$$;

drop trigger if exists app_settings_pay_period on public.app_settings;
create trigger app_settings_pay_period
  before insert or update on public.app_settings
  for each row execute function public.enforce_pay_period_settings();

-- The period containing p_date for a frequency and anchor; nulls when there
-- are no periods (none, or biweekly with no anchor). Same as
-- payPeriodContaining in lib/pay-periods.ts.
create or replace function public.pay_period_bounds(p_frequency text, p_anchor date, p_date date,
                                                    out start_date date, out end_date date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_anchor date;
  v_len int;
begin
  if p_date is null then
    return;
  end if;
  if p_frequency = 'semimonthly' then
    if extract(day from p_date) <= 15 then
      start_date := date_trunc('month', p_date)::date;
      end_date := start_date + 14;
    else
      start_date := date_trunc('month', p_date)::date + 15;
      end_date := (date_trunc('month', p_date) + interval '1 month')::date - 1;
    end if;
    return;
  end if;
  if p_frequency = 'weekly' then
    v_anchor := coalesce(p_anchor, date '2024-01-01'); -- a Monday
    v_len := 7;
  elsif p_frequency = 'biweekly' and p_anchor is not null then
    v_anchor := p_anchor;
    v_len := 14;
  else
    return;
  end if;
  start_date := p_date - (((p_date - v_anchor) % v_len) + v_len) % v_len;
  end_date := start_date + v_len - 1;
end;
$$;

-- The org's setting. Reads app_settings as its owner, so not granted.
create or replace function public.pay_period_setting(p_org uuid, out frequency text, out anchor date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_anchor text;
begin
  select value into frequency from public.app_settings where org_id = p_org and key = 'pay_period_frequency';
  frequency := coalesce(nullif(frequency, ''), 'none');
  select value into v_anchor from public.app_settings where org_id = p_org and key = 'pay_period_anchor';
  if v_anchor ~ '^\d{4}-\d{2}-\d{2}$' then
    anchor := v_anchor::date;
  end if;
exception when others then
  anchor := null;
end;
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.pay_periods (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'open' check (status in ('open', 'approved', 'locked')),
  approved_by uuid,
  approved_at timestamptz,
  locked_by   uuid,
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  constraint pay_periods_dates check (end_date >= start_date and end_date - start_date < 31),
  constraint pay_periods_status_stamps check (
    (status = 'open' and approved_at is null and locked_at is null)
    or (status = 'approved' and approved_at is not null and locked_at is null)
    or (status = 'locked' and approved_at is not null and locked_at is not null)
  ),
  constraint pay_periods_org_start_key unique (org_id, start_date)
);
create index if not exists pay_periods_org_end_idx on public.pay_periods (org_id, end_date);

create table if not exists public.pay_period_signoffs (
  period_id   bigint not null references public.pay_periods (id) on delete cascade,
  org_id      uuid not null,
  employee_id bigint not null,
  status      text not null check (status in ('signed', 'disputed')),
  note        text,
  signed_by   uuid,
  signed_at   timestamptz not null default now(),
  primary key (period_id, employee_id),
  constraint pay_period_signoffs_employee_org_fkey foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete cascade,
  constraint pay_period_signoffs_dispute_note check (status <> 'disputed' or length(btrim(coalesce(note, ''))) > 0)
);
create index if not exists pay_period_signoffs_employee_idx on public.pay_period_signoffs (org_id, employee_id);

create table if not exists public.pay_period_events (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  period_id   bigint not null references public.pay_periods (id) on delete cascade,
  employee_id bigint,
  action      text not null check (action in
                ('approve', 'lock', 'reopen', 'sign', 'dispute', 'signoff_cleared', 'approval_cleared')),
  actor       uuid,
  at          timestamptz not null default now(),
  reason      text,
  details     jsonb
);
create index if not exists pay_period_events_period_idx on public.pay_period_events (period_id, at);

alter table public.pay_periods enable row level security;
alter table public.pay_period_signoffs enable row level security;
alter table public.pay_period_events enable row level security;

revoke all on table public.pay_periods, public.pay_period_signoffs, public.pay_period_events
  from public, anon, authenticated, service_role;
grant select on table public.pay_periods, public.pay_period_signoffs, public.pay_period_events
  to authenticated, service_role;

drop policy if exists mt_select on public.pay_periods;
create policy mt_select on public.pay_periods for select to authenticated
  using (org_id in (select public.my_org_ids()));

drop policy if exists mt_select on public.pay_period_signoffs;
create policy mt_select on public.pay_period_signoffs for select to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );

drop policy if exists mt_select on public.pay_period_events;
create policy mt_select on public.pay_period_events for select to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );

-- ── Lock checks ─────────────────────────────────────────────────────────────

drop function if exists public.raise_pay_period_locked(public.pay_periods);

-- The locked period containing p_at (store time), if any.
create or replace function public.pay_period_locked_for(p_org uuid, p_at timestamptz)
returns public.pay_periods
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.pay_periods p
   where p.org_id = p_org and p.status = 'locked'
     and p.start_date <= (p_at at time zone public.store_timezone(p_org))::date
     and p.end_date   >= (p_at at time zone public.store_timezone(p_org))::date
   limit 1
$$;

-- The locked period containing the clock-in of the shift a punch at p_at
-- belongs to: the employee's latest clock-in before it, unless a clock-out
-- (other than p_exclude, the punch itself) already closed that shift.
create or replace function public.pay_period_locked_session(p_org uuid, p_employee bigint, p_at timestamptz, p_exclude bigint)
returns public.pay_periods
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_in_id bigint;
  v_in_at timestamptz;
  v_none public.pay_periods;
begin
  select id, punched_at into v_in_id, v_in_at from public.punch_records
   where org_id = p_org and employee_id = p_employee and punch_type = 'clock_in'
     and punched_at <= p_at and id is distinct from p_exclude
   order by punched_at desc, id desc
   limit 1;
  if v_in_id is null or exists (
    select 1 from public.punch_records
     where org_id = p_org and employee_id = p_employee and punch_type = 'clock_out'
       and punched_at >= v_in_at and punched_at <= p_at and id is distinct from p_exclude
  ) then
    return v_none;
  end if;
  return public.pay_period_locked_for(p_org, v_in_at);
end;
$$;

-- Employees with a shift begun in [p_start, p_end] (store dates) that has no
-- clock-out yet, e.g. 'Alex Kim (from 2026-10-11)'.
create or replace function public.pay_period_open_shifts(p_org uuid, p_start date, p_end date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(distinct e.name || ' (from ' || (ci.punched_at at time zone public.store_timezone(p_org))::date || ')', ', ')
    from public.punch_records ci
    join public.employees e on e.id = ci.employee_id and e.org_id = ci.org_id
   where ci.org_id = p_org and ci.punch_type = 'clock_in'
     and (ci.punched_at at time zone public.store_timezone(p_org))::date between p_start and p_end
     and not exists (
       select 1 from public.punch_records n
        where n.org_id = ci.org_id and n.employee_id = ci.employee_id
          and n.punch_type in ('clock_out', 'clock_in')
          and (n.punched_at, n.id) > (ci.punched_at, ci.id)
     )
$$;

-- The service role's demo reset and org_delete's teardown aren't held back.
create or replace function public.pay_period_exempt(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
     and (current_setting('app.allow_owner_removal', true) = 'on'
          or exists (select 1 from public.organizations where id = p_org and is_demo))
$$;

create or replace function public.raise_pay_period_locked(p public.pay_periods, p_session boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_session then
    raise exception 'That punch belongs to a shift that began in a locked pay period (% to %). A manager must reopen it first.',
      p.start_date, p.end_date using errcode = 'PP001';
  end if;
  raise exception 'That time is in a locked pay period (% to %). A manager must reopen it first.',
    p.start_date, p.end_date using errcode = 'PP001';
end;
$$;

create or replace function public.enforce_pay_period_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_locked public.pay_periods;
begin
  if public.pay_period_exempt(v_org) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'schedule_id') = (to_jsonb(old) - 'schedule_id') then
    return new; -- linking or unlinking a shift moves no hours
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_locked := public.pay_period_locked_for(old.org_id, old.punched_at);
    if v_locked.id is not null then
      perform public.raise_pay_period_locked(v_locked);
    end if;
    if old.punch_type <> 'clock_in' then
      v_locked := public.pay_period_locked_session(old.org_id, old.employee_id, old.punched_at, old.id);
      if v_locked.id is not null then
        perform public.raise_pay_period_locked(v_locked, true);
      end if;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_locked := public.pay_period_locked_for(new.org_id, new.punched_at);
    if v_locked.id is not null then
      perform public.raise_pay_period_locked(v_locked);
    end if;
    if new.punch_type <> 'clock_in' then
      v_locked := public.pay_period_locked_session(new.org_id, new.employee_id, new.punched_at,
                                                   case when tg_op = 'UPDATE' then new.id end);
      if v_locked.id is not null then
        perform public.raise_pay_period_locked(v_locked, true);
      end if;
    end if;
    return new;
  end if;
  return old;
end;
$$;

-- "zz": after the other BEFORE triggers (they run by name), so a live
-- punch is judged at the time enforce_punch_integrity stamped on it.
drop trigger if exists punch_records_zz_pay_period_lock on public.punch_records;
create trigger punch_records_zz_pay_period_lock
  before insert or update or delete on public.punch_records
  for each row execute function public.enforce_pay_period_lock();

create or replace function public.enforce_pay_period_lock_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked public.pay_periods;
begin
  if public.pay_period_exempt(new.org_id) then
    return new;
  end if;
  if tg_op = 'INSERT' or (new.status = 'approved' and old.status is distinct from 'approved') then
    v_locked := public.pay_period_locked_for(new.org_id, new.punched_at);
    if v_locked.id is not null then
      perform public.raise_pay_period_locked(v_locked);
    end if;
    if new.punch_type <> 'clock_in' then
      v_locked := public.pay_period_locked_session(new.org_id, new.employee_id, new.punched_at, null);
      if v_locked.id is not null then
        perform public.raise_pay_period_locked(v_locked, true);
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists punch_corrections_zz_pay_period_lock on public.punch_corrections;
create trigger punch_corrections_zz_pay_period_lock
  before insert or update of status on public.punch_corrections
  for each row execute function public.enforce_pay_period_lock_correction();

-- A changed punch in an unlocked period: the employee's sign-off and the
-- manager's approval were for other hours.
create or replace function public.pay_period_touch(p_org uuid, p_employee bigint, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.pay_periods;
  v_signoff public.pay_period_signoffs;
begin
  select p.* into v_period from public.pay_periods p
   where p.org_id = p_org and p.status in ('open', 'approved')
     and p.start_date <= (p_at at time zone public.store_timezone(p_org))::date
     and p.end_date   >= (p_at at time zone public.store_timezone(p_org))::date;
  if v_period.id is null then
    return;
  end if;
  delete from public.pay_period_signoffs
   where period_id = v_period.id and employee_id = p_employee
  returning * into v_signoff;
  if v_signoff.period_id is not null then
    insert into public.pay_period_events (org_id, period_id, employee_id, action, actor, reason, details)
    values (p_org, v_period.id, p_employee, 'signoff_cleared', auth.uid(), 'Punches changed after sign-off',
            to_jsonb(v_signoff));
  end if;
  if v_period.status = 'approved' then
    update public.pay_periods
       set status = 'open', approved_by = null, approved_at = null
     where id = v_period.id;
    insert into public.pay_period_events (org_id, period_id, employee_id, action, actor, reason, details)
    values (p_org, v_period.id, p_employee, 'approval_cleared', auth.uid(), 'Punches changed after approval',
            jsonb_build_object('approved_by', v_period.approved_by, 'approved_at', v_period.approved_at));
  end if;
end;
$$;

create or replace function public.pay_period_punch_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
begin
  if public.pay_period_exempt(v_org) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'schedule_id') = (to_jsonb(old) - 'schedule_id') then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.pay_period_touch(old.org_id, old.employee_id, old.punched_at);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.pay_period_touch(new.org_id, new.employee_id, new.punched_at);
  end if;
  return null;
end;
$$;

drop trigger if exists punch_records_pay_period_changed on public.punch_records;
create trigger punch_records_pay_period_changed
  after insert or update or delete on public.punch_records
  for each row execute function public.pay_period_punch_changed();

-- ── Actions ─────────────────────────────────────────────────────────────────

-- The period containing p_date: the recorded one, or a new open row with the
-- dates the org's setting gives. Not granted: the functions below call it.
create or replace function public.pay_period_ensure(p_org uuid, p_date date)
returns public.pay_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pay_periods;
  v_setting record;
  v_bounds record;
begin
  if p_date is null then
    raise exception 'A date is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pay_period:' || p_org::text, 0));
  select * into v_row from public.pay_periods
   where org_id = p_org and start_date <= p_date and end_date >= p_date;
  if v_row.id is not null then
    return v_row;
  end if;
  select * into v_setting from public.pay_period_setting(p_org);
  if v_setting.frequency = 'none' then
    raise exception 'This store doesn''t use pay periods. Choose a pay period in Settings.' using errcode = '22023';
  end if;
  select * into v_bounds from public.pay_period_bounds(v_setting.frequency, v_setting.anchor, p_date);
  if v_bounds.start_date is null then
    raise exception 'Set the first day of a pay period in Settings.' using errcode = '22023';
  end if;
  if exists (select 1 from public.pay_periods
              where org_id = p_org and start_date <= v_bounds.end_date and end_date >= v_bounds.start_date) then
    raise exception 'The pay period % to % overlaps one already recorded under an earlier setting.',
      v_bounds.start_date, v_bounds.end_date using errcode = '23P01';
  end if;
  insert into public.pay_periods (org_id, start_date, end_date)
  values (p_org, v_bounds.start_date, v_bounds.end_date)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.pay_period_require_manager(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_org_manager(p_org) then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.pay_period_store_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone public.store_timezone(p_org))::date
$$;

-- Refuses while a shift begun in the period is still open.
create or replace function public.pay_period_require_closed_shifts(p public.pay_periods, p_verb text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open text := public.pay_period_open_shifts(p.org_id, p.start_date, p.end_date);
begin
  if v_open is not null then
    raise exception 'Can''t % this pay period: still clocked in: %. Add the missing clock-out first.', p_verb, v_open
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.pay_period_approve(p_org uuid, p_date date)
returns public.pay_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pay_periods;
begin
  perform public.pay_period_require_manager(p_org);
  v_row := public.pay_period_ensure(p_org, p_date);
  if v_row.status = 'locked' then
    raise exception 'This pay period is locked' using errcode = '55000';
  end if;
  if v_row.status = 'approved' then
    return v_row;
  end if;
  if v_row.end_date >= public.pay_period_store_today(p_org) then
    raise exception 'A pay period can be approved once it has ended (after %)', v_row.end_date using errcode = '22023';
  end if;
  perform public.pay_period_require_closed_shifts(v_row, 'approve');
  update public.pay_periods
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = v_row.id
  returning * into v_row;
  insert into public.pay_period_events (org_id, period_id, action, actor)
  values (p_org, v_row.id, 'approve', auth.uid());
  return v_row;
end;
$$;

create or replace function public.pay_period_lock(p_org uuid, p_date date)
returns public.pay_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pay_periods;
begin
  perform public.pay_period_require_manager(p_org);
  v_row := public.pay_period_ensure(p_org, p_date);
  if v_row.status = 'locked' then
    return v_row;
  end if;
  if v_row.status <> 'approved' then
    raise exception 'Approve the pay period before locking it' using errcode = '55000';
  end if;
  perform public.pay_period_require_closed_shifts(v_row, 'lock');
  update public.pay_periods
     set status = 'locked', locked_by = auth.uid(), locked_at = now()
   where id = v_row.id
  returning * into v_row;
  insert into public.pay_period_events (org_id, period_id, action, actor)
  values (p_org, v_row.id, 'lock', auth.uid());
  return v_row;
end;
$$;

create or replace function public.pay_period_reopen(p_org uuid, p_date date, p_reason text)
returns public.pay_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pay_periods;
  v_was public.pay_periods;
begin
  perform public.pay_period_require_manager(p_org);
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required to reopen a pay period' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pay_period:' || p_org::text, 0));
  select * into v_was from public.pay_periods
   where org_id = p_org and start_date <= p_date and end_date >= p_date;
  if v_was.id is null or v_was.status = 'open' then
    raise exception 'This pay period is already open' using errcode = '55000';
  end if;
  update public.pay_periods
     set status = 'open', approved_by = null, approved_at = null, locked_by = null, locked_at = null
   where id = v_was.id
  returning * into v_row;
  insert into public.pay_period_events (org_id, period_id, action, actor, reason, details)
  values (p_org, v_row.id, 'reopen', auth.uid(), btrim(p_reason),
          jsonb_build_object('previous_status', v_was.status,
                             'approved_by', v_was.approved_by, 'approved_at', v_was.approved_at,
                             'locked_by', v_was.locked_by, 'locked_at', v_was.locked_at));
  return v_row;
end;
$$;

-- The caller signs off (or disputes) their own hours for the period
-- containing p_date. Their employee record is found from auth.uid(), so
-- nobody can sign for someone else.
create or replace function public.pay_period_sign(p_org uuid, p_date date, p_status text, p_note text default null)
returns public.pay_period_signoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee bigint;
  v_row public.pay_periods;
  v_note text := nullif(btrim(p_note), '');
  v_signoff public.pay_period_signoffs;
begin
  select id into v_employee from public.employees
   where org_id = p_org and user_id = auth.uid() and archived_at is null and auth.uid() is not null;
  if v_employee is null then
    raise exception 'No employee record linked to this account' using errcode = '42501';
  end if;
  if p_status not in ('signed', 'disputed') then
    raise exception 'status must be signed or disputed' using errcode = '22023';
  end if;
  if p_status = 'disputed' and v_note is null then
    raise exception 'Say what''s wrong with your hours' using errcode = '22023';
  end if;
  v_row := public.pay_period_ensure(p_org, p_date);
  if v_row.end_date > public.pay_period_store_today(p_org) then
    raise exception 'You can sign off on the last day of the pay period (%)', v_row.end_date using errcode = '22023';
  end if;
  insert into public.pay_period_signoffs (period_id, org_id, employee_id, status, note, signed_by, signed_at)
  values (v_row.id, p_org, v_employee, p_status, v_note, auth.uid(), now())
  on conflict (period_id, employee_id) do update
    set status = excluded.status, note = excluded.note, signed_by = excluded.signed_by, signed_at = excluded.signed_at
  returning * into v_signoff;
  insert into public.pay_period_events (org_id, period_id, employee_id, action, actor, reason)
  values (p_org, v_row.id, v_employee, case when p_status = 'signed' then 'sign' else 'dispute' end, auth.uid(), v_note);
  return v_signoff;
end;
$$;

-- The nightly demo reset (service role only): the demo's periods go with its
-- punches.
create or replace function public.pay_periods_reset_demo(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations where id = p_org and is_demo) then
    raise exception 'pay_periods_reset_demo: % is not a demo organization', p_org;
  end if;
  delete from public.pay_periods where org_id = p_org;
end;
$$;

revoke all on function
  public.enforce_pay_period_settings(),
  public.pay_period_bounds(text, date, date),
  public.pay_period_setting(uuid),
  public.pay_period_locked_for(uuid, timestamptz),
  public.pay_period_locked_session(uuid, bigint, timestamptz, bigint),
  public.pay_period_open_shifts(uuid, date, date),
  public.pay_period_require_closed_shifts(public.pay_periods, text),
  public.pay_period_exempt(uuid),
  public.raise_pay_period_locked(public.pay_periods, boolean),
  public.enforce_pay_period_lock(),
  public.enforce_pay_period_lock_correction(),
  public.pay_period_touch(uuid, bigint, timestamptz),
  public.pay_period_punch_changed(),
  public.pay_period_ensure(uuid, date),
  public.pay_period_require_manager(uuid),
  public.pay_period_store_today(uuid),
  public.pay_period_approve(uuid, date),
  public.pay_period_lock(uuid, date),
  public.pay_period_reopen(uuid, date, text),
  public.pay_period_sign(uuid, date, text, text),
  public.pay_periods_reset_demo(uuid)
  from public, anon, authenticated;

grant execute on function public.pay_period_bounds(text, date, date) to authenticated, service_role;
grant execute on function
  public.pay_period_approve(uuid, date),
  public.pay_period_lock(uuid, date),
  public.pay_period_reopen(uuid, date, text),
  public.pay_period_sign(uuid, date, text, text)
  to authenticated, service_role;
grant execute on function public.pay_periods_reset_demo(uuid) to service_role;

commit;
