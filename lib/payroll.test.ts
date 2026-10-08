import { describe, it, expect } from "vitest";
import { computePayroll, type PunchRow } from "./payroll";

let nextId = 1;
function row(employee_id: number, punch_type: string, punched_at: string, name = `Emp ${employee_id}`): PunchRow {
  return { id: nextId++, employee_id, punch_type, punched_at, employees: { name } };
}

describe("computePayroll — timezone", () => {
  it("buckets punches into days in the org's timezone", () => {
    // 01:00Z Jan 16 is still Jan 15 in Los Angeles but Jan 16 in New York.
    const rows = [row(1, "clock_in", "2026-01-15T20:00:00Z"), row(1, "clock_out", "2026-01-16T01:00:00Z")];
    expect(computePayroll(rows, "America/Los_Angeles")[0].weeks[0].days.map((d) => d.date)).toEqual(["2026-01-15"]);
    expect(computePayroll(rows, "Asia/Tokyo")[0].weeks[0].days.map((d) => d.date)).toEqual(["2026-01-16"]);
  });

  it("defaults to America/New_York", () => {
    const rows = [row(1, "clock_in", "2026-01-16T03:00:00Z"), row(1, "clock_out", "2026-01-16T04:30:00Z")];
    expect(computePayroll(rows)[0].weeks[0].days[0].date).toBe("2026-01-15");
  });
});

describe("computePayroll — DST", () => {
  it("pays 9 real hours for midnight–8 AM on the fall-back night", () => {
    const rows = [row(1, "clock_in", "2026-11-01T04:00:00Z"), row(1, "clock_out", "2026-11-01T13:00:00Z")];
    const day = computePayroll(rows, "America/New_York")[0].weeks[0].days[0];
    expect(day.date).toBe("2026-11-01");
    expect(day.workedHours).toBe(9);
  });

  it("pays 7 real hours for midnight–8 AM on the spring-forward night", () => {
    const rows = [row(1, "clock_in", "2026-03-08T05:00:00Z"), row(1, "clock_out", "2026-03-08T12:00:00Z")];
    expect(computePayroll(rows, "America/New_York")[0].weeks[0].days[0].workedHours).toBe(7);
  });

  it("counts the extra fall-back hour toward weekly overtime", () => {
    // Five 8h shifts Mon–Thu + the 9h fall-back Sunday shift in the same Mon-start week.
    const rows: PunchRow[] = [];
    for (const d of ["26", "27", "28", "29"]) {
      rows.push(row(1, "clock_in", `2026-10-${d}T13:00:00Z`), row(1, "clock_out", `2026-10-${d}T21:00:00Z`));
    }
    rows.push(row(1, "clock_in", "2026-10-30T13:00:00Z"), row(1, "clock_out", "2026-10-30T21:00:00Z"));
    rows.push(row(1, "clock_in", "2026-11-01T04:00:00Z"), row(1, "clock_out", "2026-11-01T13:00:00Z"));
    const week = computePayroll(rows, "America/New_York")[0].weeks[0];
    expect(week.totalWorkedHours).toBe(49);
    expect(week.overtimeHours).toBe(9);
  });
});

describe("computePayroll — shifts past midnight", () => {
  it("keeps a shift that ends after midnight whole, on the day it started", () => {
    const rows = [row(1, "clock_in", "2026-01-15T21:00:00Z"), row(1, "clock_out", "2026-01-16T05:30:00Z")]; // 16:00 → 00:30 EST
    const days = computePayroll(rows, "America/New_York")[0].weeks[0].days;
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-01-15");
    expect(days[0].workedHours).toBe(8.5);
    expect(days[0].hasIncomplete).toBe(false);
  });

  it("drops days outside the requested range (the query window is padded)", () => {
    const rows = [
      row(1, "clock_in", "2026-01-15T21:00:00Z"), row(1, "clock_out", "2026-01-16T05:30:00Z"),
      row(1, "clock_in", "2026-01-16T14:00:00Z"), row(1, "clock_out", "2026-01-16T22:00:00Z"),
      row(2, "clock_in", "2026-01-16T14:00:00Z"), row(2, "clock_out", "2026-01-16T22:00:00Z"),
    ];
    const result = computePayroll(rows, "America/New_York", { from: "2026-01-15", to: "2026-01-15" });
    expect(result).toHaveLength(1); // employee 2 has nothing in range
    expect(result[0].weeks[0].days.map((d) => d.date)).toEqual(["2026-01-15"]);
    expect(result[0].totalWorkedHours).toBe(8.5);
  });
});
