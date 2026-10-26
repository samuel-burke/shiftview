-- Shift-swap target consent.
--
-- Previously a swap went straight from 'pending' (created by the requester) to
-- a manager 'approved'/'denied' decision — the *target* employee was never
-- asked. A manager could therefore move someone's shift onto a coworker who had
-- never agreed to the trade. Add an explicit acceptance step so both employees
-- are part of the process:
--
--   pending  → requester created it; awaiting the TARGET employee's response
--   accepted → target agreed; awaiting a MANAGER's approval
--   declined → target refused (terminal)
--   approved → manager approved an accepted swap; schedules exchanged (terminal)
--   denied   → manager rejected an accepted swap (terminal)
--
-- A manager may only approve/deny a swap once it is 'accepted'. The status
-- column already defaults to 'pending'; this just widens its CHECK to the full
-- set of states (older rows are pending/approved/denied, all still valid).

begin;

alter table public.shift_swaps drop constraint if exists shift_swaps_status_check;
alter table public.shift_swaps
  add constraint shift_swaps_status_check
  check (status in ('pending', 'accepted', 'declined', 'approved', 'denied'));

commit;
