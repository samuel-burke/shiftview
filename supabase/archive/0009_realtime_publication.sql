-- In-app notification banners, the notification bell, message threads, and
-- several live-updating pages rely on Supabase Realtime (postgres_changes).
-- Those streams only fire for tables that are part of the supabase_realtime
-- publication — previously this was configured by hand in the dashboard.
-- Make it explicit and idempotent here so fresh environments work out of the
-- box. The banner path in particular now depends on the notifications table
-- being published (it is the universal in-app delivery mechanism).

begin;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return; -- non-Supabase environment; nothing to do
  end if;

  foreach t in array array[
    'notifications', 'messages', 'employees', 'managers', 'schedules',
    'store_hours', 'app_settings', 'time_off_requests', 'audit_logs'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
