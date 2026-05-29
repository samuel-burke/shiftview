import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { DEMO_SETTINGS } from "@/data/demo-fixtures";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(DEMO_SETTINGS);
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return NextResponse.json({
    firstDayOfWeek:  parseInt(map.first_day_of_week  ?? "6"),
    optimalCoverage: parseInt(map.optimal_coverage   ?? "3"),
    minCoverage:     parseInt(map.minimum_coverage   ?? "2"),
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const supabase = await createClient();

  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const rows: { key: string; value: string }[] = [];

  if (body.firstDayOfWeek !== undefined) {
    const v = Number(body.firstDayOfWeek);
    if (!Number.isInteger(v) || v < 0 || v > 6)
      return NextResponse.json({ error: "firstDayOfWeek must be 0–6" }, { status: 400 });
    rows.push({ key: "first_day_of_week", value: String(v) });
  }

  if (body.optimalCoverage !== undefined) {
    const v = Number(body.optimalCoverage);
    if (!Number.isInteger(v) || v < 1)
      return NextResponse.json({ error: "optimalCoverage must be ≥ 1" }, { status: 400 });
    rows.push({ key: "optimal_coverage", value: String(v) });
  }

  if (body.minCoverage !== undefined) {
    const v = Number(body.minCoverage);
    if (!Number.isInteger(v) || v < 0)
      return NextResponse.json({ error: "minCoverage must be ≥ 0" }, { status: 400 });
    rows.push({ key: "minimum_coverage", value: String(v) });
  }

  if (rows.length === 0)
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });

  const { error } = await supabase
    .from("app_settings")
    .upsert(rows);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
