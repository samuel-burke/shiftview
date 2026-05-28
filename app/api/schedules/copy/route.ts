import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const { fromDate, toDate } = await request.json();

  if (!fromDate || !toDate)
    return NextResponse.json({ error: "fromDate and toDate required" }, { status: 400 });
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate))
    return NextResponse.json({ error: "dates must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  // Fetch existing schedules for toDate (to avoid duplicates)
  const { data: existing } = await supabase
    .from("schedules")
    .select("employee_id")
    .eq("date", toDate);
  const existingIds = new Set((existing ?? []).map((s: { employee_id: number }) => s.employee_id));

  // Fetch schedules from fromDate
  const { data: source, error: fetchErr } = await supabase
    .from("schedules")
    .select("employee_id, start_minutes, end_minutes")
    .eq("date", fromDate);
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const toCopy = (source ?? []).filter(
    (s: { employee_id: number }) => !existingIds.has(s.employee_id)
  );

  if (toCopy.length === 0)
    return NextResponse.json({ copied: 0, skipped: (source ?? []).length });

  const { error: insertErr } = await supabase.from("schedules").insert(
    toCopy.map((s: { employee_id: number; start_minutes: number; end_minutes: number }) => ({
      employee_id: s.employee_id,
      date: toDate,
      start_minutes: s.start_minutes,
      end_minutes: s.end_minutes,
    }))
  );
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ copied: toCopy.length, skipped: existingIds.size });
}
