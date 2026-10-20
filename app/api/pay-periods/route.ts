import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { getOrgTimezone } from "@/lib/org-timezone";
import { daysBetweenKeys, isDateKey, todayKeyInTz } from "@/lib/dates";
import { latestSignablePayPeriod, payPeriodsEnabled } from "@/lib/pay-periods";
import {
  loadPayPeriodFor,
  loadPayPeriods,
  loadPayPeriodSettings,
  payPeriodErrorResponse,
  type PayPeriodView,
} from "@/lib/pay-periods-server";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export type PayPeriodsResponse = {
  frequency: string;
  anchor: string | null;
  enabled: boolean;
  today: string;
  periods: PayPeriodView[];
};

// GET /api/pay-periods?date=YYYY-MM-DD   the period containing date
//     /api/pay-periods?from=…&to=…       every period touching the range
//     /api/pay-periods?signable=1        the latest period the caller can sign
//
// Any member of the org. Managers see every employee's sign-off; anyone else
// sees only their own.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const signable = searchParams.get("signable") === "1";

  if (date !== null && !isDateKey(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if ((from !== null || to !== null) && (!isDateKey(from) || !isDateKey(to)))
    return NextResponse.json({ error: "from and to must both be YYYY-MM-DD" }, { status: 400 });
  if (from && to && (from > to || daysBetweenKeys(from, to) > 366))
    return NextResponse.json({ error: "from must not be after to, and the range must not exceed 366 days" }, { status: 400 });
  if (!date && !from && !signable)
    return NextResponse.json({ error: "date, from and to, or signable=1 required" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error: authError } = await getOrgContext(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });
  const { orgId } = ctx;
  if (!ctx.isManager && ctx.employeeId === null)
    return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });
  const scope = ctx.isManager ? {} : { employeeId: ctx.employeeId! };

  const [settings, tz] = await Promise.all([loadPayPeriodSettings(supabase, orgId), getOrgTimezone(supabase, orgId)]);
  const today = todayKeyInTz(tz);

  let periods: PayPeriodView[] = [];
  if (from && to) {
    const result = await loadPayPeriods(supabase, orgId, settings, from, to, scope);
    if (result.error) return payPeriodErrorResponse(result.error as never, "api/pay-periods");
    periods = result.periods;
  } else {
    const target = signable ? latestSignablePayPeriod(today, settings)?.start ?? null : date;
    if (target) {
      const result = await loadPayPeriodFor(supabase, orgId, settings, target, scope);
      if (result.error) return payPeriodErrorResponse(result.error as never, "api/pay-periods");
      periods = result.period ? [result.period] : [];
    }
  }

  const body: PayPeriodsResponse = {
    frequency: settings.frequency,
    anchor: settings.anchor,
    enabled: payPeriodsEnabled(settings),
    today,
    periods,
  };
  return NextResponse.json(body);
}

const ACTIONS = { approve: "pay_period_approve", lock: "pay_period_lock", reopen: "pay_period_reopen" } as const;
type Action = keyof typeof ACTIONS;

// POST /api/pay-periods  { action: "approve" | "lock" | "reopen", date, reason? }
// Managers only. `date` is any day in the period. Reopening a locked or
// approved period needs a reason; the database keeps it in
// pay_period_events. The database also enforces all of this for direct calls.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { action, date, reason } = body as { action?: unknown; date?: unknown; reason?: unknown };
  if (typeof action !== "string" || !(action in ACTIONS))
    return NextResponse.json({ error: "action must be approve, lock or reopen" }, { status: 400 });
  if (!isDateKey(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (action === "reopen" && !trimmedReason)
    return NextResponse.json({ error: "A reason is required to reopen a pay period" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const args: Record<string, unknown> = { p_org: orgId, p_date: date };
  if (action === "reopen") args.p_reason = trimmedReason;
  const { data, error } = await supabase.rpc(ACTIONS[action as Action], args);
  if (error) return payPeriodErrorResponse(error, "api/pay-periods");

  const row = (data ?? {}) as { id?: number; start_date?: string; end_date?: string; status?: string };
  writeAuditLog({
    action:       `pay_period.${action}`,
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "pay_period",
    resourceId:   row.id != null ? String(row.id) : null,
    after:        { status: row.status ?? null },
    metadata:     { start: row.start_date ?? null, end: row.end_date ?? null, reason: trimmedReason || null },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    period: { id: row.id ?? null, start: row.start_date ?? null, end: row.end_date ?? null, status: row.status ?? null },
  });
}
