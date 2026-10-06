// The static model the scheduler works on, built once from its input: the week
// as 15-minute slots with a target headcount per slot, where shifts may go
// each day, and each employee's limits and windows.
//
// Times: a shift belongs to the day it starts on, with minutes since that
// day's midnight (end past 1440 = overnight), as everywhere else in the app.
// "abs" minutes count from the first planned day's midnight, so shifts on
// different days compare directly.

import { getShiftType, type ShiftType } from "@/data/types";
import { MAX_HEADCOUNT, SLOT_MINUTES, targetAt } from "@/lib/coverage";
import { addDaysToKey, dayOfWeekForKey, daysBetweenKeys, shiftElapsedMinutes } from "@/lib/dates";
import { isUnavailableAllDay } from "@/lib/availability-rules";
import { resolveEmployeeLimits, type EmploymentType, type SchedulingRules } from "@/lib/scheduling-rules";
import { WEEKLY_OVERTIME_THRESHOLD_MINUTES } from "@/lib/schedule-hours";
import type { SchedulerInput } from "./types";

export const DAY = 1440;
export const SLOTS_PER_DAY = DAY / SLOT_MINUTES;
export const WEEK_DAYS = 7;
export const WEEK_SLOTS = WEEK_DAYS * SLOTS_PER_DAY;
// The week plus the day after it, where an overnight shift from the last day ends.
export const TIMELINE_SLOTS = WEEK_SLOTS + SLOTS_PER_DAY;
// Existing shifts tracked around the week (for rest and consecutive-day
// rules): a week before it through a week after.
export const FIRST_DAY = -7;
export const LAST_DAY = 13;
export const OVERTIME_THRESHOLD = WEEKLY_OVERTIME_THRESHOLD_MINUTES;
// With overtime allowed "to fill gaps", anyone whose regular maximum reaches
// the overtime threshold may be scheduled up to this much past it.
export const OVERTIME_ALLOWANCE_MINUTES = 8 * 60;
// Rate assumed for cost comparisons when nobody has a pay rate set.
const FALLBACK_PAY_RATE = 15;

// Where shifts starting on a day may lie, in minutes since that day's midnight.
// `hi` passes 1440 when coverage runs on past midnight (24-hour operations).
export type DayWindow = { lo: number; hi: number };

export type ModelEmployee = {
  index: number;
  id: number;
  name: string;
  type: EmploymentType;
  typeSet: boolean;
  minMinutes: number;
  // Hours past this are overtime allowance (penalized); past capMinutes, impossible.
  regularMaxMinutes: number;
  capMinutes: number;
  maxDays: number;
  rate: number;
  rateKnown: boolean;
  payRate: number | null;
  // Per week day: where a shift starting that day may lie, or null if none can.
  windows: (DayWindow | null)[];
  // Per week day: a pending time-off request (and the rules say to avoid it).
  avoidPending: boolean[];
  // Per week day: a pending request, whatever the rules say (for reporting).
  pending: boolean[];
  // Per week day: approved time off, a call-out, or kept off by an adjustment.
  unavailable: boolean[];
  availability: SchedulerInput["employees"][number]["availability"];
  preferredTypes: Set<ShiftType> | null;
  preferredDays: Set<number>;
  avoidDays: Set<number>;
  desiredMinutes: number | null;
  // Day of week → start minute last week, for keeping schedules consistent.
  lastWeekStart: (number | null)[];
};

export type ModelShift = {
  emp: number; // employee index, or −1 for someone not on the roster
  day: number;
  start: number;
  end: number;
  abs: number;
  absEnd: number;
  paid: number; // paid minutes counted toward the week (0 outside it)
  type: ShiftType;
  fixed: boolean;
};

export type Model = {
  dates: string[]; // the 7 planned dates
  dows: number[];  // their days of week
  target: Int16Array; // per slot
  windows: (DayWindow | null)[]; // per week day
  rules: SchedulingRules;
  grid: number;
  lengths: number[]; // allowed shift lengths, shortest first
  minLength: number;
  maxLength: number;
  employees: ModelEmployee[];
  existing: ModelShift[];
  paid(day: number, start: number, end: number): number;
  classify(day: number, start: number, end: number): ShiftType;
};

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;
const floorTo = (n: number, step: number) => Math.floor(n / step) * step;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildModel(input: SchedulerInput): Model {
  const { rules, timezone: tz } = input;
  const weekStart = input.weekDates[0];
  const dates = Array.from({ length: WEEK_DAYS }, (_, i) => addDaysToKey(weekStart, i));
  const dows = dates.map(dayOfWeekForKey);
  const grid = rules.startGranularityMinutes;

  // Paid minutes are real elapsed time, which differs from end − start only
  // around a DST change; check each day once and do the exact sum only there.
  const regularDay = Array.from({ length: WEEK_DAYS + 1 }, (_, i) =>
    shiftElapsedMinutes(addDaysToKey(weekStart, i), 0, DAY, tz) === DAY
  );
  const paid = (day: number, start: number, end: number): number => {
    if (day < 0 || day >= WEEK_DAYS) return 0;
    if (regularDay[day] && (end <= DAY || regularDay[day + 1])) return end - start;
    return shiftElapsedMinutes(dates[day], start, end, tz);
  };

  // Target headcount per slot: the curve, plus this week's coverage adjustments.
  const target = new Int16Array(TIMELINE_SLOTS);
  for (let day = 0; day < WEEK_DAYS; day++) {
    const blocks = input.curves[dates[day]] ?? [];
    for (let s = 0; s < SLOTS_PER_DAY; s++) target[day * SLOTS_PER_DAY + s] = targetAt(blocks, s * SLOT_MINUTES);
  }
  for (const adj of input.adjustments) {
    if (adj.kind !== "coverage") continue;
    const day = daysBetweenKeys(weekStart, adj.date);
    if (day < 0 || day >= WEEK_DAYS) continue;
    const first = Math.max(0, Math.ceil(adj.startMinutes / SLOT_MINUTES));
    const last = Math.min(SLOTS_PER_DAY, Math.ceil(adj.endMinutes / SLOT_MINUTES));
    for (let s = first; s < last; s++) {
      const i = day * SLOTS_PER_DAY + s;
      target[i] = Math.max(0, Math.min(MAX_HEADCOUNT, target[i] + adj.delta));
    }
  }

  // Where shifts may go each day: the store's hours plus wherever the target
  // asks for someone. A day with no target is treated as closed.
  const storeFor = (day: number) => {
    const h = input.storeHours[dows[day]];
    return h && h.open >= 0 && h.close <= DAY && h.open < h.close ? h : null;
  };
  const windows: (DayWindow | null)[] = dates.map((_, day) => {
    let first = -1, last = -1;
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      if (target[day * SLOTS_PER_DAY + s] > 0) {
        if (first < 0) first = s;
        last = s;
      }
    }
    if (first < 0) return null;
    const store = storeFor(day);
    return {
      lo: Math.min(first * SLOT_MINUTES, store?.open ?? DAY),
      hi: Math.max((last + 1) * SLOT_MINUTES, store?.close ?? 0),
    };
  });
  // Coverage that runs through midnight into the next day can be worked by
  // overnight shifts. (Not past the last day: the day after isn't planned.)
  for (let day = 0; day < WEEK_DAYS - 1; day++) {
    const w = windows[day], next = windows[day + 1];
    if (w && next && w.hi === DAY && next.lo === 0) w.hi = DAY + next.hi;
  }

  const classify = (day: number, start: number, end: number): ShiftType => {
    const store = day >= 0 && day < WEEK_DAYS ? storeFor(day) : null;
    const w = day >= 0 && day < WEEK_DAYS ? windows[day] : null;
    const open = store?.open ?? w?.lo ?? start;
    const close = store?.close ?? (w ? Math.min(w.hi, DAY) : end);
    return getShiftType(start, end, open, close) ?? "mid";
  };

  // Shift lengths on the grid, within the org's range.
  const minLength = ceilTo(rules.minShiftMinutes, grid);
  const maxLength = floorTo(rules.maxShiftMinutes, grid);
  const lengths: number[] = [];
  for (let len = minLength; len <= maxLength; len += grid) lengths.push(len);

  const knownRates = input.employees.map((e) => e.payRate).filter((r): r is number => r != null && r > 0);
  const defaultRate = median(knownRates) ?? FALLBACK_PAY_RATE;

  const employees: ModelEmployee[] = input.employees.map((e, index) => {
    const limits = resolveEmployeeLimits(
      {
        employmentType: e.employmentType,
        minWeeklyHours: e.minWeeklyHours,
        maxWeeklyHours: e.maxWeeklyHours,
        maxDaysPerWeek: e.maxDaysPerWeek,
      },
      rules
    );
    const override = input.adjustments.find(
      (a): a is Extract<typeof a, { kind: "employee_hours" }> => a.kind === "employee_hours" && a.employeeId === e.id
    );
    let maxMinutes = override?.maxHours != null ? Math.round(override.maxHours * 60) : limits.maxMinutes;
    let regularMax: number;
    let cap: number;
    if (override?.maxHours != null) {
      // An explicit weekly maximum allows exactly that, overtime included.
      regularMax = cap = maxMinutes;
    } else if (rules.overtimePolicy === "never") {
      regularMax = cap = Math.min(maxMinutes, OVERTIME_THRESHOLD);
    } else {
      regularMax = maxMinutes;
      cap = maxMinutes >= OVERTIME_THRESHOLD ? maxMinutes + OVERTIME_ALLOWANCE_MINUTES : maxMinutes;
    }
    maxMinutes = cap;
    const minMinutes = Math.min(
      override?.minHours != null ? Math.round(override.minHours * 60) : limits.minMinutes,
      regularMax
    );

    const offDates = new Set([
      ...e.unavailableDates.map((d) => d.slice(0, 10)),
      ...input.adjustments
        .filter((a): a is Extract<typeof a, { kind: "employee_off" }> => a.kind === "employee_off" && a.employeeId === e.id)
        .map((a) => a.date),
    ]);
    const pendingDates = new Set(e.pendingTimeOffDates.map((d) => d.slice(0, 10)));
    const unavailable = dates.map((d) => offDates.has(d));
    const pending = dates.map((d) => pendingDates.has(d));

    // Availability window for a day as [lo, hi], or null when unavailable.
    const availWindow = (day: number): [number, number] | null => {
      if (unavailable[day]) return null;
      const rule = e.availability[dows[day]];
      if (!rule) return [0, DAY];
      if (isUnavailableAllDay(rule)) return null;
      return [rule.startMinutes!, rule.endMinutes!];
    };

    const empWindows: (DayWindow | null)[] = dates.map((_, day) => {
      const w = windows[day];
      const avail = availWindow(day);
      if (!w || !avail) return null;
      const lo = Math.max(floorTo(w.lo, grid), ceilTo(avail[0], grid));
      let hi = Math.min(ceilTo(Math.min(w.hi, DAY), grid), floorTo(avail[1], grid));
      // Past midnight only if available through midnight into an available morning.
      if (w.hi > DAY && hi === DAY && day + 1 < WEEK_DAYS) {
        const next = availWindow(day + 1);
        if (next && next[0] === 0) hi = DAY + Math.min(floorTo(next[1], grid), floorTo(w.hi - DAY, grid));
      }
      return hi - lo >= minLength && lengths.length > 0 ? { lo, hi } : null;
    });

    const desired = e.preferences.desiredWeeklyHours;
    return {
      index,
      id: e.id,
      name: e.name,
      type: limits.type,
      typeSet: limits.typeSet,
      minMinutes,
      regularMaxMinutes: regularMax,
      capMinutes: maxMinutes,
      maxDays: limits.maxDays,
      rate: e.payRate != null && e.payRate > 0 ? e.payRate : defaultRate,
      rateKnown: e.payRate != null,
      payRate: e.payRate,
      windows: empWindows,
      avoidPending: pending.map((p) => p && rules.pendingTimeOff === "avoid"),
      pending,
      unavailable,
      availability: e.availability,
      preferredTypes: e.preferences.shiftTypes.length ? new Set(e.preferences.shiftTypes) : null,
      preferredDays: new Set(e.preferences.preferredDays),
      avoidDays: new Set(e.preferences.avoidDays),
      desiredMinutes:
        desired == null ? null : Math.max(minMinutes, Math.min(regularMax, Math.round(desired * 60))),
      lastWeekStart: Array<number | null>(7).fill(null),
    };
  });

  const indexById = new Map(employees.map((e) => [e.id, e.index]));
  const existing: ModelShift[] = [];
  for (const s of input.existing) {
    const day = daysBetweenKeys(weekStart, s.date.slice(0, 10));
    if (day < FIRST_DAY || day > LAST_DAY) continue;
    const emp = indexById.get(s.employeeId) ?? -1;
    existing.push({
      emp,
      day,
      start: s.startMinutes,
      end: s.endMinutes,
      abs: day * DAY + s.startMinutes,
      absEnd: day * DAY + s.endMinutes,
      paid: paid(day, s.startMinutes, s.endMinutes),
      type: classify(day, s.startMinutes, s.endMinutes),
      fixed: true,
    });
    if (emp >= 0 && day < 0) {
      employees[emp].lastWeekStart[dayOfWeekForKey(s.date.slice(0, 10))] = s.startMinutes;
    }
  }

  return {
    dates,
    dows,
    target,
    windows,
    rules,
    grid,
    lengths,
    minLength,
    maxLength,
    employees,
    existing,
    paid,
    classify,
  };
}
