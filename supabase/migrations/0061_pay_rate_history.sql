-- Pay-rate history, position rates and payroll IDs (audit gaps G6, G11).
--
-- Before this, an employee had one rate (employees.pay_rate), so a raise
-- restated every past labor-cost and payroll figure, and a cashier shift paid
-- the same as a shift-lead one.
--
-- employee_pay_rates holds effective-dated rates:
--   * a row with position_id null is the employee's base rate from
--     effective_from (a store-local date) until the next base row;
--   * a row with a position_id is the rate for shifts in that position from
--     effective_from, and overrides the base rate whatever the base rate is
--     doing at the time;
--   * hourly_rate null on a base row means "no rate from this date" (the
--     reports show such hours as missing a rate, never as $0).
-- The rate for an hour of work is the one in effect on the store-local date
-- that hour was worked: a shift that crosses midnight into a new rate's
-- effective date is paid the new rate for the hours after midnight
-- (pay_rate_on below; lib/pay-rates.ts does the same lookup for reports).
--
-- Each employee's existing rate becomes a base row effective from the
-- beginning (1900-01-01), so no past figure changes when this runs.
--
-- employees.pay_rate stays, as the current base rate:
--   * writing it (the app's PATCH /api/employees, or anything older) adds a
--     base row effective today in the store's timezone instead of
--     overwriting history; the employee's first rate ever starts at the
--     beginning, as it always has;
--   * a change to the history (a back-dated correction, a row deleted) is
--     copied back to it, so it always reads the rate in effect today.
--
-- Rates are managers-only, as in 0042: RLS lets only the org's managers read
-- or write employee_pay_rates, and employees.payroll_id is left out of the
-- API column grant (managers read it through employee_payroll_ids(org)).
--
-- Can run before or after the app deploy: the old app keeps writing
-- employees.pay_rate and reading employee_pay_rates(org), both of which keep
-- working. Needs 0041, 0042 and 0047. Safe to repeat.

begin;

-- ---------------------------------------------------------------------------
-- 1. Payroll ID: the employee's ID in the payroll provider (Gusto employee
--    ID, ADP file number, ...). Managers set it; it is not in the column
--    grant, so coworkers can't read it.
-- ---------------------------------------------------------------------------

alter table public.employees add column if not exists payroll_id text;
alter table public.employees drop constraint if exists employees_payroll_id_check;
alter table public.employees add constraint employees_payroll_id_check
  check (payroll_id is null or (length(payroll_id) between 1 and 40 and payroll_id !~ '[\t\r\n]'));

-- ---------------------------------------------------------------------------
-- 2. The history table.
-- ---------------------------------------------------------------------------

create table if not exists public.employee_pay_rates (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id bigint not null,
  position_id bigint,
  effective_from date not null,
  hourly_rate numeric(10, 2),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint employee_pay_rates_employee_org_fkey
    foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade,
  constraint employee_pay_rates_position_org_fkey
    foreign key (position_id, org_id) references public.positions (id, org_id) on delete cascade,
  constraint employee_pay_rates_rate_check
    check (hourly_rate is null or (hourly_rate >= 0 and hourly_rate < 100000)),
  -- A position rate always has a rate; to stop using one, delete it.
  constraint employee_pay_rates_position_rate_check
    check (position_id is null or hourly_rate is not null),
  constraint employee_pay_rates_one_per_day
    unique nulls not distinct (employee_id, position_id, effective_from)
);

create index if not exists employee_pay_rates_lookup
  on public.employee_pay_rates (org_id, employee_id, effective_from);

alter table public.employee_pay_rates enable row level security;

drop policy if exists mt_select on public.employee_pay_rates;
drop policy if exists mt_insert on public.employee_pay_rates;
drop policy if exists mt_update on public.employee_pay_rates;
drop policy if exists mt_delete on public.employee_pay_rates;
create policy mt_select on public.employee_pay_rates for select to authenticated
  using (org_id in (select public.my_managed_org_ids()));
create policy mt_insert on public.employee_pay_rates for insert to authenticated
  with check (org_id in (select public.my_managed_org_ids()));
create policy mt_update on public.employee_pay_rates for update to authenticated
  using (org_id in (select public.my_managed_org_ids()))
  with check (org_id in (select public.my_managed_org_ids()));
create policy mt_delete on public.employee_pay_rates for delete to authenticated
  using (org_id in (select public.my_managed_org_ids()));

revoke all on table public.employee_pay_rates from public, anon;
grant select, insert, update, delete on table public.employee_pay_rates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The lookup rule, in one place.
-- ---------------------------------------------------------------------------

-- The hourly rate for p_employee on store-local day p_day, in p_position
-- (null: no position). A position rate in effect that day wins; otherwise the
-- base rate in effect that day; null when neither exists or the base rate in
-- effect is "no rate".
create or replace function public.pay_rate_on(p_employee bigint, p_day date, p_position bigint default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.hourly_rate from public.employee_pay_rates r
      where p_position is not null
        and r.employee_id = p_employee and r.position_id = p_position and r.effective_from <= p_day
      order by r.effective_from desc limit 1),
    (select r.hourly_rate from public.employee_pay_rates r
      where r.employee_id = p_employee and r.position_id is null and r.effective_from <= p_day
      order by r.effective_from desc limit 1)
  )
$$;
-- Internal: callers reach rates through employee_pay_rates (RLS) or the
-- manager-checked functions below.
revoke all on function public.pay_rate_on(bigint, date, bigint) from public, anon, authenticated;
grant execute on function public.pay_rate_on(bigint, date, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Backfill: each existing rate, effective from the beginning.
-- ---------------------------------------------------------------------------

insert into public.employee_pay_rates (org_id, employee_id, position_id, effective_from, hourly_rate, created_by)
select e.org_id, e.id, null, date '1900-01-01', e.pay_rate, null
  from public.employees e
 where e.pay_rate is not null
   and not exists (select 1 from public.employee_pay_rates r
                    where r.employee_id = e.id and r.position_id is null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Keep employees.pay_rate and the history in step.
-- ---------------------------------------------------------------------------

-- Writing employees.pay_rate adds a history row instead of overwriting it.
create or replace function public.employee_pay_rate_to_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_from date;
  v_has_history boolean;
begin
  v_has_history := exists (select 1 from public.employee_pay_rates
                            where employee_id = new.id and position_id is null);
  -- No rate, and none before: nothing to record.
  if not v_has_history and new.pay_rate is null then
    return null;
  end if;
  v_today := (now() at time zone public.store_timezone(new.org_id))::date;
  -- Already what the history says for today (this is also how the copy-back
  -- from the history trigger below ends): nothing to do.
  if v_has_history and public.pay_rate_on(new.id, v_today, null) is not distinct from new.pay_rate then
    return null;
  end if;
  -- The first rate an employee ever gets applies from the beginning, as the
  -- single rate always did; later ones from today.
  if v_has_history then
    v_from := v_today;
  else
    v_from := date '1900-01-01';
  end if;
  insert into public.employee_pay_rates (org_id, employee_id, position_id, effective_from, hourly_rate)
  values (new.org_id, new.id, null, v_from, new.pay_rate)
  on conflict (employee_id, position_id, effective_from)
  do update set hourly_rate = excluded.hourly_rate, created_at = now(), created_by = auth.uid();
  return null;
end;
$$;

drop trigger if exists employees_pay_rate_history on public.employees;
create trigger employees_pay_rate_history
  after insert or update of pay_rate on public.employees
  for each row execute function public.employee_pay_rate_to_history();

-- A change to the base-rate history is copied to employees.pay_rate, which
-- then reads the rate in effect today.
create or replace function public.employee_pay_rate_from_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.employee_pay_rates%rowtype;
  v_rate numeric;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if v_row.position_id is not null then return null; end if;
  v_rate := public.pay_rate_on(
    v_row.employee_id,
    (now() at time zone public.store_timezone(v_row.org_id))::date,
    null);
  update public.employees set pay_rate = v_rate
   where id = v_row.employee_id and org_id = v_row.org_id and pay_rate is distinct from v_rate;
  return null;
end;
$$;

drop trigger if exists employee_pay_rates_sync on public.employee_pay_rates;
create trigger employee_pay_rates_sync
  after insert or update or delete on public.employee_pay_rates
  for each row execute function public.employee_pay_rate_from_history();

-- created_by is who made the change, never what the client sent.
create or replace function public.employee_pay_rates_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.org_id := old.org_id;
    new.employee_id := old.employee_id;
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists employee_pay_rates_stamp on public.employee_pay_rates;
create trigger employee_pay_rates_stamp
  before insert or update on public.employee_pay_rates
  for each row execute function public.employee_pay_rates_stamp();

revoke all on function
  public.employee_pay_rate_to_history(),
  public.employee_pay_rate_from_history(),
  public.employee_pay_rates_stamp()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the app reads.
-- ---------------------------------------------------------------------------

-- Same signature as 0041: today's base rate for each employee, for a manager
-- of p_org and nothing for anyone else. Now read from the history, so a
-- future-dated raise shows up on its day without anyone writing anything.
create or replace function public.employee_pay_rates(p_org uuid)
returns table (employee_id bigint, pay_rate numeric)
language sql stable security definer set search_path = public
as $$
  select e.id::bigint,
         case when exists (select 1 from public.employee_pay_rates r
                            where r.employee_id = e.id and r.position_id is null)
              then public.pay_rate_on(e.id, (now() at time zone public.store_timezone(p_org))::date, null)
              else e.pay_rate end
    from public.employees e
   where e.org_id = p_org
     and public.is_org_manager(p_org)
$$;
revoke all on function public.employee_pay_rates(uuid) from public, anon;
grant execute on function public.employee_pay_rates(uuid) to authenticated, service_role;

-- Payroll IDs for a manager of p_org; nothing for anyone else.
create or replace function public.employee_payroll_ids(p_org uuid)
returns table (employee_id bigint, payroll_id text)
language sql stable security definer set search_path = public
as $$
  select e.id::bigint, e.payroll_id
    from public.employees e
   where e.org_id = p_org
     and public.is_org_manager(p_org)
$$;
revoke all on function public.employee_payroll_ids(uuid) from public, anon;
grant execute on function public.employee_payroll_ids(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
