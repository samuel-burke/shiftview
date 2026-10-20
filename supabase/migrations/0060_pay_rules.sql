-- Pay rules: exempt employees and checked pay-rule settings.
--
-- Payroll (lib/payroll.ts, lib/pay-rules.ts) now follows per-org pay rules
-- stored in app_settings, and skips overtime for exempt (salaried)
-- employees. Managers can write app_settings and employees directly with
-- their own session (RLS: managers only), so the values payroll reads are
-- checked here as well as in the API:
--
--   * employees.exempt boolean not null default false. Readable through the
--     API like the other roster columns (0042 grants column by column);
--     only managers can change it (employees' mt_update policy, 0003).
--   * app_settings values for the pay-rule keys must be ones payroll
--     understands, stored canonically (trimmed, lower case), else 22023:
--       overtime_rule           federal | california | alaska | nevada | colorado
--       overtime_nevada_daily   true | false
--       payroll_week_start      0–6 (0 = Sunday)
--       punch_rounding_minutes  0 | 5 | 6 | 15
--     Unset keys mean today's behaviour (federal, Monday, exact time), so no
--     existing store changes until a manager opts in. Rows already holding a
--     value payroll can't read (none should exist) are removed, which is how
--     the app reads them anyway: as the default.
--
-- The app keeps working before this runs (it reads no one as exempt when the
-- column is missing), so it can go before or after the app deploy. Safe to
-- repeat.

begin;

alter table public.employees add column if not exists exempt boolean not null default false;

grant select (exempt) on public.employees to anon, authenticated;

-- The value an app_settings row for a pay-rule key must hold, canonical, or
-- null when it isn't valid. Other keys pass through unchanged.
create or replace function public.canonical_pay_rule_setting(p_key text, p_value text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_key
    when 'overtime_rule' then
      case when lower(btrim(p_value)) in ('federal', 'california', 'alaska', 'nevada', 'colorado')
           then lower(btrim(p_value)) end
    when 'overtime_nevada_daily' then
      case when lower(btrim(p_value)) in ('true', 'false') then lower(btrim(p_value)) end
    when 'payroll_week_start' then
      case when btrim(p_value) ~ '^[0-6]$' then btrim(p_value) end
    when 'punch_rounding_minutes' then
      case when btrim(p_value) in ('0', '5', '6', '15') then btrim(p_value) end
    else p_value
  end
$$;

create or replace function public.enforce_pay_rule_setting()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_value text;
begin
  if new.key not in ('overtime_rule', 'overtime_nevada_daily', 'payroll_week_start', 'punch_rounding_minutes') then
    return new;
  end if;
  v_value := public.canonical_pay_rule_setting(new.key, new.value);
  if v_value is null then
    raise exception '% "%" is not a valid pay rule setting', new.key, new.value using errcode = '22023';
  end if;
  new.value := v_value;
  return new;
end;
$$;

delete from public.app_settings
 where key in ('overtime_rule', 'overtime_nevada_daily', 'payroll_week_start', 'punch_rounding_minutes')
   and public.canonical_pay_rule_setting(key, value) is null;

update public.app_settings
   set value = public.canonical_pay_rule_setting(key, value)
 where key in ('overtime_rule', 'overtime_nevada_daily', 'payroll_week_start', 'punch_rounding_minutes')
   and value is distinct from public.canonical_pay_rule_setting(key, value);

drop trigger if exists app_settings_pay_rules on public.app_settings;
create trigger app_settings_pay_rules
  before insert or update on public.app_settings
  for each row execute function public.enforce_pay_rule_setting();

revoke all on function public.enforce_pay_rule_setting() from public, anon, authenticated;
revoke all on function public.canonical_pay_rule_setting(text, text) from public, anon;
grant execute on function public.canonical_pay_rule_setting(text, text) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
