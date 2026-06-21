import { describe, it, expect } from "vitest";
import { classifyArrival, summarizePunctuality } from "./punctuality";

describe("classifyArrival", () => {
  const start = 540; // 9:00 AM
  const grace = 6;

  it("is on_time when arriving before or within grace", () => {
    expect(classifyArrival(start, 535, grace)).toBe("on_time");
    expect(classifyArrival(start, 540, grace)).toBe("on_time");
    expect(classifyArrival(start, 546, grace)).toBe("on_time"); // exactly grace
  });

  it("is late when past the grace window", () => {
    expect(classifyArrival(start, 547, grace)).toBe("late");
  });

  it("is absent when there is no clock-in", () => {
    expect(classifyArrival(start, null, grace)).toBe("absent");
  });
});

describe("summarizePunctuality", () => {
  it("counts statuses and computes an on-time rate among those who showed", () => {
    const s = summarizePunctuality([
      { status: "on_time" }, { status: "on_time" }, { status: "late" }, { status: "absent" },
    ]);
    expect(s).toEqual({ total: 4, onTime: 2, late: 1, absent: 1, onTimeRate: 67 });
  });

  it("is 0% on-time when nobody showed", () => {
    expect(summarizePunctuality([{ status: "absent" }])).toEqual({
      total: 1, onTime: 0, late: 0, absent: 1, onTimeRate: 0,
    });
  });

  it("handles an empty list", () => {
    expect(summarizePunctuality([])).toEqual({ total: 0, onTime: 0, late: 0, absent: 0, onTimeRate: 0 });
  });
});
