import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

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
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("availability")
    .select("day_of_week")
    .eq("employee_id", employeeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const unavailableDays = (data ?? []).map((row: { day_of_week: number }) => row.day_of_week);
  return NextResponse.json({ unavailableDays });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { employeeId, dayOfWeek } = body;

  if (employeeId == null)
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });
  if (dayOfWeek == null)
    return NextResponse.json({ error: "dayOfWeek required" }, { status: 400 });
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    return NextResponse.json({ error: "dayOfWeek must be an integer between 0 and 6" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("availability")
    .upsert({ employee_id: employeeId, day_of_week: dayOfWeek }, { onConflict: "employee_id,day_of_week" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json();
  const { employeeId, dayOfWeek } = body;

  if (employeeId == null)
    return NextResponse.json({ error: "employeeId required" }, { status: 400 });
  if (dayOfWeek == null)
    return NextResponse.json({ error: "dayOfWeek required" }, { status: 400 });
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    return NextResponse.json({ error: "dayOfWeek must be an integer between 0 and 6" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("availability")
    .delete()
    .eq("employee_id", employeeId)
    .eq("day_of_week", dayOfWeek);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
