-- Behavioural tests for supabase/migrations/0037_realtime_swaps_and_chess_prefs.sql.
--
-- Self-contained: builds the pre-0037 function and publication, applies the
-- migration (twice, to check it repeats cleanly), then checks the results.
-- Run against a throwaway Postgres database:
--
--   createdb prefs_test
--   cd supabase/manual-tests && psql -q -d prefs_test -f 0037_realtime_swaps_and_chess_prefs.test.sql
--   dropdb prefs_test
--
-- Any line containing FAIL is a regression.

create table public.shift_swaps (id bigserial primary key);
create table public.user_notification_preferences (
  user_id uuid primary key,
  late_punch_alerts boolean default true, message_alerts boolean default true,
  pto_alerts boolean default true, new_shift_alerts boolean default true,
  shift_change_alerts boolean default true, swap_alerts boolean default true,
  shift_reminder_alerts boolean default true, chess_alerts boolean default true
);
create publication supabase_realtime;

-- The function as production had it: no chess_alerts.
create function public.notify_get_push_prefs(p_user_id uuid)
returns table (late_punch_alerts boolean, message_alerts boolean, pto_alerts boolean, new_shift_alerts boolean,
  shift_change_alerts boolean, swap_alerts boolean, shift_reminder_alerts boolean)
language sql security definer set search_path = public as $$
  select coalesce(late_punch_alerts, true), coalesce(message_alerts, true), coalesce(pto_alerts, true),
    coalesce(new_shift_alerts, true), coalesce(shift_change_alerts, true), coalesce(swap_alerts, true),
    coalesce(shift_reminder_alerts, true)
  from user_notification_preferences where user_id = p_user_id
  union all select true, true, true, true, true, true, true limit 1;
$$;

\ir ../migrations/0037_realtime_swaps_and_chess_prefs.sql
\ir ../migrations/0037_realtime_swaps_and_chess_prefs.sql

insert into user_notification_preferences (user_id, chess_alerts, swap_alerts)
values ('11111111-1111-1111-1111-111111111111', false, false);

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

select pg_temp.check('shift_swaps streams over Realtime',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shift_swaps'));
select pg_temp.check('a saved chess setting comes back',
  (select chess_alerts = false from notify_get_push_prefs('11111111-1111-1111-1111-111111111111')));
select pg_temp.check('the other settings still come back',
  (select swap_alerts = false and message_alerts from notify_get_push_prefs('11111111-1111-1111-1111-111111111111')));
select pg_temp.check('someone who never saved preferences gets everything on',
  (select chess_alerts and late_punch_alerts from notify_get_push_prefs('22222222-2222-2222-2222-222222222222')));
