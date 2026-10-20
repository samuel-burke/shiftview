import { describe, it, expect } from "vitest";
import { computePayroll, payrollQueryWindow, type EmployeePayroll, type PunchRow } from "./payroll";
import { addDaysToKey, zonedTimeToUtc } from "./dates";

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

// ── Regression tests from the timekeeping audit (2026-10) ────────────────────

// What the payroll routes read for a range: the rows payrollQueryWindow covers.
function queried(all: PunchRow[], from: string, to: string, tz: string): PunchRow[] {
  const { start, end } = payrollQueryWindow(from, to, tz);
  return all.filter((p) => p.punched_at >= start && p.punched_at <= end);
}

function report(all: PunchRow[], from: string, to: string, tz = "America/New_York") {
  return computePayroll(queried(all, from, to, tz), tz, { from, to });
}

const worked = (r: EmployeePayroll[]) => r.reduce((s, e) => s + e.totalWorkedHours, 0);
const overtime = (r: EmployeePayroll[]) => r.reduce((s, e) => s + e.totalOvertimeHours, 0);

describe("payrollQueryWindow", () => {
  it("starts the day before the first day's workweek and ends the day after `to`", () => {
    // Wed Jun 10 2026 → its workweek starts Mon Jun 8; pad to Sun Jun 7.
    const w = payrollQueryWindow("2026-06-10", "2026-06-24", "America/New_York");
    expect(w.start).toBe("2026-06-07T04:00:00.000Z");
    expect(w.end).toBe("2026-06-26T03:59:59.999Z");
  });

  it("uses local midnight across a DST change", () => {
    // Mon Nov 2 2026; the padding day Sun Nov 1 is the 25-hour fall-back day.
    const w = payrollQueryWindow("2026-11-02", "2026-11-08", "America/New_York");
    expect(w.start).toBe("2026-11-01T04:00:00.000Z"); // still EDT at midnight
    expect(w.end).toBe("2026-11-10T04:59:59.999Z");
  });
});

describe("computePayroll — pay-period boundaries", () => {
  // Sun Jan 18 18:00 → Mon Jan 19 02:00 EST, break 23:30–00:30: 7h worked,
  // 5.5h on Sunday and 1.5h after the Monday workweek starts.
  const overnight = () => [
    row(1, "clock_in", "2026-01-18T23:00:00Z"),
    row(1, "break_start", "2026-01-19T04:30:00Z"),
    row(1, "break_end", "2026-01-19T05:30:00Z"),
    row(1, "clock_out", "2026-01-19T07:00:00Z"),
  ];

  it("pays a shift that crosses into the next workweek once, each hour in the week it was worked", () => {
    const all = overnight();
    const week1 = report(all, "2026-01-12", "2026-01-18");
    const week2 = report(all, "2026-01-19", "2026-01-25");
    // Before the audit fix the post-break 1.5h were paid twice; until the
    // workweek split they were all paid in week 1.
    expect(worked(week1)).toBe(5.5);
    expect(worked(week2)).toBe(1.5);
    expect(week2[0].weeks[0].days.map((d) => [d.date, d.workedHours])).toEqual([["2026-01-19", 1.5]]);
  });

  it("never pays an hour twice, wherever a range is split", () => {
    const all = overnight();
    for (const [a, b] of [["2026-01-17", "2026-01-18"], ["2026-01-19", "2026-01-20"]] as const) {
      expect(worked(report(all, "2026-01-12", a)) + worked(report(all, b, "2026-01-31"))).toBe(7);
    }
  });

  it("keeps overtime when a period ends mid-workweek (semi-monthly payroll)", () => {
    // Mon–Fri Jun 8–12 2026, 10h a day: 50h in one workweek, 10h overtime.
    const all: PunchRow[] = [];
    for (const d of ["08", "09", "10", "11", "12"]) {
      all.push(row(1, "clock_in", `2026-06-${d}T13:00:00Z`), row(1, "clock_out", `2026-06-${d}T23:00:00Z`));
    }
    const first = report(all, "2026-06-01", "2026-06-10"); // Mon–Wed: 30h
    const second = report(all, "2026-06-11", "2026-06-15"); // Thu–Fri: 20h
    expect(overtime(first)).toBe(0);
    // Before the fix this was 0: Thu–Fri were measured without Mon–Wed.
    expect(overtime(second)).toBe(10);
    expect(second[0].weeks[0].priorHours).toBe(30);
    expect(second[0].weeks[0].regularHours).toBe(10);
    expect(second[0].weeks[0].totalWorkedHours).toBe(20);
    expect(second[0].weeks[0].days.map((d) => [d.date, d.regularHours, d.overtimeHours])).toEqual([
      ["2026-06-11", 10, 0],
      ["2026-06-12", 0, 10],
    ]);
  });

  it("reports only in-range days of a workweek the range starts in", () => {
    const all = [
      row(1, "clock_in", "2026-06-08T13:00:00Z"), row(1, "clock_out", "2026-06-08T21:00:00Z"),
      row(1, "clock_in", "2026-06-11T13:00:00Z"), row(1, "clock_out", "2026-06-11T21:00:00Z"),
    ];
    const r = report(all, "2026-06-10", "2026-06-16");
    expect(r[0].weeks[0].days.map((d) => d.date)).toEqual(["2026-06-11"]);
    expect(r[0].totalWorkedHours).toBe(8);
  });

  it("leaves out an employee whose only hours are before the range", () => {
    const all = [row(1, "clock_in", "2026-06-08T13:00:00Z"), row(1, "clock_out", "2026-06-08T21:00:00Z")];
    expect(report(all, "2026-06-10", "2026-06-16")).toEqual([]);
  });

  it("splits overtime by day in the order it was worked", () => {
    const all: PunchRow[] = [];
    for (const d of ["08", "09", "10", "11"]) {
      all.push(row(1, "clock_in", `2026-06-${d}T12:00:00Z`), row(1, "clock_out", `2026-06-${d}T23:00:00Z`)); // 11h
    }
    const days = report(all, "2026-06-08", "2026-06-14")[0].weeks[0].days;
    expect(days.map((d) => [d.regularHours, d.overtimeHours])).toEqual([[11, 0], [11, 0], [11, 0], [7, 4]]);
  });

  it("counts a DST-lengthened shift toward overtime in a range that starts mid-week", () => {
    // Workweek Mon Oct 26–Sun Nov 1 2026. 8h Mon–Thu (32h), then the 9h
    // fall-back night Sun Nov 1: 41h, 1h overtime — reported in a range from Fri.
    const all: PunchRow[] = [];
    for (const d of ["26", "27", "28", "29"]) {
      all.push(row(1, "clock_in", `2026-10-${d}T13:00:00Z`), row(1, "clock_out", `2026-10-${d}T21:00:00Z`));
    }
    all.push(row(1, "clock_in", "2026-11-01T04:00:00Z"), row(1, "clock_out", "2026-11-01T13:00:00Z"));
    const r = report(all, "2026-10-30", "2026-11-05");
    expect(r[0].weeks[0].priorHours).toBe(32);
    expect(r[0].totalWorkedHours).toBe(9);
    expect(r[0].totalOvertimeHours).toBe(1);
  });
});

describe("computePayroll — punches that don't pair up", () => {
  it("flags a doubled clock-in and pays from the first one", () => {
    const rows = [
      row(1, "clock_in", "2026-06-08T13:00:00Z"),
      row(1, "clock_in", "2026-06-08T17:00:00Z"),
      row(1, "clock_out", "2026-06-08T21:00:00Z"),
    ];
    const day = computePayroll(rows, "America/New_York")[0].weeks[0].days[0];
    // Before the fix: 4h and no flag, so 4 worked hours vanished silently.
    expect(day.workedHours).toBe(8);
    expect(day.hasIncomplete).toBe(true);
  });

  it.each([
    ["a clock-out with no clock-in", ["clock_out"]],
    ["a break end with no break start", ["clock_in", "break_end", "clock_out"]],
    ["a break start with no clock-in", ["break_start", "break_end", "clock_out"]],
    ["a clock-in during a break", ["clock_in", "break_start", "clock_in", "clock_out"]],
    ["two break starts", ["clock_in", "break_start", "break_start", "break_end", "clock_out"]],
  ])("flags %s for review", (_label, types) => {
    const rows = types.map((t, i) => row(1, t, new Date(Date.UTC(2026, 5, 8, 13 + i)).toISOString()));
    expect(computePayroll(rows, "America/New_York")[0].weeks[0].days[0].hasIncomplete).toBe(true);
  });

  it("does not flag a normal day with breaks", () => {
    const types = ["clock_in", "break_start", "break_end", "break_start", "break_end", "clock_out"];
    const rows = types.map((t, i) => row(1, t, new Date(Date.UTC(2026, 5, 8, 13 + i)).toISOString()));
    const day = computePayroll(rows, "America/New_York")[0].weeks[0].days[0];
    expect(day.hasIncomplete).toBe(false);
    expect(day.workedHours).toBe(3);
    expect(day.breakHours).toBe(2);
  });

  it("orders punches stamped the same instant by id", () => {
    const at = "2026-06-08T17:00:00Z";
    const a = row(1, "clock_in", "2026-06-08T13:00:00Z");
    const out = row(1, "break_start", at);
    const back = row(1, "break_end", at);
    const end = row(1, "clock_out", "2026-06-08T21:00:00Z");
    const day = computePayroll([end, back, out, a], "America/New_York")[0].weeks[0].days[0];
    expect(day.hasIncomplete).toBe(false);
    expect(day.workedHours).toBe(8);
  });
});

describe("computePayroll — rounding", () => {
  it("sums exact time and rounds once, so seconds over 40h still reach overtime", () => {
    // Five days of 8h 0m 17s: 40h 1m 25s. Rounding each day to 8.00 used to
    // report 40.00 and no overtime.
    const rows: PunchRow[] = [];
    for (const d of ["08", "09", "10", "11", "12"]) {
      rows.push(row(1, "clock_in", `2026-06-${d}T13:00:00Z`), row(1, "clock_out", `2026-06-${d}T21:00:17Z`));
    }
    const emp = computePayroll(rows, "America/New_York")[0];
    expect(emp.totalWorkedHours).toBe(40.02);
    expect(emp.totalOvertimeHours).toBe(0.02);
    expect(emp.totalRegularHours).toBe(40);
  });

  it("keeps regular + overtime equal to total on every day and week", () => {
    // Day lengths whose two-decimal sum is exactly 40 but whose floating-point
    // running sum is 40.00000000000001 — which once produced a 0.00 OT line.
    const lengths = [8.72, 6.78, 8.46, 9.41, 6.63];
    const rows: PunchRow[] = [];
    lengths.forEach((h, i) => {
      const start = Date.UTC(2026, 5, 8 + i, 12);
      rows.push(row(1, "clock_in", new Date(start).toISOString()));
      rows.push(row(1, "clock_out", new Date(start + Math.round(h * 3_600_000)).toISOString()));
    });
    const week = computePayroll(rows, "America/New_York")[0].weeks[0];
    expect(week.totalWorkedHours).toBe(40);
    expect(week.overtimeHours).toBe(0);
    for (const d of week.days) {
      expect(d.overtimeHours).toBe(0);
      expect(Math.round((d.regularHours + d.overtimeHours) * 100) / 100).toBe(d.workedHours);
    }
  });
});

// Deterministic pseudo-random shifts, so the property tests below are repeatable.
function prng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

function randomPunches(rand: () => number, tz: string, firstDay: string, days: number): PunchRow[] {
  const rows: PunchRow[] = [];
  let lastEnd = 0;
  for (let i = 0; i < days; i++) {
    if (rand() < 0.25) continue; // a day off
    const date = addDaysToKey(firstDay, i);
    const startMin = Math.floor(rand() * 20 * 60); // any start, incl. late nights
    const lengthMin = 4 * 60 + Math.floor(rand() * 9 * 60); // 4–13h, may cross midnight
    const start = zonedTimeToUtc(date, startMin, tz).getTime();
    if (start < lastEnd + 3_600_000) continue; // shifts never overlap
    lastEnd = start + lengthMin * 60_000 + 60_000;
    const end = start + lengthMin * 60_000;
    rows.push(row(1, "clock_in", new Date(start).toISOString()));
    if (rand() < 0.5) {
      const bStart = start + Math.floor(lengthMin / 2) * 60_000;
      rows.push(row(1, "break_start", new Date(bStart).toISOString()));
      rows.push(row(1, "break_end", new Date(bStart + 30 * 60_000).toISOString()));
    }
    rows.push(row(1, "clock_out", new Date(end + 1_000 * Math.floor(rand() * 59)).toISOString()));
  }
  return rows;
}

describe("computePayroll — consecutive periods add up to the whole", () => {
  // Spans both 2026 US DST changes and a southern-hemisphere one.
  const cases: [string, string][] = [
    ["America/New_York", "2026-02-23"],
    ["America/New_York", "2026-10-12"],
    ["America/Los_Angeles", "2026-03-02"],
    ["Australia/Sydney", "2026-03-23"],
    ["Asia/Kolkata", "2026-06-01"],
    ["UTC", "2026-01-05"],
  ];

  it.each(cases)("%s from %s: any split pays the same hours and overtime", (tz, firstDay) => {
    const rand = prng(firstDay.length * 97 + tz.length);
    const all = randomPunches(rand, tz, firstDay, 42);
    const lastDay = addDaysToKey(firstDay, 41);
    const whole = report(all, firstDay, lastDay, tz);
    for (let k = 0; k < 12; k++) {
      const split = addDaysToKey(firstDay, 1 + Math.floor(rand() * 40));
      const a = report(all, firstDay, addDaysToKey(split, -1), tz);
      const b = report(all, split, lastDay, tz);
      // Each period rounds its own totals once; allow a cent of an hour each.
      expect(Math.abs(worked(a) + worked(b) - worked(whole))).toBeLessThanOrEqual(0.02);
      expect(Math.abs(overtime(a) + overtime(b) - overtime(whole))).toBeLessThanOrEqual(0.02);
    }
  });

  it.each(cases)("%s from %s: regular + overtime = total, and nothing is flagged", (tz, firstDay) => {
    const all = randomPunches(prng(7), tz, firstDay, 42);
    for (const emp of report(all, firstDay, addDaysToKey(firstDay, 41), tz)) {
      expect(Math.round((emp.totalRegularHours + emp.totalOvertimeHours) * 100) / 100).toBe(emp.totalWorkedHours);
      for (const w of emp.weeks) {
        expect(w.regularHours).toBeLessThanOrEqual(40);
        expect(w.hasIncomplete).toBe(false);
      }
    }
  });
});
