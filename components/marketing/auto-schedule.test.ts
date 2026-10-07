import { describe, it, expect } from "vitest";
import { generateSchedule, type ExistingShift, type SchedulerInput } from "@/lib/scheduler";
import {
  DEMO_AVAILABILITY,
  DEMO_COVERAGE_DEFAULTS,
  DEMO_COVERAGE_PROFILES,
  DEMO_EMPLOYEES,
  DEMO_EMPLOYMENT,
  DEMO_PREFERENCES,
  DEMO_SETTINGS,
  DEMO_STORE_HOURS,
  EMPLOYEE_PATTERNS,
} from "@/data/demo-fixtures";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";
import { addDaysToKey, dayOfWeekForKey } from "@/lib/dates";
import { weekDates } from "@/lib/draft-metrics";
import { weekCells } from "@/lib/week-cells";
import { draftWeek } from "./auto-schedule";
import savedRun from "./auto-schedule.json";

// The landing page's Auto-schedule preview shows a real run of the engine for
// the demo store, saved to auto-schedule.json so the page ships no engine. If
// the engine or the demo data change, this fails; regenerate the file with
//   npx vitest run components/marketing/auto-schedule.test.ts -u
//
// The run: next week, with this week's published pattern live, after the
// manager set Riley's employment type in the readiness check. Casey has the
// Friday off (approved), Jamie has asked for Saturday (pending), and the rules
// are the defaults (no overtime, avoid pending time off).
const WEEK_START = "2026-10-12"; // a Monday, the demo store's first day of the week
const SEED = 6;
const TIME_OFF = [
  { employeeId: 2, day: 4, status: "approved" as const },
  { employeeId: 9, day: 5, status: "pending" as const },
];

function input(): SchedulerInput {
  const dates = weekDates(WEEK_START);
  const profiles = new Map(DEMO_COVERAGE_PROFILES.map((p) => [p.id, p.blocks]));
  const existing: ExistingShift[] = weekDates(addDaysToKey(WEEK_START, -7)).flatMap((date) =>
    DEMO_EMPLOYEES.flatMap((e) => {
      const s = EMPLOYEE_PATTERNS[e.id]?.[dayOfWeekForKey(date)];
      return s ? [{ employeeId: e.id, date, startMinutes: s[0], endMinutes: s[1] }] : [];
    })
  );
  const offDates = (id: number, status: "approved" | "pending") =>
    TIME_OFF.filter((t) => t.employeeId === id && t.status === status).map((t) => dates[t.day]);
  return {
    weekDates: dates,
    timezone: DEMO_SETTINGS.timezone,
    curves: Object.fromEntries(dates.map((d) => [d, profiles.get(DEMO_COVERAGE_DEFAULTS[dayOfWeekForKey(d)])!])),
    storeHours: DEMO_STORE_HOURS,
    employees: DEMO_EMPLOYEES.map((e) => {
      const job = DEMO_EMPLOYMENT[e.id];
      const prefs = DEMO_PREFERENCES[e.id];
      return {
        id: e.id,
        name: e.name,
        employmentType: job.type ?? "part_time",
        minWeeklyHours: job.minHours ?? null,
        maxWeeklyHours: job.maxHours ?? null,
        maxDaysPerWeek: job.maxDays ?? null,
        payRate: job.payRate,
        availability: Object.fromEntries(
          (DEMO_AVAILABILITY[e.id] ?? []).map((a) => [a.dayOfWeek, { startMinutes: a.startMinutes, endMinutes: a.endMinutes }])
        ),
        unavailableDates: offDates(e.id, "approved"),
        pendingTimeOffDates: offDates(e.id, "pending"),
        preferences: {
          shiftTypes: prefs?.shiftTypes ?? [],
          preferredDays: prefs?.preferredDays ?? [],
          avoidDays: prefs?.avoidDays ?? [],
          desiredWeeklyHours: prefs?.desiredHours ?? null,
        },
      };
    }),
    existing,
    rules: { ...DEFAULT_SCHEDULING_RULES },
    adjustments: [],
    seed: SEED,
    // Generous, so the search always runs its full iteration budget and the
    // result is the same on any machine.
    timeLimitMs: 60_000,
  };
}

describe("Auto-schedule preview", () => {
  it("is the engine's own run for the demo store", async () => {
    const result = generateSchedule(input());
    const saved = {
      weekStart: WEEK_START,
      seed: SEED,
      timeOff: TIME_OFF,
      shifts: result.shifts,
      metrics: result.metrics,
      gaps: result.gaps,
      suggestions: result.suggestions,
      warnings: result.warnings,
    };
    await expect(`${JSON.stringify(saved, null, 2)}\n`).toMatchFileSnapshot("./auto-schedule.json");
  });
});

describe("draftWeek", () => {
  it("moves the run onto another week as the Week page's Auto drafts", () => {
    const week = draftWeek("2026-11-02", "2026-10-30T16:00:00Z");
    expect(week.dates).toEqual(weekDates("2026-11-02"));
    expect(week.run.weekStart).toBe("2026-11-02");
    expect(week.drafts).toHaveLength(savedRun.shifts.length);
    week.drafts.forEach((d, i) => {
      expect(dayOfWeekForKey(d.date)).toBe(dayOfWeekForKey(savedRun.shifts[i].date));
      expect(d.generationRunId).toBe(week.run.runId);
    });
    // Draft mode shows every one of them as a draft, none as a live shift.
    const cells = [...weekCells(week.drafts, "draft").values()];
    expect(cells.every((c) => c.live === null && c.draft !== null)).toBe(true);
    // Jamie's pending Saturday is on the new week's Saturday.
    expect(week.timeOff).toEqual([{ id: 1, employeeId: 9, date: "2026-11-07", status: "pending" }]);
  });
});
