import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { MIGRATION_ERROR_CODES } from "@/lib/auto-schedule-server";

export const dynamic = "force-dynamic";

const REFUSALS: Record<string, { status: number; error: string }> = {
  forbidden:      { status: 403, error: "Manager access required" },
  not_found:      { status: 404, error: "Run not found" },
  already_undone: { status: 409, error: "That run was already undone or replaced" },
  published:      { status: 409, error: "That week has been published" },
  not_latest:     { status: 409, error: "Only the week's latest run can be undone" },
};

// POST /api/drafts/generate/undo { runId } — removes the drafts a run created
// and restores the drafts it replaced.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const runId = body?.runId;
  if (!Number.isInteger(runId)) return NextResponse.json({ error: "runId must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data, error } = await supabase.rpc("undo_generation_run", { p_org: orgId, p_run_id: runId });
  if (error) {
    if (MIGRATION_ERROR_CODES.has(error.code))
      return NextResponse.json({ error: "Auto-schedule needs database migration 0034_auto_scheduler.sql" }, { status: 503 });
    console.error("[api/drafts/generate/undo]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (data?.status !== "ok") {
    const refusal = REFUSALS[data?.status];
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    console.error("[api/drafts/generate/undo] unexpected result", data);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "draft_schedule.generate_undo",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "schedule_generation_run",
    resourceId:   String(runId),
    after:        { removed: data.removed, restored: data.restored },
    metadata:     { weekStart: data.week_start },
  }).catch(() => {});

  return NextResponse.json({ removed: data.removed, restored: data.restored });
}
