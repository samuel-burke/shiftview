// Paid and unpaid breaks in payroll (break types, migration 0065): an unpaid
// break is deducted, as every break was before; a paid one is worked time.
import { describe, it, expect } from "vitest";
import { computePayroll, type PunchRow } from "./payroll";

let nextId = 1;
function row(punch_type: string, punched_at: string, break_paid?: boolean): PunchRow {
  return { id: nextId++, employee_id: 1, punch_type, punched_at, employees: { name: "Ana" }, ...(break_paid === undefined ? {} : { break_paid }) };
}
const day = (rows: PunchRow[], tz = "America/New_York") => computePayroll(rows, tz)[0].weeks[0].days[0];

// Thu Jan 15 2026, EST (UTC-5): 9:00 AM is 14:00Z.
describe("computePayroll — break types", () => {
  it("still deducts a break with no paid flag (no types configured), exactly as before", () => {
    const d = day([
      row("clock_in", "2026-01-15T14:00:00Z"),
      row("break_start", "2026-01-15T17:00:00Z"),
      row("break_end", "2026-01-15T17:30:00Z"),
      row("clock_out", "2026-01-15T22:00:00Z"),
    ]);
    expect(d.workedHours).toBe(7.5);
    expect(d.breakHours).toBe(0.5);
    expect(d.hasIncomplete).toBe(false);
  });

  it("deducts an unpaid break and pays a paid one in the same shift", () => {
    // 9–5 with a paid 15-minute rest and an unpaid 30-minute meal.
    const d = day([
      row("clock_in", "2026-01-15T14:00:00Z"),
      row("break_start", "2026-01-15T16:00:00Z", true),
      row("break_end", "2026-01-15T16:15:00Z"),
      row("break_start", "2026-01-15T18:00:00Z", false),
      row("break_end", "2026-01-15T18:30:00Z"),
      row("clock_out", "2026-01-15T22:00:00Z"),
    ]);
    expect(d.workedHours).toBe(7.5);
    expect(d.breakHours).toBe(0.5); // only the deducted break
    expect(d.hasIncomplete).toBe(false);
  });

  it("pays a shift of only paid breaks in full", () => {
    const d = day([
      row("clock_in", "2026-01-15T14:00:00Z"),
      row("break_start", "2026-01-15T16:00:00Z", true),
      row("break_end", "2026-01-15T16:10:00Z"),
      row("break_start", "2026-01-15T19:00:00Z", true),
      row("break_end", "2026-01-15T19:10:00Z"),
      row("clock_out", "2026-01-15T22:00:00Z"),
    ]);
    expect(d.workedHours).toBe(8);
    expect(d.breakHours).toBe(0);
  });

  it("pays a paid break left open at clock-out up to the clock-out", () => {
    const d = day([
      row("clock_in", "2026-01-15T14:00:00Z"),
      row("break_start", "2026-01-15T21:50:00Z", true),
      row("clock_out", "2026-01-15T22:00:00Z"),
    ]);
    expect(d.workedHours).toBe(8);
    expect(d.breakHours).toBe(0);
  });

  it("flags a paid break with no clock-in before it, and doesn't pay it", () => {
    const d = day([
      row("break_start", "2026-01-15T16:00:00Z", true),
      row("break_end", "2026-01-15T16:15:00Z"),
      row("clock_out", "2026-01-15T22:00:00Z"),
    ]);
    expect(d.hasIncomplete).toBe(true);
    expect(d.workedHours).toBe(5.75); // from the break end, as before
  });

  it("counts paid breaks toward weekly overtime", () => {
    // Mon–Fri 9–5 with a paid 30-minute break each day: 40 paid hours, no OT;
    // with the breaks unpaid it would be 37.5.
    const rows: PunchRow[] = [];
    for (const d of ["12", "13", "14", "15", "16"]) {
      rows.push(row("clock_in", `2026-01-${d}T14:00:00Z`));
      rows.push(row("break_start", `2026-01-${d}T17:00:00Z`, true));
      rows.push(row("break_end", `2026-01-${d}T17:30:00Z`));
      rows.push(row("clock_out", `2026-01-${d}T22:00:00Z`));
    }
    rows.push(row("clock_in", "2026-01-17T14:00:00Z"));
    rows.push(row("clock_out", "2026-01-17T15:00:00Z"));
    const week = computePayroll(rows, "America/New_York")[0].weeks[0];
    expect(week.totalWorkedHours).toBe(41);
    expect(week.overtimeHours).toBe(1);
    expect(week.breakHours).toBe(0);
  });

  it("pays a paid break across the fall-back hour at its real length", () => {
    // Nov 1 2026, New York: 1:30 AM EDT (05:30Z) to 1:15 AM EST (06:15Z) is 45 real minutes.
    const d = day([
      row("clock_in", "2026-11-01T04:00:00Z"),          // midnight EDT
      row("break_start", "2026-11-01T05:30:00Z", true),
      row("break_end", "2026-11-01T06:15:00Z"),
      row("break_start", "2026-11-01T07:00:00Z", false),  // 2:00 AM EST
      row("break_end", "2026-11-01T07:30:00Z"),
      row("clock_out", "2026-11-01T09:00:00Z"),          // 4:00 AM EST
    ]);
    expect(d.date).toBe("2026-11-01");
    expect(d.workedHours).toBe(4.5); // 5 real hours less the unpaid 30 minutes
    expect(d.breakHours).toBe(0.5);
  });

  it("keeps a paid overnight break on the shift's own day", () => {
    // 10 PM – 6 AM in Kiritimati (UTC+14), paid break 11:45 PM – 12:15 AM.
    const d = day([
      row("clock_in", "2026-01-15T08:00:00Z"),
      row("break_start", "2026-01-15T09:45:00Z", true),
      row("break_end", "2026-01-15T10:15:00Z"),
      row("clock_out", "2026-01-15T16:00:00Z"),
    ], "Pacific/Kiritimati");
    expect(d.date).toBe("2026-01-15");
    expect(d.workedHours).toBe(8);
  });
});
