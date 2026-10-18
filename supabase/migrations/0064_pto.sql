-- Paid time off: request types and paid hours, a balance ledger, and accruals.
--
-- Until now a time-off request was only a day marked off: no hours, no
-- balance, nothing for payroll, so PTO was tracked somewhere else by hand.
--
-- 1. time_off_requests gets leave_type ('unpaid', the default and what every
--    existing request stays; 'pto'; 'sick') and paid_hours (null for unpaid;
--    0 < h <= 24 for paid). Status gains 'cancelled'. A cancelled request no
--    longer holds its day, so the one-request-per-day key becomes a partial
--    unique index over the requests that aren't cancelled.
-- 2. pto_ledger: every change to a balance, one row each: an accrual, a usage
--    (a paid request approved), a restore (that request cancelled), a manual
--    adjustment (a manager, with a reason) or a carryover forfeit at year
--    end. Each row stores the balance after it, so a balance is always
--    explained by its rows. Rows are never edited or removed (except with the
--    employee or the organization).
-- 3. pto_balances: the running balance per employee and leave type, written
--    only by the ledger's insert trigger, under a row lock. Two approvals at
--    once queue on that lock, so the second sees the first's deduction.
-- 4. Approving a paid request writes its usage row and cancelling it writes
--    the restore, in triggers on time_off_requests, so any path (the API, a
--    direct PostgREST update, the service role) keeps the ledger right. A
--    usage that would take the balance below zero is refused (TO001) unless
--    the transaction set app.pto_allow_negative (decide_time_off does when
--    the manager chooses to approve anyway). An approved request's type and
--    hours can't change and it can only be cancelled (TO002); a cancelled one
--    is final.
-- 5. decide_time_off (managers approve/deny, optionally changing type and
--    hours, optionally allowing a negative balance), cancel_time_off (the
--    employee, for a request from today on in the store's timezone, or a
--    manager, any), and post_pto_accruals (the app computes each accrual
--    period's expected hours from payroll hours; this reconciles the ledger
--    to them, idempotently, and applies the carryover cap at each year end).
--
-- Safe to repeat.

begin;

-- ── 1. Requests ─────────────────────────────────────────────────────────────

alter table public.time_off_requests add column if not exists leave_type text not null default 'unpaid';
alter table public.time_off_requests add column if not exists paid_hours numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'time_off_requests_leave_type_check') then
    alter table public.time_off_requests add constraint time_off_requests_leave_type_check
      check (leave_type in ('unpaid', 'pto', 'sick'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'time_off_requests_paid_hours_check') then
    alter table public.time_off_requests add constraint time_off_requests_paid_hours_check
      check ((leave_type = 'unpaid' and paid_hours is null)
          or (leave_type <> 'unpaid' and paid_hours > 0 and paid_hours <= 24));
  end if;
end $$;

alter table public.time_off_requests drop constraint if exists time_off_requests_status_check;
alter table public.time_off_requests add constraint time_off_requests_status_check
  check (status in ('pending', 'approved', 'denied', 'cancelled'));

-- One live request per person per day; a cancelled one frees the day.
alter table public.time_off_requests drop constraint if exists time_off_requests_employee_id_date_key;
create unique index if not exists time_off_requests_employee_date_key
  on public.time_off_requests (employee_id, date) where status <> 'cancelled';

-- ── 2. Ledger and balances ─────────────────────────────────────────────────

create table if not exists public.pto_ledger (
  id             bigint generated always as identity primary key,
  org_id         uuid not null references public.organizations (id) on delete cascade,
  employee_id    bigint not null,
  leave_type     text not null check (leave_type in ('pto', 'sick')),
  kind           text not null check (kind in ('accrual', 'usage', 'restore', 'adjustment', 'carryover')),
  hours          numeric(8,2) not null check (hours <> 0),
  balance_after  numeric(8,2) not null default 0,
  effective_date date not null,
  -- Accruals and carryovers: the period they're for, and the hours worked in
  -- it that earned them (hours-worked accruals).
  period_start   date,
  period_end     date,
  worked_hours   numeric(8,2),
  -- Usage and restores: the request. Set null if the request is deleted (its
  -- restore is written first, see time_off_requests_pto_delete).
  request_id     bigint references public.time_off_requests (id) on delete set null,
  reason         text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint pto_ledger_employee_org_fkey foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete cascade,
  constraint pto_ledger_sign_check check (
    (kind <> 'usage' or hours < 0) and (kind <> 'restore' or hours > 0)),
  constraint pto_ledger_adjustment_reason_check check (
    kind <> 'adjustment' or nullif(btrim(reason), '') is not null)
);

create index if not exists pto_ledger_employee_idx
  on public.pto_ledger (org_id, employee_id, leave_type, effective_date);
create index if not exists pto_ledger_period_idx
  on public.pto_ledger (org_id, leave_type, kind, period_start);
-- A request is deducted once and restored once.
create unique index if not exists pto_ledger_request_kind_key
  on public.pto_ledger (request_id, kind) where request_id is not null;

create table if not exists public.pto_balances (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  employee_id bigint not null,
  leave_type  text not null check (leave_type in ('pto', 'sick')),
  balance     numeric(8,2) not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (employee_id, leave_type),
  constraint pto_balances_employee_org_fkey foreign key (employee_id, org_id)
    references public.employees (id, org_id) on delete cascade
);
create index if not exists pto_balances_org_idx on public.pto_balances (org_id);

alter table public.pto_ledger enable row level security;
alter table public.pto_balances enable row level security;

-- Balances are read-only to everyone: only the ledger trigger writes them.
-- The ledger takes inserts from managers (adjustments, by policy below) and
-- from the security-definer functions; nobody updates or deletes it.
revoke all on table public.pto_balances from public, anon, authenticated, service_role;
grant select on table public.pto_balances to authenticated, service_role;
revoke all on table public.pto_ledger from public, anon, authenticated, service_role;
grant select, insert on table public.pto_ledger to authenticated, service_role;

drop policy if exists mt_select on public.pto_ledger;
create policy mt_select on public.pto_ledger for select to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );
drop policy if exists mt_insert on public.pto_ledger;
create policy mt_insert on public.pto_ledger for insert to authenticated
  with check (
    org_id in (select public.my_managed_org_ids())
    and kind = 'adjustment'
    and request_id is null
    and created_by = auth.uid()
  );

drop policy if exists mt_select on public.pto_balances;
create policy mt_select on public.pto_balances for select to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );

-- Every ledger row moves its balance, under the balance row's lock, and
-- records the balance after it.
create or replace function public.pto_ledger_apply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_balance numeric(8,2);
begin
  insert into public.pto_balances (org_id, employee_id, leave_type, balance)
  values (new.org_id, new.employee_id, new.leave_type, 0)
  on conflict (employee_id, leave_type) do nothing;

  select balance into v_balance from public.pto_balances
   where employee_id = new.employee_id and leave_type = new.leave_type
   for update;

  if new.kind = 'usage' and v_balance + new.hours < 0
     and coalesce(current_setting('app.pto_allow_negative', true), '') <> 'on' then
    raise exception 'Not enough % balance: % h available, % h requested',
      new.leave_type, v_balance, -new.hours
      using errcode = 'TO001';
  end if;

  new.balance_after := v_balance + new.hours;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  update public.pto_balances
     set balance = new.balance_after, updated_at = now()
   where employee_id = new.employee_id and leave_type = new.leave_type;
  return new;
end;
$$;

drop trigger if exists pto_ledger_apply on public.pto_ledger;
create trigger pto_ledger_apply
  before insert on public.pto_ledger
  for each row execute function public.pto_ledger_apply();

-- The ledger is append-only. The one update allowed is the foreign key
-- clearing request_id when a request is deleted.
create or replace function public.pto_ledger_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.request_id is null
     and (to_jsonb(new) - 'request_id') = (to_jsonb(old) - 'request_id') then
    return new;
  end if;
  raise exception 'PTO ledger rows cannot be changed; add an adjustment instead'
    using errcode = '42501';
end;
$$;

drop trigger if exists pto_ledger_guard on public.pto_ledger;
create trigger pto_ledger_guard
  before update on public.pto_ledger
  for each row execute function public.pto_ledger_guard();

-- ── 3. Requests drive the ledger ───────────────────────────────────────────

create or replace function public.time_off_requests_pto_check()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- Unpaid days carry no hours; a paid one without hours gets a full day.
  if new.leave_type = 'unpaid' then
    new.paid_hours := null;
  elsif new.paid_hours is null then
    new.paid_hours := 8;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'cancelled' then
      raise exception 'A new request cannot be cancelled' using errcode = 'TO002';
    end if;
    return new;
  end if;

  if new.employee_id is distinct from old.employee_id or new.org_id is distinct from old.org_id then
    raise exception 'A request cannot move to another employee' using errcode = 'TO002';
  end if;
  if old.status = 'cancelled' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'A cancelled request cannot be changed' using errcode = 'TO002';
    end if;
    return new;
  end if;
  if old.status = 'approved' then
    if new.status not in ('approved', 'cancelled') then
      raise exception 'An approved request can only be cancelled' using errcode = 'TO002';
    end if;
    if new.leave_type is distinct from old.leave_type
       or new.paid_hours is distinct from old.paid_hours
       or new.date is distinct from old.date then
      raise exception 'An approved request cannot be changed; cancel it and request again'
        using errcode = 'TO002';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists time_off_requests_pto_check on public.time_off_requests;
create trigger time_off_requests_pto_check
  before insert or update on public.time_off_requests
  for each row execute function public.time_off_requests_pto_check();

create or replace function public.time_off_requests_pto_ledger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_was_approved boolean := tg_op = 'UPDATE' and old.status = 'approved';
begin
  if new.status = 'approved' and not v_was_approved and new.leave_type <> 'unpaid' then
    insert into public.pto_ledger
      (org_id, employee_id, leave_type, kind, hours, effective_date, request_id)
    values
      (new.org_id, new.employee_id, new.leave_type, 'usage', -new.paid_hours, new.date, new.id);
  elsif v_was_approved and new.status <> 'approved' and old.leave_type <> 'unpaid' then
    insert into public.pto_ledger
      (org_id, employee_id, leave_type, kind, hours, effective_date, request_id)
    values
      (old.org_id, old.employee_id, old.leave_type, 'restore', old.paid_hours, old.date, old.id);
  end if;
  return null;
end;
$$;

drop trigger if exists time_off_requests_pto_ledger on public.time_off_requests;
create trigger time_off_requests_pto_ledger
  after insert or update on public.time_off_requests
  for each row execute function public.time_off_requests_pto_ledger();

-- Deleting an approved paid request (a manager over PostgREST, or deleting
-- the organization) gives its hours back first, so the balance still adds up.
create or replace function public.time_off_requests_pto_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.status = 'approved' and old.leave_type <> 'unpaid'
     and not exists (select 1 from public.pto_ledger where request_id = old.id and kind = 'restore') then
    insert into public.pto_ledger
      (org_id, employee_id, leave_type, kind, hours, effective_date, request_id, reason)
    values
      (old.org_id, old.employee_id, old.leave_type, 'restore', old.paid_hours, old.date, old.id,
       'Request deleted');
  end if;
  return old;
end;
$$;

drop trigger if exists time_off_requests_pto_delete on public.time_off_requests;
create trigger time_off_requests_pto_delete
  before delete on public.time_off_requests
  for each row execute function public.time_off_requests_pto_delete();

revoke all on function public.pto_ledger_apply(), public.pto_ledger_guard(),
  public.time_off_requests_pto_check(), public.time_off_requests_pto_ledger(),
  public.time_off_requests_pto_delete()
  from public, anon, authenticated;

-- ── 4. Deciding and cancelling ─────────────────────────────────────────────

-- A manager approves or denies a request, optionally setting its type and
-- paid hours first. Approving a paid request with too little balance returns
-- status 'insufficient' (with the balance) unless p_allow_negative.
create or replace function public.decide_time_off(
  p_request bigint,
  p_status text,
  p_leave_type text default null,
  p_paid_hours numeric default null,
  p_allow_negative boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_req     public.time_off_requests%rowtype;
  v_type    text;
  v_hours   numeric(5,2);
  v_balance numeric(8,2);
begin
  if p_status is null or p_status not in ('approved', 'denied') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_leave_type is not null and p_leave_type not in ('unpaid', 'pto', 'sick') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_paid_hours is not null and (p_paid_hours <= 0 or p_paid_hours > 24) then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_req from public.time_off_requests where id = p_request for update;
  if not found or (auth.uid() is not null and not public.is_org_manager(v_req.org_id)) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_req.status = 'cancelled' or (v_req.status = 'approved' and p_status <> 'approved') then
    return jsonb_build_object('status', 'conflict', 'current', v_req.status);
  end if;
  if v_req.status = p_status then
    return jsonb_build_object('status', 'ok', 'unchanged', true);
  end if;

  v_type := coalesce(p_leave_type, v_req.leave_type);
  v_hours := case when v_type = 'unpaid' then null
                  else coalesce(p_paid_hours, v_req.paid_hours, 8) end;

  if p_status = 'approved' and v_type <> 'unpaid' then
    insert into public.pto_balances (org_id, employee_id, leave_type, balance)
    values (v_req.org_id, v_req.employee_id, v_type, 0)
    on conflict (employee_id, leave_type) do nothing;
    select balance into v_balance from public.pto_balances
     where employee_id = v_req.employee_id and leave_type = v_type
     for update;
    if v_balance < v_hours and not coalesce(p_allow_negative, false) then
      return jsonb_build_object('status', 'insufficient', 'balance', v_balance, 'hours', v_hours,
                                'leave_type', v_type);
    end if;
  end if;

  perform set_config('app.pto_allow_negative', case when p_allow_negative then 'on' else '' end, true);
  update public.time_off_requests
     set status = p_status, leave_type = v_type, paid_hours = v_hours
   where id = p_request;
  perform set_config('app.pto_allow_negative', '', true);

  select balance into v_balance from public.pto_balances
   where employee_id = v_req.employee_id and leave_type = v_type;
  return jsonb_build_object('status', 'ok', 'leave_type', v_type, 'paid_hours', v_hours,
                            'balance', v_balance);
end;
$$;

-- The employee cancels their own request for today or later (store time); a
-- manager cancels any. A cancelled approved paid request gives its hours back.
create or replace function public.cancel_time_off(p_request bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_req     public.time_off_requests%rowtype;
  v_manager boolean;
  v_today   date;
begin
  select * into v_req from public.time_off_requests where id = p_request for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  v_manager := auth.uid() is null or public.is_org_manager(v_req.org_id);
  if not v_manager then
    if not exists (select 1 from public.employees
                    where id = v_req.employee_id and org_id = v_req.org_id
                      and user_id = auth.uid() and archived_at is null) then
      return jsonb_build_object('status', 'not_found');
    end if;
    v_today := (now() at time zone public.store_timezone(v_req.org_id))::date;
    if v_req.date < v_today then
      return jsonb_build_object('status', 'past');
    end if;
  end if;
  if v_req.status not in ('pending', 'approved') then
    return jsonb_build_object('status', 'conflict', 'current', v_req.status);
  end if;

  update public.time_off_requests set status = 'cancelled' where id = p_request;
  return jsonb_build_object('status', 'ok', 'was', v_req.status);
end;
$$;

-- ── 5. Accruals ────────────────────────────────────────────────────────────

-- p_entries: [{employee_id, period_start, period_end, hours, worked_hours}],
-- every accrual period ending in [p_window_start, p_through] with the hours
-- it should have earned in total. Each period's accrual rows are brought to
-- that total (a correction row for the difference, so a late punch fix is
-- explained); periods in the window no entry names go back to zero. Then,
-- for each year ending in the window, a balance above p_carryover_cap at
-- December 31 is forfeited by a carryover row dated that day. Serialized per
-- organization and leave type, so two runs at once can't both post.
create or replace function public.post_pto_accruals(
  p_org uuid,
  p_leave_type text,
  p_window_start date,
  p_through date,
  p_carryover_cap numeric,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_rows      int := 0;
  v_carryover int := 0;
  v_year      int;
  v_dec31     date;
  r           record;
begin
  if auth.uid() is not null and not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_leave_type not in ('pto', 'sick') or p_window_start is null or p_through is null
     or p_window_start > p_through or jsonb_typeof(p_entries) is distinct from 'array'
     or (p_carryover_cap is not null and p_carryover_cap < 0) then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('pto_accrual:' || p_org::text || ':' || p_leave_type));

  for r in
    with wanted as (
      select (e->>'employee_id')::bigint as employee_id,
             (e->>'period_start')::date  as period_start,
             (e->>'period_end')::date    as period_end,
             round((e->>'hours')::numeric, 2) as hours,
             round(nullif(e->>'worked_hours', '')::numeric, 2) as worked_hours
        from jsonb_array_elements(p_entries) e
    ),
    posted as (
      select employee_id, period_start, max(period_end) as period_end, sum(hours) as hours
        from public.pto_ledger
       where org_id = p_org and leave_type = p_leave_type and kind = 'accrual'
         and period_end between p_window_start and p_through
       group by employee_id, period_start
    )
    select coalesce(w.employee_id, p.employee_id) as employee_id,
           coalesce(w.period_start, p.period_start) as period_start,
           coalesce(w.period_end, p.period_end) as period_end,
           w.worked_hours,
           coalesce(w.hours, 0) - coalesce(p.hours, 0) as delta
      from wanted w
      full join posted p on p.employee_id = w.employee_id and p.period_start = w.period_start
  loop
    if r.period_end < p_window_start or r.period_end > p_through or r.period_start > r.period_end then
      raise exception 'Accrual period % – % is outside % – %', r.period_start, r.period_end,
        p_window_start, p_through using errcode = '22023';
    end if;
    if r.delta <> 0 then
      insert into public.pto_ledger
        (org_id, employee_id, leave_type, kind, hours, effective_date, period_start, period_end, worked_hours)
      values
        (p_org, r.employee_id, p_leave_type, 'accrual', r.delta, r.period_end, r.period_start,
         r.period_end, r.worked_hours);
      v_rows := v_rows + 1;
    end if;
  end loop;

  for v_year in extract(year from p_window_start)::int .. extract(year from p_through)::int loop
    v_dec31 := make_date(v_year, 12, 31);
    continue when v_dec31 < p_window_start or v_dec31 > p_through;
    for r in
      select l.employee_id,
             coalesce(sum(l.hours) filter (where not (l.kind = 'carryover' and l.effective_date = v_dec31)), 0) as before_cap,
             coalesce(sum(l.hours) filter (where l.kind = 'carryover' and l.effective_date = v_dec31), 0) as posted
        from public.pto_ledger l
       where l.org_id = p_org and l.leave_type = p_leave_type and l.effective_date <= v_dec31
       group by l.employee_id
    loop
      declare
        v_want numeric(8,2) := case when p_carryover_cap is null then 0
                                    else -greatest(0, r.before_cap - p_carryover_cap) end;
      begin
        if v_want <> r.posted then
          insert into public.pto_ledger
            (org_id, employee_id, leave_type, kind, hours, effective_date, period_start, period_end, reason)
          values
            (p_org, r.employee_id, p_leave_type, 'carryover', v_want - r.posted, v_dec31,
             make_date(v_year, 1, 1), v_dec31,
             case when p_carryover_cap is null then 'Carryover cap removed'
                  else format('Carryover cap %s h', p_carryover_cap) end);
          v_carryover := v_carryover + 1;
        end if;
      end;
    end loop;
  end loop;

  return jsonb_build_object('status', 'ok', 'accrual_rows', v_rows, 'carryover_rows', v_carryover);
end;
$$;

revoke all on function public.decide_time_off(bigint, text, text, numeric, boolean) from public, anon;
grant execute on function public.decide_time_off(bigint, text, text, numeric, boolean) to authenticated, service_role;
revoke all on function public.cancel_time_off(bigint) from public, anon;
grant execute on function public.cancel_time_off(bigint) to authenticated, service_role;
revoke all on function public.post_pto_accruals(uuid, text, date, date, numeric, jsonb) from public, anon;
grant execute on function public.post_pto_accruals(uuid, text, date, date, numeric, jsonb) to authenticated, service_role;

commit;
