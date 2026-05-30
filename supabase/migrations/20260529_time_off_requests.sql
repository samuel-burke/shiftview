create table if not exists time_off_requests (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  date        date not null,
  status      text not null default 'pending' check (status in ('pending','approved','denied')),
  note        text,
  created_at  timestamptz default now(),
  unique (employee_id, date)
);
alter table time_off_requests enable row level security;
-- Employees see their own; managers see all
create policy "select_own_or_manager" on time_off_requests for select using (
  auth.uid() = (select user_id from employees where id = employee_id)
  or exists (select 1 from managers where user_id = auth.uid())
);
create policy "insert_own" on time_off_requests for insert with check (
  auth.uid() = (select user_id from employees where id = employee_id)
);
create policy "update_manager" on time_off_requests for update using (
  exists (select 1 from managers where user_id = auth.uid())
);
