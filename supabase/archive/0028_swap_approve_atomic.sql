-- Atomic shift-swap approval.
--
-- Approving a swap moves two schedules' owners and resolves the swap row. Doing
-- that as three separate statements from the API left a window where a crash
-- (or a concurrent approval) could exchange one shift but not the other, or
-- double-apply. Fold the whole operation into one SECURITY DEFINER function so
-- it runs in a single transaction with row locks.
--
-- The function re-derives and re-checks everything itself (manager membership,
-- org scope, and that the swap is still 'accepted') so it is safe to expose to
-- the authenticated role: callers can't use it to act outside their org or to
-- approve a swap the target hasn't accepted. It returns a short status string
-- the API maps to an HTTP response.

begin;

create or replace function public.approve_shift_swap(p_org uuid, p_swap_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_swap   public.shift_swaps%rowtype;
  v_emp_a  bigint;
  v_emp_b  bigint;
begin
  -- Only a manager of this org may approve, however the RPC is reached.
  if not public.is_org_manager(p_org) then
    return 'forbidden';
  end if;

  -- Lock the swap so two approvals can't both apply.
  select * into v_swap
  from public.shift_swaps
  where id = p_swap_id and org_id = p_org
  for update;

  if not found then
    return 'not_found';
  end if;

  -- The consent gate: a swap can only be approved once the target accepted it.
  -- Any other state (pending / approved / denied / declined) is returned as-is
  -- so the caller can distinguish "still awaiting acceptance" from "resolved".
  if v_swap.status <> 'accepted' then
    return v_swap.status;
  end if;

  -- Lock both schedules and read their current owners.
  select employee_id into v_emp_a
  from public.schedules
  where id = v_swap.schedule_a_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  select employee_id into v_emp_b
  from public.schedules
  where id = v_swap.schedule_b_id and org_id = p_org
  for update;
  if not found then
    return 'schedule_missing';
  end if;

  -- Exchange owners and resolve the swap — all or nothing.
  update public.schedules set employee_id = v_emp_b
    where id = v_swap.schedule_a_id and org_id = p_org;
  update public.schedules set employee_id = v_emp_a
    where id = v_swap.schedule_b_id and org_id = p_org;
  update public.shift_swaps set status = 'approved'
    where id = p_swap_id and org_id = p_org;

  return 'approved';
end;
$$;

revoke all on function public.approve_shift_swap(uuid, bigint) from public, anon;
grant execute on function public.approve_shift_swap(uuid, bigint) to authenticated;

commit;
