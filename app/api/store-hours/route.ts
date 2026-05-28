import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { DEMO_STORE_HOURS } from "@/data/demo-fixtures";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const { dayOfWeek, openMinutes, closeMinutes } = await request.json();

  if (dayOfWeek == null || openMinutes == null || closeMinutes == null)
    return NextResponse.json({ error: "dayOfWeek, openMinutes, closeMinutes required" }, { status: 400 });
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    return NextResponse.json({ error: "dayOfWeek must be 0–6" }, { status: 400 });
  if (!Number.isInteger(openMinutes) || openMinutes < 0 || openMinutes >= 1440)
    return NextResponse.json({ error: "openMinutes out of range" }, { status: 400 });
  if (!Number.isInteger(closeMinutes) || closeMinutes <= 0 || closeMinutes > 1440)
    return NextResponse.json({ error: "closeMinutes out of range" }, { status: 400 });
  if (openMinutes >= closeMinutes)
    return NextResponse.json({ error: "open must be before close" }, { status: 400 });

  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("store_hours")
    .upsert({ day_of_week: dayOfWeek, open_minutes: openMinutes, close_minutes: closeMinutes }, { onConflict: "day_of_week" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(DEMO_STORE_HOURS);
  }

  const { data, error } = await supabase
    .from("store_hours")
    .select("day_of_week, open_minutes, close_minutes")
    .order("day_of_week");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mapped = Object.fromEntries(
    data.map((row) => [
      row.day_of_week,
      { open: row.open_minutes, close: row.close_minutes },
    ])
  );

  return NextResponse.json(mapped);
}
