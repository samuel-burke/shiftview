-- Cross-device clock sync: the time clock and the ambient clock-status ring
-- subscribe to Supabase Realtime (postgres_changes) on the punch_records table
-- so a punch made on one device updates the user's other open devices instantly.
-- Realtime only fires for tables in the supabase_realtime publication, and
-- punch_records was missing from it (see 0009) — so those streams never fired
-- and the second device only caught up on the next tab-focus refetch. Add it
-- here, idempotently, so fresh environments work out of the box.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'punch_records'
    ) then
      execute 'alter publication supabase_realtime add table public.punch_records';
    end if;
  end if;
end $$;
