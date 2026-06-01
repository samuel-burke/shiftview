import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { data: template } = await supabase
    .from("schedule_templates")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("schedule_templates")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  writeAuditLog({
    action:       "template.delete",
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
