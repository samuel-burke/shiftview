// Dollars for punched hours: the hours come from computePayroll
// (lib/payroll.ts) unchanged; this prices them at the rate in effect when they
// were worked (lib/pay-rates.ts has the rule), in the shift's position.
//
// For each payroll day it finds the worked stretches of that day's punches
// (paired exactly as computePayroll pairs them), splits them at the store's
// midnights (a rate takes effect at the start of its store-local date), and
// looks up the rate for each piece from its store-local date and the
// position of the shift its clock-in was matched to (punch_records.schedule_id
// → schedules.position_id). A day's regular, overtime and double-time hours
// are laid over its worked time in that order: overtime is the last hours of
// a day (the ones that take the week, or the day, past its limit), so a
// piece late in the day carries the overtime. Hours stay as computePayroll
// reports them; only their split between rates comes from here.
//
// Pay is regular × rate + overtime × rate × 1.5 + double time × rate × 2,
// each line rounded to the cent (lib/pay-rates.ts payCents), and every total
// is the sum of the rounded lines, so an export's columns always add up.

import { dateKeyInTz, localDayBoundsUtc } from "@/lib/dates";
import { assignPunchDays } from "@/lib/punch-sessions";
import type { EmployeePayroll } from "@/lib/payroll";
import { apportion, payCents, type RateLookup } from "@/lib/pay-rates";

export const OVERTIME_MULTIPLIER = 1.5;
export const DOUBLE_TIME_MULTIPLIER = 2;

export type CostPunch = {
  id: number;
  employee_id: number;
  punch_type: string;
  punched_at: string;
  schedule_id?: number | null;
};

// Day-level hours, with double time when the hours output has it.
type DayHours = { date: string; regularHours: number; overtimeHours: number; doubleTimeHours?: number };

export type PayLine = {
  // The position of the shift (null: no position), and whether the rate is
  // that position's own rate rather than the base rate.
  positionId: number | null;
  positionRate: boolean;
  rate: number | null;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  // Cents; null when there is no rate for these hours.
  regularCents: number | null;
  overtimeCents: number | null;
  doubleTimeCents: number | null;
  totalCents: number | null;
};

export type DayPay = {
  date: string;
  lines: PayLine[];
  // Sum of the lines that have a rate.
  totalCents: number;
  // Some of the day's hours have no rate.
  missingRate: boolean;
};

export type EmployeePay = {
  employeeId: number;
  days: Map<string, DayPay>;
  totalCents: number;
  regularCents: number;
  overtimeCents: number;
  doubleTimeCents: number;
  missingRate: boolean;
};

type Interval = { start: number; end: number; scheduleId: number | null };

// Worked stretches of one day's punches (in time order), paired exactly as
// computePayroll's computeSegments pairs them: a second clock-in keeps the
// first, a break end with no break start opens a stretch, unpaired ends
// count nothing. Each stretch carries the schedule its shift was clocked in
// for.
export function workedIntervals(punches: CostPunch[]): Interval[] {
  const out: Interval[] = [];
  let segStart: number | null = null;
  let segSchedule: number | null = null;
  let sessionSchedule: number | null = null;
  for (const p of punches) {
    const t = new Date(p.punched_at).getTime();
    switch (p.punch_type) {
      case "clock_in":
        if (segStart === null) {
          segStart = t;
          sessionSchedule = p.schedule_id ?? sessionSchedule;
          segSchedule = sessionSchedule;
        }
        break;
      case "break_end":
        if (segStart === null) {
          segStart = t;
          segSchedule = sessionSchedule ?? p.schedule_id ?? null;
        }
        break;
      case "break_start":
        if (segStart !== null) { out.push({ start: segStart, end: t, scheduleId: segSchedule }); segStart = null; }
        break;
      case "clock_out":
        if (segStart !== null) { out.push({ start: segStart, end: t, scheduleId: segSchedule }); segStart = null; }
        sessionSchedule = null;
        break;
    }
  }
  return out.filter((i) => i.end > i.start);
}

// An interval cut at the store's midnights, each piece tagged with its
// store-local date.
export function splitAtMidnights(iv: Interval, tz: string): (Interval & { day: string })[] {
  const out: (Interval & { day: string })[] = [];
  let a = iv.start;
  while (a < iv.end) {
    const day = dateKeyInTz(a, tz);
    const nextMidnight = localDayBoundsUtc(day, tz).end.getTime() + 1;
    const b = Math.min(iv.end, nextMidnight);
    out.push({ start: a, end: b, scheduleId: iv.scheduleId, day });
    a = b;
  }
  return out;
}

const hundredths = (h: number) => Math.round(h * 100);

// Prices one day's hours. `pieces` are its worked stretches split at
// midnight, in time order.
export function priceDay(
  employeeId: number,
  day: DayHours,
  pieces: (Interval & { day: string })[],
  rates: RateLookup,
  positionOf: (scheduleId: number | null) => number | null,
): DayPay {
  const cats = [
    hundredths(day.regularHours),
    hundredths(day.overtimeHours),
    hundredths(day.doubleTimeHours ?? 0),
  ];
  const totalUnits = cats[0] + cats[1] + cats[2];
  const totalMs = pieces.reduce((s, p) => s + (p.end - p.start), 0);

  // With no stretches to place the hours on (shouldn't happen: the hours come
  // from the same punches), price them all at the day's own rate.
  const placed = totalMs > 0 ? pieces : [{ start: 0, end: 1, scheduleId: null, day: day.date }];
  const span = totalMs > 0 ? totalMs : 1;

  // Each piece's share of each category, in milliseconds of the timeline:
  // regular first, then overtime, then double time.
  const bounds = [0, cats[0], cats[0] + cats[1], totalUnits].map((u) => (totalUnits > 0 ? (u / totalUnits) * span : 0));
  type Group = { positionId: number | null; positionRate: boolean; rate: number | null; ms: [number, number, number] };
  const groups: Group[] = [];
  let cursor = 0;
  for (const p of placed) {
    const a = cursor;
    const b = cursor + (p.end - p.start);
    cursor = b;
    const positionId = positionOf(p.scheduleId);
    const { rate, positionRate } = rates(employeeId, p.day, positionId);
    let g = groups.find((x) => x.positionId === positionId && x.rate === rate);
    if (!g) { g = { positionId, positionRate, rate, ms: [0, 0, 0] }; groups.push(g); }
    for (let c = 0; c < 3; c++) {
      const overlap = Math.max(0, Math.min(b, bounds[c + 1]) - Math.max(a, bounds[c]));
      g.ms[c] += overlap;
    }
  }

  // Hundredths of an hour per line, so the lines add up to the day's hours.
  const units = [0, 1, 2].map((c) => apportion(cats[c], groups.map((g) => g.ms[c])));
  const mult = [1, OVERTIME_MULTIPLIER, DOUBLE_TIME_MULTIPLIER] as const;

  let totalCents = 0;
  let missingRate = false;
  const lines: PayLine[] = groups
    .map((g, i) => {
      const u = [units[0][i], units[1][i], units[2][i]];
      const cents = g.rate == null ? [null, null, null] : u.map((x, c) => payCents(x, g.rate!, mult[c]));
      const lineTotal = g.rate == null ? null : (cents as number[]).reduce((s, x) => s + x, 0);
      return {
        positionId: g.positionId,
        positionRate: g.positionRate,
        rate: g.rate,
        regularHours: u[0] / 100,
        overtimeHours: u[1] / 100,
        doubleTimeHours: u[2] / 100,
        regularCents: cents[0],
        overtimeCents: cents[1],
        doubleTimeCents: cents[2],
        totalCents: lineTotal,
      };
    })
    .filter((l) => l.regularHours + l.overtimeHours + l.doubleTimeHours > 0);
  for (const l of lines) {
    if (l.totalCents == null) missingRate = true;
    else totalCents += l.totalCents;
  }
  return { date: day.date, lines, totalCents, missingRate };
}

// Pay for every employee and day of a computePayroll result. `punches` are the
// rows computePayroll was given (with schedule_id), `positionBySchedule` maps
// a schedule id to its position.
export function computePay(
  payroll: EmployeePayroll[],
  punches: CostPunch[],
  rates: RateLookup,
  positionBySchedule: Map<number, number | null>,
  tz: string,
): Map<number, EmployeePay> {
  const byEmployee = new Map<number, CostPunch[]>();
  for (const p of punches) {
    if (!byEmployee.has(p.employee_id)) byEmployee.set(p.employee_id, []);
    byEmployee.get(p.employee_id)!.push(p);
  }
  const positionOf = (id: number | null) => (id == null ? null : positionBySchedule.get(id) ?? null);

  const out = new Map<number, EmployeePay>();
  for (const emp of payroll) {
    // Bucket punches into work days exactly as computePayroll does.
    const sorted = [...(byEmployee.get(emp.employeeId) ?? [])].sort(
      (a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime() || a.id - b.id,
    );
    const assigned = assignPunchDays(sorted.map((p) => ({ punchType: p.punch_type, punchedAt: p.punched_at })), tz);
    const byDate = new Map<string, CostPunch[]>();
    sorted.forEach((p, i) => {
      const d = assigned[i].day;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(p);
    });

    const pay: EmployeePay = {
      employeeId: emp.employeeId, days: new Map(), totalCents: 0,
      regularCents: 0, overtimeCents: 0, doubleTimeCents: 0, missingRate: false,
    };
    for (const week of emp.weeks) {
      for (const day of week.days) {
        const pieces = workedIntervals(byDate.get(day.date) ?? []).flatMap((iv) => splitAtMidnights(iv, tz));
        const dp = priceDay(emp.employeeId, day, pieces, rates, positionOf);
        pay.days.set(day.date, dp);
        pay.totalCents += dp.totalCents;
        pay.missingRate ||= dp.missingRate;
        for (const l of dp.lines) {
          pay.regularCents += l.regularCents ?? 0;
          pay.overtimeCents += l.overtimeCents ?? 0;
          pay.doubleTimeCents += l.doubleTimeCents ?? 0;
        }
      }
    }
    out.set(emp.employeeId, pay);
  }
  return out;
}

// Sum of a set of days' pay lines, by pay type.
export function sumLines(days: DayPay[]): {
  regularCents: number; overtimeCents: number; doubleTimeCents: number; totalCents: number; missingRate: boolean;
} {
  let regularCents = 0, overtimeCents = 0, doubleTimeCents = 0, totalCents = 0, missingRate = false;
  for (const d of days) {
    missingRate ||= d.missingRate;
    for (const l of d.lines) {
      regularCents += l.regularCents ?? 0;
      overtimeCents += l.overtimeCents ?? 0;
      doubleTimeCents += l.doubleTimeCents ?? 0;
      totalCents += l.totalCents ?? 0;
    }
  }
  return { regularCents, overtimeCents, doubleTimeCents, totalCents, missingRate };
}
