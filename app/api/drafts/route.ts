import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { validateShiftMinutes } from "@/app/api/schedules/validation";
import { requireManager } from "@/lib/require-manager";
import { fmtMinutes } from "@/data/types";
import { weekDates } from "@/lib/draft-metrics";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Same time-off / availability checks as live schedules. Returns a 409
 * response when a conflict is found (and override is false), else null.
 */
async function findConflict(
  supabase: SupabaseClient,
  employeeId: number,
  date: string,
  startMinutes: number,
  endMinutes: number
): Promise<NextResponse | null> {
  const dayOfWeek = new Date(date + "T12:00:00").getDay();

  const { data: timeOff } = await supabase
    .from("time_off_requests")
    .select("id, status")
    .eq("employee_id", employeeId)
    .eq("date", date)
    .eq("status", "approved")
    .maybeSingle();

  if (timeOff) {
    return NextResponse.json({
      conflict: "time_off",
      message: `Employee has approved time off on ${date}`,
    }, { status: 409 });
  }

  const { data: availRecord } = await supabase
    .from("availability")
    .select("id, start_minutes, end_minutes")
    .eq("employee_id", employeeId)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  if (availRecord) {
    if (availRecord.start_minutes === null || availRecord.end_minutes === null) {
      return NextResponse.json({
        conflict: "availability",
        window: null,
        message: `Employee is unavailable on ${new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}s`,
      }, { status: 409 });
    }
    if (startMinutes < availRecord.start_minutes || endMinutes > availRecord.end_minutes) {
      return NextResponse.json({
        conflict: "availability",
        window: { startMinutes: availRecord.start_minutes, endMinutes: availRecord.end_minutes },
        message: `Shift falls outside employee's availability window (${fmtMinutes(availRecord.start_minutes)} – ${fmtMinutes(availRecord.end_minutes)})`,
      }, { status: 409 });
    }
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get("weekStart");

  if (!weekStart) return NextResponse.json({ error: "weekStart param required" }, { status: 400 });
  if (!DATE_RE.test(weekStart)) return NextResponse.json({ error: "weekStart must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const dates = weekDates(weekStart);
  const { data, error } = await supabase
    .from("draft_schedules")
    .select("*")
    .gte("date", dates[0])
    .lte("date", dates[6])
    .order("start_minutes");

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const mapped = data.map((s) => ({
    id:           s.id,
    employeeId:   s.employee_id,
    date:         typeof s.date === "string" ? s.date.slice(0, 10) : s.date,
    startMinutes: s.start_minutes,
    endMinutes:   s.end_minutes,
  }));

  return NextResponse.json(mapped);
}

export async function POST(request: Request) {
  const { employeeId, date, startMinutes, endMinutes, override = false } = await request.json();

  if (employeeId == null || !date || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "employeeId, date, startMinutes, endMinutes required" }, { status: 400 });
  if (!DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("draft_schedules")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("date", date)
    .maybeSingle();

  if (existing)
    return NextResponse.json({ error: "Employee already has a draft shift on this date" }, { status: 409 });

  if (!override) {
    const conflict = await findConflict(supabase, employeeId, date, startMinutes, endMinutes);
    if (conflict) return conflict;
  }

  const { error } = await supabase
    .from("draft_schedules")
    .insert({ employee_id: employeeId, date, start_minutes: startMinutes, end_minutes: endMinutes });

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PUT(request: Request) {
  const { id, startMinutes, endMinutes, override = false } = await request.json();

  if (id == null || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "id, startMinutes, endMinutes required" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("draft_schedules")
    .select("employee_id, date")
    .eq("id", id)
    .maybeSingle();

  if (!existing)
    return NextResponse.json({ error: "Draft shift not found" }, { status: 404 });

  if (!override) {
    const dateStr = typeof existing.date === "string" ? existing.date.slice(0, 10) : existing.date;
    const conflict = await findConflict(supabase, existing.employee_id, dateStr, startMinutes, endMinutes);
    if (conflict) return conflict;
  }

  const { error } = await supabase
    .from("draft_schedules")
    .update({ start_minutes: startMinutes, end_minutes: endMinutes })
    .eq("id", id);

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("draft_schedules")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[api/drafts]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
