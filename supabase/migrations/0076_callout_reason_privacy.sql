-- Call-out status is shared with the team; reasons are private to the employee
-- and their organization's managers. As with pay rates (0042), row policies
-- alone cannot protect a column on a member-readable row. Realtime also omits
-- columns the subscriber cannot SELECT, including from old records.
--
-- DEPLOY WITH THE APP: callout reads must use callouts_for_org, and upserts
-- must use save_callout (ON CONFLICT requires SELECT on the updated columns).
-- Existing RLS, call-out rules, notifications and audit-log controls remain in
-- force. Safe to repeat.

begin;

revoke select on public.callouts from public, anon, authenticated;
revoke select (reason) on public.callouts from public, anon, authenticated;
grant select (id, org_id, employee_id, date, created_by, created_at)
  on public.callouts to authenticated;

-- Returns the shared status with a reason only when the caller may read it.
-- Filters applied by PostgREST operate on these already-redacted results.
create or replace function public.callouts_for_org(p_org uuid)
returns table (id bigint, employee_id bigint, date date, reason text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.employee_id, c.date,
         case when c.org_id in (select public.my_managed_org_ids())
                or (c.org_id, c.employee_id) in (select * from public.my_employees())
              then c.reason else null end
    from public.callouts c
   where c.org_id = p_org and c.org_id in (select public.my_org_ids())
$$;

-- Keep re-filing atomic without granting direct SELECT on reason. This runs
-- with the owner's privileges, so explicitly enforce the same own-or-manager
-- scope as the table's write policies. The callouts_rules trigger still checks
-- the signed-in employee's shift, date and clock-in restrictions.
create or replace function public.save_callout(
  p_org uuid, p_employee_id bigint, p_date date, p_reason text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not exists (select 1 from public.my_managed_org_ids() o where o = p_org)
     and not exists (select 1 from public.my_employees() e
                      where e.org_id = p_org and e.employee_id = p_employee_id) then
    raise exception 'You can only call out for yourself or manage your own organization'
      using errcode = '42501';
  end if;

  insert into public.callouts (org_id, employee_id, date, reason, created_by)
  values (p_org, p_employee_id, p_date, p_reason, auth.uid())
  on conflict (org_id, employee_id, date) do update
    set reason = excluded.reason, created_by = excluded.created_by
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.callouts_for_org(uuid), public.save_callout(uuid, bigint, date, text)
  from public, anon;
grant execute on function public.callouts_for_org(uuid), public.save_callout(uuid, bigint, date, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
