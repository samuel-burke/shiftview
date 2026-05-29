-- Push subscription storage (one per browser per user)
create table if not exists push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth_key    text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

create policy "own_push_subscriptions" on push_subscriptions
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Activity feed / notification inbox
create table if not exists notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,  -- null = all managers
  type        text not null,
  title       text not null,
  body        text not null,
  read        boolean not null default false,
  data        jsonb,
  created_at  timestamptz not null default now()
);

alter table notifications enable row level security;

-- Users see their own notifications
create policy "own_notifications_select" on notifications
  for select using (user_id = auth.uid());

-- Users can mark their own notifications read
create policy "own_notifications_update" on notifications
  for update using (user_id = auth.uid());

-- Managers can see all-manager notifications (user_id = null)
create policy "manager_broadcast_select" on notifications
  for select using (
    user_id is null and
    exists (select 1 from managers where user_id = auth.uid())
  );

-- Managers can mark all-manager notifications read
create policy "manager_broadcast_update" on notifications
  for update using (
    user_id is null and
    exists (select 1 from managers where user_id = auth.uid())
  );

-- Service role inserts all notifications (no RLS restriction needed with service key)
