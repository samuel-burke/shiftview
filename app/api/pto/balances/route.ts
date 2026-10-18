import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { loadBalances, loadPtoPolicies } from "@/lib/pto-server";
import { describePolicy, policyEnabled, type LeaveType } from "@/lib/pto";

export const dynamic = "force-dynamic";

export type PtoBalancesResponse = {
  // Which banks are in use: a policy accrues into it, or someone has hours.
  types: { leaveType: LeaveType; accrues: boolean; policy: string }[];
  balances: { employeeId: number; employeeName: string; pto: number; sick: number }[];
};

// GET /api/pto/balances[?employeeId=N]
// An employee gets their own balances; a manager every current employee's
// (or one's, with employeeId).
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
  const { orgId, isManager, employeeId } = ctx;

  let only: number | undefined;
  if (isManager) {
    only = requested ?? undefined;
  } else {
    if (employeeId === null)
      return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });
    if (requested !== null && requested !== employeeId)
      return NextResponse.json({ error: "You can only view your own balance" }, { status: 403 });
    only = employeeId;
  }

  let empQuery = supabase.from("employees").select("id, name").eq("org_id", orgId).is("archived_at", null);
  if (only !== undefined) empQuery = empQuery.eq("id", only);
  const [{ data: emps, error: empErr }, { balances, error: balErr }, policies] = await Promise.all([
    empQuery.order("name"),
    loadBalances(supabase, orgId, only),
    loadPtoPolicies(supabase, orgId),
  ]);
  if (empErr || balErr) {
    console.error("[api/pto/balances]", empErr ?? balErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const byEmp = new Map(balances.map((b) => [b.employeeId, b]));
  const rows = ((emps ?? []) as { id: number; name: string }[]).map((e) => ({
    employeeId: e.id,
    employeeName: e.name,
    pto: byEmp.get(e.id)?.pto ?? 0,
    sick: byEmp.get(e.id)?.sick ?? 0,
  }));
  const types = (["pto", "sick"] as const)
    .filter((t) => policyEnabled(policies[t]) || balances.some((b) => b[t] !== 0))
    .map((t) => ({ leaveType: t, accrues: policyEnabled(policies[t]), policy: describePolicy(policies[t]) }));

  const body: PtoBalancesResponse = { types, balances: rows };
  return NextResponse.json(body);
}
