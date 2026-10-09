-- notify_* functions: service role only.
--
-- They are SECURITY DEFINER and take any org or user id, so any session (an
-- anonymous demo visitor included) could write notifications into any
-- organization, read anyone's push subscriptions and delete them.
-- notify_get_push_subs and notify_delete_subs predate this repo's migrations,
-- so every overload is found by name rather than by signature.
--
-- DEPLOY THE APP FIRST: lib/notify.ts must call these through the admin
-- client (this branch) before they are revoked, or in-app notifications and
-- pushes stop. Safe to repeat.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'notify_insert', 'notify_get_manager_ids', 'notify_upsert_chess',
         'notify_get_active_endpoints', 'notify_get_push_subs',
         'notify_get_push_prefs', 'notify_delete_subs'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
