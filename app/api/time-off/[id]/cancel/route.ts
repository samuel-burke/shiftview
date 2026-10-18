import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";
import { cancelTimeOff } from "@/lib/pto-server";

export const dynamic = "force-dynamic";

// POST /api/time-off/:id/cancel
// The employee cancels their own pending or approved request for today or
// later; a manager cancels any. Cancelling an approved paid day gives its
// hours back (cancel_time_off, migration 0064, checks who may).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const result = await cancelTimeOff(supabase, id);
  switch (result.status) {
    case "not_found":
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    case "past":
      return NextResponse.json({ error: "A day that has passed can only be cancelled by a manager" }, { status: 403 });
    case "conflict":
      return NextResponse.json({ error: "Only a pending or approved request can be cancelled" }, { status: 409 });
    case "error":
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "time_off.cancel",
    orgId:        ctx!.orgId,
    actorId:      ctx!.user.id,
    resourceType: "time_off_request",
    resourceId:   String(id),
    before:       { status: result.was ?? null },
    after:        { status: "cancelled" },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
