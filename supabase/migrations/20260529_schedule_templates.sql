create table if not exists schedule_templates (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz default now()
);
create table if not exists schedule_template_rows (
  id bigint generated always as identity primary key,
  template_id bigint not null references schedule_templates(id) on delete cascade,
  employee_id bigint not null references employees(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_minutes int not null,
  end_minutes int not null
);
alter table schedule_templates enable row level security;
alter table schedule_template_rows enable row level security;
create policy "managers_templates" on schedule_templates for all using (
  exists (select 1 from managers where user_id = auth.uid())
) with check (exists (select 1 from managers where user_id = auth.uid()));
create policy "managers_template_rows" on schedule_template_rows for all using (
  exists (select 1 from managers where user_id = auth.uid())
) with check (exists (select 1 from managers where user_id = auth.uid()));
