import { describe, it, expect } from "vitest";
import { computePayroll, type EmployeePayroll } from "./payroll";
import { computePay, priceDay, splitAtMidnights, sumLines, workedIntervals, type CostPunch } from "./pay-cost";
import { makeRateLookup, RATE_BEGINNING, type PayRateRow } from "./pay-rates";
import { zonedTimeToUtc } from "./dates";

const NY = "America/New_York";
let nextId = 1;
type Row = CostPunch & { employees: { name: string } };
const p = (punch_type: string, at: string, opts: { emp?: number; schedule?: number | null } = {}): Row => ({
  id: nextId++,
  employee_id: opts.emp ?? 1,
  punch_type,
  punched_at: at,
  schedule_id: opts.schedule ?? null,
  employees: { name: `Emp ${opts.emp ?? 1}` },
});
// A store-local wall time in New York as an ISO instant.
const at = (date: string, hhmm: string, tz = NY) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(date, h * 60 + m, tz).toISOString();
};
const shift = (date: string, start: string, endDate: string, end: string, opts: { emp?: number; schedule?: number | null; tz?: string } = {}) => [
  p("clock_in", at(date, start, opts.tz), opts),
  p("clock_out", at(endDate, end, opts.tz), { emp: opts.emp }),
];
const base = (effectiveFrom: string, hourlyRate: number | null, employeeId = 1): PayRateRow =>
  ({ employeeId, positionId: null, effectiveFrom, hourlyRate });

function price(rows: Row[], rates: PayRateRow[], range: { from: string; to: string }, opts: { tz?: string; positions?: Map<number, number | null> } = {}) {
  const tz = opts.tz ?? NY;
  const payroll = computePayroll(rows, tz, range);
  const pay = computePay(payroll, rows, makeRateLookup(rates), opts.positions ?? new Map(), tz);
  return { payroll, pay, emp: (id = 1) => pay.get(id)! };
}

describe("computePay — rate changes", () => {
  it("prices each day of a week at the rate in effect that day (raise on Wednesday)", () => {
    const rows = ["08", "09", "10", "11", "12"].flatMap((d) => shift(`2026-06-${d}`, "09:00", `2026-06-${d}`, "17:00"));
    const { emp } = price(rows, [base(RATE_BEGINNING, 15), base("2026-06-10", 20)], { from: "2026-06-08", to: "2026-06-14" });
    const days = emp().days;
    expect(days.get("2026-06-09")!.totalCents).toBe(12000); // 8 × 15
    expect(days.get("2026-06-10")!.totalCents).toBe(16000); // 8 × 20
    expect(days.get("2026-06-10")!.lines).toMatchObject([{ rate: 20, regularHours: 8 }]);
    expect(emp().totalCents).toBe(2 * 12000 + 3 * 16000);
  });

  it("splits a shift that crosses midnight into a raise: old rate before midnight, new after", () => {
    // Tue 8 PM → Wed 4 AM, raise effective Wed. The shift is Tuesday's (payroll
    // keeps it on the day it started), but its hours after midnight are Wednesday's.
    const rows = shift("2026-06-09", "20:00", "2026-06-10", "04:00");
    const { emp, payroll } = price(rows, [base(RATE_BEGINNING, 15), base("2026-06-10", 20)], { from: "2026-06-08", to: "2026-06-14" });
    expect(payroll[0].weeks[0].days.map((d) => d.date)).toEqual(["2026-06-09"]);
    const day = emp().days.get("2026-06-09")!;
    expect(day.lines).toMatchObject([
      { rate: 15, regularHours: 4, regularCents: 6000 },
      { rate: 20, regularHours: 4, regularCents: 8000 },
    ]);
    expect(day.totalCents).toBe(14000);
  });

  it("uses the old rate for all of a shift that ends exactly at the raise's midnight", () => {
    const rows = shift("2026-06-09", "16:00", "2026-06-10", "00:00");
    const { emp } = price(rows, [base(RATE_BEGINNING, 15), base("2026-06-10", 20)], { from: "2026-06-08", to: "2026-06-14" });
    expect(emp().days.get("2026-06-09")!.lines).toMatchObject([{ rate: 15, regularHours: 8 }]);
  });

  it("prices overtime at 1.5× the rate in effect on the overtime day", () => {
    // 10h Mon–Fri: Fri is all overtime, and the raise lands on Friday.
    const rows = ["08", "09", "10", "11", "12"].flatMap((d) => shift(`2026-06-${d}`, "08:00", `2026-06-${d}`, "18:00"));
    const { emp } = price(rows, [base(RATE_BEGINNING, 20), base("2026-06-12", 30)], { from: "2026-06-08", to: "2026-06-14" });
    expect(emp().days.get("2026-06-12")!.lines).toMatchObject([{ rate: 30, regularHours: 0, overtimeHours: 10, overtimeCents: 45000 }]);
    expect(emp().regularCents).toBe(80000);
    expect(emp().overtimeCents).toBe(45000);
    expect(emp().totalCents).toBe(125000);
  });

  it("puts a day's overtime on its last hours, across a midnight rate change", () => {
    // Mon–Wed 12h (36h), then Thu 8 PM → Fri 4 AM. Thu's first 4h take the
    // week to 40 (regular, old rate); its last 4h, after midnight, are overtime
    // at the new rate.
    const rows = [
      ...["08", "09", "10"].flatMap((d) => shift(`2026-06-${d}`, "06:00", `2026-06-${d}`, "18:00")),
      ...shift("2026-06-11", "20:00", "2026-06-12", "04:00"),
    ];
    const { emp } = price(rows, [base(RATE_BEGINNING, 10), base("2026-06-12", 20)], { from: "2026-06-08", to: "2026-06-14" });
    const thu = emp().days.get("2026-06-11")!;
    expect(thu.lines).toMatchObject([
      { rate: 10, regularHours: 4, overtimeHours: 0, totalCents: 4000 },
      { rate: 20, regularHours: 0, overtimeHours: 4, overtimeCents: 12000 },
    ]);
  });

  it("counts hours before a mid-week range toward overtime, at their own rate", () => {
    const rows = ["08", "09", "10", "11", "12"].flatMap((d) => shift(`2026-06-${d}`, "08:00", `2026-06-${d}`, "18:00"));
    const { emp } = price(rows, [base(RATE_BEGINNING, 20)], { from: "2026-06-11", to: "2026-06-14" });
    expect([...emp().days.keys()]).toEqual(["2026-06-11", "2026-06-12"]);
    expect(emp().totalCents).toBe(10 * 2000 + 10 * 3000);
  });

  it("reports hours with no rate as missing, never as $0", () => {
    const rows = shift("2026-06-09", "09:00", "2026-06-09", "17:00");
    const { emp } = price(rows, [], { from: "2026-06-08", to: "2026-06-14" });
    const day = emp().days.get("2026-06-09")!;
    expect(day.missingRate).toBe(true);
    expect(day.lines).toMatchObject([{ rate: null, regularHours: 8, regularCents: null, totalCents: null }]);
    expect(emp().missingRate).toBe(true);
  });

  it("prices only the rated part when a rate starts mid-shift", () => {
    const rows = shift("2026-06-09", "20:00", "2026-06-10", "04:00");
    const { emp } = price(rows, [base("2026-06-10", 20)], { from: "2026-06-08", to: "2026-06-14" });
    const day = emp().days.get("2026-06-09")!;
    expect(day.missingRate).toBe(true);
    expect(day.totalCents).toBe(8000);
  });

  it("returns nothing for no punches", () => {
    expect(price([], [base(RATE_BEGINNING, 15)], { from: "2026-06-08", to: "2026-06-14" }).pay.size).toBe(0);
  });
});

describe("computePay — position rates", () => {
  const rates: PayRateRow[] = [
    base(RATE_BEGINNING, 15),
    { employeeId: 1, positionId: 3, effectiveFrom: "2026-06-01", hourlyRate: 25 },
  ];
  const positions = new Map<number, number | null>([[70, 3], [71, null], [72, 4]]);

  it("pays a shift in a position with its own rate at that rate", () => {
    const rows = shift("2026-06-09", "09:00", "2026-06-09", "17:00", { schedule: 70 });
    const { emp } = price(rows, rates, { from: "2026-06-08", to: "2026-06-14" }, { positions });
    expect(emp().days.get("2026-06-09")!.lines).toMatchObject([{ positionId: 3, positionRate: true, rate: 25, totalCents: 20000 }]);
  });

  it("pays the base rate for a shift with no position, another position, or no schedule", () => {
    for (const schedule of [71, 72, null]) {
      const rows = shift("2026-06-09", "09:00", "2026-06-09", "17:00", { schedule });
      const { emp } = price(rows, rates, { from: "2026-06-08", to: "2026-06-14" }, { positions });
      expect(emp().days.get("2026-06-09")!.lines[0]).toMatchObject({ positionRate: false, rate: 15, totalCents: 12000 });
    }
  });

  it("keeps the position after a break (the break punches carry no schedule)", () => {
    const rows = [
      p("clock_in", at("2026-06-09", "09:00"), { schedule: 70 }),
      p("break_start", at("2026-06-09", "12:00")),
      p("break_end", at("2026-06-09", "12:30")),
      p("clock_out", at("2026-06-09", "17:30")),
    ];
    const { emp } = price(rows, rates, { from: "2026-06-08", to: "2026-06-14" }, { positions });
    expect(emp().days.get("2026-06-09")!.lines).toMatchObject([{ rate: 25, regularHours: 8, totalCents: 20000 }]);
  });

  it("prices a split day's two shifts in their own positions", () => {
    const rows = [
      ...shift("2026-06-09", "08:00", "2026-06-09", "12:00", { schedule: 70 }),
      ...shift("2026-06-09", "16:00", "2026-06-09", "20:00", { schedule: 71 }),
    ];
    const { emp } = price(rows, rates, { from: "2026-06-08", to: "2026-06-14" }, { positions });
    expect(emp().days.get("2026-06-09")!.lines).toMatchObject([
      { positionId: 3, rate: 25, regularHours: 4, totalCents: 10000 },
      { positionId: null, rate: 15, regularHours: 4, totalCents: 6000 },
    ]);
  });

  it("uses the base rate before the position rate's date", () => {
    const rows = shift("2026-05-29", "09:00", "2026-05-29", "17:00", { schedule: 70 });
    const { emp } = price(rows, rates, { from: "2026-05-25", to: "2026-05-31" }, { positions });
    expect(emp().days.get("2026-05-29")!.lines[0]).toMatchObject({ rate: 15, positionRate: false, positionId: 3 });
  });
});

describe("computePay — DST and timezones", () => {
  it("prices the 9-hour fall-back night across a raise at midnight (2h old, 7h new)", () => {
    // Sat Oct 31 10 PM → Sun Nov 1 6 AM (EST): 2h before midnight, 7 real hours after.
    const rows = shift("2026-10-31", "22:00", "2026-11-01", "06:00");
    const { emp, payroll } = price(rows, [base(RATE_BEGINNING, 10), base("2026-11-01", 20)], { from: "2026-10-26", to: "2026-11-01" });
    expect(payroll[0].totalWorkedHours).toBe(9);
    expect(emp().days.get("2026-10-31")!.lines).toMatchObject([
      { rate: 10, regularHours: 2, totalCents: 2000 },
      { rate: 20, regularHours: 7, totalCents: 14000 },
    ]);
  });

  it("prices the 7-hour spring-forward night", () => {
    const rows = shift("2026-03-08", "00:00", "2026-03-08", "08:00");
    const { emp } = price(rows, [base(RATE_BEGINNING, 10)], { from: "2026-03-02", to: "2026-03-08" });
    expect(emp().totalCents).toBe(7000);
  });

  it("finds midnight in the store's timezone, not the server's", () => {
    // 9 PM → 3 AM in Kiritimati (UTC+14), raise on the second day.
    const tz = "Pacific/Kiritimati";
    const rows = shift("2026-06-09", "21:00", "2026-06-10", "03:00", { tz });
    const { emp } = price(rows, [base(RATE_BEGINNING, 10), base("2026-06-10", 20)], { from: "2026-06-08", to: "2026-06-14" }, { tz });
    expect(emp().days.get("2026-06-09")!.lines).toMatchObject([
      { rate: 10, regularHours: 3 },
      { rate: 20, regularHours: 3 },
    ]);
  });

  it("splits at a half-hour-offset zone's midnight (St John's)", () => {
    const tz = "America/St_Johns";
    const pieces = splitAtMidnights(
      { start: Date.parse(at("2026-06-09", "23:00", tz)), end: Date.parse(at("2026-06-10", "01:30", tz)), scheduleId: null },
      tz,
    );
    expect(pieces.map((x) => [x.day, (x.end - x.start) / 60_000])).toEqual([["2026-06-09", 60], ["2026-06-10", 90]]);
  });
});

describe("computePay — rounding", () => {
  it("rounds each line to the cent and totals the rounded lines", () => {
    // 7h 46m 12s = 7.77h at $15.33 → $119.11 (119.1141).
    const start = Date.parse(at("2026-06-09", "09:00"));
    const rows = [p("clock_in", new Date(start).toISOString()), p("clock_out", new Date(start + (7 * 3600 + 46 * 60 + 12) * 1000).toISOString())];
    const { emp } = price(rows, [base(RATE_BEGINNING, 15.33)], { from: "2026-06-08", to: "2026-06-14" });
    expect(emp().days.get("2026-06-09")!.lines[0]).toMatchObject({ regularHours: 7.77, regularCents: 11911 });
    expect(emp().totalCents).toBe(11911);
  });

  it("makes two rate lines add up to the day's reported hours", () => {
    // 20:00 → 00:20 + 00:00 → 04:41 hours split unevenly at midnight.
    const rows = [p("clock_in", at("2026-06-09", "20:07")), p("clock_out", at("2026-06-10", "04:41"))];
    const { emp, payroll } = price(rows, [base(RATE_BEGINNING, 10), base("2026-06-10", 11)], { from: "2026-06-08", to: "2026-06-14" });
    const day = payroll[0].weeks[0].days[0];
    const lines = emp().days.get("2026-06-09")!.lines;
    const sum = lines.reduce((s, l) => s + Math.round(l.regularHours * 100), 0);
    expect(sum).toBe(Math.round(day.regularHours * 100));
  });
});

describe("workedIntervals — pairs punches as computePayroll does", () => {
  const cases: Record<string, Row[]> = {
    "a plain shift": shift("2026-06-09", "09:00", "2026-06-09", "17:00"),
    "a doubled clock-in (keeps the first)": [
      p("clock_in", at("2026-06-09", "09:00")), p("clock_in", at("2026-06-09", "13:00")), p("clock_out", at("2026-06-09", "17:00")),
    ],
    "a break end with no start": [
      p("clock_in", at("2026-06-09", "09:00")), p("break_end", at("2026-06-09", "12:00")), p("clock_out", at("2026-06-09", "17:00")),
    ],
    "a clock-in during a break": [
      p("clock_in", at("2026-06-09", "09:00")), p("break_start", at("2026-06-09", "12:00")),
      p("clock_in", at("2026-06-09", "12:45")), p("clock_out", at("2026-06-09", "17:00")),
    ],
    "an open shift": [p("clock_in", at("2026-06-09", "09:00"))],
    "a clock-out with no clock-in": [p("clock_out", at("2026-06-09", "09:00"))],
  };
  for (const [name, rows] of Object.entries(cases)) {
    it(`matches the worked hours for ${name}`, () => {
      const payroll = computePayroll(rows, NY, { from: "2026-06-08", to: "2026-06-14" });
      const worked = payroll[0]?.totalWorkedHours ?? 0;
      const ms = workedIntervals(rows).reduce((s, i) => s + i.end - i.start, 0);
      expect(Math.round(ms / 36_000) / 100).toBe(worked);
    });
  }
});

describe("priceDay — double time (when the hours output has it)", () => {
  it("prices double time at 2×, on the last hours of the day", () => {
    const start = Date.parse(at("2026-06-09", "06:00"));
    const pieces = [{ start, end: start + 14 * 3_600_000, scheduleId: null, day: "2026-06-09" }];
    const day = { date: "2026-06-09", regularHours: 8, overtimeHours: 4, doubleTimeHours: 2 };
    const dp = priceDay(1, day, pieces, makeRateLookup([base(RATE_BEGINNING, 20)]), () => null);
    expect(dp.lines).toMatchObject([{ regularCents: 16000, overtimeCents: 12000, doubleTimeHours: 2, doubleTimeCents: 8000, totalCents: 36000 }]);
  });

  it("puts the double time at the new rate when a raise starts mid-shift", () => {
    // 6 PM → 8 AM (14h): 6h before midnight at $10, 8h after at $20. The last
    // 2h (double time) and the 4h before them (overtime) are all after midnight.
    const start = Date.parse(at("2026-06-09", "18:00"));
    const mid = Date.parse(at("2026-06-10", "00:00"));
    const pieces = [
      { start, end: mid, scheduleId: null, day: "2026-06-09" },
      { start: mid, end: mid + 8 * 3_600_000, scheduleId: null, day: "2026-06-10" },
    ];
    const day = { date: "2026-06-09", regularHours: 8, overtimeHours: 4, doubleTimeHours: 2 };
    const dp = priceDay(1, day, pieces, makeRateLookup([base(RATE_BEGINNING, 10), base("2026-06-10", 20)]), () => null);
    expect(dp.lines).toMatchObject([
      { rate: 10, regularHours: 6, overtimeHours: 0, doubleTimeHours: 0 },
      { rate: 20, regularHours: 2, overtimeHours: 4, doubleTimeHours: 2, doubleTimeCents: 8000 },
    ]);
    expect(sumLines([dp])).toMatchObject({ regularCents: 6000 + 4000, overtimeCents: 12000, doubleTimeCents: 8000 });
  });

  it("works without doubleTimeHours (today's hours output)", () => {
    const start = Date.parse(at("2026-06-09", "09:00"));
    const pieces = [{ start, end: start + 8 * 3_600_000, scheduleId: null, day: "2026-06-09" }];
    const dp = priceDay(1, { date: "2026-06-09", regularHours: 8, overtimeHours: 0 }, pieces, makeRateLookup([base(RATE_BEGINNING, 10)]), () => null);
    expect(dp.lines).toMatchObject([{ doubleTimeHours: 0, doubleTimeCents: 0, totalCents: 8000 }]);
  });
});

describe("computePay — several employees", () => {
  it("keeps each employee's rates and punches apart", () => {
    const rows = [
      ...shift("2026-06-09", "09:00", "2026-06-09", "17:00", { emp: 1 }),
      ...shift("2026-06-09", "09:00", "2026-06-09", "13:00", { emp: 2 }),
    ];
    const { pay } = price(rows, [base(RATE_BEGINNING, 15, 1), base(RATE_BEGINNING, 30, 2)], { from: "2026-06-08", to: "2026-06-14" });
    expect(pay.get(1)!.totalCents).toBe(12000);
    expect(pay.get(2)!.totalCents).toBe(12000);
  });

  it("returns a pay entry for each employee computePayroll returned", () => {
    const rows = shift("2026-06-09", "09:00", "2026-06-09", "17:00", { emp: 5 });
    const payroll: EmployeePayroll[] = computePayroll(rows, NY, { from: "2026-06-08", to: "2026-06-14" });
    const pay = computePay(payroll, rows, makeRateLookup([]), new Map(), NY);
    expect([...pay.keys()]).toEqual([5]);
  });
});
