-- Organization isolation: references that crossed tenants.
--
-- An audit of every privileged query and policy against two organizations
-- found two places where a row in one organization could point at another:
--
-- 1. Recipients. messages.to_user_id and notifications.user_id were never
--    checked against the row's organization. Any member could insert a
--    message in their own org addressed to a user of a different org, and
--    POST /api/messages then pushed its text to that user's devices through
--    the service-role notify path. Both columns must now name a member
--    (employee or manager) of the row's org; notifications may still be an
--    org-wide broadcast (user_id null). The check is a trigger, not a policy,
--    so it also holds for the service role, which bypasses RLS.
--
-- 2. punch_corrections.punch_id only referenced punch_records(id), so a
--    manager could link their org's correction to another org's punch. It
--    now references (id, org_id) like every other cross-table reference.
--
-- Needs 0041. Safe to repeat.

create or replace function public.enforce_recipient_in_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v_user is null then
    return new;
  end if;
  if not exists (select 1 from public.employees where org_id = new.org_id and user_id = v_user)
     and not exists (select 1 from public.managers where org_id = new.org_id and user_id = v_user) then
    raise exception 'The recipient is not a member of this organization' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_recipient_in_org() from public, anon, authenticated;

drop trigger if exists messages_recipient_in_org on public.messages;
create trigger messages_recipient_in_org
  before insert or update of org_id, to_user_id on public.messages
  for each row execute function public.enforce_recipient_in_org('to_user_id');

drop trigger if exists notifications_recipient_in_org on public.notifications;
create trigger notifications_recipient_in_org
  before insert or update of org_id, user_id on public.notifications
  for each row execute function public.enforce_recipient_in_org('user_id');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'punch_records_id_org_unique') then
    alter table public.punch_records
      add constraint punch_records_id_org_unique unique (id, org_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'punch_corrections_punch_org_fkey') then
    alter table public.punch_corrections
      add constraint punch_corrections_punch_org_fkey
      foreign key (punch_id, org_id) references public.punch_records (id, org_id)
      on delete set null (punch_id);
  end if;
end $$;
