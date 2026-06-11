-- Multi-tenancy migration, phase 2 of 4: ENFORCE.
--
-- Makes org_id mandatory and adds integrity constraints that make cross-org
-- references impossible at the database level. Run after 0001 has been applied
-- and all rows are backfilled.
--
-- NOTE: the DROP CONSTRAINT names below assume Postgres default naming
-- (<table>_pkey). If your project used custom names, adjust before running.

begin;

-- 1. org_id becomes NOT NULL everywhere (the default stays in place until
--    phase 4 so pre-refactor application code keeps working).
do $$
declare
  t text;
begin
  foreach t in array array[
    'employees', 'managers', 'schedules', 'availability',
    'time_off_requests', 'punch_records', 'store_hours', 'app_settings',
    'messages', 'notifications', 'shift_swaps',
    'schedule_templates', 'schedule_template_rows', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
end $$;

-- 2. Tables that were keyed globally are now keyed per-org.
--    Because (org_id, key) / (org_id, day_of_week) become the primary keys,
--    existing PostgREST upserts keep resolving conflicts correctly as long as
--    rows include org_id.
alter table public.app_settings drop constraint app_settings_pkey;
alter table public.app_settings add primary key (org_id, key);

alter table public.store_hours drop constraint store_hours_pkey;
alter table public.store_hours add primary key (org_id, day_of_week);

-- 3. Composite foreign keys: a child row's org_id must match its parent's.
--    This makes "schedule in org A pointing at employee in org B" a constraint
--    violation rather than a latent data leak. (MATCH SIMPLE semantics mean
--    rows with a NULL schedule_id are unaffected.)
alter table public.employees
  add constraint employees_id_org_unique unique (id, org_id);
alter table public.schedules
  add constraint schedules_id_org_unique unique (id, org_id);
alter table public.schedule_templates
  add constraint schedule_templates_id_org_unique unique (id, org_id);

alter table public.schedules
  add constraint schedules_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id);
alter table public.availability
  add constraint availability_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id);
alter table public.time_off_requests
  add constraint time_off_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id);
alter table public.punch_records
  add constraint punch_records_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id);
alter table public.punch_records
  add constraint punch_records_schedule_org_fkey
  foreign key (schedule_id, org_id) references public.schedules (id, org_id);
alter table public.shift_swaps
  add constraint shift_swaps_requester_org_fkey
  foreign key (requester_id, org_id) references public.employees (id, org_id);
alter table public.shift_swaps
  add constraint shift_swaps_target_org_fkey
  foreign key (target_id, org_id) references public.employees (id, org_id);
alter table public.shift_swaps
  add constraint shift_swaps_schedule_a_org_fkey
  foreign key (schedule_a_id, org_id) references public.schedules (id, org_id);
alter table public.shift_swaps
  add constraint shift_swaps_schedule_b_org_fkey
  foreign key (schedule_b_id, org_id) references public.schedules (id, org_id);
alter table public.schedule_template_rows
  add constraint template_rows_template_org_fkey
  foreign key (template_id, org_id) references public.schedule_templates (id, org_id);
alter table public.schedule_template_rows
  add constraint template_rows_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id);

-- 4. A user can hold a given role at most once per org (but may belong to
--    several orgs). managers was keyed on user_id alone, which would forbid
--    managing more than one org — re-key it per-org.
alter table public.managers drop constraint managers_pkey;
alter table public.managers add primary key (org_id, user_id);
create unique index if not exists employees_org_user_unique
  on public.employees (org_id, user_id) where user_id is not null;

commit;
