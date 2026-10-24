-- 0071 says a change draft (replaces_schedule_id) is for the same person and
-- day as the live shift it replaces, and the app only writes it that way. But
-- a manager can insert draft_schedules rows directly through the API, and
-- publish_drafts copied only the times and note onto the live shift. Draft
-- mode would show the change under one person while publishing moved another
-- person's shift. publish_drafts now refuses such a draft; the error rolls
-- back the claim, so every draft stays. Safe to repeat.

begin;

CREATE OR REPLACE FUNCTION public.publish_drafts(p_org uuid, p_draft_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claimed jsonb;
begin
  if not public.is_org_manager(p_org) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  with claimed as (
    delete from public.draft_schedules
     where org_id = p_org and id = any(coalesce(p_draft_ids, '{}'::bigint[]))
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by id), '[]'::jsonb) into v_claimed from claimed;

  if exists (
    select 1 from jsonb_to_recordset(v_claimed) as c(replaces_schedule_id bigint, employee_id bigint, date date)
      join public.schedules s on s.org_id = p_org and s.id = c.replaces_schedule_id
     where s.employee_id <> c.employee_id or s.date <> c.date
  ) then
    raise exception 'A draft change must keep its shift''s person and day' using errcode = '23514';
  end if;

  -- Removals first, so a new shift can take a day one frees.
  delete from public.schedules s
    using jsonb_to_recordset(v_claimed) as c(replaces_schedule_id bigint, removes boolean)
   where s.org_id = p_org and s.id = c.replaces_schedule_id and c.removes;

  update public.schedules s
     set start_minutes = c.start_minutes, end_minutes = c.end_minutes, note = c.note
    from jsonb_to_recordset(v_claimed)
      as c(replaces_schedule_id bigint, removes boolean, start_minutes int, end_minutes int, note text)
   where s.org_id = p_org and s.id = c.replaces_schedule_id and not c.removes;

  insert into public.schedules (org_id, employee_id, date, start_minutes, end_minutes, note)
  select p_org, c.employee_id, c.date, c.start_minutes, c.end_minutes, c.note
    from jsonb_to_recordset(v_claimed)
      as c(employee_id bigint, date date, start_minutes int, end_minutes int, note text, replaces_schedule_id bigint)
   where c.replaces_schedule_id is null;

  return jsonb_build_object('status', 'ok', 'claimed', v_claimed);
end;
$function$;

revoke all on function public.publish_drafts(uuid, bigint[]) from public, anon;
grant execute on function public.publish_drafts(uuid, bigint[]) to authenticated;

commit;
