// Test helpers for the scheduler: input builders, a seeded random scenario
// generator, and an independent checker of every hard rule. The checker works
// from the input and the app's shared helpers only, never the engine's
// internals, so it can catch the engine breaking a rule.

import type { CoverageBlock } from "@/lib/coverage";
import {
  DEMO_AVAILABILITY,
  DEMO_COVERAGE_DEFAULTS,
  DEMO_COVERAGE_PROFILES,
  DEMO_EMPLOYEES,
  DEMO_EMPLOYMENT,
  DEMO_PREFERENCES,
  DEMO_STORE_HOURS,
} from "@/data/demo-fixtures";
import { addDaysToKey, dayOfWeekForKey, daysBetweenKeys } from "@/lib/dates";
import { fitsAvailability } from "@/lib/availability-rules";
import { DEFAULT_SCHEDULING_RULES, resolveEmployeeLimits, type SchedulingRules } from "@/lib/scheduling-rules";
import { shiftMinutes, WEEKLY_OVERTIME_THRESHOLD_MINUTES } from "@/lib/schedule-hours";
import { shiftParts, shiftsOverlap, validateShiftTimes } from "@/lib/shift-times";
import { createRng, type Rng } from "../rng";
import type { ExistingShift, ScheduleResult, SchedulerEmployee, SchedulerInput } from "../types";

export const WEEK_START = "2026-10-12"; // a Monday
export const WEEK = Array.from({ length: 7 }, (_, i) => addDaysToKey(WEEK_START, i));
export const TZ = "America/New_York";

export function employee(id: number, overrides: Partial<SchedulerEmployee> = {}): SchedulerEmployee {
  return {
    id,
    name: `Employee ${id}`,
    employmentType: "part_time",
    minWeeklyHours: null,
    maxWeeklyHours: null,
    maxDaysPerWeek: null,
    payRate: 16,
    availability: {},
    unavailableDates: [],
    pendingTimeOffDates: [],
    preferences: { shiftTypes: [], preferredDays: [], avoidDays: [], desiredWeeklyHours: null },
    ...overrides,
  };
}

// The same curve every day of the week.
export function everyDay(blocks: CoverageBlock[], dates: string[] = WEEK): Record<string, CoverageBlock[]> {
  return Object.fromEntries(dates.map((d) => [d, blocks]));
}

export const STORE_9_TO_9 = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 540, close: 1260 }]));

export function input(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    weekDates: WEEK,
    timezone: TZ,
    curves: everyDay([{ startMinutes: 540, endMinutes: 1260, headcount: 2 }]),
    storeHours: STORE_9_TO_9,
    employees: [],
    existing: [],
    rules: { ...DEFAULT_SCHEDULING_RULES },
    adjustments: [],
    seed: 1,
    iterations: 4000,
    timeLimitMs: 60_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The independent hard-rule checker
// ---------------------------------------------------------------------------

type Span = { employeeId: number; date: string; startMinutes: number; endMinutes: number; generated: boolean };

function weeklyCap(e: SchedulerEmployee, rules: SchedulingRules, inp: SchedulerInput): number {
  const limits = resolveEmployeeLimits(e, rules);
  const override = inp.adjustments.find((a) => a.kind === "employee_hours" && a.employeeId === e.id);
  if (override && override.kind === "employee_hours" && override.maxHours != null) return Math.round(override.maxHours * 60);
  if (rules.overtimePolicy === "never") return Math.min(limits.maxMinutes, WEEKLY_OVERTIME_THRESHOLD_MINUTES);
  return limits.maxMinutes >= WEEKLY_OVERTIME_THRESHOLD_MINUTES ? limits.maxMinutes + 8 * 60 : limits.maxMinutes;
}

// Returns a list of broken rules; empty when the schedule is valid.
export function hardRuleViolations(inp: SchedulerInput, result: ScheduleResult): string[] {
  const problems: string[] = [];
  const { rules } = inp;
  const g = rules.startGranularityMinutes;
  const byId = new Map(inp.employees.map((e) => [e.id, e]));
  const weekSet = new Set(inp.weekDates);
  const spans: Span[] = [
    ...inp.existing.map((s) => ({ ...s, date: s.date.slice(0, 10), generated: false })),
    ...result.shifts.map((s) => ({ ...s, generated: true })),
  ];

  for (const s of result.shifts) {
    const label = `#${s.employeeId} ${s.date} ${s.startMinutes}-${s.endMinutes}`;
    const e = byId.get(s.employeeId);
    if (!e) { problems.push(`${label}: unknown employee`); continue; }
    if (!weekSet.has(s.date)) problems.push(`${label}: outside the week`);
    const timesError = validateShiftTimes(s.startMinutes, s.endMinutes);
    if (timesError) problems.push(`${label}: ${timesError}`);
    const len = s.endMinutes - s.startMinutes;
    if (len < rules.minShiftMinutes || len > rules.maxShiftMinutes) problems.push(`${label}: length ${len} outside rules`);
    if (s.startMinutes % g !== 0 || s.endMinutes % g !== 0) problems.push(`${label}: off the ${g}-minute grid`);

    // Time off, call-outs, kept-off days and availability, on every day the shift touches.
    const offDates = new Set([
      ...e.unavailableDates,
      ...inp.adjustments.filter((a) => a.kind === "employee_off" && a.employeeId === e.id).map((a) => (a as { date: string }).date),
    ]);
    for (const part of shiftParts(s)) {
      if (offDates.has(part.date)) problems.push(`${label}: works on a day off (${part.date})`);
      if (!fitsAvailability(e.availability[dayOfWeekForKey(part.date)], part.start, part.end))
        problems.push(`${label}: outside availability on ${part.date}`);
    }

    // Only on days with a coverage target.
    const blocks = inp.curves[s.date] ?? [];
    if (!blocks.some((b) => b.headcount > 0) && !inp.adjustments.some((a) => a.kind === "coverage" && a.date === s.date && a.delta > 0))
      problems.push(`${label}: on a day with no coverage target`);
  }

  // Per employee: one shift a day, no overlaps, rest, hours, days, streaks.
  for (const e of inp.employees) {
    const mine = spans
      .filter((s) => s.employeeId === e.id)
      .map((s) => ({ ...s, abs: daysBetweenKeys(WEEK_START, s.date) * 1440 + s.startMinutes, absEnd: daysBetweenKeys(WEEK_START, s.date) * 1440 + s.endMinutes }))
      .sort((a, b) => a.abs - b.abs);
    if (!mine.some((s) => s.generated)) continue;

    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const a = mine[i], b = mine[j];
        if (!a.generated && !b.generated) continue;
        if (a.date === b.date) problems.push(`#${e.id}: two shifts on ${a.date}`);
        if (shiftsOverlap(a, b)) problems.push(`#${e.id}: overlapping shifts on ${a.date} and ${b.date}`);
      }
      if (i + 1 < mine.length && (mine[i].generated || mine[i + 1].generated)) {
        const gap = mine[i + 1].abs - mine[i].absEnd;
        if (gap < rules.minRestMinutes) problems.push(`#${e.id}: only ${gap} min rest after ${mine[i].date}`);
      }
    }

    const inWeek = mine.filter((s) => weekSet.has(s.date));
    const minutes = inWeek.reduce((sum, s) => sum + shiftMinutes(s, inp.timezone), 0);
    const cap = weeklyCap(e, rules, inp);
    if (minutes > cap) problems.push(`#${e.id}: ${minutes} min this week, over the ${cap} min cap`);

    const days = new Set(inWeek.map((s) => s.date));
    const maxDays = resolveEmployeeLimits(e, rules).maxDays;
    if (days.size > maxDays) problems.push(`#${e.id}: works ${days.size} days, over ${maxDays}`);

    const worked = new Set(mine.map((s) => s.date));
    for (const s of mine.filter((x) => x.generated)) {
      let run = 1;
      for (let d = addDaysToKey(s.date, -1); worked.has(d); d = addDaysToKey(d, -1)) run++;
      for (let d = addDaysToKey(s.date, 1); worked.has(d); d = addDaysToKey(d, 1)) run++;
      if (run > rules.maxConsecutiveDays) problems.push(`#${e.id}: ${run} days in a row around ${s.date}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Random scenarios
// ---------------------------------------------------------------------------

function pick<T>(rng: Rng, items: T[]): T {
  return items[rng.int(items.length)];
}

export function randomScenario(seed: number): SchedulerInput {
  const rng = createRng(seed);
  // Some weeks span a DST change (2026-11-01 falls back, 2026-03-08 springs forward).
  const weekStart = pick(rng, ["2026-10-12", "2026-10-26", "2026-03-02", "2026-06-07"]);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
  const allDay = rng.next() < 0.15; // a 24-hour operation

  const curves: Record<string, CoverageBlock[]> = {};
  for (const d of weekDates) {
    if (rng.next() < 0.1) continue; // closed
    if (allDay) {
      curves[d] = [
        { startMinutes: 0, endMinutes: 360, headcount: 1 + rng.int(2) },
        { startMinutes: 360, endMinutes: 1440, headcount: 1 + rng.int(3) },
      ];
      continue;
    }
    const open = 360 + 15 * rng.int(17);  // 6:00–10:00
    const close = 1080 + 15 * rng.int(21); // 18:00–23:00
    const mid1 = open + 15 * rng.int(Math.max(1, (close - open) / 30));
    const mid2 = mid1 + 15 * rng.int(Math.max(1, (close - mid1) / 15));
    curves[d] = [
      { startMinutes: open, endMinutes: mid1, headcount: 1 + rng.int(3) },
      { startMinutes: mid1, endMinutes: mid2, headcount: 1 + rng.int(5) },
      { startMinutes: mid2, endMinutes: close, headcount: 1 + rng.int(3) },
    ].filter((b) => b.endMinutes > b.startMinutes);
  }

  const granularity = pick(rng, [15, 30, 30, 60]);
  const minShift = Math.ceil((120 + 60 * rng.int(4)) / granularity) * granularity;
  const maxShift = Math.max(minShift, Math.floor((minShift + 60 * rng.int(6)) / granularity) * granularity);
  const rules: SchedulingRules = {
    ...DEFAULT_SCHEDULING_RULES,
    startGranularityMinutes: granularity,
    minShiftMinutes: minShift,
    maxShiftMinutes: maxShift,
    minRestMinutes: pick(rng, [0, 480, 600, 720]),
    maxConsecutiveDays: 3 + rng.int(5),
    overtimePolicy: pick(rng, ["never", "when_needed"]),
    pendingTimeOff: pick(rng, ["avoid", "ignore"]),
  };

  const count = 3 + rng.int(23);
  const employees: SchedulerEmployee[] = [];
  for (let id = 1; id <= count; id++) {
    const availability: SchedulerEmployee["availability"] = {};
    for (let dow = 0; dow < 7; dow++) {
      const r = rng.next();
      if (r < 0.15) availability[dow] = { startMinutes: null, endMinutes: null };
      else if (r < 0.35) {
        const start = 15 * rng.int(60);
        availability[dow] = { startMinutes: start, endMinutes: Math.min(1440, start + 240 + 15 * rng.int(40)) };
      } else if (r < 0.4) availability[dow] = { startMinutes: 0, endMinutes: 1440 };
    }
    const type = pick(rng, ["full_time", "part_time", null] as const);
    employees.push(employee(id, {
      employmentType: type,
      maxWeeklyHours: rng.next() < 0.3 ? 8 + rng.int(40) : null,
      maxDaysPerWeek: rng.next() < 0.2 ? 1 + rng.int(7) : null,
      payRate: rng.next() < 0.8 ? 12 + rng.int(20) : null,
      availability,
      unavailableDates: weekDates.filter(() => rng.next() < 0.07),
      pendingTimeOffDates: weekDates.filter(() => rng.next() < 0.07),
      preferences: {
        shiftTypes: (["opener", "mid", "closer"] as const).filter(() => rng.next() < 0.3),
        preferredDays: [1, 2, 3].filter(() => rng.next() < 0.3),
        avoidDays: [0, 6].filter(() => rng.next() < 0.3),
        desiredWeeklyHours: rng.next() < 0.3 ? 10 + rng.int(30) : null,
      },
    }));
  }

  // Published shifts in the week and the weeks around it.
  const existing: ExistingShift[] = [];
  for (let day = -7; day < 14; day++) {
    for (const e of employees) {
      if (rng.next() > (day >= 0 && day < 7 ? 0.08 : 0.25)) continue;
      const start = 15 * rng.int(80);
      existing.push({
        employeeId: e.id,
        date: addDaysToKey(weekStart, day),
        startMinutes: start,
        endMinutes: start + 60 + 15 * rng.int(36),
      });
    }
  }
  // Sometimes a published shift belongs to someone no longer on the roster.
  if (rng.next() < 0.3) existing.push({ employeeId: 999, date: weekDates[2], startMinutes: 600, endMinutes: 900 });

  const adjustments: SchedulerInput["adjustments"] = [];
  if (rng.next() < 0.3) adjustments.push({ kind: "coverage", date: pick(rng, weekDates), startMinutes: 480, endMinutes: 720, delta: 1 + rng.int(2) });
  if (rng.next() < 0.3) adjustments.push({ kind: "employee_off", employeeId: 1 + rng.int(count), date: pick(rng, weekDates) });
  if (rng.next() < 0.3) adjustments.push({ kind: "employee_hours", employeeId: 1 + rng.int(count), minHours: null, maxHours: 10 + rng.int(40) });

  return {
    weekDates,
    timezone: TZ,
    curves,
    storeHours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 480 + 15 * rng.int(9), close: 1200 + 15 * rng.int(9) }])),
    employees,
    existing,
    rules,
    adjustments,
    seed,
    iterations: 3000,
    timeLimitMs: 60_000,
  };
}

// ---------------------------------------------------------------------------
// Realistic rosters
// ---------------------------------------------------------------------------

// The demo organization's roster, curves and store hours.
export function demoInput(seed = 1): SchedulerInput {
  const profileById = new Map(DEMO_COVERAGE_PROFILES.map((p) => [p.id, p.blocks]));
  return {
    weekDates: WEEK,
    timezone: TZ,
    curves: Object.fromEntries(WEEK.map((d) => [d, profileById.get(DEMO_COVERAGE_DEFAULTS[dayOfWeekForKey(d)])!])),
    storeHours: DEMO_STORE_HOURS,
    employees: DEMO_EMPLOYEES.map((e) => {
      const job = DEMO_EMPLOYMENT[e.id];
      const prefs = DEMO_PREFERENCES[e.id];
      return employee(e.id, {
        name: e.name,
        employmentType: job?.type ?? null,
        minWeeklyHours: job?.minHours ?? null,
        maxWeeklyHours: job?.maxHours ?? null,
        maxDaysPerWeek: job?.maxDays ?? null,
        availability: Object.fromEntries(
          (DEMO_AVAILABILITY[e.id] ?? []).map((a) => [a.dayOfWeek, { startMinutes: a.startMinutes, endMinutes: a.endMinutes }])
        ),
        preferences: {
          shiftTypes: prefs?.shiftTypes ?? [],
          preferredDays: prefs?.preferredDays ?? [],
          avoidDays: prefs?.avoidDays ?? [],
          desiredWeeklyHours: prefs?.desiredHours ?? null,
        },
      });
    }),
    existing: [],
    rules: { ...DEFAULT_SCHEDULING_RULES },
    adjustments: [],
    seed,
  };
}

// A large store: 50 people, a two-peak weekday curve and a busier weekend.
export function largeInput(seed = 1): SchedulerInput {
  const rng = createRng(1234);
  const weekday = [
    { startMinutes: 360, endMinutes: 540, headcount: 4 },
    { startMinutes: 540, endMinutes: 720, headcount: 8 },
    { startMinutes: 720, endMinutes: 840, headcount: 12 },
    { startMinutes: 840, endMinutes: 1020, headcount: 8 },
    { startMinutes: 1020, endMinutes: 1200, headcount: 10 },
    { startMinutes: 1200, endMinutes: 1320, headcount: 5 },
  ];
  const weekend = weekday.map((b) => ({ ...b, headcount: b.headcount + 3 }));
  return {
    weekDates: WEEK,
    timezone: TZ,
    curves: Object.fromEntries(WEEK.map((d) => [d, [0, 6].includes(dayOfWeekForKey(d)) ? weekend : weekday])),
    storeHours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: 360, close: 1320 }])),
    employees: Array.from({ length: 50 }, (_, i) =>
      employee(i + 1, {
        employmentType: i < 20 ? "full_time" : "part_time",
        payRate: 15 + rng.int(10),
        availability: rng.next() < 0.4 ? { [rng.int(7)]: { startMinutes: null, endMinutes: null } } : {},
        preferences: {
          shiftTypes: rng.next() < 0.5 ? [(["opener", "mid", "closer"] as const)[rng.int(3)]] : [],
          preferredDays: [],
          avoidDays: rng.next() < 0.3 ? [rng.int(7)] : [],
          desiredWeeklyHours: i >= 20 && rng.next() < 0.5 ? 16 + rng.int(12) : null,
        },
      })
    ),
    existing: [],
    rules: { ...DEFAULT_SCHEDULING_RULES },
    adjustments: [],
    seed,
  };
}
