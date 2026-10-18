import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { computePayroll, EmployeePayroll, payrollQueryWindow, PunchRow } from "@/lib/payroll";
import { daysBetweenKeys } from "@/lib/dates";
import { getOrgPayrollSettings, loadExemptEmployeeIds, overtimeThresholds } from "@/lib/pay-rules";
import { writeAuditLog } from "@/lib/audit";
import { csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Export helpers ──────────────────────────────────────────────────────────

// IIF is tab-separated, one record per line: a tab or line break inside a
// value would split the record.
function iifField(v: string): string {
  return v.replace(/[\t\r\n]+/g, " ");
}

// MM/DD/YYYY
function mmddyyyy(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

// ─── Format generators ────────────────────────────────────────────────────────

// Columns that only appear when they apply, so a store on the default rules
// gets exactly the files it always has:
//   * doubleTime: the org's rule can pay double time (California), or this
//     payroll has some: a "DT Hrs" column after "OT Hrs".
//   * exempt: the org has exempt employees: an "Exempt" column at the end.
type ExportColumns = { doubleTime: boolean; exempt: boolean };

function summaryCSV(rows: EmployeePayroll[], cols: ExportColumns): string {
  const lines = [csvRow([
    "Employee", "Week Of", "Regular Hrs", "OT Hrs", ...(cols.doubleTime ? ["DT Hrs"] : []),
    "Break Hrs", "Total Hrs", "Incomplete", ...(cols.exempt ? ["Exempt"] : []),
  ])];
  const exemptCell = (emp: EmployeePayroll) => (cols.exempt ? [emp.exempt ? "Yes" : ""] : []);
  for (const emp of rows) {
    for (const week of emp.weeks) {
      lines.push(csvRow([
        emp.employeeName,
        week.weekStart,
        week.regularHours.toFixed(2),
        week.overtimeHours.toFixed(2),
        ...(cols.doubleTime ? [week.doubleTimeHours.toFixed(2)] : []),
        week.breakHours.toFixed(2),
        week.totalWorkedHours.toFixed(2),
        week.hasIncomplete ? "Yes" : "",
        ...exemptCell(emp),
      ]));
    }
    if (emp.weeks.length > 1) {
      lines.push(csvRow([
        emp.employeeName + " (total)",
        "",
        emp.totalRegularHours.toFixed(2),
        emp.totalOvertimeHours.toFixed(2),
        ...(cols.doubleTime ? [emp.totalDoubleTimeHours.toFixed(2)] : []),
        emp.totalBreakHours.toFixed(2),
        emp.totalWorkedHours.toFixed(2),
        "",
        ...exemptCell(emp),
      ]));
    }
  }
  return lines.join("\n");
}

// Daily detail — works with QuickBooks Online time import, Gusto, ADP, and most modern payroll platforms
function dailyCSV(rows: EmployeePayroll[], cols: ExportColumns): string {
  const lines = [csvRow(["Employee", "Date", "Day", "Hours Worked", "Break Hours", "Incomplete", ...(cols.exempt ? ["Exempt"] : [])])];
  for (const emp of rows) {
    for (const week of emp.weeks) {
      for (const day of week.days) {
        if (day.workedHours === 0 && !day.hasIncomplete) continue;
        lines.push(csvRow([
          emp.employeeName,
          day.date,
          day.dayName,
          day.workedHours.toFixed(2),
          day.breakHours.toFixed(2),
          day.hasIncomplete ? "Yes" : "",
          ...(cols.exempt ? [emp.exempt ? "Yes" : ""] : []),
        ]));
      }
    }
  }
  return lines.join("\n");
}

// Calculation breakdown — how each worked day splits under the org's overtime
// rule (daily limits, then the weekly 40 on what's still regular), alongside
// that day's break hours. Hours worked earlier in a workweek the range starts
// part-way through open the week as a "worked before this period" row: they
// were paid in the previous period but count toward this week's overtime. The
// per-week subtotal rows are exactly the figures the Summary sheet reports.
// The day-level split is computePayroll's, so the QuickBooks export matches.
// With double time, a "7th Day" column marks California's 7th consecutive
// workday.
function detailedCSV(rows: EmployeePayroll[], cols: ExportColumns): string {
  const dt = (v: string) => (cols.doubleTime ? [v] : []);
  const lines = [csvRow([
    "Employee", "Week Of", "Date", "Day",
    "Worked Hrs", "Cumulative Wk Hrs", "Regular Hrs", "OT Hrs", ...dt("DT Hrs"), "Break Hrs", "Incomplete",
    ...dt("7th Day"), ...(cols.exempt ? ["Exempt"] : []),
  ])];
  for (const emp of rows) {
    const exemptCell = cols.exempt ? [emp.exempt ? "Yes" : ""] : [];
    for (const week of emp.weeks) {
      let weekAccum = week.priorHours;
      if (week.priorHours > 0) {
        lines.push(csvRow([
          emp.employeeName, week.weekStart, "", "Worked before this period",
          week.priorHours.toFixed(2), weekAccum.toFixed(2), "", "", ...dt(""), "", "", ...dt(""), ...exemptCell,
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
          ...dt(day.doubleTimeHours.toFixed(2)),
          day.breakHours.toFixed(2),
          day.hasIncomplete ? "Yes" : "",
          ...dt(day.seventhConsecutiveDay ? "Yes" : ""),
          ...exemptCell,
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
        ...dt(week.doubleTimeHours.toFixed(2)),
        week.breakHours.toFixed(2),
        week.hasIncomplete ? "Yes" : "",
        ...dt(""),
        ...exemptCell,
      ]));
    }
    lines.push(""); // blank separator between employees
  }
  return lines.join("\n");
}

// QuickBooks Desktop IIF — one TIMEACT row per employee per worked day and
// pay type, using computePayroll's day-level regular/overtime/double-time
// split. The Double Time type is only declared when some row uses it. An
// exempt employee's rows say "Exempt" in the note.
function quickbooksIIF(rows: EmployeePayroll[]): string {
  const anyDouble = rows.some((e) => e.totalDoubleTimeHours > 0);
  const lines = [
    "!TIMETYPE\tNAME",
    "TIMETYPE\tRegular Time",
    "TIMETYPE\tOvertime",
    ...(anyDouble ? ["TIMETYPE\tDouble Time"] : []),
    "!TIMEACT\tDATE\tJOB\tEMP\tSERVICE\tDURATION\tNOTE\tBILLINGSTATUS\tPITEM\tCLASS",
  ];

  for (const emp of rows) {
    for (const week of emp.weeks) {
      for (const day of week.days) {
        const note = [emp.exempt ? "Exempt" : "", day.hasIncomplete ? "Incomplete punch — verify hours" : ""]
          .filter(Boolean).join("; ");
        for (const [service, hrs] of [
          ["Regular Time", day.regularHours],
          ["Overtime", day.overtimeHours],
          ["Double Time", day.doubleTimeHours],
        ] as const) {
          if (hrs <= 0) continue;
          lines.push(
            ["TIMEACT", mmddyyyy(day.date), "", iifField(emp.employeeName), service,
             hrs.toFixed(2), note, "0", "", ""].join("\t")
          );
        }
      }
    }
  }

  return lines.join("\n");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { searchParams } = new URL(request.url);
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");
  const format = searchParams.get("format") ?? "summary";

  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const daysDiff = daysBetweenKeys(from, to);
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const { tz, rules } = await getOrgPayrollSettings(supabase, orgId!);
  const { ids: exemptEmployeeIds, error: exemptError } = await loadExemptEmployeeIds(supabase, orgId!);
  if (exemptError) {
    console.error("[api/reports/payroll/export] exempt", exemptError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const span = payrollQueryWindow(from, to, tz, rules.workweekStartDay);
  const { data, error, truncated } = await fetchAllRows((first, last) =>
    supabase
      .from("punch_records")
      .select("id, employee_id, punch_type, punched_at, employees!punch_records_employee_org_fkey(name)")
      .eq("org_id", orgId!)
      .gte("punched_at", span.start)
      .lte("punched_at", span.end)
      .order("employee_id")
      .order("punched_at")
      .order("id")
      .range(first, last)
  );

  if (error) {
    console.error("[api/reports/payroll/export]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // Paying from a partial set of punches would underpay silently.
  if (truncated)
    return NextResponse.json({ error: "Too many punches in this range — choose a shorter range" }, { status: 422 });

  const payroll = computePayroll(data as unknown as PunchRow[], tz, { from, to }, { rules, exemptEmployeeIds });
  const cols: ExportColumns = {
    doubleTime: overtimeThresholds(rules).dailyDoubleTime !== null || payroll.some((e) => e.totalDoubleTimeHours > 0),
    exempt: exemptEmployeeIds.size > 0,
  };

  writeAuditLog({
    action:       "payroll.export",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "punch_record",
    metadata:     { from, to, format, employeeCount: payroll.length, overtimeRule: rules.overtimeRule, roundingMinutes: rules.roundingMinutes },
  }).catch(() => {});

  let content: string;
  let contentType: string;
  let filename: string;

  switch (format) {
    case "qb-iif":
      content     = quickbooksIIF(payroll);
      contentType = "text/plain";
      filename    = `payroll_${from}_to_${to}.iif`;
      break;
    case "daily":
      content     = dailyCSV(payroll, cols);
      contentType = "text/csv";
      filename    = `payroll_daily_${from}_to_${to}.csv`;
      break;
    case "detailed":
      content     = detailedCSV(payroll, cols);
      contentType = "text/csv";
      filename    = `payroll_breakdown_${from}_to_${to}.csv`;
      break;
    default:
      content     = summaryCSV(payroll, cols);
      contentType = "text/csv";
      filename    = `payroll_${from}_to_${to}.csv`;
  }

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
