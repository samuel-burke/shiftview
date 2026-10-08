// The schedule being built: every shift (existing and generated), headcount
// per slot, and per-employee totals, with the score kept up to date as shifts
// are added and removed. Lower scores are better.

import type { ShiftType } from "@/data/types";
import { SLOT_MINUTES } from "@/lib/coverage";
import {
  DAY,
  FIRST_DAY,
  LAST_DAY,
  OVERTIME_THRESHOLD,
  TIMELINE_SLOTS,
  WEEK_DAYS,
  type Model,
  type ModelShift,
} from "./model";
import type { Rng } from "./rng";

// What the schedule trades off, in points. In priority order: meet the
// coverage target, give full-timers their minimum hours, don't overstaff, avoid
// pending time off and overtime, then preferences, fairness and cost.
export const WEIGHTS = {
  // Per staff-hour below target for the first missing person; a gap two
  // people deep costs 3× that, three deep 6×, so deep gaps are filled first.
  shortfall: 100,
  overstaff: 15,               // per staff-hour above target
  fullTimeBelowMin: 60,        // per hour a full-timer is under their minimum
  partTimeBelowMin: 25,        // per hour a part-timer is under their minimum
  beyondRegularMax: 45,        // per hour of overtime allowance used
  desiredHours: 4,             // per hour away from the hours someone asked for
  laborCost: 0.05,             // per dollar (overtime at 1.5×)
  perShift: 3,                 // prefer fewer, longer shifts
  avoidDay: 20,                // a day they'd rather not work
  preferredDay: 4,             // bonus: a day they'd like
  shiftTypeMismatch: 8,        // a shift type they didn't ask for
  pendingTimeOff: 80,          // a day they've asked off (pending)
  fairness: 1.5,               // × (closes² + weekend shifts²) per person
  consistency: 3,              // bonus: same weekday and start (±1 h) as last week
};

export const EPS = 1e-6;
const SLOT_HOURS = SLOT_MINUTES / 60;
const SHORT_SLOT = WEIGHTS.shortfall * SLOT_HOURS;
const OVER_SLOT = WEIGHTS.overstaff * SLOT_HOURS;
const DAY_SPAN = LAST_DAY - FIRST_DAY + 1;

export type Shift = ModelShift;

export function slotPenalty(target: number, count: number): number {
  if (count < target) {
    const k = target - count;
    return (SHORT_SLOT * k * (k + 1)) / 2;
  }
  return OVER_SLOT * (count - target);
}

export function slotRange(s: { abs: number; absEnd: number }): [number, number] {
  return [
    Math.max(0, Math.ceil(s.abs / SLOT_MINUTES)),
    Math.min(TIMELINE_SLOTS, Math.ceil(s.absEnd / SLOT_MINUTES)),
  ];
}

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;
const floorTo = (n: number, step: number) => Math.floor(n / step) * step;

// Where a new shift for an employee may go on a day, in abs minutes, given
// everything already scheduled; null when they can't work that day at all.
export type Opening = { lo: number; hi: number; capLeft: number };

export class ScheduleState {
  readonly cov = new Int16Array(TIMELINE_SLOTS);
  readonly shifts: Shift[][];      // per employee, sorted by start
  readonly minutes: number[];      // paid minutes this week
  readonly closes: number[];       // closing shifts this week
  readonly weekends: number[];     // weekend shifts this week
  readonly genCount: number[];     // generated shifts
  readonly workDays: number[];     // days this week with a shift
  readonly dayCount: Uint8Array[]; // shifts per day, FIRST_DAY … LAST_DAY
  readonly generated: Shift[] = [];
  private readonly genPos = new Map<Shift, number>();
  score = 0;

  constructor(readonly model: Model) {
    const n = model.employees.length;
    this.shifts = Array.from({ length: n }, () => []);
    this.minutes = new Array(n).fill(0);
    this.closes = new Array(n).fill(0);
    this.weekends = new Array(n).fill(0);
    this.genCount = new Array(n).fill(0);
    this.workDays = new Array(n).fill(0);
    this.dayCount = Array.from({ length: n }, () => new Uint8Array(DAY_SPAN));
    for (const s of model.existing) {
      this.coverage(s, 1);
      if (s.emp >= 0) this.attach(s);
    }
    this.score = this.fullScore();
  }

  private isWeekend(day: number): boolean {
    const dow = this.model.dows[day];
    return dow === 0 || dow === 6;
  }

  private coverage(s: Shift, sign: 1 | -1): void {
    const [a, b] = slotRange(s);
    for (let k = a; k < b; k++) this.cov[k] += sign;
  }

  private attach(s: Shift): void {
    const i = s.emp;
    const list = this.shifts[i];
    let at = list.length;
    while (at > 0 && list[at - 1].abs > s.abs) at--;
    list.splice(at, 0, s);
    const dc = this.dayCount[i];
    if (s.day >= FIRST_DAY && s.day <= LAST_DAY) {
      if (s.day >= 0 && s.day < WEEK_DAYS && dc[s.day - FIRST_DAY] === 0) this.workDays[i]++;
      dc[s.day - FIRST_DAY]++;
    }
    if (s.day >= 0 && s.day < WEEK_DAYS) {
      this.minutes[i] += s.paid;
      if (s.type === "closer") this.closes[i]++;
      if (this.isWeekend(s.day)) this.weekends[i]++;
    }
    if (!s.fixed) this.genCount[i]++;
  }

  private detach(s: Shift): void {
    const i = s.emp;
    const list = this.shifts[i];
    list.splice(list.indexOf(s), 1);
    const dc = this.dayCount[i];
    if (s.day >= FIRST_DAY && s.day <= LAST_DAY) {
      dc[s.day - FIRST_DAY]--;
      if (s.day >= 0 && s.day < WEEK_DAYS && dc[s.day - FIRST_DAY] === 0) this.workDays[i]--;
    }
    if (s.day >= 0 && s.day < WEEK_DAYS) {
      this.minutes[i] -= s.paid;
      if (s.type === "closer") this.closes[i]--;
      if (this.isWeekend(s.day)) this.weekends[i]--;
    }
    if (!s.fixed) this.genCount[i]--;
  }

  // An employee's part of the score, from their totals.
  employeePenaltyWith(i: number, minutes: number, closes: number, weekends: number, count: number): number {
    const e = this.model.employees[i];
    let p = 0;
    if (minutes < e.minMinutes)
      p += ((e.type === "full_time" ? WEIGHTS.fullTimeBelowMin : WEIGHTS.partTimeBelowMin) * (e.minMinutes - minutes)) / 60;
    if (e.desiredMinutes !== null) p += (WEIGHTS.desiredHours * Math.abs(minutes - e.desiredMinutes)) / 60;
    if (minutes > e.regularMaxMinutes) p += (WEIGHTS.beyondRegularMax * (minutes - e.regularMaxMinutes)) / 60;
    const overtime = Math.max(0, minutes - OVERTIME_THRESHOLD);
    p += (WEIGHTS.laborCost * e.rate * (minutes - overtime + 1.5 * overtime)) / 60;
    p += WEIGHTS.perShift * count;
    if (!e.preferredTypes?.has("closer")) p += WEIGHTS.fairness * closes * closes;
    if (!(e.preferredDays.has(0) || e.preferredDays.has(6))) p += WEIGHTS.fairness * weekends * weekends;
    return p;
  }

  employeePenalty(i: number): number {
    return this.employeePenaltyWith(i, this.minutes[i], this.closes[i], this.weekends[i], this.genCount[i]);
  }

  // The employee's part of the score if one more shift were added.
  employeePenaltyAfterAdd(i: number, day: number, paid: number, type: ShiftType): number {
    return this.employeePenaltyWith(
      i,
      this.minutes[i] + paid,
      this.closes[i] + (type === "closer" ? 1 : 0),
      this.weekends[i] + (this.isWeekend(day) ? 1 : 0),
      this.genCount[i] + 1
    );
  }

  // Preference terms of one generated shift.
  shiftPenalty(i: number, day: number, start: number, type: ShiftType): number {
    const e = this.model.employees[i];
    const dow = this.model.dows[day];
    let p = 0;
    if (e.avoidDays.has(dow)) p += WEIGHTS.avoidDay;
    if (e.preferredDays.has(dow)) p -= WEIGHTS.preferredDay;
    if (e.preferredTypes && !e.preferredTypes.has(type)) p += WEIGHTS.shiftTypeMismatch;
    if (e.avoidPending[day]) p += WEIGHTS.pendingTimeOff;
    const last = e.lastWeekStart[dow];
    if (last !== null && Math.abs(start - last) <= 60) p -= WEIGHTS.consistency;
    return p;
  }

  fullScore(): number {
    let total = 0;
    for (let k = 0; k < TIMELINE_SLOTS; k++) total += slotPenalty(this.model.target[k], this.cov[k]);
    for (let i = 0; i < this.model.employees.length; i++) total += this.employeePenalty(i);
    for (const s of this.generated) total += this.shiftPenalty(s.emp, s.day, s.start, s.type);
    return total;
  }

  makeShift(emp: number, day: number, start: number, end: number): Shift {
    return {
      emp,
      day,
      start,
      end,
      abs: day * DAY + start,
      absEnd: day * DAY + end,
      paid: this.model.paid(day, start, end),
      type: this.model.classify(day, start, end),
      fixed: false,
    };
  }

  // Adds a generated shift (feasibility is the caller's job); returns the score change.
  add(s: Shift): number {
    const target = this.model.target;
    let delta = 0;
    const [a, b] = slotRange(s);
    for (let k = a; k < b; k++) delta += slotPenalty(target[k], this.cov[k] + 1) - slotPenalty(target[k], this.cov[k]);
    const before = this.employeePenalty(s.emp);
    this.coverage(s, 1);
    this.attach(s);
    delta += this.employeePenalty(s.emp) - before + this.shiftPenalty(s.emp, s.day, s.start, s.type);
    this.genPos.set(s, this.generated.length);
    this.generated.push(s);
    this.score += delta;
    return delta;
  }

  remove(s: Shift): number {
    const target = this.model.target;
    let delta = 0;
    const [a, b] = slotRange(s);
    for (let k = a; k < b; k++) delta += slotPenalty(target[k], this.cov[k] - 1) - slotPenalty(target[k], this.cov[k]);
    const before = this.employeePenalty(s.emp);
    this.coverage(s, -1);
    this.detach(s);
    delta += this.employeePenalty(s.emp) - before - this.shiftPenalty(s.emp, s.day, s.start, s.type);
    const pos = this.genPos.get(s)!;
    const last = this.generated.pop()!;
    if (last !== s) {
      this.generated[pos] = last;
      this.genPos.set(last, pos);
    }
    this.genPos.delete(s);
    this.score += delta;
    return delta;
  }

  // Where a new shift for employee i could go on `day`, honoring their window,
  // one shift a day, days per week, consecutive days, rest and their hours cap.
  opening(i: number, day: number): Opening | null {
    const m = this.model;
    const e = m.employees[i];
    if (day < 0 || day >= WEEK_DAYS) return null;
    const w = e.windows[day];
    if (!w) return null;
    const dc = this.dayCount[i];
    if (dc[day - FIRST_DAY] > 0) return null;
    if (this.workDays[i] + 1 > e.maxDays) return null;
    let run = 1;
    for (let d = day - 1; d >= FIRST_DAY && dc[d - FIRST_DAY] > 0; d--) run++;
    for (let d = day + 1; d <= LAST_DAY && dc[d - FIRST_DAY] > 0; d++) run++;
    if (run > m.rules.maxConsecutiveDays) return null;
    const capLeft = e.capMinutes - this.minutes[i];
    if (capLeft < m.minLength) return null;

    const base = day * DAY;
    let lo = base + w.lo;
    let hi = base + w.hi;
    const rest = m.rules.minRestMinutes;
    for (const o of this.shifts[i]) {
      if (o.abs < base) lo = Math.max(lo, o.absEnd + rest);
      else if (o.abs >= base + DAY) hi = Math.min(hi, o.abs - rest);
    }
    lo = base + ceilTo(lo - base, m.grid);
    hi = base + floorTo(hi - base, m.grid);
    // A shift belongs to the day it starts on: it must start before midnight.
    if (lo - base >= DAY || hi - lo < m.minLength) return null;
    return { lo, hi, capLeft };
  }

  canPlace(i: number, day: number, start: number, end: number): boolean {
    const m = this.model;
    const len = end - start;
    if (start < 0 || start >= DAY) return false;
    if (len < m.minLength || len > m.maxLength || len % m.grid !== 0 || start % m.grid !== 0) return false;
    const open = this.opening(i, day);
    if (!open) return false;
    if (day * DAY + start < open.lo || day * DAY + end > open.hi) return false;
    return m.paid(day, start, end) <= open.capLeft;
  }

  // Prefix sums of the coverage change from adding one person to each slot:
  // the coverage part of adding a shift is P[end] − P[start].
  addGainPrefix(): Float64Array {
    const target = this.model.target;
    const p = new Float64Array(TIMELINE_SLOTS + 1);
    for (let k = 0; k < TIMELINE_SLOTS; k++)
      p[k + 1] = p[k] + slotPenalty(target[k], this.cov[k] + 1) - slotPenalty(target[k], this.cov[k]);
    return p;
  }

  randomGenerated(rng: Rng): Shift | null {
    return this.generated.length ? this.generated[rng.int(this.generated.length)] : null;
  }

  snapshot(): Shift[] {
    return this.generated.slice();
  }

  restore(snapshot: Shift[]): void {
    for (const s of this.generated.slice()) this.remove(s);
    for (const s of snapshot) this.add(s);
  }
}
