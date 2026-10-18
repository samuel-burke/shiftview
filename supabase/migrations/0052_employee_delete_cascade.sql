-- Deleting an employee works whatever history they have.
--
-- 0041 replaced some single-column foreign keys to employees with same-org
-- (employee_id, org_id) keys, and three of those have no ON DELETE action:
--   * callouts.employee_id
--   * open_shift_claims.employee_id
--   * open_shifts.filled_by
-- So DELETE /api/employees failed with 23503 (a 500 in the app) for anyone
-- who had ever called out, claimed an open shift, or picked one up. Worse,
-- the route deletes the person's schedules first, in a separate request, so
-- the failed delete left the employee on the roster with every shift gone.
--
-- Now their call-outs and claims go with them, a shift they picked up stays
-- filled with filled_by cleared (the schedule row it created is removed with
-- their other shifts), and schedules cascade too, so deleting the employee
-- row is one atomic statement. The app still deletes schedules first when
-- this migration has not run yet.
--
-- Can run before or after the app deploy. Safe to repeat.

begin;

alter table public.callouts drop constraint if exists callouts_employee_org_fkey;
alter table public.callouts add constraint callouts_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade;

alter table public.open_shift_claims drop constraint if exists open_shift_claims_employee_org_fkey;
alter table public.open_shift_claims add constraint open_shift_claims_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade;

-- org_id is not null and must stay set: clear only filled_by.
alter table public.open_shifts drop constraint if exists open_shifts_filled_by_org_fkey;
alter table public.open_shifts add constraint open_shifts_filled_by_org_fkey
  foreign key (filled_by, org_id) references public.employees (id, org_id) on delete set null (filled_by);

-- Both keys on schedules.employee_id must cascade: the same-org one checks
-- for remaining rows before the single-column one removes them.
alter table public.schedules drop constraint if exists fk_employee;
alter table public.schedules add constraint fk_employee
  foreign key (employee_id) references public.employees (id) on delete cascade;
alter table public.schedules drop constraint if exists schedules_employee_org_fkey;
alter table public.schedules add constraint schedules_employee_org_fkey
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete cascade;

commit;
