import { describe, it, expect } from "vitest";
import { generateSchedule } from "./index";
import { demoInput, hardRuleViolations, largeInput } from "./__tests__/helpers";
import type { SchedulerInput } from "./types";

function summarize(label: string, inp: SchedulerInput) {
  const started = Date.now();
  const result = generateSchedule(inp);
  const ms = Date.now() - started;
  const m = result.metrics;
  process.stdout.write(
    `${label}: ${ms} ms · coverage ${m.coverageScore}% · ${m.generatedShifts} shifts · ` +
      `${m.scheduledHours}/${m.budgetHours} h · short ${m.shortfallHours} h · over ${m.overstaffHours} h · ` +
      `OT ${m.overtimeHours} h · prefs ${m.preferenceScore}% · gaps ${result.gaps.length} · $${m.laborCost}\n`
  );
  return { result, ms };
}

// Prints quality and speed for representative rosters: BENCH=1 npx vitest run lib/scheduler/benchmark.test.ts
describe.skipIf(!process.env.BENCH)("scheduler benchmark", () => {
  it("demo roster", () => {
    for (const seed of [1, 2, 3]) summarize(`demo seed ${seed}`, demoInput(seed));
  });

  it("50-person roster", () => {
    for (const seed of [1, 2]) {
      const { result } = summarize(`large seed ${seed}`, largeInput(seed));
      expect(hardRuleViolations(largeInput(seed), result)).toEqual([]);
    }
  }, 60_000);
});
