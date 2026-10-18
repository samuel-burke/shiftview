import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { fetchAllRows } from "@/lib/fetch-all-rows";

export const dynamic = "force-dynamic";

export type PtoLedgerEntry = {
  id: number;
  leaveType: "pto" | "sick";
  kind: "accrual" | "usage" | "restore" | "adjustment" | "carryover";
  hours: number;
  balanceAfter: number;
  effectiveDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  workedHours: number | null;
  requestId: number | null;
  reason: string | null;
  createdAt: string;
};

// GET /api/pto/ledger?employeeId=N — every row behind an employee's balances,
// newest first. Employees read their own; managers anyone in their org.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("employeeId");
  const requested = raw === null ? null : Number(raw);
  if (requested !== null && !Number.isInteger(requested))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error)
    return NextResponse.json({ error }, { status: error === "Not authenticated" ? 401 : 403 });

  let employeeId: number;
  if (ctx.isManager) {
    if (requested === null)
      return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
    employeeId = requested;
  } else {
    if (ctx.employeeId === null)
      return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });
    if (requested !== null && requested !== ctx.employeeId)
      return NextResponse.json({ error: "You can only view your own balance" }, { status: 403 });
    employeeId = ctx.employeeId;
  }

  const { data, error: dbError } = await fetchAllRows<Record<string, unknown>>((first, last) =>
    supabase
      .from("pto_ledger")
      .select("id, leave_type, kind, hours, balance_after, effective_date, period_start, period_end, worked_hours, request_id, reason, created_at")
      .eq("org_id", ctx.orgId)
      .eq("employee_id", employeeId)
      .order("id", { ascending: false })
      .range(first, last),
    { maxRows: 5_000 },
  );
  if (dbError) {
    console.error("[api/pto/ledger]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const entries: PtoLedgerEntry[] = data.map((r) => ({
    id: Number(r.id),
    leaveType: r.leave_type as PtoLedgerEntry["leaveType"],
    kind: r.kind as PtoLedgerEntry["kind"],
    hours: Number(r.hours),
    balanceAfter: Number(r.balance_after),
    effectiveDate: String(r.effective_date),
    periodStart: (r.period_start as string | null) ?? null,
    periodEnd: (r.period_end as string | null) ?? null,
    workedHours: num(r.worked_hours),
    requestId: num(r.request_id),
    reason: (r.reason as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
  return NextResponse.json({ employeeId, entries });
}
