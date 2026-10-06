import { describe, it, expect } from "vitest";
import { generateSchedule } from "./index";
import { hardRuleViolations, randomScenario } from "./__tests__/helpers";

// A hundred random rosters, rule sets and weeks (some across DST changes,
// some 24-hour): whatever the engine produces, no hard rule may be broken.
describe("generateSchedule never breaks a hard rule", () => {
  const SCENARIOS = 100;

  it(`holds across ${SCENARIOS} random scenarios`, () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SCENARIOS; seed++) {
      const scenario = randomScenario(seed);
      const result = generateSchedule(scenario);
      const problems = hardRuleViolations(scenario, result);
      if (problems.length) failures.push(`scenario ${seed}: ${problems.slice(0, 3).join("; ")}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it("is deterministic for a seed", () => {
    for (const seed of [3, 17, 42]) {
      const a = generateSchedule(randomScenario(seed));
      const b = generateSchedule(randomScenario(seed));
      expect(b).toEqual(a);
    }
  });
});
