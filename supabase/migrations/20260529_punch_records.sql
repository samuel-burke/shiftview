create table if not exists punch_records (
  id          bigint generated always as identity primary key,
  employee_id bigint not null references employees(id) on delete cascade,
  schedule_id bigint references schedules(id) on delete set null,
  punch_type  text not null check (punch_type in ('clock_in','clock_out','break_start','break_end')),
  punched_at  timestamptz not null default now(),
  lat         double precision,
  lng         double precision,
  is_manual   boolean not null default false,
  note        text,
  created_at  timestamptz not null default now()
);

alter table punch_records enable row level security;

-- Managers can do everything
create policy "managers_all_punch_records" on punch_records
  for all using (
    exists (select 1 from managers where user_id = auth.uid())
  ) with check (
    exists (select 1 from managers where user_id = auth.uid())
  );

-- Employees can insert their own punches
create policy "employees_insert_own_punch" on punch_records
  for insert with check (
    employee_id = (
      select id from employees where user_id = auth.uid() limit 1
    )
  );

-- Employees can read their own punches
create policy "employees_select_own_punch" on punch_records
  for select using (
    employee_id = (
      select id from employees where user_id = auth.uid() limit 1
    )
  );

-- Employees can update their own punches (manual corrections with note)
create policy "employees_update_own_punch" on punch_records
  for update using (
    employee_id = (
      select id from employees where user_id = auth.uid() limit 1
    )
  );
