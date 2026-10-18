import { describe, it, expect } from "vitest";
import { computePayroll, type EmployeePayroll } from "./payroll";
import { computePay, type CostPunch } from "./pay-cost";
import { makeRateLookup, RATE_BEGINNING, type PayRateRow } from "./pay-rates";
import { zonedTimeToUtc } from "./dates";
import {
  adpBatchId,
  adpCSV,
  dailyCSV,
  gustoCSV,
  hoursToHMM,
  money,
  qboCSV,
  quickbooksIIF,
  renderExport,
  splitName,
  summaryCSV,
  type ExportContext,
} from "./payroll-export";

const NY = "America/New_York";
let nextId = 1;
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(date, h * 60 + m, NY).toISOString();
};
type Row = CostPunch & { employees: { name: string } };
const shift = (emp: number, name: string, date: string, start: string, endDate: string, end: string, schedule: number | null = null): Row[] => [
  { id: nextId++, employee_id: emp, punch_type: "clock_in", punched_at: at(date, start), schedule_id: schedule, employees: { name } },
  { id: nextId++, employee_id: emp, punch_type: "clock_out", punched_at: at(endDate, end), schedule_id: null, employees: { name } },
];
const base = (employeeId: number, effectiveFrom: string, hourlyRate: number | null): PayRateRow =>
  ({ employeeId, positionId: null, effectiveFrom, hourlyRate });

function build(rows: Row[], rates: PayRateRow[], range = { from: "2026-06-08", to: "2026-06-14" }, extra: Partial<ExportContext> = {}) {
  const payroll = computePayroll(rows, NY, range);
  const pay = computePay(payroll, rows, makeRateLookup(rates), extra.positionNames ? new Map([[70, 3]]) : new Map(), NY);
  const ctx: ExportContext = {
    from: range.from,
    to: range.to,
    pay,
    payrollIds: new Map([[1, "1001"], [2, null]]),
    positionNames: new Map([[3, "Shift Lead"]]),
    adpCoCode: "abc",
    ...extra,
  };
  return { payroll, ctx };
}

// Ann Lee: 10h Mon–Fri at $20 (Fri all overtime). Bo: 4h Tuesday, no rate.
function standardWeek() {
  const rows = [
    ...["08", "09", "10", "11", "12"].flatMap((d) => shift(1, "Ann Lee", `2026-06-${d}`, "08:00", `2026-06-${d}`, "18:00")),
    ...shift(2, "Bo", "2026-06-09", "09:00", "2026-06-09", "13:00"),
  ];
  return build(rows, [base(1, RATE_BEGINNING, 20)]);
}

describe("helpers", () => {
  it("writes money as dollars and cents, blank when unknown", () => {
    expect(money(0)).toBe("0.00");
    expect(money(5)).toBe("0.05");
    expect(money(11911)).toBe("119.11");
    expect(money(123456789)).toBe("1234567.89");
    expect(money(-250)).toBe("-2.50");
    expect(money(null)).toBe("");
  });

  it("writes hours as H:MM to the nearest minute", () => {
    expect(hoursToHMM(8.5)).toBe("8:30");
    expect(hoursToHMM(0.25)).toBe("0:15");
    expect(hoursToHMM(8.72)).toBe("8:43"); // 523.2 min
    expect(hoursToHMM(10)).toBe("10:00");
    expect(hoursToHMM(0.99)).toBe("0:59");
    expect(hoursToHMM(0.995)).toBe("1:00");
  });

  it("splits names into first and last", () => {
    expect(splitName("Ann Marie Lee")).toEqual({ first: "Ann Marie", last: "Lee" });
    expect(splitName("Bo")).toEqual({ first: "Bo", last: "" });
    expect(splitName("  Cy   Dee ")).toEqual({ first: "Cy", last: "Dee" });
  });

  it("makes the ADP batch ID from the period end (YYMMDD)", () => {
    expect(adpBatchId("2026-06-14")).toBe("260614");
  });
});

describe("summary CSV", () => {
  it("has the payroll ID and dollars", () => {
    const { payroll, ctx } = standardWeek();
    expect(summaryCSV(payroll, ctx).split("\n")).toEqual([
      "Employee,Payroll ID,Week Of,Regular Hrs,OT Hrs,Break Hrs,Total Hrs,Incomplete,Regular Pay,OT Pay,Double Time Pay,Total Pay,Missing Rate",
      "Ann Lee,1001,2026-06-08,40.00,10.00,0.00,50.00,,800.00,300.00,0.00,1100.00,",
      "Bo,,2026-06-08,4.00,0.00,0.00,4.00,,,,,,Yes",
    ]);
  });

  it("totals several weeks", () => {
    const rows = [
      ...shift(1, "Ann Lee", "2026-06-12", "09:00", "2026-06-12", "17:00"),
      ...shift(1, "Ann Lee", "2026-06-15", "09:00", "2026-06-15", "17:00"),
    ];
    const { payroll, ctx } = build(rows, [base(1, RATE_BEGINNING, 15), base(1, "2026-06-15", 16.5)], { from: "2026-06-08", to: "2026-06-21" });
    expect(summaryCSV(payroll, ctx).split("\n").slice(1)).toEqual([
      "Ann Lee,1001,2026-06-08,8.00,0.00,0.00,8.00,,120.00,0.00,0.00,120.00,",
      "Ann Lee,1001,2026-06-15,8.00,0.00,0.00,8.00,,132.00,0.00,0.00,132.00,",
      "Ann Lee (total),1001,,16.00,0.00,0.00,16.00,,252.00,0.00,0.00,252.00,",
    ]);
  });
});

describe("daily CSV", () => {
  it("has payroll ID, position, rate and dollars per day", () => {
    const { payroll, ctx } = standardWeek();
    const lines = dailyCSV(payroll, ctx).split("\n");
    expect(lines[0]).toBe(
      "Employee,Payroll ID,Date,Day,Position,Hours Worked,Break Hours,Regular Hrs,OT Hrs,Double Time Hrs,Rate,Regular Pay,OT Pay,Double Time Pay,Total Pay,Incomplete"
    );
    expect(lines[1]).toBe("Ann Lee,1001,2026-06-08,Mon,,10.00,0.00,10.00,0.00,0.00,20.00,200.00,0.00,0.00,200.00,");
    expect(lines[5]).toBe("Ann Lee,1001,2026-06-12,Fri,,10.00,0.00,0.00,10.00,0.00,20.00,0.00,300.00,0.00,300.00,");
    expect(lines[6]).toBe("Bo,,2026-06-09,Tue,,4.00,0.00,4.00,0.00,0.00,,,,,,");
  });

  it("writes one row per rate when a raise starts mid-shift, break hours on the first", () => {
    const rows = [
      { id: nextId++, employee_id: 1, punch_type: "clock_in", punched_at: at("2026-06-09", "20:00"), schedule_id: 70, employees: { name: "Ann Lee" } },
      { id: nextId++, employee_id: 1, punch_type: "break_start", punched_at: at("2026-06-09", "22:00"), schedule_id: null, employees: { name: "Ann Lee" } },
      { id: nextId++, employee_id: 1, punch_type: "break_end", punched_at: at("2026-06-09", "22:30"), schedule_id: null, employees: { name: "Ann Lee" } },
      { id: nextId++, employee_id: 1, punch_type: "clock_out", punched_at: at("2026-06-10", "04:30"), schedule_id: null, employees: { name: "Ann Lee" } },
    ];
    const { payroll, ctx } = build(rows, [base(1, RATE_BEGINNING, 15), base(1, "2026-06-10", 20)], undefined, { positionNames: new Map([[3, "Shift Lead"]]) });
    expect(dailyCSV(payroll, ctx).split("\n").slice(1)).toEqual([
      "Ann Lee,1001,2026-06-09,Tue,Shift Lead,3.50,0.50,3.50,0.00,0.00,15.00,52.50,0.00,0.00,52.50,",
      "Ann Lee,1001,2026-06-09,Tue,Shift Lead,4.50,0.00,4.50,0.00,0.00,20.00,90.00,0.00,0.00,90.00,",
    ]);
  });

  it("defuses a formula in a name or payroll ID", () => {
    const rows = shift(1, "=cmd|' /C calc'!A0", "2026-06-09", "09:00", "2026-06-09", "17:00");
    const { payroll, ctx } = build(rows, [], undefined, { payrollIds: new Map([[1, "+1234"]]) });
    expect(dailyCSV(payroll, ctx).split("\n")[1].startsWith("'=cmd|' /C calc'!A0,'+1234,")).toBe(true);
  });
});

describe("Gusto preset", () => {
  it("has Gusto's hours-import columns, one row per employee per workweek", () => {
    const { payroll, ctx } = standardWeek();
    expect(gustoCSV(payroll, ctx).split("\n")).toEqual([
      "Employee ID,Last name,First name,Regular hours,Overtime hours,Double overtime hours,Workweeks",
      "1001,Lee,Ann,40.00,10.00,0.00,2026-06-08 - 2026-06-14",
      ",,Bo,4.00,0.00,0.00,2026-06-08 - 2026-06-14",
    ]);
  });

  it("clips the workweek to the pay period", () => {
    const rows = shift(1, "Ann Lee", "2026-06-11", "09:00", "2026-06-11", "17:00");
    const { payroll, ctx } = build(rows, [], { from: "2026-06-10", to: "2026-06-12" });
    expect(gustoCSV(payroll, ctx).split("\n")[1]).toBe("1001,Lee,Ann,8.00,0.00,0.00,2026-06-10 - 2026-06-12");
  });
});

describe("ADP Workforce Now preset", () => {
  it("starts with Co Code, Batch ID, File # and leaves Temp Rate to ADP", () => {
    const { payroll, ctx } = standardWeek();
    expect(adpCSV(payroll, ctx).split("\n")).toEqual([
      "Co Code,Batch ID,File #,Temp Dept,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount",
      "ABC,260614,1001,,,40.00,10.00,,",
      "ABC,260614,,,,4.00,0.00,,",
    ]);
  });

  it("puts hours at a position rate on their own row with that Temp Rate", () => {
    const rows = [
      ...shift(1, "Ann Lee", "2026-06-09", "09:00", "2026-06-09", "17:00", 70),
      ...shift(1, "Ann Lee", "2026-06-10", "09:00", "2026-06-10", "13:00"),
    ];
    const payroll = computePayroll(rows, NY, { from: "2026-06-08", to: "2026-06-14" });
    const rates = makeRateLookup([base(1, RATE_BEGINNING, 15), { employeeId: 1, positionId: 3, effectiveFrom: RATE_BEGINNING, hourlyRate: 22.5 }]);
    const pay = computePay(payroll, rows, rates, new Map([[70, 3]]), NY);
    const ctx: ExportContext = { from: "2026-06-08", to: "2026-06-14", pay, payrollIds: new Map([[1, "1001"]]), positionNames: new Map(), adpCoCode: "XYZ" };
    expect(adpCSV(payroll, ctx).split("\n").slice(1)).toEqual([
      "XYZ,260614,1001,,,4.00,0.00,,",
      "XYZ,260614,1001,,22.50,8.00,0.00,,",
    ]);
  });

  it("puts double time in Hours 3 with code D", () => {
    const payroll: EmployeePayroll[] = [{
      employeeId: 1, employeeName: "Ann Lee", totalRegularHours: 8, totalOvertimeHours: 4, totalBreakHours: 0, totalWorkedHours: 14,
      weeks: [{ weekStart: "2026-06-08", priorHours: 0, regularHours: 8, overtimeHours: 4, breakHours: 0, totalWorkedHours: 14, hasIncomplete: false,
        days: [{ date: "2026-06-09", dayName: "Tue", workedHours: 14, regularHours: 8, overtimeHours: 4, doubleTimeHours: 2, breakHours: 0, hasIncomplete: false } as never] }],
    }];
    const ctx: ExportContext = { from: "2026-06-08", to: "2026-06-14", pay: new Map(), payrollIds: new Map([[1, "7"]]), positionNames: new Map(), adpCoCode: "ABC" };
    expect(adpCSV(payroll, ctx).split("\n")[1]).toBe("ABC,260614,7,,,8.00,4.00,D,2.00");
  });

  it("names the file PR<co code>EPI.csv", () => {
    const { payroll, ctx } = standardWeek();
    expect(renderExport("adp", payroll, ctx).filename).toBe("PRABCEPI.csv");
  });
});

describe("QuickBooks Online preset", () => {
  it("has one time-activity row per day and pay type, duration H:MM, overtime rate 1.5×", () => {
    const { payroll, ctx } = standardWeek();
    const lines = qboCSV(payroll, ctx).split("\n");
    expect(lines[0]).toBe("Date,Employee,Service Item,Duration,Hourly Rate,Billable,Description");
    expect(lines[1]).toBe("06/08/2026,Ann Lee,Regular Time,10:00,20.00,No,");
    expect(lines[5]).toBe("06/12/2026,Ann Lee,Overtime,10:00,30.00,No,");
    expect(lines[6]).toBe("06/09/2026,Bo,Regular Time,4:00,,No,");
    expect(lines).toHaveLength(7);
  });

  it("names the position and flags incomplete punches in the description", () => {
    const rows: Row[] = [
      ...shift(1, "Ann Lee", "2026-06-09", "09:00", "2026-06-09", "17:15", 70),
      { id: nextId++, employee_id: 1, punch_type: "clock_in", punched_at: at("2026-06-09", "18:00"), schedule_id: null, employees: { name: "Ann Lee" } },
    ];
    const { payroll, ctx } = build(rows, [base(1, RATE_BEGINNING, 15)], undefined, { positionNames: new Map([[3, "Shift Lead"]]) });
    expect(qboCSV(payroll, ctx).split("\n")[1]).toBe("06/09/2026,Ann Lee,Regular Time,8:15,15.00,No,Shift Lead · Incomplete punch — verify hours");
  });
});

describe("QuickBooks Desktop IIF", () => {
  it("writes DURATION as H:MM (Intuit's timer-activity format), not decimal hours", () => {
    const { payroll } = standardWeek();
    const lines = quickbooksIIF(payroll).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "!TIMETYPE\tNAME",
      "TIMETYPE\tRegular Time",
      "TIMETYPE\tOvertime",
      "!TIMEACT\tDATE\tJOB\tEMP\tSERVICE\tDURATION\tNOTE\tBILLINGSTATUS\tPITEM\tCLASS",
    ]);
    expect(lines[4]).toBe("TIMEACT\t06/08/2026\t\tAnn Lee\tRegular Time\t10:00\t\t0\t\t");
    expect(lines[8]).toBe("TIMEACT\t06/12/2026\t\tAnn Lee\tOvertime\t10:00\t\t0\t\t");
    expect(lines.every((l) => !/\t\d+\.\d\d\t/.test(l))).toBe(true);
  });

  it("converts fractional hours to minutes (8.50 → 8:30)", () => {
    const rows = shift(1, "Ann Lee", "2026-06-09", "09:00", "2026-06-09", "17:30");
    const { payroll } = build(rows, []);
    expect(quickbooksIIF(payroll).split("\n").find((l) => l.startsWith("TIMEACT\t"))!.split("\t")[5]).toBe("8:30");
  });

  it("adds a Double Time type only when double time is exported", () => {
    const payroll: EmployeePayroll[] = [{
      employeeId: 1, employeeName: "Ann", totalRegularHours: 8, totalOvertimeHours: 4, totalBreakHours: 0, totalWorkedHours: 14,
      weeks: [{ weekStart: "2026-06-08", priorHours: 0, regularHours: 8, overtimeHours: 4, breakHours: 0, totalWorkedHours: 14, hasIncomplete: false,
        days: [{ date: "2026-06-09", dayName: "Tue", workedHours: 14, regularHours: 8, overtimeHours: 4, doubleTimeHours: 2, breakHours: 0, hasIncomplete: false } as never] }],
    }];
    const iif = quickbooksIIF(payroll).split("\n");
    expect(iif).toContain("TIMETYPE\tDouble Time");
    expect(iif).toContain("TIMEACT\t06/09/2026\t\tAnn\tDouble Time\t2:00\t\t0\t\t");
  });
});

describe("renderExport", () => {
  it("names and types each format", () => {
    const { payroll, ctx } = standardWeek();
    const meta = (f: Parameters<typeof renderExport>[0]) => {
      const r = renderExport(f, payroll, ctx);
      return [r.contentType, r.filename];
    };
    expect(meta("summary")).toEqual(["text/csv", "payroll_2026-06-08_to_2026-06-14.csv"]);
    expect(meta("daily")).toEqual(["text/csv", "payroll_daily_2026-06-08_to_2026-06-14.csv"]);
    expect(meta("detailed")).toEqual(["text/csv", "payroll_breakdown_2026-06-08_to_2026-06-14.csv"]);
    expect(meta("qb-iif")).toEqual(["text/plain", "payroll_2026-06-08_to_2026-06-14.iif"]);
    expect(meta("gusto")).toEqual(["text/csv", "gusto_hours_2026-06-08_to_2026-06-14.csv"]);
    expect(meta("qbo")).toEqual(["text/csv", "qbo_timesheets_2026-06-08_to_2026-06-14.csv"]);
  });

  it("writes headers only for an empty period", () => {
    const ctx: ExportContext = { from: "2026-06-08", to: "2026-06-14", pay: new Map(), payrollIds: new Map(), positionNames: new Map(), adpCoCode: "ABC" };
    for (const f of ["summary", "daily", "gusto", "adp", "qbo"] as const)
      expect(renderExport(f, [], ctx).content.split("\n")).toHaveLength(1);
  });
});
