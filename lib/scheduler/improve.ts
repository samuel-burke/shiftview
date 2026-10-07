// Local search over the generated shifts: simulated annealing with small moves
// (stretch or trim a shift, slide it, hand it to someone else, swap two
// people's shifts, drop a shift, add one for a gap, move one to another day).
// Every move keeps all hard rules; the best schedule seen is kept.

import { SLOT_MINUTES } from "@/lib/coverage";
import { WEEK_DAYS, WEEK_SLOTS } from "./model";
import { bestCandidate } from "./construct";
import type { Rng } from "./rng";
import { EPS, type ScheduleState, type Shift } from "./state";

type Spec = { emp: number; day: number; start: number; end: number };
type Move = { delta: number; undo: () => void };

// Replace `removes` with `adds` when every added shift is allowed.
function replace(state: ScheduleState, removes: Shift[], adds: Spec[]): Move | null {
  const before = state.score;
  for (const s of removes) state.remove(s);
  const added: Shift[] = [];
  for (const a of adds) {
    if (!state.canPlace(a.emp, a.day, a.start, a.end)) {
      for (const s of added) state.remove(s);
      for (const s of removes) state.add(s);
      return null;
    }
    const s = state.makeShift(a.emp, a.day, a.start, a.end);
    state.add(s);
    added.push(s);
  }
  return {
    delta: state.score - before,
    undo: () => {
      for (const s of added) state.remove(s);
      for (const s of removes) state.add(s);
    },
  };
}

function resize(state: ScheduleState, rng: Rng): Move | null {
  const x = state.randomGenerated(rng);
  if (!x) return null;
  const g = state.model.grid;
  let { start, end } = x;
  switch (rng.int(6)) {
    case 0: start -= g; break;
    case 1: start += g; break;
    case 2: end -= g; break;
    case 3: end += g; break;
    case 4: start -= g; end -= g; break;
    default: start += g; end += g;
  }
  if (start < 0) return null;
  return replace(state, [x], [{ emp: x.emp, day: x.day, start, end }]);
}

function reassign(state: ScheduleState, rng: Rng): Move | null {
  const x = state.randomGenerated(rng);
  const n = state.model.employees.length;
  if (!x || n < 2) return null;
  let emp = rng.int(n - 1);
  if (emp >= x.emp) emp++;
  return replace(state, [x], [{ emp, day: x.day, start: x.start, end: x.end }]);
}

function swap(state: ScheduleState, rng: Rng): Move | null {
  const x = state.randomGenerated(rng);
  if (!x) return null;
  for (let tries = 0; tries < 6; tries++) {
    const y = state.randomGenerated(rng)!;
    if (y.emp === x.emp || y.day !== x.day) continue;
    return replace(state, [x, y], [
      { emp: y.emp, day: x.day, start: x.start, end: x.end },
      { emp: x.emp, day: y.day, start: y.start, end: y.end },
    ]);
  }
  return null;
}

function drop(state: ScheduleState, rng: Rng): Move | null {
  const x = state.randomGenerated(rng);
  return x ? replace(state, [x], []) : null;
}

function moveDay(state: ScheduleState, rng: Rng): Move | null {
  const x = state.randomGenerated(rng);
  if (!x) return null;
  let day = rng.int(WEEK_DAYS - 1);
  if (day >= x.day) day++;
  return replace(state, [x], [{ emp: x.emp, day, start: x.start, end: x.end }]);
}

function addForGap(state: ScheduleState, rng: Rng): Move | null {
  const m = state.model;
  if (m.employees.length === 0) return null;
  for (let tries = 0; tries < 8; tries++) {
    const slot = rng.int(WEEK_SLOTS);
    if (m.target[slot] <= state.cov[slot]) continue;
    const c = bestCandidate(state, rng.int(m.employees.length), state.addGainPrefix(), slot * SLOT_MINUTES);
    if (c) return replace(state, [], [c]);
  }
  return null;
}

// Returns true if it stopped at the deadline rather than the iteration budget.
export function improve(state: ScheduleState, rng: Rng, iterations: number, deadline: number): boolean {
  const START_TEMP = 25;
  const END_TEMP = 0.25;
  let bestScore = state.score;
  let best = state.snapshot();
  let timedOut = false;

  for (let it = 0; it < iterations; it++) {
    if ((it & 1023) === 0 && Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const temp = START_TEMP * Math.pow(END_TEMP / START_TEMP, it / iterations);
    const r = rng.next();
    const move =
      r < 0.3 ? resize(state, rng)
      : r < 0.45 ? reassign(state, rng)
      : r < 0.58 ? swap(state, rng)
      : r < 0.7 ? drop(state, rng)
      : r < 0.9 ? addForGap(state, rng)
      : moveDay(state, rng);
    if (!move) continue;
    if (move.delta <= EPS || rng.next() < Math.exp(-move.delta / temp)) {
      if (state.score < bestScore - EPS) {
        bestScore = state.score;
        best = state.snapshot();
      }
    } else {
      move.undo();
    }
  }

  state.restore(best);
  return timedOut;
}
