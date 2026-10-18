import { describe, it, expect } from "vitest";
import { checkEmployeeManualPunch } from "./manual-punch-rules";

const p = (punchType: string) => ({ punchType });
const at = (punchType: string, punchedAt: string) => ({ punchType, punchedAt });

// Store-local times in New York (UTC-4 in October).
const TZ = "America/New_York";
const MON_18 = "2026-10-12T22:00:00Z";
const MON_22 = "2026-10-13T02:00:00Z";
const MON_23 = "2026-10-13T03:00:00Z";
const TUE_09 = "2026-10-13T13:00:00Z";

describe("checkEmployeeManualPunch", () => {
  it("allows adding a missed clock-out after the last punch", () => {
    expect(checkEmployeeManualPunch("clock_out", p("clock_in"), null)).toBeNull();
    expect(checkEmployeeManualPunch("break_end", p("break_start"), null)).toBeNull();
    expect(checkEmployeeManualPunch("clock_in", null, null)).toBeNull();
    expect(checkEmployeeManualPunch("clock_in", p("clock_out"), null)).toBeNull();
  });

  it("rejects punches that aren't a valid next step", () => {
    expect(checkEmployeeManualPunch("clock_out", null, null)).toMatch(/first punch/);
    expect(checkEmployeeManualPunch("clock_in", p("clock_in"), null)).not.toBeNull();
    expect(checkEmployeeManualPunch("break_end", p("clock_in"), null)).not.toBeNull();
    expect(checkEmployeeManualPunch("clock_out", p("break_start"), null)).not.toBeNull();
  });

  it("allows closing yesterday's open shift after already clocking in today", () => {
    // prev = yesterday's clock-in, next = today's clock-in.
    expect(checkEmployeeManualPunch("clock_out", p("clock_in"), p("clock_in"))).toBeNull();
    expect(checkEmployeeManualPunch("clock_out", p("break_end"), p("clock_in"))).toBeNull();
  });

  it("rejects an inserted punch that leaves the old shift open before the next clock-in", () => {
    // clock_in → break_start → clock_in would be a broken sequence.
    expect(checkEmployeeManualPunch("break_start", p("clock_in"), p("clock_in"))).not.toBeNull();
    // Without times there's no telling the break end is from an earlier day.
    expect(checkEmployeeManualPunch("break_end", p("break_start"), p("clock_in"))).not.toBeNull();
    // Even with times, a break start never closes the old shift.
    expect(checkEmployeeManualPunch(
      "break_start", at("clock_in", MON_18), at("clock_in", TUE_09), MON_22, TZ,
    )).not.toBeNull();
  });

  it("allows a forgotten break end from an earlier store day ahead of the next clock-in", () => {
    // So the clock-out can then be filed between it and Tuesday's clock-in.
    expect(checkEmployeeManualPunch(
      "break_end", at("break_start", MON_18), at("clock_in", TUE_09), MON_22, TZ,
    )).toBeNull();
    // Same store day: the clock-in can't follow an open break end.
    expect(checkEmployeeManualPunch(
      "break_end", at("break_start", MON_18), at("clock_in", MON_23), MON_22, TZ,
    )).not.toBeNull();
  });

  it("allows a missed clock-in after an earlier store day's forgotten clock-out", () => {
    // Monday's shift was never closed; Tuesday's clock-in was missed.
    expect(checkEmployeeManualPunch("clock_in", at("clock_in", MON_18), null, TUE_09, TZ)).toBeNull();
    expect(checkEmployeeManualPunch("clock_in", at("break_start", MON_18), null, TUE_09, TZ)).toBeNull();
    // Monday 18:00 and Monday 22:00 New York are both Monday — still a conflict.
    expect(checkEmployeeManualPunch("clock_in", at("clock_in", MON_18), null, MON_22, TZ)).not.toBeNull();
    // 23:00 and 01:00 UTC on different UTC days are the same New York day.
    expect(checkEmployeeManualPunch(
      "clock_in", at("clock_in", "2026-10-12T23:00:00Z"), null, "2026-10-13T01:00:00Z", TZ,
    )).not.toBeNull();
    // Without the store timezone we can't tell, so it stays blocked.
    expect(checkEmployeeManualPunch("clock_in", at("clock_in", MON_18), null, TUE_09)).not.toBeNull();
  });

  it("blocks backdating a clock-in ahead of a real, late one", () => {
    // Yesterday ended with a clock-out; today's real clock-in was late.
    expect(checkEmployeeManualPunch("clock_in", p("clock_out"), p("clock_in"))).not.toBeNull();
    expect(checkEmployeeManualPunch("clock_in", null, p("clock_in"))).not.toBeNull();
  });

  it("blocks inserting punches into the middle of a recorded shift", () => {
    expect(checkEmployeeManualPunch("clock_out", p("clock_in"), p("clock_out"))).not.toBeNull();
    expect(checkEmployeeManualPunch("break_start", p("clock_in"), p("break_start"))).not.toBeNull();
  });
});
