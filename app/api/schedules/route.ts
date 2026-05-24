import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateShiftMinutes(startMinutes: unknown, endMinutes: unknown): string | null {
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes))
    return "startMinutes and endMinutes must be integers";
  const start = startMinutes as number;
  const end   = endMinutes   as number;
  if (start < 0 || start >= 1440)      return "startMinutes must be between 0 and 1439";
  if (end   <= 0 || end   > 1440)      return "endMinutes must be between 1 and 1440";
  if (start >= end)                    return "startMinutes must be less than endMinutes";
  if (end - start < 60)                return "shift must be at least 1 hour";
  if (end - start > 960)               return "shift cannot exceed 16 hours";
  return null;
}

async function requireManager(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Not authenticated" };
  const { data: managerRow } = await supabase
    .from("managers")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!managerRow) return { user, error: "Manager access required" };
  return { user, error: null };
}

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  const { error } = await supabase
    .from("schedules")
    .update({ start_minutes: startMinutes, end_minutes: endMinutes })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
    .from("schedules")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
