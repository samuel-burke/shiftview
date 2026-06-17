import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { allocateTips, type TipParticipant } from "@/lib/tip-pool";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/tip-pool?date=YYYY-MM-DD&poolCents=NNNN (manager-only)
// Suggests how to split a pooled tip amount across the staff scheduled that day,
// weighted by scheduled hours. Money is split to exact cents.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const poolCents = Number(searchParams.get("poolCents"));

  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  if (!Number.isInteger(poolCents) || poolCents <= 0)
    return NextResponse.json({ error: "poolCents must be a positive integer" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const { data: rows, error } = await supabase
    .from("schedules")
    .select("employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("date", date)
    .limit(10000);

  if (error) {
    console.error("[api/reports/tip-pool]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Sum scheduled minutes per employee for the day.
  const minutesByEmployee = new Map<number, number>();
  for (const s of rows ?? []) {
    minutesByEmployee.set(
      s.employee_id,
      (minutesByEmployee.get(s.employee_id) ?? 0) + (s.end_minutes - s.start_minutes)
    );
  }

  const participants: TipParticipant[] = [...minutesByEmployee.entries()].map(
    ([employeeId, weightMinutes]) => ({ employeeId, weightMinutes })
  );
  const shares = allocateTips(poolCents, participants);

  const nameById = new Map<number, string>();
  if (participants.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", participants.map((p) => p.employeeId));
    for (const e of emps ?? []) nameById.set(e.id, e.name);
  }

  return NextResponse.json({
    date,
    poolCents,
    shares: shares.map((s) => ({
      employeeId: s.employeeId,
      employeeName: nameById.get(s.employeeId) ?? "Unknown",
      minutes: minutesByEmployee.get(s.employeeId) ?? 0,
      cents: s.cents,
    })),
  });
}
