create table if not exists shift_swaps (
  id            bigint generated always as identity primary key,
  requester_id  bigint not null references employees(id) on delete cascade,
  target_id     bigint not null references employees(id) on delete cascade,
  schedule_a_id bigint not null references schedules(id) on delete cascade,
  schedule_b_id bigint not null references schedules(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at    timestamptz default now()
);
alter table shift_swaps enable row level security;
create policy "select_involved_or_manager" on shift_swaps for select using (
  auth.uid() = (select user_id from employees where id = requester_id)
  or auth.uid() = (select user_id from employees where id = target_id)
  or exists (select 1 from managers where user_id = auth.uid())
);
create policy "insert_own" on shift_swaps for insert with check (
  auth.uid() = (select user_id from employees where id = requester_id)
);
create policy "update_manager" on shift_swaps for update using (
  exists (select 1 from managers where user_id = auth.uid())
);
