-- Invites for people who already have a ShiftView account.
--
-- An invited employee row is linked to its account by email when the account
-- is created (link_employee_on_signup, an auth.users trigger that predates
-- this repo's migrations). Someone who already has an account — they work at
-- another store, or were invited before and never accepted — never fires that
-- trigger again, and Supabase won't invite an email that's already
-- registered, so inviting them failed.
--
-- POST /api/invites now calls link_employee_account() right after creating
-- the employee row. It links the row to an existing account with the same
-- email (case-insensitive; anonymous demo users have no email and never
-- match) and says whether that account has confirmed its email, so the route
-- knows whether to send an invite or just tell them. People in several
-- organizations pick between them with the organization switcher.
--
-- Service role only. Safe to repeat.

create or replace function public.link_employee_account(p_org uuid, p_employee bigint)
returns table (user_id uuid, confirmed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid;
  v_confirmed boolean;
begin
  select u.id, u.email_confirmed_at is not null
    into v_user_id, v_confirmed
    from public.employees e
    join auth.users u on lower(u.email) = lower(e.email)
   where e.id = p_employee and e.org_id = p_org and e.user_id is null
   order by u.created_at
   limit 1;
  if v_user_id is null then
    return;
  end if;

  -- A person holds at most one employee row per organization.
  if exists (select 1 from public.employees where org_id = p_org and employees.user_id = v_user_id) then
    return;
  end if;

  update public.employees set user_id = v_user_id where id = p_employee and org_id = p_org;
  return query select v_user_id, v_confirmed;
end;
$$;

revoke all on function public.link_employee_account(uuid, bigint) from public, anon, authenticated;
grant execute on function public.link_employee_account(uuid, bigint) to service_role;

notify pgrst, 'reload schema';
