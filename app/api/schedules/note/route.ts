import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { validateShiftNote } from "@/lib/shift-note";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/schedules/note?date=YYYY-MM-DD — notes for that day's shifts (any
// member). Kept separate from the main schedules route so its response shape
// stays stable.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { data, error: dbError } = await supabase
    .from("schedules")
    .select("id, note")
    .eq("org_id", ctx!.orgId)
    .eq("date", date);

  if (dbError) {
    console.error("[api/schedules/note]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    notes: (data ?? []).map((s) => ({ scheduleId: s.id, note: s.note ?? null })),
  });
}

// PUT /api/schedules/note { scheduleId, note } — manager sets or clears a
// shift's note. An empty/whitespace note (or null) clears it.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { scheduleId, note } = body;

  if (!Number.isInteger(scheduleId))
    return NextResponse.json({ error: "scheduleId must be an integer" }, { status: 400 });

  const check = validateShiftNote(note);
  if (!check.valid) return NextResponse.json({ error: check.error }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );

  const { data: schedule } = await supabase
    .from("schedules")
    .select("id")
    .eq("org_id", orgId!)
    .eq("id", scheduleId)
    .maybeSingle();
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const { error } = await supabase
    .from("schedules")
    .update({ note: check.value })
    .eq("org_id", orgId!)
    .eq("id", scheduleId);

  if (error) {
    console.error("[api/schedules/note]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "schedule.note",
    orgId:        orgId!,
    actorId:      user!.id,
    resourceType: "schedule",
    resourceId:   String(scheduleId),
    after:        { note: check.value },
  }).catch(() => {});

  return NextResponse.json({ ok: true, note: check.value });
}
