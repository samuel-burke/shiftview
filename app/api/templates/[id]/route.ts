import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { data: template } = await supabase
    .from("schedule_templates")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("schedule_templates")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);

  if (error) {
    console.error("[api/templates/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "template.delete",
    orgId,
    actorId:      user?.id,
    resourceType: "schedule_template",
    resourceId:   String(id),
    before:       template ? { name: template.name } : null,
    metadata: {
      templateId:   id,
      templateName: template?.name ?? null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
