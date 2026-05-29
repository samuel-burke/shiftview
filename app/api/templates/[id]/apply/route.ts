import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

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
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json();
  const { weekStartDate } = body;
  if (!weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate))
    return NextResponse.json({ error: "weekStartDate must be YYYY-MM-DD" }, { status: 400 });

  // Fetch template rows
  const { data: rows, error: rowErr } = await supabase
    .from("schedule_template_rows")
    .select("employee_id, day_of_week, start_minutes, end_minutes")
    .eq("template_id", id);

  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ created: 0, skipped: 0 });

  // Compute target dates
  const targetDates = rows.map((r: any) => addDays(weekStartDate, r.day_of_week));
  const uniqueDates = [...new Set(targetDates)];

  // Fetch existing schedules for those dates
  const { data: existing } = await supabase
    .from("schedules")
    .select("employee_id, date")
    .in("date", uniqueDates);

  const existingSet = new Set(
    (existing ?? []).map((s: any) => `${s.employee_id}__${s.date}`)
  );

  const toInsert = rows
    .map((r: any, i: number) => ({
      employee_id: r.employee_id,
      date: targetDates[i],
      start_minutes: r.start_minutes,
      end_minutes: r.end_minutes,
    }))
    .filter((r: any) => !existingSet.has(`${r.employee_id}__${r.date}`));

  const skipped = rows.length - toInsert.length;

  if (toInsert.length === 0) return NextResponse.json({ created: 0, skipped });

  const { error: insertErr } = await supabase.from("schedules").insert(toInsert);
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ created: toInsert.length, skipped });
}
