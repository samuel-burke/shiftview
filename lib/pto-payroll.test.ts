import { describe, it, expect } from "vitest";
import { computePayroll, type PunchRow } from "./payroll";
import { withPaidLeave } from "./pto-payroll";

const NY = "America/New_York";
let nextId = 1;
const p = (punch_type: string, punched_at: string, employee_id = 1, name = "Ann"): PunchRow =>
  ({ id: nextId++, employee_id, punch_type, punched_at, employees: { name } });

// 10h a day Mon–Thu, Oct 5–8 2026 (EDT): 40h.
function fortyHours(): PunchRow[] {
  return ["05", "06", "07", "08"].flatMap((d) => [
    p("clock_in", `2026-10-${d}T13:00:00.000Z`),
    p("clock_out", `2026-10-${d}T23:00:00.000Z`),
  ]);
}

describe("withPaidLeave", () => {
  it("adds PTO beside worked hours and never turns it into overtime", () => {
    const worked = computePayroll(fortyHours(), NY, { from: "2026-10-05", to: "2026-10-11" });
    const [ann] = withPaidLeave(worked, [{ employeeId: 1, date: "2026-10-09", leaveType: "pto", hours: 8 }]);
    const week = ann.weeks[0];
    expect(week.totalWorkedHours).toBe(40);
    expect(week.overtimeHours).toBe(0);
    expect(week.regularHours).toBe(40);
    expect(week.ptoHours).toBe(8);
    expect(week.sickHours).toBe(0);
    expect(ann.totalPtoHours).toBe(8);
    const fri = week.days.find((d) => d.date === "2026-10-09")!;
    expect(fri).toMatchObject({ dayName: "Fri", workedHours: 0, ptoHours: 8, overtimeHours: 0 });
    // Days stay in order.
    expect(week.days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("puts paid leave on a day that was also worked", () => {
    const worked = computePayroll(fortyHours(), NY, { from: "2026-10-05", to: "2026-10-11" });
    const [ann] = withPaidLeave(worked, [{ employeeId: 1, date: "2026-10-05", leaveType: "sick", hours: 2 }]);
    expect(ann.weeks[0].days[0]).toMatchObject({ date: "2026-10-05", workedHours: 10, sickHours: 2, ptoHours: 0 });
    expect(ann.weeks[0].days).toHaveLength(4);
  });

  it("adds an employee who only has paid leave, by name", () => {
    const worked = computePayroll(fortyHours(), NY, { from: "2026-10-05", to: "2026-10-11" });
    const out = withPaidLeave(worked, [{ employeeId: 2, date: "2026-10-07", leaveType: "pto", hours: 7.5 }], { 2: "Bob" });
    expect(out.map((e) => e.employeeName)).toEqual(["Ann", "Bob"]);
    const bob = out[1];
    expect(bob).toMatchObject({ totalWorkedHours: 0, totalPtoHours: 7.5, totalOvertimeHours: 0 });
    expect(bob.weeks).toHaveLength(1);
    expect(bob.weeks[0]).toMatchObject({ weekStart: "2026-10-05", ptoHours: 7.5, totalWorkedHours: 0 });
  });

  it("adds a week that only has paid leave", () => {
    const worked = computePayroll(fortyHours(), NY, { from: "2026-10-05", to: "2026-10-18" });
    const [ann] = withPaidLeave(worked, [{ employeeId: 1, date: "2026-10-14", leaveType: "pto", hours: 8 }]);
    expect(ann.weeks.map((w) => [w.weekStart, w.ptoHours])).toEqual([["2026-10-05", 0], ["2026-10-12", 8]]);
  });

  it("a leave day across DST keeps its hours as approved", () => {
    const [bob] = withPaidLeave([], [{ employeeId: 2, date: "2026-11-01", leaveType: "pto", hours: 9 }], { 2: "Bob" });
    expect(bob.weeks[0].weekStart).toBe("2026-10-26");
    expect(bob.weeks[0].days[0]).toMatchObject({ date: "2026-11-01", dayName: "Sun", ptoHours: 9 });
  });

  it("with no leave, changes nothing but adds zero columns", () => {
    const worked = computePayroll(fortyHours(), NY, { from: "2026-10-05", to: "2026-10-11" });
    const [ann] = withPaidLeave(worked, []);
    expect(ann.weeks[0]).toMatchObject({ ...worked[0].weeks[0], days: expect.any(Array), ptoHours: 0, sickHours: 0 });
    expect(ann.totalPtoHours).toBe(0);
  });

  it("an unknown name falls back to the id", () => {
    const [x] = withPaidLeave([], [{ employeeId: 7, date: "2026-10-07", leaveType: "sick", hours: 8 }]);
    expect(x.employeeName).toBe("Employee 7");
  });
});
