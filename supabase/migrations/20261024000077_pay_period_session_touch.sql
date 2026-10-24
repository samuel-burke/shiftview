-- A punch belongs to the pay period of its shift's clock-in (the lock and
-- payroll both say so), but 0062's pay_period_punch_changed only cleared the
-- approval and sign-off of the period holding the punch itself. Editing the
-- Monday 06:00 clock-out of a Sunday 22:00 shift therefore left the Sunday
-- week approved and signed off with hours nobody saw. Now a punch that is not
-- a clock-in also clears the period its shift began in. Safe to repeat.

begin;

-- The clock-in of the open shift a punch at p_at belongs to: the same lookup
-- as pay_period_locked_session, returning the time instead of the period.
create or replace function public.pay_period_session_start(p_org uuid, p_employee bigint, p_at timestamptz, p_exclude bigint)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_in_id bigint;
  v_in_at timestamptz;
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
    return null;
  end if;
  return v_in_at;
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
  v_in_at timestamptz;
begin
  if public.pay_period_exempt(v_org) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'schedule_id') = (to_jsonb(old) - 'schedule_id') then
    return null;
  end if;
  -- Touching the same period twice does nothing the second time.
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.pay_period_touch(old.org_id, old.employee_id, old.punched_at);
    if old.punch_type <> 'clock_in' then
      v_in_at := public.pay_period_session_start(old.org_id, old.employee_id, old.punched_at, old.id);
      if v_in_at is not null then
        perform public.pay_period_touch(old.org_id, old.employee_id, v_in_at);
      end if;
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.pay_period_touch(new.org_id, new.employee_id, new.punched_at);
    if new.punch_type <> 'clock_in' then
      v_in_at := public.pay_period_session_start(new.org_id, new.employee_id, new.punched_at, new.id);
      if v_in_at is not null then
        perform public.pay_period_touch(new.org_id, new.employee_id, v_in_at);
      end if;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function
  public.pay_period_session_start(uuid, bigint, timestamptz, bigint),
  public.pay_period_punch_changed()
from public, anon, authenticated;

commit;
