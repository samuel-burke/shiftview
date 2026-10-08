# Auto-schedule

Auto-schedule fills a week with **draft** shifts, from the Week page's Draft mode. The drafts meet the coverage targets as closely as the rules allow. They respect:

- availability and time off
- full-time and part-time hour limits
- rest between shifts
- overtime rules

They honor employee preferences where possible, and the page explains any gap that couldn't be covered. Shifts already live stay as they are; the drafts fill around them. The manager reviews and edits the drafts, then publishes the week. Nothing goes to employees until then.

The "AI" is our own optimization engine in `lib/scheduler/`. It is strictly typed, deterministic TypeScript, using the same family of techniques as Timefold/OptaPlanner: a greedy construction heuristic followed by local search.

- It runs inside the app's API routes.
- It calls no chatbot, LLM or third-party service, and schedule data never leaves the app.
- The same input and seed always give the same schedule, and every result can be explained.

## For managers

### Set up once

| Where | What |
|---|---|
| Coverage (`/coverage`) | The target curve for each day: how many people you need, in 15-minute steps. Days with no target are treated as closed, so nobody is scheduled. |
| Settings → Workplace → Scheduling Rules | Shift length (default 4–8 h) and start times (every :00/:30). Rest between shifts (10 h). Most days in a row (6). Full-time and part-time hour ranges and days (FT 32–40 h, PT 0–29 h, 5 days each). The defaults for overtime and for pending time off. |
| Settings → Team → a person → Scheduling | Full-time or part-time, plus personal weekly hours and days when they differ from the defaults. Also their shift preferences. |
| Settings → Preferences → Shift Preferences (each employee) | Opener/Mid/Closer, days they'd like and days they'd rather not, and desired weekly hours. |

Anyone without an employment type is scheduled as part-time. The Auto-schedule sheet points them out and can set the type in one tap.

### Each week

1. On the **Week** page (`/week`), switch to **Draft**, pick the week and tap **Auto-schedule**. Draft opens on next week.
2. **Before you start** checks three things: days without a coverage target, anyone without an employment type, and pending time-off requests.
3. If the week already has drafts, choose **Keep & fill around** or **Start fresh**.
4. Set **Rules for this week**:
   - Overtime: *never*, or *to fill gaps*.
   - Pending time off: *avoid those days*, or *ignore*.
5. Add anything that's **this week only**:
   - extra or fewer people for a time range (a truck delivery, a slow afternoon)
   - keep someone off a day
   - cap or raise someone's hours
6. **Generate Schedule.** The new drafts are tagged **Auto**. A summary card shows:
   - coverage before → after
   - hours against the budget
   - overtime, labor cost, and how many preferences were honored
   - each gap left, with who couldn't cover it and why (for example, "Sun 6–8 PM short 1 · Bob J.: at their weekly hours")
7. Review the week:
   - Draft mode shows the week as it will be after publishing: live shifts (muted, tagged **Live**, view only) plus the drafts. The stats, charts and heatmap count both.
   - The **Coverage by Hour** heatmap shows every day by hour, from short (amber) through met (gray) to over (blue).
   - **Hours This Week** shows each person against their own range and the 40-hour line.
   - The grid shows each person's hours for the week; on phones, each row of the day list shows their week so far, e.g. "32/40 h week".
   - Edit any draft as usual. An edited Auto draft becomes yours: it loses the Auto tag, and another version or an undo leaves it alone.
8. To improve the result:
   - **Try Another Version** makes a different schedule with the same settings. It replaces only that run's drafts, never yours.
   - A one-tap fix such as **Let Bob J. work up to 32 h** regenerates with that person's hours raised for the week.
   - **Undo** removes the run's drafts and brings back the ones it replaced.
9. **Publish.** The page switches to Live on the same week.

The summary stays in Draft mode until the week is published, the run is undone, or you dismiss the card. It survives a page reload.

A draft can't share a day with its person's live shift: the drafts API refuses one, and Auto-schedule plans around live shifts. A draft made before a live shift was added to the same day is flagged **Clash** in Draft mode. Publishing skips it and keeps it in Draft, and the page says whose and which day.

## What the scheduler considers

### Hard rules (never broken)

- **Time off:** no shift on an approved time-off day or a call-out day, or on a day kept off with an adjustment.
- **Availability:** same meaning as for manual edits. No availability on file means available any time. An overnight shift must fit both days.
- **One shift per person per day,** with no overlap with published shifts or kept drafts. That includes overnight shifts that run into the next day.
- **Shift length and start grid** come from the rules. A shift starts on its own day.
- **Weekly limits:** each person's maximum hours and maximum days.
- **Rest** between shifts and **consecutive days.** Both also count the previous week's published shifts.
- **Overtime:** never past 40 hours in the schedule week, which is the same week the hours reports use. The exceptions:
  - The run allows overtime *to fill gaps*. Anyone whose maximum reaches 40 h may then go up to 8 h further, at 1.5× cost.
  - An hours adjustment sets that person's cap for the week.
- **Closed days:** no shifts on days without a coverage target.

### Goals, in priority order

The engine minimizes a penalty score. These are the weights (`WEIGHTS` in `lib/scheduler/state.ts`):

| Goal | Weight |
|---|---|
| Meet the coverage target | 100 per staff-hour short. Deeper gaps cost more: 2 short = 3×, 3 short = 6×. |
| Full-timers reach their minimum | 60 per hour under (part-timers: 25) |
| Avoid a day someone asked off (pending) | 80 per shift |
| Use as little of the overtime allowance as possible | 45 per hour |
| Avoid "rather not" days | 20 per shift |
| Don't overstaff | 15 per staff-hour over |
| Shift type someone didn't ask for | 8 per shift |
| Close to desired weekly hours | 4 per hour away |
| Fewer, longer shifts | 3 per shift |
| Spread closes and weekends fairly | 1.5 × (closes² + weekend shifts²) per person |
| Labor cost | 0.05 per dollar (overtime at 1.5×) |
| Preferred days | −4 per shift (a bonus) |
| Keep last week's pattern | −3 per shift with the same weekday and a start within an hour (a bonus) |

## How it works

`generateSchedule(input)` in `lib/scheduler/index.ts` is a pure function: no database, no network, no clock except a time limit.

1. **Model** (`model.ts`):
   - Splits the week into 15-minute slots, each with a target headcount: the curve plus adjustments, minus what published shifts and kept drafts already cover.
   - Works out, for every person and day, where a shift may lie.
   - Tracks existing shifts from a week before through a week after, for the rest and streak rules.
2. **Construct** (`construct.ts`):
   - Greedy, neediest slot first: take the deepest gap and give it the best-scoring shift anyone can work.
   - Ties go to the gap the fewest people can cover.
   - Then top up anyone under their minimum hours.
3. **Improve** (`improve.ts`): simulated annealing with small moves:
   - stretch or trim a shift
   - hand a shift to someone else
   - swap two people's shifts
   - drop a shift
   - add a shift for a gap
   - move a shift to another day

   Every move keeps all hard rules, the score updates incrementally, and the best schedule seen is kept.
4. **Finish:** one more construction and minimum-hours pass, then **prune** any generated shift the schedule is better off without.
5. **Diagnose** (`diagnose.ts`):
   - Computes metrics with the app's shared coverage, hours and cost helpers, so the numbers match the Week page's charts.
   - Gives each remaining gap the reasons nobody covered it.
   - Suggests one-tap fixes.

**Determinism.** The random choices come from a seeded generator (`rng.ts`, mulberry32), and the seed is stored on the run, so the same input and seed give the same schedule. The search has an iteration budget and a 3-second wall-clock limit. When the limit cuts it short, the result can vary and the summary says so.

**Speed** (`BENCH=1 npx vitest run lib/scheduler/benchmark.test.ts`):

| Roster | Coverage | Hours vs. budget | Overtime | Time |
|---|---|---|---|---|
| Demo store (12 people) | 100% | 266 / 266 h | 0 h | 130–220 ms |
| Synthetic, 50 people | 100% | 965.5–966.5 / 964 h | 0 h | 0.4–0.5 s |

**Why not an LLM.** A language model can't guarantee hard rules: it can schedule someone on approved time off or past their hours, and it can't prove a gap was unavoidable. Training one would need large datasets and GPUs. A constraint optimizer is the standard tool for rostering: it is exact about rules, fast, explainable and cheap to run. `generateSchedule` keeps a narrow interface, so an exact solver (MILP or CP-SAT) could replace the heuristic later without touching the API or UI.

## Data model: `supabase/migrations/0034_auto_scheduler.sql`

- **`employees`** gets `employment_type` (`full_time` / `part_time`), `min_weekly_hours`, `max_weekly_hours` and `max_days_per_week`.
  - All are nullable; null means the default for their type.
  - Check constraints keep the values in range.
- **`employee_preferences`**, one row per employee:
  - `preferred_shift_types` (opener/mid/closer), `preferred_days`, `avoid_days`, `desired_weekly_hours`, `note`, `updated_at`.
  - Readable and writable by the employee themself or a manager.
- **`schedule_generation_runs`**, one row per run:
  - `week_start`, `mode`, `seed`, `rules`, `adjustments`, `metrics` (the summary), `previous_drafts` (the drafts it replaced, for undo), `created_by`, `created_at`, `undone_at`, `published_at`.
  - Managers can read and update rows; nobody can insert directly.
- **`draft_schedules.generation_run_id`**: which run created a draft. It drives the Auto tag, "another version" and undo. Editing the draft clears it (`PUT /api/drafts`), so the run no longer owns it.
- **`apply_generated_drafts(...)`**:
  - Writes a run and its drafts in one transaction, under a per-org-and-week advisory lock.
  - Refuses with `conflict` if the week's drafts changed since the engine read them (it compares a fingerprint), and with `stale` when asked to replace a run that is no longer the latest.
- **`undo_generation_run(...)`**: removes a run's drafts and restores `previous_drafts`. Only the week's latest live run can be undone, and only before the week is published.
- **Cleanup:** `reset_demo_org()` and `org_delete()` now clear the new tables. `org_delete()` was also missing several newer tenant tables, including callouts, which made it fail for orgs that had them; it now covers all of them.
- **Org rules** are `sched_*` keys in `app_settings` (e.g. `sched_ft_max_hours`, `sched_overtime_policy`), parsed by `lib/scheduling-rules.ts`. Unset keys use the defaults.

Publishing a week stamps its runs with `published_at`, so they can no longer be undone or replaced.

## API

| Endpoint | Who | What |
|---|---|---|
| `POST /api/drafts/generate` | Managers | Body: `{ weekStart, mode: "fill" \| "replace", seed?, rules?, adjustments?, replaceRunId? }`. Returns `{ run, inserted, removed }`. Errors: 400 invalid input; 409 the drafts changed while generating, or the run was already replaced; 503 migration 0034 not applied. |
| `GET /api/drafts/generate?weekStart=` | Managers | `{ run }`: the week's latest run still in effect, or `null`. |
| `POST /api/drafts/generate/undo` | Managers | Body: `{ runId }`. Returns `{ removed, restored }`. Errors: 404 no such run; 409 not the latest run, already undone, or the week is published. |
| `GET` / `PUT /api/preferences` | The employee, or a manager | Shift preferences. |
| `GET` / `PATCH /api/employees` | Managers (PATCH) | Now include employment type and weekly limits. |
| `GET` / `PUT /api/settings` | Managers (PUT) | Now include `schedulingRules`. |

Adjustments are typed, not free text, and `parseAdjustments` validates them:

```ts
{ kind: "coverage", date, startMinutes, endMinutes, delta }   // ± people for a time range
{ kind: "employee_off", employeeId, date }                    // keep someone off a day
{ kind: "employee_hours", employeeId, minHours, maxHours }    // this week's hours (may allow overtime)
```

Generate and undo are recorded in the audit log as `draft_schedule.generate` and `draft_schedule.generate_undo`.

## Code map

| Path | Purpose |
|---|---|
| `lib/scheduler/` | The engine: `types`, `model`, `state` (score and weights), `construct`, `improve`, `diagnose`, `adjustments`, `rng` |
| `lib/scheduling-rules.ts` | Org rules: parse, validate, defaults, each person's resolved limits |
| `lib/availability-rules.ts` | Availability and time-off checks shared by manual edits and the engine |
| `lib/auto-schedule-server.ts` | Loads a week's inputs for the engine, all scoped to the org |
| `lib/coverage-heatmap.ts` | Hour-by-hour coverage for the heatmap |
| `app/api/drafts/generate/` | Generate, latest run, undo |
| `app/week/weekPageClient.tsx` | The Week page: Live and Draft modes, Auto-schedule and Publish |
| `components/week/` | The page's header (mode toggle), stats and charts, and the phone day list |
| `hooks/useWeekShifts.ts`, `hooks/useAutoSchedule.ts` | The week's live shifts and drafts; the Auto-schedule run state |
| `lib/week-cells.ts` | Which shift each person-day shows when live shifts and drafts meet |
| `components/AutoScheduleSheet.tsx` | The setup sheet |
| `components/AutoScheduleSummary.tsx` | The results card |
| `components/WeekCoverageHeatmap.tsx` | The week heatmap |
| `components/DraftHoursPanel.tsx` | Hours by person |
| `components/SchedulingRulesSection.tsx`, `EmployeeSchedulingRow.tsx`, `ShiftPreferencesSection.tsx` | Settings |

## Testing

```bash
npx vitest run lib/scheduler                                      # engine: cases, invariants, determinism
BENCH=1 npx vitest run lib/scheduler/benchmark.test.ts            # coverage, gaps and runtime
npx vitest run app/api/drafts components/AutoSchedule*            # API routes and UI
npx playwright test e2e/auto-schedule.spec.ts e2e/week.spec.ts   # Draft mode and the Week page, every size class
```

- `invariants.test.ts` builds 100 seeded random rosters and checks that no hard rule is ever broken.
- The engine tests also run in the CI timezone matrix.
- `supabase/manual-tests/0034_auto_scheduler.test.sql` covers the RPCs, RLS and cleanup functions against a throwaway Postgres database. Its header has the commands; any line with FAIL is a regression.

## Deploying

Apply `supabase/migrations/0034_auto_scheduler.sql` in the Supabase SQL editor before deploying, as with earlier migrations:

- It needs 0031 applied first (for `is_own_employee`); overnight shifts also need 0033.
- Paste the whole file into a new snippet and run it with nothing selected.
- If an AI assistant or another tool applies it for you, have it apply the file exactly as it is, in one piece.
- Unlike earlier migrations, the file has no `begin;`/`commit;`. Some runners send statements separately over more than one connection, and an open transaction hides earlier statements' work from later ones. Every statement is safe to repeat, so if a run stops partway, run the whole file again.

To check it applied, run this; every column should be `true`:

```sql
select
  to_regclass('public.schedule_generation_runs') is not null as runs_table,
  to_regclass('public.employee_preferences') is not null as preferences_table,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'employees'
             and column_name = 'employment_type') as employee_columns,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'draft_schedules'
             and column_name = 'generation_run_id') as draft_column,
  (select count(*) from pg_proc
    where proname in ('apply_generated_drafts', 'undo_generation_run')) = 2 as functions;
```

Until it's applied:

- the rest of the app keeps working;
- the scheduling fields fall back to their defaults;
- the generate endpoints answer 503 with a message naming the migration.

## Not in v1

- Coverage per department or position. Targets are store-wide today.
- Posting unfilled gaps as open shifts.
- Labor rules for minors, fair-workweek and predictive-scheduling laws, and daily overtime (e.g. California).
- Meal breaks in coverage.
- Planning several weeks at once.

**Next (optional): learn from edits.** Each generated draft records its run, so the app can compare what Auto-schedule proposed with what managers actually published. A small in-house model, with no LLM and no data leaving the database, could then:

- tune each org's goal weights
- infer preferences employees never stated

It's worth building once there is enough real usage to learn from.
