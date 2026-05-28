import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data, error } = await supabase
    .from("schedule_templates")
    .select("id, name, created_at, schedule_template_rows(id)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const templates = (data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    createdAt: t.created_at,
    rowCount: (t.schedule_template_rows ?? []).length,
  }));

  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
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

  if (tplError) return NextResponse.json({ error: tplError.message }, { status: 500 });

  const rowData = rows.map((r: any) => ({
    template_id: template.id,
    employee_id: r.employeeId,
    day_of_week: r.dayOfWeek,
    start_minutes: r.startMinutes,
    end_minutes: r.endMinutes,
  }));

  const { error: rowError } = await supabase
    .from("schedule_template_rows")
    .insert(rowData);

  if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });

  return NextResponse.json({ id: template.id });
}
