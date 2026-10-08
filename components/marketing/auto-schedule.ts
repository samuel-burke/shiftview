// The Auto-schedule run the landing page shows, moved onto the visitor's next
// week. auto-schedule.json is the real engine's output for the demo store
// (auto-schedule.test.ts generates it and fails if it goes stale), so the
// preview is a genuine run without shipping the engine to the browser.

import saved from "./auto-schedule.json";
import { DEMO_COVERAGE_DEFAULTS, DEMO_COVERAGE_PROFILES } from "@/data/demo-fixtures";
import { addDaysToKey, dayOfWeekForKey, daysBetweenKeys } from "@/lib/dates";
import { weekDates } from "@/lib/draft-metrics";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";
import type { GenerationRun, ProposedShift, ScheduleGap, ScheduleMetrics, SchedulerWarning, Suggestion } from "@/lib/scheduler/types";
import type { DraftWeek } from "./screens";

type SavedRun = {
  weekStart: string;
  seed: number;
  timeOff: { employeeId: number; day: number; status: "approved" | "pending" }[];
  shifts: ProposedShift[];
  metrics: ScheduleMetrics;
  gaps: ScheduleGap[];
  suggestions: Suggestion[];
  warnings: SchedulerWarning[];
};

const RUN = saved as SavedRun;

/** The run as the Week page would hold it for the week starting `weekStart`, made at `createdAt`. */
export function draftWeek(weekStart: string, createdAt: string): DraftWeek {
  const dates = weekDates(weekStart);
  const move = (date: string) => addDaysToKey(weekStart, daysBetweenKeys(RUN.weekStart, date));
  const profiles = new Map(DEMO_COVERAGE_PROFILES.map((p) => [p.id, p.blocks]));
  const warnings = RUN.warnings.map((w): SchedulerWarning => (w.code === "no_coverage_target" ? { ...w, dates: w.dates.map(move) } : w));
  const run: GenerationRun = {
    runId: 1,
    weekStart,
    mode: "replace",
    seed: RUN.seed,
    createdAt,
    rules: DEFAULT_SCHEDULING_RULES,
    adjustments: [],
    metrics: RUN.metrics,
    gaps: RUN.gaps.map((g) => ({ ...g, date: move(g.date) })),
    suggestions: RUN.suggestions,
    warnings,
    employees: [],
  };
  return {
    dates,
    curves: Object.fromEntries(dates.map((d) => [d, profiles.get(DEMO_COVERAGE_DEFAULTS[dayOfWeekForKey(d)]) ?? []])),
    drafts: RUN.shifts.map((s, i) => ({ id: i + 1, ...s, date: move(s.date), generationRunId: run.runId, source: "draft" as const })),
    timeOff: RUN.timeOff
      .filter((t) => t.status === "pending")
      .map((t, i) => ({ id: i + 1, employeeId: t.employeeId, date: dates[t.day], status: "pending" as const })),
    run,
  };
}
