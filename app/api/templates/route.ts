import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

type TemplateRow = {
  id: number;
  name: string;
  created_at: string;
  schedule_template_rows: { id: number }[] | null;
};

type TemplateRowInput = {
  employeeId: number;
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
};

export async function GET() {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data, error } = await supabase
    .from("schedule_templates")
    .select("id, name, created_at, schedule_template_rows(id)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/templates]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const templates = (data ?? []).map((t: TemplateRow) => ({
    id: t.id,
    name: t.name,
    createdAt: t.created_at,
    rowCount: (t.schedule_template_rows ?? []).length,
  }));

  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const body = await request.json();
  const { name, rows } = body;

  if (!name || typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "name is required" }, { status: 400 });

  if (!Array.isArray(rows) || rows.length === 0)
    return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 });

  const { data: template, error: tplError } = await supabase
    .from("schedule_templates")
    .insert({ name: name.trim() })
    .select("id")
    .single();

  if (tplError) {
    console.error("[api/templates]", tplError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rowData = rows.map((r: TemplateRowInput) => ({
    template_id: template.id,
    employee_id: r.employeeId,
    day_of_week: r.dayOfWeek,
    start_minutes: r.startMinutes,
    end_minutes: r.endMinutes,
  }));

  const { error: rowError } = await supabase
    .from("schedule_template_rows")
    .insert(rowData);

  if (rowError) {
    console.error("[api/templates]", rowError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "template.create",
    actorId:      user?.id,
    resourceType: "schedule_template",
    resourceId:   String(template.id),
    after: { name: name.trim(), rowCount: rows.length },
    metadata: {
      templateId:   template.id,
      templateName: name.trim(),
      rowCount:     rows.length,
    },
  }).catch(() => {});

  return NextResponse.json({ id: template.id });
}
