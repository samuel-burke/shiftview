import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "date param required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("date", date)
    .order("start_minutes");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Map snake_case back to camelCase to match your existing frontend types
  const mapped = data.map((s) => ({
    id:           s.id,
    employeeId:   s.employee_id,
    date:         s.date,
    startMinutes: s.start_minutes,
    endMinutes:   s.end_minutes,
  }));

  return NextResponse.json(mapped);
}
