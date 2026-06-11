import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { withOrgAll } from "@/lib/org-scope";

export const dynamic = "force-dynamic";

type TemplateRow = {
  employee_id: number;
  day_of_week: number;
  start_minutes: number;
  end_minutes: number;
};

type ScheduleInsert = {
  employee_id: number;
  date: string;
  start_minutes: number;
  end_minutes: number;
};

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(
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

  const body = await request.json();
  const { weekStartDate } = body;
  if (!weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate))
    return NextResponse.json({ error: "weekStartDate must be YYYY-MM-DD" }, { status: 400 });

  const d = new Date(weekStartDate + "T00:00:00Z");
  if (isNaN(d.getTime())) return NextResponse.json({ error: "Invalid weekStartDate" }, { status: 400 });
  if (d.getUTCDay() !== 1) return NextResponse.json({ error: "weekStartDate must be a Monday" }, { status: 422 });

  const { data: template } = await supabase
    .from("schedule_templates")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();

  // Fetch template rows
  const { data: rows, error: rowErr } = await supabase
    .from("schedule_template_rows")
    .select("employee_id, day_of_week, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("template_id", id);

  if (rowErr) {
    console.error("[api/templates/[id]/apply]", rowErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!rows || rows.length === 0) return NextResponse.json({ created: 0, skipped: 0 });

  // Compute target dates
  const templateRows: TemplateRow[] = rows;
  const targetDates = templateRows.map((r) => addDays(weekStartDate, r.day_of_week));
  const uniqueDates = [...new Set(targetDates)];

  // Fetch existing schedules for those dates
  const { data: existing } = await supabase
    .from("schedules")
    .select("employee_id, date")
    .eq("org_id", orgId)
    .in("date", uniqueDates);

  const existingSet = new Set(
    (existing ?? []).map((s: { employee_id: number; date: string }) => `${s.employee_id}__${s.date}`)
  );

  const toInsert: ScheduleInsert[] = templateRows
    .map((r, i) => ({
      employee_id: r.employee_id,
      date: targetDates[i],
      start_minutes: r.start_minutes,
      end_minutes: r.end_minutes,
    }))
    .filter((r) => !existingSet.has(`${r.employee_id}__${r.date}`));

  const skipped = rows.length - toInsert.length;

  if (toInsert.length === 0) return NextResponse.json({ created: 0, skipped });

  const { error: insertErr } = await supabase
    .from("schedules")
    .insert(withOrgAll(orgId, toInsert));
  if (insertErr) {
    console.error("[api/templates/[id]/apply]", insertErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "template.apply",
    orgId,
    actorId:      user?.id,
    resourceType: "schedule_template",
    resourceId:   String(id),
    metadata: {
      templateId:   id,
      templateName: template?.name ?? null,
      weekStartDate,
      created:      toInsert.length,
      skipped,
    },
  }).catch(() => {});

  return NextResponse.json({ created: toInsert.length, skipped });
}
