-- Two-way chat messages between managers and employees
create table messages (
  id            bigint generated always as identity primary key,
  conversation_id text not null,
  from_user_id  uuid not null references auth.users(id) on delete cascade,
  to_user_id    uuid not null references auth.users(id) on delete cascade,
  body          text not null check (char_length(body) > 0 and char_length(body) <= 2000),
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Fast lookup by conversation, newest last for chat rendering
create index messages_conversation_idx on messages (conversation_id, created_at);

alter table messages enable row level security;

-- Users can only read messages they sent or received
create policy "messages_select" on messages
  for select using (from_user_id = auth.uid() or to_user_id = auth.uid());

-- Users can only insert messages from themselves
create policy "messages_insert" on messages
  for insert with check (from_user_id = auth.uid());

-- Only the recipient can mark a message as read
create policy "messages_update_read" on messages
  for update
  using (to_user_id = auth.uid())
  with check (to_user_id = auth.uid());

-- Enable realtime so MessageThread updates live
alter publication supabase_realtime add table messages;
