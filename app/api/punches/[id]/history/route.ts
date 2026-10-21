import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";

export const dynamic = "force-dynamic";

type Snapshot = { punchType: string; punchedAt: string; note: string | null } | null;

export type PunchHistoryEntry = {
  id: number;
  action: "insert" | "update" | "delete";
  changedAt: string;
  // Display name of whoever made the change; null when the server did.
  changedBy: string | null;
  reason: string | null;
  before: Snapshot;
  after: Snapshot;
};

// Only what the history needs to show; the stored rows also hold location.
function snapshot(row: unknown): Snapshot {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    punchType: String(r.punch_type),
    punchedAt: String(r.punched_at),
    note:      typeof r.note === "string" ? r.note : null,
  };
}

// GET /api/punches/[id]/history
// Every recorded change to one punch, oldest first (punch_record_history,
// 0053). Managers see any punch in their organization; an employee sees only
// their own. RLS enforces the same; the filter here keeps it explicit.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, isManager, employeeId } = ctx!;
  if (!isManager && !employeeId) return NextResponse.json({ history: [] });

  let query = supabase
    .from("punch_record_history")
    .select("id, action, old_row, new_row, changed_by, changed_at, reason")
    .eq("org_id", orgId)
    .eq("punch_id", id)
    .order("changed_at")
    .order("id");
  if (!isManager) query = query.eq("employee_id", employeeId!);

  const { data, error: fetchError } = await query;
  if (fetchError) {
    console.error("[api/punches/[id]/history]", fetchError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const rows = (data ?? []) as {
    id: number; action: PunchHistoryEntry["action"]; old_row: unknown; new_row: unknown;
    changed_by: string | null; changed_at: string; reason: string | null;
  }[];

  // Managers are named by their linked employee row; one without a row is
  // still shown as a manager rather than as nobody.
  const userIds = [...new Set(rows.map((r) => r.changed_by).filter((u): u is string => !!u))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: people } = await supabase
      .from("employees")
      .select("user_id, name")
      .eq("org_id", orgId)
      .in("user_id", userIds);
    for (const p of (people ?? []) as { user_id: string; name: string }[]) names.set(p.user_id, p.name);
  }

  const history: PunchHistoryEntry[] = rows.map((r) => ({
    id:        r.id,
    action:    r.action,
    changedAt: r.changed_at,
    changedBy: r.changed_by ? names.get(r.changed_by) ?? "A manager" : null,
    reason:    r.reason,
    before:    snapshot(r.old_row),
    after:     snapshot(r.new_row),
  }));
  return NextResponse.json({ history });
}
