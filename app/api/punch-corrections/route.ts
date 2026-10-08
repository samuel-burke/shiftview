import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";

export const dynamic = "force-dynamic";

export type PunchCorrection = {
  id: number;
  employeeId: number;
  employeeName: string;
  punchType: "clock_in" | "clock_out" | "break_start" | "break_end";
  punchedAt: string;
  note: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
};

type Row = {
  id: number;
  employee_id: number;
  punch_type: PunchCorrection["punchType"];
  punched_at: string;
  note: string;
  status: PunchCorrection["status"];
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

// GET /api/punch-corrections
//   Manager            → every pending request in the org, oldest first.
//   Employee (or ?mine=true) → the caller's own requests from the last 30 days.
export async function GET(request: Request) {
  const mine = new URL(request.url).searchParams.get("mine") === "true";
  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;
  const managerView = isManager && !mine;
  if (!managerView && !employeeId) return NextResponse.json({ corrections: [] });

  let query = supabase
    .from("punch_corrections")
    .select("id, employee_id, punch_type, punched_at, note, status, created_at, reviewed_at, review_note")
    .eq("org_id", orgId);
  if (managerView) {
    query = query.eq("status", "pending").order("created_at", { ascending: true });
  } else {
    query = query
      .eq("employee_id", employeeId!)
      .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: false });
  }

  const { data, error: fetchError } = await query.limit(200);
  if (fetchError) {
    console.error("[api/punch-corrections]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const rows = (data ?? []) as Row[];

  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", ids);
    for (const e of (emps ?? []) as { id: number; name: string }[]) names.set(e.id, e.name);
  }

  const corrections: PunchCorrection[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: names.get(r.employee_id) ?? "Unknown",
    punchType: r.punch_type,
    punchedAt: r.punched_at,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
  }));
  return NextResponse.json({ corrections });
}
