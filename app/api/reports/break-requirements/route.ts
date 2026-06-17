import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { requiredBreaks, summarizeBreakRequirements, DEFAULT_BREAK_RULES } from "@/lib/break-rules";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/break-requirements?date=YYYY-MM-DD (manager-only)
// Which of the day's shifts legally require a meal/rest break, so a manager can
// plan break coverage. Uses the default break rules.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const { data: rows, error } = await supabase
    .from("schedules")
    .select("id, employee_id, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("date", date)
    .order("start_minutes", { ascending: true });

  if (error) {
    console.error("[api/reports/break-requirements]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const shifts = rows ?? [];
  const ids = [...new Set(shifts.map((s) => s.employee_id))];
  const nameById = new Map<number, string>();
  if (ids.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", ids);
    for (const e of emps ?? []) nameById.set(e.id, e.name);
  }

  const detailed = shifts.map((s) => {
    const durationMinutes = s.end_minutes - s.start_minutes;
    const req = requiredBreaks(durationMinutes);
    return {
      scheduleId: s.id,
      employeeId: s.employee_id,
      employeeName: nameById.get(s.employee_id) ?? "Unknown",
      startMinutes: s.start_minutes,
      endMinutes: s.end_minutes,
      durationMinutes,
      mealBreakRequired: req.mealBreakRequired,
      restBreaks: req.restBreaks,
    };
  });

  return NextResponse.json({
    date,
    rules: DEFAULT_BREAK_RULES,
    shifts: detailed,
    summary: summarizeBreakRequirements(
      shifts.map((s) => ({ startMinutes: s.start_minutes, endMinutes: s.end_minutes }))
    ),
  });
}
