import { describe, it, expect } from "vitest";
import { checkEmployeeManualPunch } from "./manual-punch-rules";

const p = (punchType: string) => ({ punchType });

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
    expect(checkEmployeeManualPunch("break_end", p("break_start"), p("clock_in"))).toBeNull();
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
