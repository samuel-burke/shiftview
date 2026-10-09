-- Drop the single-tenant RLS policies that survived the multi-tenancy move.
--
-- 0003 replaced the original policies with org-scoped mt_* ones but only
-- dropped its own names; it warned that the old ones had to be removed by
-- hand. In production they never were. Postgres ORs permissive policies, so
-- each old one below still applied on its own, with no organization check:
--
--   * "any signed-in user" policies let every session read every
--     organization's employees and schedules, and update any schedule;
--   * "is a manager anywhere" policies let a manager of ANY organization read
--     and write every organization's employees, schedules, punches, time off,
--     swaps, availability, templates, settings, store hours, manager alerts
--     and audit logs.
--
-- Every demo visitor is an anonymous manager of the demo organization, so
-- anyone who opened the demo had that access.
--
-- Everything the app needs is covered by the mt_* policies (0003 onward) and
-- the per-user policies kept below (push_subscriptions_own,
-- users_own_notification_prefs, dp_select, dp_write). Independent of the app
-- code: safe to apply before or after 0035, and safe to repeat.

-- "Any signed-in user" (no organization check).
drop policy if exists "auth read employees"              on public.employees;
drop policy if exists authenticated_can_read_employees   on public.employees;
drop policy if exists "auth read schedules"              on public.schedules;
drop policy if exists "Auth Update"                      on public.schedules;
drop policy if exists "public read"                      on public.store_hours;

-- "Is a manager of any organization".
drop policy if exists managers_can_update_employees      on public.employees;
drop policy if exists managers_delete_employees          on public.employees;
drop policy if exists "managers can update schedules"    on public.schedules;
drop policy if exists managers_can_delete_schedules      on public.schedules;
drop policy if exists managers_can_insert_schedules      on public.schedules;
drop policy if exists managers_can_update_schedules      on public.schedules;
drop policy if exists managers_delete_schedules          on public.schedules;
drop policy if exists managers_write_app_settings        on public.app_settings;
drop policy if exists "managers write"                   on public.store_hours;
drop policy if exists audit_logs_managers_select         on public.audit_logs;
drop policy if exists availability_managers_all          on public.availability;
drop policy if exists punch_records_managers_all         on public.punch_records;
drop policy if exists templates_managers_all             on public.schedule_templates;
drop policy if exists template_rows_managers_all         on public.schedule_template_rows;
drop policy if exists shift_swaps_select_involved_or_manager on public.shift_swaps;
drop policy if exists shift_swaps_update_manager         on public.shift_swaps;
drop policy if exists time_off_select_own_or_manager     on public.time_off_requests;
drop policy if exists time_off_update_manager            on public.time_off_requests;
drop policy if exists notifications_manager_broadcast_select on public.notifications;
drop policy if exists notifications_manager_broadcast_update on public.notifications;

-- "Your own rows", without an organization check. Superseded by mt_*; they
-- would also undo 0035's narrower rules (for example, employees editing their
-- own punches or reading every message they ever exchanged after leaving an
-- organization).
drop policy if exists availability_employees_select      on public.availability;
drop policy if exists availability_employees_insert      on public.availability;
drop policy if exists availability_employees_update      on public.availability;
drop policy if exists availability_employees_delete      on public.availability;
drop policy if exists punch_records_employees_select     on public.punch_records;
drop policy if exists punch_records_employees_insert     on public.punch_records;
drop policy if exists punch_records_employees_update     on public.punch_records;
drop policy if exists shift_swaps_insert_own             on public.shift_swaps;
drop policy if exists time_off_insert_own                on public.time_off_requests;
drop policy if exists messages_select                    on public.messages;
drop policy if exists messages_insert                    on public.messages;
drop policy if exists messages_update_read               on public.messages;
drop policy if exists notifications_own_select           on public.notifications;
drop policy if exists notifications_own_update           on public.notifications;
drop policy if exists "users can read own manager row"   on public.managers;

-- Left over from the fixture-based demo: its tables (schedules_demo,
-- employees_demo) no longer exist.
drop function if exists public.generate_demo_schedules();
