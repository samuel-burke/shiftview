import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// DELETE /api/callouts/[id] — rescind a call-out. Allowed for the employee who
// filed it (they're back / it was a mistake) or any manager.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || isNaN(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, user, isManager, employeeId } = ctx!;

  const { data: callout } = await supabase
    .from("callouts")
    .select("id, employee_id, date")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (!callout)
    return NextResponse.json({ error: "Call-out not found" }, { status: 404 });

  // Only the employee who filed it, or a manager, may rescind it.
  if (!isManager && callout.employee_id !== employeeId)
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const { error: deleteError } = await supabase
    .from("callouts")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);

  if (deleteError) {
    console.error("[api/callouts/[id]]", deleteError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "callout.cancel",
    orgId,
    actorId:      user.id,
    resourceType: "callout",
    resourceId:   String(id),
    before:       { employeeId: callout.employee_id, date: callout.date },
    metadata:     { employeeId: callout.employee_id, date: callout.date, byManager: isManager },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
