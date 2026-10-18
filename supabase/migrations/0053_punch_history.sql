-- Punch history: every edit to a punch leaves a record in the database.
--
-- Until now the only trail of a punch edit was an audit_logs row the API
-- wrote after the fact, fire-and-forget: an edit could succeed with no record,
-- and anything done outside /api/punches (a manager's direct PostgREST update
-- or delete, the punch-corrections route taking back a punch it had just
-- added) left nothing at all. enforce_punch_integrity only marks an edited
-- punch is_manual; the time it replaced was gone.
--
-- 1. punch_record_history: one row per change, with the row before and after
--    (jsonb), who made it (auth.uid(); null for the service role), when, and
--    why. Written only by the punch_records_history trigger. Managers read
--    their organization's rows; an employee reads the rows for their own
--    punches. No role can insert, update or delete them.
-- 2. The trigger records every manual insert, every update and every delete.
--    Live punches (is_manual false) are not recorded on insert: they are
--    stamped by the server's clock, the row itself is the record, and there is
--    one per clock action. The reason comes from the transaction-local setting
--    app.punch_reason when set (delete_punch sets it), otherwise from the
--    row's note: /api/punches stores a manager's reason in note when adding
--    or editing a punch.
-- 3. Deletes go through delete_punch(p_id, p_reason), which requires a reason
--    and the caller to manage the punch's organization. Direct DELETE on
--    punch_records is revoked from anon and authenticated, so a manager can
--    no longer remove a punch over PostgREST without saying why. Cascades
--    (deleting an employee) and the server's security-definer functions are
--    unaffected, and are still recorded.
-- 4. Changing a punch's type (or moving it to another employee) now marks it
--    is_manual too, as moving its time already did, so a punch whose history
--    has edits always shows as edited.
--
-- The demo organization is wiped and reseeded nightly by the service role;
-- those changes aren't recorded, or the table would grow by a day's punches
-- every night for nothing.
--
-- Safe to repeat.

begin;

create table if not exists public.punch_record_history (
  id          bigint generated always as identity primary key,
  -- Deleting an organization deletes its history; an employee's or a punch's
  -- deletion doesn't, which is the point.
  org_id      uuid not null references public.organizations (id) on delete cascade,
  punch_id    bigint not null,
  employee_id bigint not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  old_row     jsonb,
  new_row     jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  reason      text
);

create index if not exists punch_record_history_punch_idx
  on public.punch_record_history (org_id, punch_id, changed_at);
create index if not exists punch_record_history_employee_idx
  on public.punch_record_history (org_id, employee_id, changed_at);

alter table public.punch_record_history enable row level security;

-- Read-only for everyone, the service role included: only the trigger writes.
revoke all on table public.punch_record_history from public, anon, authenticated, service_role;
grant select on table public.punch_record_history to authenticated, service_role;

drop policy if exists mt_select on public.punch_record_history;
create policy mt_select on public.punch_record_history for select to authenticated
  using (
    org_id in (select public.my_managed_org_ids())
    or (org_id, employee_id) in (select org_id, employee_id from public.my_employees())
  );


create or replace function public.record_punch_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_reason text := nullif(btrim(current_setting('app.punch_reason', true)), '');
begin
  if tg_op = 'INSERT' and not new.is_manual then
    return null;
  end if;
  if tg_op = 'UPDATE' and new is not distinct from old then
    return null;
  end if;
  if v_uid is null and exists (select 1 from public.organizations where id = v_org and is_demo) then
    return null;
  end if;

  if tg_op <> 'DELETE' then
    v_reason := coalesce(v_reason, nullif(btrim(new.note), ''));
  end if;

  insert into public.punch_record_history
    (org_id, punch_id, employee_id, action, old_row, new_row, changed_by, reason)
  values (
    v_org,
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op = 'DELETE' then old.employee_id else new.employee_id end,
    lower(tg_op),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    v_uid,
    v_reason
  );
  return null;
end;
$$;

drop trigger if exists punch_records_history on public.punch_records;
create trigger punch_records_history
  after insert or update or delete on public.punch_records
  for each row execute function public.record_punch_history();


-- A punch whose type or owner changes is no longer the punch the clock
-- recorded, as one whose time moves isn't (enforce_punch_integrity).
create or replace function public.mark_punch_edited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.punch_type is distinct from old.punch_type
     or new.employee_id is distinct from old.employee_id then
    new.is_manual := true;
  end if;
  return new;
end;
$$;

drop trigger if exists punch_records_mark_edited on public.punch_records;
create trigger punch_records_mark_edited
  before update of punch_type, employee_id on public.punch_records
  for each row execute function public.mark_punch_edited();

revoke all on function public.record_punch_history(), public.mark_punch_edited()
  from public, anon, authenticated;


-- The only way for a signed-in user to delete a punch: says why, and the
-- trigger records it. Not-found and not-yours are the same error, so the
-- function can't be used to probe other organizations' punch ids.
create or replace function public.delete_punch(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required to delete a punch' using errcode = '22023';
  end if;
  select org_id into v_org from public.punch_records where id = p_id;
  if v_org is null or (auth.uid() is not null and not public.is_org_manager(v_org)) then
    raise exception 'Punch not found' using errcode = 'P0002';
  end if;

  perform set_config('app.punch_reason', btrim(p_reason), true);
  delete from public.punch_records where id = p_id;
  -- Don't let the reason leak onto later changes in the same transaction.
  perform set_config('app.punch_reason', '', true);
end;
$$;

revoke all on function public.delete_punch(bigint, text) from public, anon;
grant execute on function public.delete_punch(bigint, text) to authenticated, service_role;

drop policy if exists mt_delete on public.punch_records;
revoke delete on table public.punch_records from anon, authenticated;

commit;
