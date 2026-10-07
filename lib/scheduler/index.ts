// Auto-scheduler: builds a week of shifts that meets the coverage target as
// closely as the rules allow. A greedy construction fills the deepest gaps
// first, a seeded local search improves it, and the result explains whatever
// it couldn't cover. Pure and deterministic: the same input and seed always
// give the same schedule. See docs/AUTO_SCHEDULER.md.

import { buildModel } from "./model";
import { construct, fillMinimums, prune } from "./construct";
import { improve } from "./improve";
import { diagnose } from "./diagnose";
import { createRng } from "./rng";
import { ScheduleState } from "./state";
import type { ScheduleResult, SchedulerInput } from "./types";

export type * from "./types";
export { parseAdjustments } from "./adjustments";

const DEFAULT_TIME_LIMIT_MS = 3000;

function defaultIterations(employees: number): number {
  return Math.min(150_000, 20_000 + 2_500 * employees);
}

export function generateSchedule(input: SchedulerInput): ScheduleResult {
  const started = Date.now();
  const model = buildModel(input);
  const rng = createRng(input.seed);
  const state = new ScheduleState(model);

  construct(state, rng);
  fillMinimums(state);
  const timedOut = improve(
    state,
    rng,
    input.iterations ?? defaultIterations(model.employees.length),
    started + (input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS)
  );
  // The search can open gaps it then can't close by chance; close what's left.
  construct(state, rng);
  fillMinimums(state);
  prune(state);

  return diagnose(input, model, state, timedOut);
}
