import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();

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
