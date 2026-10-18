// Payroll export files: shiftview's own CSVs, the QuickBooks Desktop IIF, and
// presets laid out for Gusto, ADP Workforce Now and QuickBooks Online imports.
// Hours are computePayroll's (lib/payroll.ts); dollars are computePay's
// (lib/pay-cost.ts), at the rate in effect when the hours were worked.
//
// Each preset follows the provider's published import layout. Providers let
// you map columns on import and change their templates, so try one import
// before relying on a preset.
//
// Gusto (hours import CSV): Run payroll → Import payroll data → "Download the
//   CSV template". Hours are decimals in Regular hours / Overtime hours /
//   Double overtime columns; an optional "workweeks" column gives each row's
//   week so Gusto can work out the regular rate of pay for overtime; a zero
//   overwrites an entry and a blank leaves it. One row per employee per
//   workweek, matched on Gusto's employee ID (payroll ID) and name. Gusto
//   pays from its own rates, so no dollars are sent.
//   https://support.gusto.com/article/999914471000000/Run-payroll-with-Smart-Import
//   https://support.gusto.com/article/999754831000000/run-a-regular-payroll-for-admins
//   https://support.gusto.com/payroll/payroll-settings/CSV-Upload/999913061/Upload-employees-hours-and-earnings-to-payroll.htm
//
// ADP Workforce Now (paydata / timecard import CSV, "EPI" style): the company
//   code must be the first column, the batch ID second and the file number
//   (payroll ID) third; then Temp Dept, Temp Rate, Reg Hours, O/T Hours and
//   Hours 3 Code / Hours 3 Amount for other earnings. Batch ID is a 6-digit
//   value (the period end date, YYMMDD, here). Temp Rate is left blank so ADP
//   pays its own rate, except for hours at a position rate, which go on their
//   own row with that rate. Double time goes in Hours 3 with code "D"
//   (configure the earnings code in ADP). The file name ADP expects is
//   PR<co code>EPI.csv.
//   https://apps.adp.com/en-US/apps/372723/automated-paydata-integration-for-adp-workforce-now/features
//   https://support.timeips.com/index.php?module=headsup&func=display&articleid=249
//   https://kb.7shifts.com/hc/en-us/articles/4417520074387-ADP-Workforce-Now-US-Payroll-Export
//
// QuickBooks Online (timesheet / time activity CSV, Settings → Import data →
//   Time activities): one entry per row: date, employee (display name, must
//   match QuickBooks exactly), service item, duration as hh:mm or decimal,
//   hourly rate, billable, description. Duration here is H:MM.
//   https://quickbooks.intuit.com/learn-support/en-au/time-tracking/how-to-import-employee-timesheets/01/966816
//   https://tprosupport.rightworks.com/kb/article/439-import-time-activities-into-quickbooks-online/
//   https://support.saasant.com/support/solutions/articles/14000053204-how-to-import-time-activities-into-quickbooks-online-u-s-/
//
// QuickBooks Desktop IIF (Timer Activity import): TIMEACT DURATION is the
//   length in hours and minutes, HH:MM (audit decision 6: it used to be
//   decimal hours, "8.50", which QuickBooks reads differently). Written as
//   H:MM, e.g. 8:30.
//   https://wavsys.pacifictimesheet.com/timesheet/help/system_system_qbiif.html
//   https://support.zed-systems.com/kb/a312/import-quickbooks-pro-timer-activities-into-quickbooks.aspx
//   https://github.com/br3tt/qimport

import { csvRow } from "@/lib/csv";
import { addDaysToKey } from "@/lib/dates";
import type { EmployeePayroll } from "@/lib/payroll";
import type { DayPay, EmployeePay, PayLine } from "@/lib/pay-cost";

export const EXPORT_FORMATS = ["summary", "daily", "detailed", "qb-iif", "gusto", "adp", "qbo"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportContext = {
  from: string;
  to: string;
  pay: Map<number, EmployeePay>;
  payrollIds: Map<number, string | null>;
  positionNames: Map<number, string>;
  // ADP company code (3 characters), for the ADP preset.
  adpCoCode?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Cents as dollars with two decimals; blank when unknown (no rate).
export function money(cents: number | null | undefined): string {
  if (cents == null) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function rateText(rate: number | null | undefined): string {
  return rate == null ? "" : rate.toFixed(2);
}

// Decimal hours (two places) as H:MM, to the nearest minute.
export function hoursToHMM(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// IIF is tab-separated, one record per line: a tab or line break inside a
// value would split the record.
export function iifField(v: string): string {
  return v.replace(/[\t\r\n]+/g, " ");
}

// MM/DD/YYYY
export function mmddyyyy(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

// "Ann Marie Lee" → { first: "Ann Marie", last: "Lee" }; one word is a first name.
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function dayOf(ctx: ExportContext, employeeId: number, date: string): DayPay | undefined {
  return ctx.pay.get(employeeId)?.days.get(date);
}

function positionName(ctx: ExportContext, line: PayLine): string {
  return line.positionId == null ? "" : ctx.positionNames.get(line.positionId) ?? "";
}

function weekPay(ctx: ExportContext, emp: EmployeePayroll, week: EmployeePayroll["weeks"][number]) {
  let regular = 0, overtime = 0, double = 0, missing = false;
  for (const day of week.days) {
    const d = dayOf(ctx, emp.employeeId, day.date);
    if (!d) continue;
    missing ||= d.missingRate;
    for (const l of d.lines) {
      regular += l.regularCents ?? 0;
      overtime += l.overtimeCents ?? 0;
      double += l.doubleTimeCents ?? 0;
    }
  }
  return { regular, overtime, double, total: regular + overtime + double, missing };
}

// Double-time hours, when the hours output has them (daily overtime rules);
// zero otherwise.
const doubleOf = (x: object): number => (x as { doubleTimeHours?: number }).doubleTimeHours ?? 0;

// ─── shiftview CSVs ──────────────────────────────────────────────────────────

// One row per employee per workweek, with a total row for several weeks.
// Pay columns are blank when none of the hours has a rate, and "Missing Rate"
// says when some of them don't.
export function summaryCSV(rows: EmployeePayroll[], ctx: ExportContext): string {
  const lines = [csvRow([
    "Employee", "Payroll ID", "Week Of", "Regular Hrs", "OT Hrs", "Break Hrs", "Total Hrs", "Incomplete",
    "Regular Pay", "OT Pay", "Double Time Pay", "Total Pay", "Missing Rate",
  ])];
  for (const emp of rows) {
    const pid = ctx.payrollIds.get(emp.employeeId) ?? "";
    let empTotal = { regular: 0, overtime: 0, double: 0, total: 0, missing: false };
    const anyRated = (w: ReturnType<typeof weekPay>, days: number) => !(w.missing && w.total === 0 && days > 0);
    for (const week of emp.weeks) {
      const w = weekPay(ctx, emp, week);
      empTotal = {
        regular: empTotal.regular + w.regular, overtime: empTotal.overtime + w.overtime,
        double: empTotal.double + w.double, total: empTotal.total + w.total, missing: empTotal.missing || w.missing,
      };
      const known = anyRated(w, week.days.length);
      lines.push(csvRow([
        emp.employeeName,
        pid,
        week.weekStart,
        week.regularHours.toFixed(2),
        week.overtimeHours.toFixed(2),
        week.breakHours.toFixed(2),
        week.totalWorkedHours.toFixed(2),
        week.hasIncomplete ? "Yes" : "",
        known ? money(w.regular) : "",
        known ? money(w.overtime) : "",
        known ? money(w.double) : "",
        known ? money(w.total) : "",
        w.missing ? "Yes" : "",
      ]));
    }
    if (emp.weeks.length > 1) {
      const known = !(empTotal.missing && empTotal.total === 0);
      lines.push(csvRow([
        emp.employeeName + " (total)",
        pid,
        "",
        emp.totalRegularHours.toFixed(2),
        emp.totalOvertimeHours.toFixed(2),
        emp.totalBreakHours.toFixed(2),
        emp.totalWorkedHours.toFixed(2),
        "",
        known ? money(empTotal.regular) : "",
        known ? money(empTotal.overtime) : "",
        known ? money(empTotal.double) : "",
        known ? money(empTotal.total) : "",
        empTotal.missing ? "Yes" : "",
      ]));
    }
  }
  return lines.join("\n");
}

// Daily detail: one row per employee, day and position/rate. A day worked in
// one position at one rate (the usual case) is one row; its break hours are
// on its first row.
export function dailyCSV(rows: EmployeePayroll[], ctx: ExportContext): string {
  const lines = [csvRow([
    "Employee", "Payroll ID", "Date", "Day", "Position", "Hours Worked", "Break Hours",
    "Regular Hrs", "OT Hrs", "Double Time Hrs", "Rate", "Regular Pay", "OT Pay", "Double Time Pay", "Total Pay",
    "Incomplete",
  ])];
  for (const emp of rows) {
    const pid = ctx.payrollIds.get(emp.employeeId) ?? "";
    for (const week of emp.weeks) {
      for (const day of week.days) {
        if (day.workedHours === 0 && !day.hasIncomplete) continue;
        const dp = dayOf(ctx, emp.employeeId, day.date);
        const payLines = dp && dp.lines.length > 0 ? dp.lines : [null];
        payLines.forEach((l, i) => {
          const hours = l ? l.regularHours + l.overtimeHours + l.doubleTimeHours : day.workedHours;
          lines.push(csvRow([
            emp.employeeName,
            pid,
            day.date,
            day.dayName,
            l ? positionName(ctx, l) : "",
            (Math.round(hours * 100) / 100).toFixed(2),
            i === 0 ? day.breakHours.toFixed(2) : "0.00",
            (l ? l.regularHours : day.regularHours).toFixed(2),
            (l ? l.overtimeHours : day.overtimeHours).toFixed(2),
            (l ? l.doubleTimeHours : doubleOf(day)).toFixed(2),
            rateText(l?.rate),
            money(l?.regularCents),
            money(l?.overtimeCents),
            money(l?.doubleTimeCents),
            money(l?.totalCents),
            day.hasIncomplete ? "Yes" : "",
          ]));
        });
      }
    }
  }
  return lines.join("\n");
}

// Calculation breakdown — shows how each worked day accumulates toward the
// weekly 40h regular cap (hours beyond it become overtime), alongside that
// day's break hours. Hours worked earlier in a workweek the range starts
// part-way through open the week as a "worked before this period" row: they
// were paid in the previous period but count toward this week's overtime. The
// per-week subtotal rows are exactly the figures the Summary sheet reports.
// The day-level split is computePayroll's, so the QuickBooks export matches.
export function detailedCSV(rows: EmployeePayroll[]): string {
  const lines = [csvRow([
    "Employee", "Week Of", "Date", "Day",
    "Worked Hrs", "Cumulative Wk Hrs", "Regular Hrs", "OT Hrs", "Break Hrs", "Incomplete",
  ])];
  for (const emp of rows) {
    for (const week of emp.weeks) {
      let weekAccum = week.priorHours;
      if (week.priorHours > 0) {
        lines.push(csvRow([
          emp.employeeName, week.weekStart, "", "Worked before this period",
          week.priorHours.toFixed(2), weekAccum.toFixed(2), "", "", "", "",
        ]));
      }
      for (const day of week.days) {
        if (day.workedHours === 0 && !day.hasIncomplete) continue;
        weekAccum += day.workedHours;
        lines.push(csvRow([
          emp.employeeName,
          week.weekStart,
          day.date,
          day.dayName,
          day.workedHours.toFixed(2),
          weekAccum.toFixed(2),
          day.regularHours.toFixed(2),
          day.overtimeHours.toFixed(2),
          day.breakHours.toFixed(2),
          day.hasIncomplete ? "Yes" : "",
        ]));
      }
      lines.push(csvRow([
        `${emp.employeeName} — week total`,
        week.weekStart,
        "", "",
        week.totalWorkedHours.toFixed(2),
        "",
        week.regularHours.toFixed(2),
        week.overtimeHours.toFixed(2),
        week.breakHours.toFixed(2),
        week.hasIncomplete ? "Yes" : "",
      ]));
    }
    lines.push(""); // blank separator between employees
  }
  return lines.join("\n");
}

// ─── QuickBooks Desktop IIF ──────────────────────────────────────────────────

// One TIMEACT row per employee per worked day and pay type, using
// computePayroll's day-level split. DURATION is H:MM.
export function quickbooksIIF(rows: EmployeePayroll[]): string {
  const lines: string[] = [];
  for (const emp of rows) {
    for (const week of emp.weeks) {
      for (const day of week.days) {
        const note = day.hasIncomplete ? "Incomplete punch — verify hours" : "";
        const parts = [["Regular Time", day.regularHours], ["Overtime", day.overtimeHours], ["Double Time", doubleOf(day)]] as const;
        for (const [service, hrs] of parts) {
          if (Math.round(hrs * 60) <= 0) continue;
          lines.push(
            ["TIMEACT", mmddyyyy(day.date), "", iifField(emp.employeeName), service,
             hoursToHMM(hrs), note, "0", "", ""].join("\t")
          );
        }
      }
    }
  }
  const usesDoubleTime = lines.some((l) => l.split("\t")[4] === "Double Time");
  return [
    "!TIMETYPE\tNAME",
    "TIMETYPE\tRegular Time",
    "TIMETYPE\tOvertime",
    ...(usesDoubleTime ? ["TIMETYPE\tDouble Time"] : []),
    "!TIMEACT\tDATE\tJOB\tEMP\tSERVICE\tDURATION\tNOTE\tBILLINGSTATUS\tPITEM\tCLASS",
    ...lines,
  ].join("\n");
}

// ─── Gusto ───────────────────────────────────────────────────────────────────

export const GUSTO_HEADER = [
  "Employee ID", "Last name", "First name", "Regular hours", "Overtime hours", "Double overtime hours", "Workweeks",
];

export function gustoCSV(rows: EmployeePayroll[], ctx: ExportContext): string {
  const lines = [csvRow(GUSTO_HEADER)];
  for (const emp of rows) {
    const { first, last } = splitName(emp.employeeName);
    for (const week of emp.weeks) {
      // The part of this workweek inside the pay period.
      const start = week.weekStart < ctx.from ? ctx.from : week.weekStart;
      const weekEnd = addDaysToKey(week.weekStart, 6);
      const end = weekEnd > ctx.to ? ctx.to : weekEnd;
      const dt = week.days.reduce((s, d) => s + doubleOf(d), 0);
      lines.push(csvRow([
        ctx.payrollIds.get(emp.employeeId) ?? "",
        last,
        first,
        week.regularHours.toFixed(2),
        week.overtimeHours.toFixed(2),
        (Math.round(dt * 100) / 100).toFixed(2),
        `${start} - ${end}`,
      ]));
    }
  }
  return lines.join("\n");
}

// ─── ADP Workforce Now ───────────────────────────────────────────────────────

export const ADP_HEADER = [
  "Co Code", "Batch ID", "File #", "Temp Dept", "Temp Rate", "Reg Hours", "O/T Hours", "Hours 3 Code", "Hours 3 Amount",
];
export const ADP_DOUBLE_TIME_CODE = "D";

// YYYY-MM-DD → YYMMDD
export function adpBatchId(date: string): string {
  return date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
}

export function adpCSV(rows: EmployeePayroll[], ctx: ExportContext): string {
  const lines = [csvRow(ADP_HEADER)];
  const batch = adpBatchId(ctx.to);
  const co = (ctx.adpCoCode ?? "").toUpperCase();
  for (const emp of rows) {
    // Hours at the employee's own rate on one row; hours at each position
    // rate on a row of their own, with that rate.
    const groups = new Map<string, { rate: number | null; reg: number; ot: number; dt: number }>();
    const add = (key: string, rate: number | null, reg: number, ot: number, dt: number) => {
      const g = groups.get(key) ?? { rate, reg: 0, ot: 0, dt: 0 };
      g.reg += Math.round(reg * 100); g.ot += Math.round(ot * 100); g.dt += Math.round(dt * 100);
      groups.set(key, g);
    };
    for (const week of emp.weeks) {
      for (const day of week.days) {
        const dp = dayOf(ctx, emp.employeeId, day.date);
        if (!dp || dp.lines.length === 0) {
          add("base", null, day.regularHours, day.overtimeHours, doubleOf(day));
          continue;
        }
        for (const l of dp.lines) {
          if (l.positionRate) add(`rate:${l.rate}`, l.rate, l.regularHours, l.overtimeHours, l.doubleTimeHours);
          else add("base", null, l.regularHours, l.overtimeHours, l.doubleTimeHours);
        }
      }
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => (a === "base" ? -1 : b === "base" ? 1 : a.localeCompare(b)));
    for (const [, g] of ordered) {
      if (g.reg + g.ot + g.dt === 0) continue;
      lines.push(csvRow([
        co,
        batch,
        ctx.payrollIds.get(emp.employeeId) ?? "",
        "",
        rateText(g.rate),
        (g.reg / 100).toFixed(2),
        (g.ot / 100).toFixed(2),
        g.dt > 0 ? ADP_DOUBLE_TIME_CODE : "",
        g.dt > 0 ? (g.dt / 100).toFixed(2) : "",
      ]));
    }
  }
  return lines.join("\n");
}

// ─── QuickBooks Online ───────────────────────────────────────────────────────

export const QBO_HEADER = ["Date", "Employee", "Service Item", "Duration", "Hourly Rate", "Billable", "Description"];

export function qboCSV(rows: EmployeePayroll[], ctx: ExportContext): string {
  const lines = [csvRow(QBO_HEADER)];
  for (const emp of rows) {
    for (const week of emp.weeks) {
      for (const day of week.days) {
        const dp = dayOf(ctx, emp.employeeId, day.date);
        const payLines: { reg: number; ot: number; dt: number; rate: number | null; pos: string }[] =
          dp && dp.lines.length > 0
            ? dp.lines.map((l) => ({ reg: l.regularHours, ot: l.overtimeHours, dt: l.doubleTimeHours, rate: l.rate, pos: positionName(ctx, l) }))
            : [{ reg: day.regularHours, ot: day.overtimeHours, dt: doubleOf(day), rate: null, pos: "" }];
        for (const l of payLines) {
          const parts = [["Regular Time", l.reg, 1], ["Overtime", l.ot, 1.5], ["Double Time", l.dt, 2]] as const;
          for (const [service, hrs, mult] of parts) {
            if (Math.round(hrs * 60) <= 0) continue;
            const description = [l.pos, day.hasIncomplete ? "Incomplete punch — verify hours" : ""].filter(Boolean).join(" · ");
            lines.push(csvRow([
              mmddyyyy(day.date),
              emp.employeeName,
              service,
              hoursToHMM(hrs),
              l.rate == null ? "" : (Math.round(l.rate * mult * 100) / 100).toFixed(2),
              "No",
              description,
            ]));
          }
        }
      }
    }
  }
  return lines.join("\n");
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export function renderExport(
  format: ExportFormat,
  rows: EmployeePayroll[],
  ctx: ExportContext,
): { content: string; contentType: string; filename: string } {
  const { from, to } = ctx;
  switch (format) {
    case "qb-iif":
      return { content: quickbooksIIF(rows), contentType: "text/plain", filename: `payroll_${from}_to_${to}.iif` };
    case "daily":
      return { content: dailyCSV(rows, ctx), contentType: "text/csv", filename: `payroll_daily_${from}_to_${to}.csv` };
    case "detailed":
      return { content: detailedCSV(rows), contentType: "text/csv", filename: `payroll_breakdown_${from}_to_${to}.csv` };
    case "gusto":
      return { content: gustoCSV(rows, ctx), contentType: "text/csv", filename: `gusto_hours_${from}_to_${to}.csv` };
    case "adp": {
      const co = (ctx.adpCoCode ?? "").toUpperCase();
      return { content: adpCSV(rows, ctx), contentType: "text/csv", filename: co ? `PR${co}EPI.csv` : `adp_paydata_${from}_to_${to}.csv` };
    }
    case "qbo":
      return { content: qboCSV(rows, ctx), contentType: "text/csv", filename: `qbo_timesheets_${from}_to_${to}.csv` };
    default:
      return { content: summaryCSV(rows, ctx), contentType: "text/csv", filename: `payroll_${from}_to_${to}.csv` };
  }
}
