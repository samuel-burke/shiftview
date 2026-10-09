-- Pay rates: managers only, in the database as well as the API.
--
-- employees is readable by every member of the organization (the roster), and
-- RLS works on rows, not columns. So although /api/employees drops pay_rate
-- for non-managers, any employee could read every coworker's pay rate by
-- querying the table directly with their own session, and Realtime sent it to
-- them with every employees change.
--
-- API roles now get every employees column except pay_rate. Managers read pay
-- rates through employee_pay_rates(org) (0041), which checks the caller is a
-- manager of that org; they still set them with an ordinary update (RLS:
-- managers only). Realtime leaves out columns the subscriber can't select.
--
-- A column added to employees later is not readable through the API until it
-- is added to the grant below.
--
-- DEPLOY THE APP FIRST: /api/employees, /api/reports/labor-cost and the
-- auto-scheduler must read pay rates through employee_pay_rates (this branch)
-- before this runs, or those reads fail. Needs 0041. Safe to repeat.

revoke select on public.employees from anon, authenticated;
grant select (
  id, org_id, name, email, user_id, hire_date,
  employment_type, min_weekly_hours, max_weekly_hours, max_days_per_week
) on public.employees to anon, authenticated;

notify pgrst, 'reload schema';
