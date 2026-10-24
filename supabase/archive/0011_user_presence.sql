-- Foreground presence, used to suppress duplicate OS push notifications.
--
-- When a user has the app open, the in-app banner (Supabase Realtime on the
-- notifications table) already shows them every notification, so the OS push
-- is just a duplicate. We can't reliably detect an open window inside the
-- service worker on iOS installed PWAs (clients.matchAll() often comes back
-- empty in the push handler, and every push is expected to show a
-- notification), so the suppression has to happen server-side, before the
-- push is ever sent.
--
-- The app heartbeats while it's in the foreground (see
-- components/PresenceHeartbeat.tsx + app/api/presence/route.ts), bumping
-- active_until a minute into the future; on hide/unload it expires it
-- immediately so background pushes resume right away.

begin;

create table if not exists public.user_presence (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  active_until timestamptz not null default now()
);

alter table public.user_presence enable row level security;

-- Presence is personal, not tenant data: a user only ever sees/writes their
-- own row. Writes normally go through presence_set (security definer); this
-- policy is the backstop.
drop policy if exists up_select on public.user_presence;
create policy up_select on public.user_presence
  for select using (user_id = auth.uid());

drop policy if exists up_write on public.user_presence;
create policy up_write on public.user_presence
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Record (or expire) the caller's foreground presence. p_active = true marks
-- the user active for the next minute; false expires it immediately.
create or replace function public.presence_set(p_active boolean)
returns void
language sql security definer set search_path = public
as $$
  insert into public.user_presence (user_id, active_until)
  values (
    auth.uid(),
    case when p_active then now() + interval '60 seconds' else now() end
  )
  on conflict (user_id) do update
    set active_until = excluded.active_until;
$$;

-- True when the given user currently has the app in the foreground. Called
-- from the notify path (lib/notify.ts) as a different user, so it must be
-- security definer to read past user_presence's own-row RLS.
create or replace function public.notify_is_user_active(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_presence
    where user_id = p_user_id and active_until > now()
  );
$$;

commit;
