import { describe, it, expect } from "vitest";
import { splitAckStatus, isAcknowledged } from "./schedule-ack";

const scheduled = [
  { employeeId: 1, employeeName: "Alex P" },
  { employeeId: 2, employeeName: "Jordan K" },
  { employeeId: 3, employeeName: "Sam B" },
];

describe("splitAckStatus", () => {
  it("partitions scheduled employees into confirmed and pending", () => {
    const s = splitAckStatus(scheduled, [{ employeeId: 2, acknowledgedAt: "2026-07-01T10:00:00Z" }]);
    expect(s.confirmed.map((c) => c.employeeId)).toEqual([2]);
    expect(s.pending.map((p) => p.employeeId)).toEqual([1, 3]);
    expect(s.confirmedCount).toBe(1);
    expect(s.pendingCount).toBe(2);
  });

  it("carries the acknowledgedAt timestamp on confirmed rows", () => {
    const s = splitAckStatus(scheduled, [{ employeeId: 1, acknowledgedAt: "2026-07-01T10:00:00Z" }]);
    expect(s.confirmed[0].acknowledgedAt).toBe("2026-07-01T10:00:00Z");
  });

  it("reports allConfirmed only when everyone scheduled has acknowledged", () => {
    const partial = splitAckStatus(scheduled, [{ employeeId: 1, acknowledgedAt: "t" }]);
    expect(partial.allConfirmed).toBe(false);

    const all = splitAckStatus(scheduled, scheduled.map((e) => ({ employeeId: e.employeeId, acknowledgedAt: "t" })));
    expect(all.allConfirmed).toBe(true);
  });

  it("is not allConfirmed when nobody is scheduled", () => {
    expect(splitAckStatus([], []).allConfirmed).toBe(false);
  });

  it("ignores acks from employees not scheduled this week", () => {
    const s = splitAckStatus(scheduled, [{ employeeId: 99, acknowledgedAt: "t" }]);
    expect(s.confirmedCount).toBe(0);
    expect(s.pendingCount).toBe(3);
  });

  it("dedupes employees scheduled for multiple shifts", () => {
    const dupes = [...scheduled, { employeeId: 1, employeeName: "Alex P" }];
    const s = splitAckStatus(dupes, []);
    expect(s.pendingCount).toBe(3);
  });

  it("sorts both lists by name", () => {
    const unsorted = [
      { employeeId: 3, employeeName: "Zara" },
      { employeeId: 1, employeeName: "Ana" },
    ];
    const s = splitAckStatus(unsorted, []);
    expect(s.pending.map((p) => p.employeeName)).toEqual(["Ana", "Zara"]);
  });
});

describe("isAcknowledged", () => {
  it("is true when the employee has an ack row", () => {
    expect(isAcknowledged(2, [{ employeeId: 2, acknowledgedAt: "t" }])).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isAcknowledged(5, [{ employeeId: 2, acknowledgedAt: "t" }])).toBe(false);
  });
});
