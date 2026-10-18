import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";
import { todayKeyInTz } from "@/lib/dates";
import { getOrgTimezone } from "@/lib/org-timezone";
import { isLeaveType } from "@/lib/pto";

export const dynamic = "force-dynamic";

// POST /api/pto/adjustments { employeeId, leaveType, hours, reason } —
// managers. Adds (or with negative hours, takes away) balance by hand, with a
// reason, as a ledger row dated today.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { employeeId, leaveType, hours, reason } = (body ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(employeeId))
    return NextResponse.json({ error: "employeeId must be an integer" }, { status: 400 });
  if (!isLeaveType(leaveType))
    return NextResponse.json({ error: "leaveType must be pto or sick" }, { status: 400 });
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours === 0 || Math.abs(hours) > 1000
      || Math.round(hours * 100) / 100 !== hours)
    return NextResponse.json({ error: "hours must be a non-zero number of hours (to 2 decimals, at most 1000)" }, { status: 400 });
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500)
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const tz = await getOrgTimezone(supabase, orgId!);
  const { data, error } = await supabase
    .from("pto_ledger")
    .insert(withOrg(orgId!, {
      employee_id: employeeId,
      leave_type: leaveType,
      kind: "adjustment",
      hours,
      reason: reason.trim(),
      effective_date: todayKeyInTz(tz),
      created_by: user!.id,
    }))
    .select("id, balance_after")
    .single();

  // The employee isn't in this organization (same-org foreign key).
  if (error?.code === "23503")
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (error) {
    console.error("[api/pto/adjustments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "pto.adjust",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "pto_ledger",
    resourceId:   String(data.id),
    after:        { employeeId, leaveType, hours, reason: reason.trim() },
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: data.id, balance: Number(data.balance_after) }, { status: 201 });
}
