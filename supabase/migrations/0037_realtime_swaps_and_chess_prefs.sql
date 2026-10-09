-- Two gaps found by comparing production with the app.
--
--   1. shift_swaps was never added to the supabase_realtime publication, so
--      the swap subscriptions in the requests inbox and on the schedule page
--      never fired; swaps only appeared after a reload.
--   2. notify_get_push_prefs predates chess notifications and doesn't return
--      chess_alerts, so lib/notify.ts never saw the setting and chess pushes
--      went out even when it was turned off. Its result columns change, so it
--      is dropped and recreated (create or replace can't change them).
--
-- Safe to repeat. 0038 (applied after this) limits the notify_* functions,
-- this one included, to the service role.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_swaps'
     ) then
    execute 'alter publication supabase_realtime add table public.shift_swaps';
  end if;
end $$;

drop function if exists public.notify_get_push_prefs(uuid);
create function public.notify_get_push_prefs(p_user_id uuid)
returns table (
  late_punch_alerts     boolean,
  message_alerts        boolean,
  pto_alerts            boolean,
  new_shift_alerts      boolean,
  shift_change_alerts   boolean,
  swap_alerts           boolean,
  shift_reminder_alerts boolean,
  chess_alerts          boolean
)
language sql stable security definer set search_path = public
as $$
  -- The user's row, or all-on defaults when they never saved preferences.
  select
    coalesce(late_punch_alerts, true),
    coalesce(message_alerts, true),
    coalesce(pto_alerts, true),
    coalesce(new_shift_alerts, true),
    coalesce(shift_change_alerts, true),
    coalesce(swap_alerts, true),
    coalesce(shift_reminder_alerts, true),
    coalesce(chess_alerts, true)
  from public.user_notification_preferences
  where user_id = p_user_id
  union all
  select true, true, true, true, true, true, true, true
  limit 1;
$$;

notify pgrst, 'reload schema';
