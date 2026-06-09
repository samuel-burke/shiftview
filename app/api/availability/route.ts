import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { writeAuditLog } from "@/lib/audit";
import { DEMO_AVAILABILITY } from "@/data/demo-fixtures";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const employeeIdStr = searchParams.get("employeeId");

  if (!employeeIdStr)
    return NextResponse.json({ error: "employeeId param required" }, { status: 400 });

  const employeeId = Number(employeeIdStr);
  if (!Number.isInteger(employeeId) || employeeId <= 0)
    return NextResponse.json({ error: "employeeId must be a positive integer" }, { status: 400 });

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const records = DEMO_AVAILABILITY[employeeId] ?? [];
    return NextResponse.json(records);
  }

  const { data, error } = await supabase
    .from("availability")
    .select("id, day_of_week, start_minutes, end_minutes, note")
    .eq("employee_id", employeeId);

  if (error) {
    console.error("[api/availability]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const records = (data ?? []).map((row: {
    id: number;
    day_of_week: number;
    start_minutes: number | null;
    end_minutes: number | null;
    note: string | null;
  }) => ({
    id: row.id,
    dayOfWeek: row.day_of_week,
    startMinutes: row.start_minutes,
    endMinutes: row.end_minutes,
    note: row.note,
  }));
  return NextResponse.json(records);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { employeeId, dayOfWeek, startMinutes = null, endMinutes = null, note = null } = body;

  if (employeeId == null)
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });
  if (dayOfWeek == null)
    return NextResponse.json({ error: "dayOfWeek required" }, { status: 400 });
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    return NextResponse.json({ error: "dayOfWeek must be an integer between 0 and 6" }, { status: 400 });

  // Validate window if both are provided (non-null)
  if (startMinutes !== null && endMinutes !== null) {
    if (startMinutes >= endMinutes)
      return NextResponse.json({ error: "startMinutes must be less than endMinutes" }, { status: 422 });
    if (endMinutes - startMinutes < 30)
      return NextResponse.json({ error: "Window must be at least 30 minutes" }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Check if manager
  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let employeeName: string | null = null;
  if (!managerRow) {
    // Non-manager: must be setting own availability
    const { data: linkedEmployee } = await supabase
      .from("employees")
      .select("id, user_id, name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!linkedEmployee || linkedEmployee.id !== employeeId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    employeeName = linkedEmployee.name;
  } else {
    const { data: emp } = await supabase
      .from("employees")
      .select("name")
      .eq("id", employeeId)
      .maybeSingle();
    employeeName = emp?.name ?? null;
  }

  const { error } = await supabase
    .from("availability")
    .upsert(
      { employee_id: employeeId, day_of_week: dayOfWeek, start_minutes: startMinutes, end_minutes: endMinutes, note },
      { onConflict: "employee_id,day_of_week" }
    );

  if (error) {
    console.error("[api/availability]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "availability.upsert",
    actorId:      user.id,
    resourceType: "availability",
    after: { employeeId, dayOfWeek, startMinutes, endMinutes, note },
    metadata: {
      employeeId,
      employeeName,
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek] ?? null,
      byManager: !!managerRow,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json();
  const { id } = body;

  if (id == null)
    return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Fetch the availability record to check ownership
  const { data: record } = await supabase
    .from("availability")
    .select("id, employee_id, day_of_week")
    .eq("id", id)
    .maybeSingle();

  // Check if manager
  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let employeeName: string | null = null;
  if (!managerRow) {
    // Non-manager: must own the record
    const { data: linkedEmployee } = await supabase
      .from("employees")
      .select("id, user_id, name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!linkedEmployee || !record || linkedEmployee.id !== record.employee_id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    employeeName = linkedEmployee.name;
  } else if (record?.employee_id) {
    const { data: emp } = await supabase
      .from("employees")
      .select("name")
      .eq("id", record.employee_id)
      .maybeSingle();
    employeeName = emp?.name ?? null;
  }

  const { error } = await supabase
    .from("availability")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[api/availability]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "availability.delete",
    actorId:      user.id,
    resourceType: "availability",
    resourceId:   String(id),
    before: record
      ? { employeeId: record.employee_id, dayOfWeek: record.day_of_week }
      : null,
    metadata: {
      employeeId:   record?.employee_id ?? null,
      employeeName,
      dayOfWeek:    record?.day_of_week ?? null,
      dayName:      record?.day_of_week != null ? DAY_NAMES[record.day_of_week] : null,
      byManager:    !!managerRow,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
