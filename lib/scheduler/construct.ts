// Greedy construction: repeatedly take the most understaffed slot (deepest gap
// first; among equals, the one the fewest people can cover) and give it the
// best-scoring shift anyone can work, until no gap can be improved. Then top up
// anyone under their minimum hours.

import { SLOT_MINUTES } from "@/lib/coverage";
import { DAY, WEEK_DAYS, WEEK_SLOTS } from "./model";
import type { Rng } from "./rng";
import { EPS, type ScheduleState } from "./state";

export type Candidate = { emp: number; day: number; start: number; end: number; delta: number };

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

// The best new shift for `emp` (lowest score change), optionally one that
// covers abs minute `cover`. `prefix` is state.addGainPrefix() for the current
// state.
export function bestCandidate(
  state: ScheduleState,
  emp: number,
  prefix: Float64Array,
  cover: number | null
): Candidate | null {
  const m = state.model;
  let best: Candidate | null = null;
  const days: number[] = [];
  if (cover === null) {
    for (let d = 0; d < WEEK_DAYS; d++) days.push(d);
  } else {
    const d = Math.floor(cover / DAY);
    days.push(d, d - 1); // an overnight shift from the day before may cover it
  }
  for (const day of days) {
    const open = state.opening(emp, day);
    if (!open) continue;
    const base = day * DAY;
    let sMin = open.lo;
    // Starts before the day's midnight; it may end after it.
    let sMax = Math.min(open.hi - m.minLength, base + DAY - m.grid);
    if (cover !== null) {
      sMin = Math.max(sMin, cover - m.maxLength + 1);
      sMax = Math.min(sMax, cover);
    }
    sMin = base + ceilTo(sMin - base, m.grid);
    const before = state.employeePenalty(emp);
    for (let s = sMin; s <= sMax; s += m.grid) {
      for (const len of m.lengths) {
        const e = s + len;
        if (e > open.hi) break;
        if (cover !== null && e <= cover) continue;
        const start = s - base;
        const end = e - base;
        const paid = m.paid(day, start, end);
        if (paid > open.capLeft) break;
        const type = m.classify(day, start, end);
        const delta =
          prefix[Math.ceil(e / SLOT_MINUTES)] - prefix[Math.ceil(s / SLOT_MINUTES)] +
          state.employeePenaltyAfterAdd(emp, day, paid, type) - before +
          state.shiftPenalty(emp, day, start, type);
        if (!best || delta < best.delta - EPS) best = { emp, day, start, end, delta };
      }
    }
  }
  return best;
}

// How many employees could ever work each slot (ignoring what's scheduled).
function eligibility(state: ScheduleState): Int16Array {
  const counts = new Int16Array(WEEK_SLOTS);
  for (const e of state.model.employees) {
    const seen = new Uint8Array(WEEK_SLOTS);
    e.windows.forEach((w, day) => {
      if (!w) return;
      for (let minute = w.lo; minute < w.hi; minute += SLOT_MINUTES) {
        const slot = Math.floor((day * DAY + minute) / SLOT_MINUTES);
        if (slot < WEEK_SLOTS && !seen[slot]) {
          seen[slot] = 1;
          counts[slot]++;
        }
      }
    });
  }
  return counts;
}

export function construct(state: ScheduleState, rng: Rng): void {
  const m = state.model;
  const order = rng.shuffle(m.employees.map((e) => e.index));
  const eligible = eligibility(state);
  const stuck = new Uint8Array(WEEK_SLOTS);
  let prefix = state.addGainPrefix();

  for (;;) {
    let slot = -1;
    let bestShort = 0;
    let bestEligible = Infinity;
    for (let k = 0; k < WEEK_SLOTS; k++) {
      if (stuck[k]) continue;
      const short = m.target[k] - state.cov[k];
      if (short <= 0) continue;
      if (short > bestShort || (short === bestShort && eligible[k] < bestEligible)) {
        slot = k;
        bestShort = short;
        bestEligible = eligible[k];
      }
    }
    if (slot < 0) return;
    if (eligible[slot] === 0) {
      stuck[slot] = 1;
      continue;
    }

    let best: Candidate | null = null;
    for (const emp of order) {
      const c = bestCandidate(state, emp, prefix, slot * SLOT_MINUTES);
      if (c && (!best || c.delta < best.delta - EPS)) best = c;
    }
    if (best && best.delta < -EPS) {
      state.add(state.makeShift(best.emp, best.day, best.start, best.end));
      prefix = state.addGainPrefix();
    } else {
      stuck[slot] = 1;
    }
  }
}

// Give anyone under their minimum hours the best shifts that still improve the
// score (for full-timers, that can mean going over budget).
export function fillMinimums(state: ScheduleState): void {
  const m = state.model;
  for (;;) {
    const short = m.employees
      .filter((e) => state.minutes[e.index] < e.minMinutes)
      .sort((a, b) => (b.minMinutes - state.minutes[b.index]) - (a.minMinutes - state.minutes[a.index]) || a.index - b.index);
    let progress = false;
    for (const e of short) {
      const c = bestCandidate(state, e.index, state.addGainPrefix(), null);
      if (c && c.delta < -EPS) {
        state.add(state.makeShift(c.emp, c.day, c.start, c.end));
        progress = true;
      }
    }
    if (!progress) return;
  }
}

// Drop any generated shift the schedule is better off without.
export function prune(state: ScheduleState): void {
  for (const s of [...state.generated].sort((a, b) => a.abs - b.abs || a.emp - b.emp)) {
    const delta = state.remove(s);
    if (delta >= -EPS) state.add(s);
  }
}

