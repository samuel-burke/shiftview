-- Per-device foreground presence (supersedes the user-level presence in 0011).
--
-- 0011 keyed presence by user, which meant having the app open on ONE device
-- (even a stray desktop tab) marked the user active everywhere and suppressed
-- the OS push to ALL their devices — so a user could stop receiving pushes
-- entirely. Track presence per device instead, keyed by the device's push
-- subscription endpoint, so an open app only suppresses the duplicate push to
-- that same device. Other devices still receive it.

begin;

-- Replace the user-level presence from 0011.
drop function if exists public.notify_is_user_active(uuid);
drop function if exists public.presence_set(boolean);
drop table if exists public.user_presence;

create table if not exists public.device_presence (
  endpoint     text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  active_until timestamptz not null default now()
);
create index if not exists device_presence_user_idx on public.device_presence (user_id);

alter table public.device_presence enable row level security;

-- Presence is personal: a user only ever sees/writes their own devices. Writes
-- normally go through presence_set (security definer); this is the backstop.
drop policy if exists dp_select on public.device_presence;
create policy dp_select on public.device_presence
  for select using (user_id = auth.uid());

drop policy if exists dp_write on public.device_presence;
create policy dp_write on public.device_presence
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Record (or expire) one device's foreground presence, identified by its push
-- subscription endpoint. p_active = true marks it active for the next minute;
-- false expires it immediately (sent on hide/close).
create or replace function public.presence_set(p_endpoint text, p_active boolean)
returns void
language sql security definer set search_path = public
as $$
  insert into public.device_presence (endpoint, user_id, active_until)
  values (
    p_endpoint,
    auth.uid(),
    case when p_active then now() + interval '60 seconds' else now() end
  )
  on conflict (endpoint) do update
    set active_until = excluded.active_until,
        user_id      = excluded.user_id;
$$;

-- Endpoints for the given user whose device currently has the app in the
-- foreground. Called from the notify path (lib/notify.ts) as a different user,
-- so it must be security definer to read past device_presence's own-row RLS.
create or replace function public.notify_get_active_endpoints(p_user_id uuid)
returns table (endpoint text)
language sql stable security definer set search_path = public
as $$
  select endpoint from public.device_presence
  where user_id = p_user_id and active_until > now();
$$;

commit;
