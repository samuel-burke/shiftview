import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { validateShiftMinutes } from "./validation";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) return NextResponse.json({ error: "date param required" }, { status: 400 });
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const table = user ? "schedules" : "schedules_demo";

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("date", date)
    .order("start_minutes");

  if (error) {
    console.error("[api/schedules]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const mapped = data.map((s) => ({
    id:           s.id,
    employeeId:   s.employee_id,
    date:         s.date,
    startMinutes: s.start_minutes,
    endMinutes:   s.end_minutes,
  }));

  return NextResponse.json(mapped);
}

export async function PUT(request: Request) {
  const { id, startMinutes, endMinutes } = await request.json();

  if (id == null || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "id, startMinutes, endMinutes required" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("schedules")
    .select("employee_id, date")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("schedules")
    .update({ start_minutes: startMinutes, end_minutes: endMinutes })
    .eq("id", id);

  if (error) {
    console.error("[api/schedules]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Notify the affected employee of their shift change
  if (existing) {
    const { data: emp } = await supabase
      .from("employees")
      .select("user_id, name")
      .eq("id", existing.employee_id)
      .maybeSingle();
    if (emp?.user_id) {
      notify(supabase, {
        userId: emp.user_id,
        type: "shift_change",
        title: "Shift Updated",
        body: `Your shift on ${existing.date} has been updated to ${fmtMinutes(startMinutes)} – ${fmtMinutes(endMinutes)}`,
        data: { scheduleId: id, date: existing.date },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const { employeeId, date, startMinutes, endMinutes } = await request.json();

  if (employeeId == null || !date || startMinutes == null || endMinutes == null)
    return NextResponse.json({ error: "employeeId, date, startMinutes, endMinutes required" }, { status: 400 });
  if (!DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const validationError = validateShiftMinutes(startMinutes, endMinutes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 422 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("schedules")
    .insert({ employee_id: employeeId, date, start_minutes: startMinutes, end_minutes: endMinutes });

  if (error) {
    console.error("[api/schedules]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Notify the employee of their new shift
  const { data: emp } = await supabase
    .from("employees")
    .select("user_id, name")
    .eq("id", employeeId)
    .maybeSingle();
  if (emp?.user_id) {
    notify(supabase, {
      userId: emp.user_id,
      type: "shift_change",
      title: "New Shift Scheduled",
      body: `You have a new shift on ${date}: ${fmtMinutes(startMinutes)} – ${fmtMinutes(endMinutes)}`,
      data: { date, employeeId },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true }, { status: 201 });
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
    .from("schedules")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[api/schedules]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
