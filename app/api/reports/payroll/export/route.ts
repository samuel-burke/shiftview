import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { computePayroll, EmployeePayroll, PunchRow } from "@/lib/payroll";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(esc).join(",");
}

// MM/DD/YYYY
function mmddyyyy(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${m}/${d}/${y}`;
}

// ─── Format generators ────────────────────────────────────────────────────────

function summaryCSV(rows: EmployeePayroll[]): string {
  const lines = [csvRow(["Employee", "Week Of", "Regular Hrs", "OT Hrs", "Break Hrs", "Total Hrs", "Incomplete"])];
  for (const emp of rows) {
    for (const week of emp.weeks) {
      lines.push(csvRow([
        emp.employeeName,
        week.weekStart,
        week.regularHours.toFixed(2),
        week.overtimeHours.toFixed(2),
        week.breakHours.toFixed(2),
        week.totalWorkedHours.toFixed(2),
        week.hasIncomplete ? "Yes" : "",
      ]));
    }
    if (emp.weeks.length > 1) {
      lines.push(csvRow([
        emp.employeeName + " (total)",
        "",
        emp.totalRegularHours.toFixed(2),
        emp.totalOvertimeHours.toFixed(2),
        emp.totalBreakHours.toFixed(2),
        emp.totalWorkedHours.toFixed(2),
        "",
      ]));
    }
  }
  return lines.join("\n");
}

// Daily detail — works with QuickBooks Online time import, Gusto, ADP, and most modern payroll platforms
function dailyCSV(rows: EmployeePayroll[]): string {
  const lines = [csvRow(["Employee", "Date", "Day", "Hours Worked", "Break Hours", "Incomplete"])];
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
        ]));
      }
    }
  }
  return lines.join("\n");
}

// QuickBooks Desktop IIF — one TIMEACT row per employee per worked day
function quickbooksIIF(rows: EmployeePayroll[]): string {
  const lines = [
    "!TIMETYPE\tNAME",
    "TIMETYPE\tRegular Time",
    "TIMETYPE\tOvertime",
    "!TIMEACT\tDATE\tJOB\tEMP\tSERVICE\tDURATION\tNOTE\tBILLINGSTATUS\tPITEM\tCLASS",
  ];

  for (const emp of rows) {
    // Track cumulative hours per week to split regular vs OT at the day level
    for (const week of emp.weeks) {
      let weekAccum = 0;
      for (const day of week.days) {
        if (day.workedHours === 0) continue;

        const remaining = day.workedHours;
        const regularCap = Math.max(0, 40 - weekAccum);
        const regularHrs = Math.min(remaining, regularCap);
        const otHrs = Math.max(0, remaining - regularCap);
        weekAccum += remaining;

        const note = day.hasIncomplete ? "Incomplete punch — verify hours" : "";

        if (regularHrs > 0) {
          lines.push(
            ["TIMEACT", mmddyyyy(day.date), "", emp.employeeName, "Regular Time",
             regularHrs.toFixed(2), note, "0", "", ""].join("\t")
          );
        }
        if (otHrs > 0) {
          lines.push(
            ["TIMEACT", mmddyyyy(day.date), "", emp.employeeName, "Overtime",
             otHrs.toFixed(2), note, "0", "", ""].join("\t")
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
  const { user, error: authError } = await requireManager(supabase);
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

  const daysDiff =
    (new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime()) / 86_400_000;
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const { data, error } = await supabase
    .from("punch_records")
    .select("id, employee_id, punch_type, punched_at, employees(name)")
    .gte("punched_at", `${from}T00:00:00+00:00`)
    .lte("punched_at", `${to}T23:59:59.999+00:00`)
    .order("employee_id")
    .order("punched_at")
    .limit(50_000);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const payroll = computePayroll((data ?? []) as PunchRow[]);

  writeAuditLog({
    action:       "payroll.export",
    actorId:      user.id,
    resourceType: "punch_record",
    metadata:     { from, to, format, employeeCount: payroll.length },
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
      content     = dailyCSV(payroll);
      contentType = "text/csv";
      filename    = `payroll_daily_${from}_to_${to}.csv`;
      break;
    default:
      content     = summaryCSV(payroll);
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
