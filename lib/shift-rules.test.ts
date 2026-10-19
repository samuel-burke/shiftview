import { describe, it, expect } from "vitest";
import { checkShiftRules, type RuleShift } from "./shift-rules";
import { DEFAULT_SCHEDULING_RULES, type EmployeeLimits } from "./scheduling-rules";

// 2026-10-17 is a Saturday; the store week starts Saturday (6).
const SAT = "2026-10-17";
const day = (offset: number) => {
  const d = new Date(`${SAT}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const shift = (offset: number, start = 540, end = 1020, id?: number): RuleShift => ({ id, date: day(offset), startMinutes: start, endMinutes: end });
const LIMITS: EmployeeLimits = { type: "full_time", typeSet: true, minMinutes: 0, maxMinutes: 40 * 60, maxDays: 5 };

function check(s: RuleShift, others: RuleShift[], limits: Partial<EmployeeLimits> = {}, rules = {}) {
  return checkShiftRules({
    shift: s,
    others,
    rules: { ...DEFAULT_SCHEDULING_RULES, ...rules },
    limits: { ...LIMITS, ...limits },
    firstDayOfWeek: 6,
  });
}
const kinds = (w: ReturnType<typeof check>) => w.map((x) => x.rule);

describe("checkShiftRules", () => {
  it("passes an ordinary shift", () => {
    expect(check(shift(2), [shift(0), shift(1)])).toEqual([]);
  });

  it("warns about short rest after a closing shift (a clopen)", () => {
    // Close at 11 PM, open at 6 AM the next day: 7h rest, rules ask for 10h.
    const w = check(shift(1, 360, 840), [shift(0, 960, 1380)]);
    expect(kinds(w)).toEqual(["rest"]);
    expect(w[0]).toMatchObject({ restMinutes: 420 });
    expect(w[0].message).toMatch(/Only 7h rest after the shift ending .* \(your rules ask for 10h\)/);
  });

  it("warns about short rest before the next shift", () => {
    const w = check(shift(0, 960, 1380), [shift(1, 360, 840)]);
    expect(kinds(w)).toEqual(["rest"]);
    expect(w[0].message).toMatch(/rest before the shift starting/);
  });

  it("measures rest across an overnight shift", () => {
    // 10 PM – 6 AM overnight, then a 2 PM shift the next day: 8h rest.
    const w = check(shift(1, 840, 1200), [shift(0, 1320, 1800)]);
    expect(w.find((x) => x.rule === "rest")).toMatchObject({ restMinutes: 480 });
  });

  it("ignores rest when the rule is off", () => {
    expect(check(shift(1, 360, 840), [shift(0, 960, 1380)], {}, { minRestMinutes: 0 })).toEqual([]);
  });

  it("ignores the shift being edited among the others", () => {
    // Editing shift 7 on day 1: its old copy must not count as a clash with itself.
    expect(check(shift(1, 600, 1080, 7), [shift(1, 540, 1020, 7)])).toEqual([]);
  });

  it("counts consecutive days across week boundaries", () => {
    const others = [-3, -2, -1, 1, 2, 3].map((o) => shift(o));
    const w = check(shift(0), others, { maxDays: 7, maxMinutes: 80 * 60 });
    expect(w.find((x) => x.rule === "consecutive_days")).toMatchObject({ days: 7 });
  });

  it("warns past the person's days per week, within the store week only", () => {
    const others = [0, 1, 2, 3, 4].map((o) => shift(o, 540, 780)); // Sat–Wed, 4h each
    const w = check(shift(5, 540, 780), others);
    expect(w.find((x) => x.rule === "days_per_week")).toMatchObject({ days: 6 });
    // The day before the week started doesn't count toward this week.
    expect(kinds(check(shift(4, 540, 780), [-1, 0, 1, 2].map((o) => shift(o, 540, 780))))).not.toContain("days_per_week");
  });

  it("warns past a personal maximum below 40 hours", () => {
    const w = check(shift(3, 540, 1020), [shift(0), shift(1), shift(2)], { maxMinutes: 29 * 60, maxDays: 7 });
    expect(w.find((x) => x.rule === "max_hours")).toMatchObject({ minutes: 32 * 60 });
    expect(kinds(w)).not.toContain("overtime");
  });

  it("gives one overtime warning, not two, when the maximum is 40 hours", () => {
    const others = [0, 1, 2, 3, 4].map((o) => shift(o)); // 5 × 8h = 40h
    const w = check(shift(5, 540, 780), others, { maxDays: 7 });
    expect(kinds(w)).toEqual(["overtime"]);
    expect(w[0]).toMatchObject({ minutes: 240 });
    expect(w[0].message).toMatch(/4h of overtime \(44h this week\)/);
  });

  it("does not count shifts from other weeks toward hours", () => {
    const lastWeek = [-5, -4, -3, -2, -1].map((o) => shift(o));
    expect(check(shift(0), lastWeek, { maxDays: 7 }).map((w) => w.rule)).not.toContain("overtime");
  });
});
