create table if not exists availability (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  note        text,
  unique (employee_id, day_of_week)
);
alter table availability enable row level security;
create policy "managers_all" on availability for all using (
  exists (select 1 from managers where user_id = auth.uid())
) with check (
  exists (select 1 from managers where user_id = auth.uid())
);
