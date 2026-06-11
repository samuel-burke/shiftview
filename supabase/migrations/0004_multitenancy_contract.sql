-- Multi-tenancy migration, phase 4 of 4: CONTRACT.
--
-- Run ONLY after the org-aware application code is fully deployed and verified
-- (no writers remain that omit org_id). Dropping the column defaults turns any
-- straggler single-tenant write into a hard NOT NULL error instead of silently
-- filing data under the default organization.

begin;

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
    execute format('alter table public.%I alter column org_id drop default', t);
  end loop;
end $$;

commit;
