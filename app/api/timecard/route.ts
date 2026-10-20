import { NextResponse } from "next/server";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { parsePunchPolicy } from "@/lib/punch-policy";
import { addDaysToKey, daysBetweenKeys, resolveTimezone } from "@/lib/dates";
import { computeTimecard, type Timecard, type TimecardPunchInput } from "@/lib/timecard";
import { computePayroll, payrollQueryWindow, type PayrollWeek, type PunchRow } from "@/lib/payroll";
import { timecardToCsv } from "@/lib/timecard-csv";
import { writeAuditLog } from "@/lib/audit";
import { parsePayPeriodSettings, type PayPeriodStatus } from "@/lib/pay-periods";
import { loadPayPeriods, type PayPeriodSignoff } from "@/lib/pay-periods-server";
import { loadExemptEmployeeIds, parsePayRules, type PayRules } from "@/lib/pay-rules";
import type { PunchType } from "@/data/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The JSON response: the time card plus its workweeks split into regular,
// overtime and double-time hours by the org's pay rules (lib/payroll.ts,
// lib/pay-rules.ts), so what a time card shows as overtime is what payroll
// pays. `exempt`: the employee gets no overtime.
//
// payPeriods: the pay periods the range touches, each with its status and this
// employee's sign-off (migration 0062); empty when the store doesn't use pay
// periods.
export type TimecardPayPeriod = {
  start: string;
  end: string;
  status: PayPeriodStatus;
  signoff: PayPeriodSignoff | null;
};
export type TimecardResponse = Timecard & {
  weeks: PayrollWeek[];
  exempt: boolean;
  payRules: Pick<PayRules, "overtimeRule" | "workweekStartDay" | "roundingMinutes">;
  payPeriods: TimecardPayPeriod[];
};

// GET /api/timecard?employeeId=N&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns one employee's punches, hours, call-outs and the punch violations
// they triggered under the org's configured PunchPolicy.
//
// Managers read any employee in their org. Anyone else reads only their own
// time card: employeeId may be left out, and naming another employee is
// refused. Nothing here carries pay rates.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const employeeIdRaw = searchParams.get("employeeId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const requestedId = employeeIdRaw ? Number(employeeIdRaw) : null;
  if (requestedId !== null && !Number.isInteger(requestedId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!from || !to)
    return NextResponse.json({ error: "from and to params required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const daysDiff = daysBetweenKeys(from, to);
  if (daysDiff > 366)
    return NextResponse.json({ error: "Date range must not exceed 366 days" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error: authError } = await getOrgContext(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });
  const { orgId, user } = ctx;

  let employeeId: number;
  if (ctx.isManager) {
    if (requestedId === null)
      return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
    employeeId = requestedId;
  } else {
    if (ctx.employeeId === null)
      return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });
    if (requestedId !== null && requestedId !== ctx.employeeId)
      return NextResponse.json({ error: "You can only view your own time card" }, { status: 403 });
    employeeId = ctx.employeeId;
  }

  const format = searchParams.get("format");

  // Confirm the employee belongs to this org (tenant scoping).
  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  // Settings → timezone + punch policy.
  const { data: settingsData } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId);
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = resolveTimezone(settingsMap.timezone);
  const policy = parsePunchPolicy(settingsMap);
  const payRules = parsePayRules(settingsMap);

  // Schedules for the employee in range, plus a day either side: a clock-in
  // just before midnight can be for the next day's shift, or one just after
  // midnight for the previous day's (computeTimecard matches them).
  const { data: scheduleRows, error: schedErr } = await supabase
    .from("schedules")
    .select("date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("date", addDaysToKey(from, -1))
    .lte("date", addDaysToKey(to, 1));
  if (schedErr) {
    console.error("[api/timecard] schedules", schedErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Punches — the payroll window: a local day past each end so a shift that
  // runs past midnight is seen whole, and back to the start of `from`'s
  // workweek so its earlier days count toward overtime. computeTimecard and
  // computePayroll both restrict what they report to [from, to].
  const { start: padStart, end: padEnd } = payrollQueryWindow(from, to, tz, payRules.workweekStartDay);
  const { data: punchRows, error: punchErr, truncated } = await fetchAllRows((first, last) =>
    supabase
      .from("punch_records")
      .select("id, punch_type, punched_at, is_manual, note")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .gte("punched_at", padStart)
      .lte("punched_at", padEnd)
      .order("punched_at")
      .order("id")
      .range(first, last),
    { maxRows: 10_000 },
  );
  if (punchErr) {
    console.error("[api/timecard] punches", punchErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (truncated)
    return NextResponse.json({ error: "Too many punches in this range — choose a shorter range" }, { status: 422 });

  // Call-outs in range.
  const { data: calloutRows, error: calloutErr } = await supabase
    .from("callouts")
    .select("date, reason")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("date", from)
    .lte("date", to);
  if (calloutErr) {
    console.error("[api/timecard] callouts", calloutErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const timecard = computeTimecard({
    employeeId,
    employeeName: emp.name,
    from,
    to,
    timezone: tz,
    policy,
    schedules: (scheduleRows ?? []).map((s) => ({
      date: s.date,
      startMinutes: s.start_minutes,
      endMinutes: s.end_minutes,
    })),
    punches: (punchRows ?? []).map((p): TimecardPunchInput => ({
      id: p.id,
      punchType: p.punch_type as PunchType,
      punchedAt: p.punched_at,
      isManual: p.is_manual,
      note: p.note,
    })),
    callouts: (calloutRows ?? []).map((c) => ({ date: c.date, reason: c.reason })),
    roundingMinutes: payRules.roundingMinutes,
  });

  if (format === "csv") {
    writeAuditLog({
      action:       "timecard.export",
      orgId:        orgId,
      actorId:      user?.id,
      resourceType: "punch_record",
      metadata: {
        from,
        to,
        employeeId,
        rowCount:        timecard.days.length,
        totalViolations: timecard.totalViolations,
      },
    }).catch(() => {});

    const safeName = emp.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return new Response(timecardToCsv(timecard), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="timecard_${safeName || employeeId}_${from}_to_${to}.csv"`,
      },
    });
  }

  const { ids: exemptIds, error: exemptErr } = await loadExemptEmployeeIds(supabase, orgId, employeeId);
  if (exemptErr) {
    console.error("[api/timecard] exempt", exemptErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const exempt = exemptIds.has(employeeId);

  const [payroll] = computePayroll(
    (punchRows ?? []).map((p): PunchRow => ({
      id: p.id,
      employee_id: employeeId,
      punch_type: p.punch_type,
      punched_at: p.punched_at,
      employees: { name: emp.name },
    })),
    tz,
    { from, to },
    { rules: payRules, exemptEmployeeIds: exemptIds },
  );

  const payPeriodSettings = parsePayPeriodSettings(settingsMap);
  let payPeriods: TimecardPayPeriod[] = [];
  if (payPeriodSettings.frequency !== "none") {
    const { periods, error: periodError } = await loadPayPeriods(supabase, orgId, payPeriodSettings, from, to, { employeeId });
    if (periodError) {
      console.error("[api/timecard] pay periods", periodError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    payPeriods = periods.map((p) => ({
      start: p.start,
      end: p.end,
      status: p.status,
      signoff: p.signoffs.find((s) => s.employeeId === employeeId) ?? null,
    }));
  }

  const body: TimecardResponse = {
    ...timecard,
    weeks: payroll?.weeks ?? [],
    exempt,
    payPeriods,
    payRules: {
      overtimeRule: payRules.overtimeRule,
      workweekStartDay: payRules.workweekStartDay,
      roundingMinutes: payRules.roundingMinutes,
    },
  };
  return NextResponse.json(body);
}
