import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { notifyManagers } from "@/lib/notify";
import { fmtMinutes } from "@/data/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mapRow(r: Record<string, unknown>) {
  return {
    id:         r.id,
    employeeId: r.employee_id,
    scheduleId: r.schedule_id ?? null,
    punchType:  r.punch_type,
    punchedAt:  r.punched_at,
    lat:        r.lat ?? null,
    lng:        r.lng ?? null,
    isManual:   r.is_manual,
    note:       r.note ?? null,
  };
}

// GET /api/punches?date=YYYY-MM-DD
// Managers receive all employees' punches; employees receive only their own.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) return NextResponse.json({ error: "date param required" }, { status: 400 });
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json([]);

  const dayStart = `${date}T00:00:00+00:00`;
  const dayEnd   = `${date}T23:59:59.999+00:00`;

  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let query = supabase
    .from("punch_records")
    .select("*")
    .gte("punched_at", dayStart)
    .lte("punched_at", dayEnd)
    .order("punched_at");

  if (!managerRow) {
    // Scope to employee's own records
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!emp) return NextResponse.json([]);
    query = query.eq("employee_id", emp.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((data ?? []).map(mapRow));
}

// POST /api/punches — employee clocks a punch
// Body: { punchType, scheduleId?, lat?, lng? }
export async function POST(request: Request) {
  const body = await request.json();
  const { punchType, scheduleId, lat, lng } = body;

  const VALID_TYPES = ["clock_in", "clock_out", "break_start", "break_end"];
  if (!punchType || !VALID_TYPES.includes(punchType))
    return NextResponse.json({ error: "punchType must be one of: " + VALID_TYPES.join(", ") }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp)
    return NextResponse.json({ error: "No employee record linked to this account" }, { status: 403 });

  const { data, error } = await supabase
    .from("punch_records")
    .insert({
      employee_id: emp.id,
      schedule_id: scheduleId ?? null,
      punch_type:  punchType,
      lat:         lat ?? null,
      lng:         lng ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Check for late clock-in and alert managers
  if (punchType === "clock_in" && scheduleId) {
    const { data: sched } = await supabase
      .from("schedules")
      .select("start_minutes, date, employee_id")
      .eq("id", scheduleId)
      .maybeSingle();
    if (sched) {
      const punchedAt = new Date(data.punched_at);
      const clockInMinutes = punchedAt.getHours() * 60 + punchedAt.getMinutes();
      const lateMinutes = clockInMinutes - sched.start_minutes;
      if (lateMinutes > 5) {
        const { data: empData } = await supabase
          .from("employees")
          .select("name")
          .eq("id", sched.employee_id)
          .maybeSingle();
        notifyManagers(
          supabase,
          "late_clock_in",
          "Late Clock-In",
          `${empData?.name ?? "An employee"} clocked in ${lateMinutes}m late (scheduled ${fmtMinutes(sched.start_minutes)})`,
          { employeeId: sched.employee_id, scheduleId, lateMinutes }
        ).catch(() => {});
      }
    }
  }

  return NextResponse.json(mapRow(data), { status: 201 });
}

// PUT /api/punches — correct / add a missed punch
// Managers can correct any; employees can only add a manual punch for themselves.
// Body: { id?, employeeId?, punchType, punchedAt, note, scheduleId? }
export async function PUT(request: Request) {
  const body = await request.json();
  const { id, employeeId, punchType, punchedAt, note, scheduleId } = body;

  const VALID_TYPES = ["clock_in", "clock_out", "break_start", "break_end"];

  if (!punchType || !VALID_TYPES.includes(punchType))
    return NextResponse.json({ error: "punchType required" }, { status: 400 });
  if (!punchedAt)
    return NextResponse.json({ error: "punchedAt required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Determine target employee
  let targetEmployeeId: number;
  if (managerRow) {
    if (!employeeId) return NextResponse.json({ error: "employeeId required for manager corrections" }, { status: 400 });
    targetEmployeeId = employeeId;
  } else {
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!emp) return NextResponse.json({ error: "No employee record" }, { status: 403 });
    targetEmployeeId = emp.id;
  }

  if (id != null) {
    // Update existing punch
    const { error } = await supabase
      .from("punch_records")
      .update({ punch_type: punchType, punched_at: punchedAt, note: note ?? null, is_manual: true })
      .eq("id", id)
      .eq("employee_id", targetEmployeeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Insert a new manual punch
    const { error } = await supabase
      .from("punch_records")
      .insert({
        employee_id: targetEmployeeId,
        schedule_id: scheduleId ?? null,
        punch_type:  punchType,
        punched_at:  punchedAt,
        is_manual:   true,
        note:        note ?? null,
      });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
