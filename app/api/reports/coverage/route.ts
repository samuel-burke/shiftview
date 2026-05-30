import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";

export const dynamic = "force-dynamic";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  const result: string[] = [];
  let cur = from;
  while (cur <= to) {
    result.push(cur);
    cur = addDays(cur, 1);
  }
  return result;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { error: authError } = await requireManager(supabase);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return NextResponse.json({ error: "from and to params are required (YYYY-MM-DD)" }, { status: 400 });

  if (from > to)
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });

  const rangeMs = new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime();
  const rangeDays = Math.round(rangeMs / (1000 * 60 * 60 * 24));
  if (rangeDays > 90)
    return NextResponse.json({ error: "Date range must not exceed 90 days" }, { status: 400 });

  const { data, error } = await supabase
    .from("schedules")
    .select("date, employee_id")
    .gte("date", from)
    .lte("date", to)
    .limit(10000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Count per date
  const counts: Record<string, number> = {};
  for (const row of (data ?? [])) {
    const d = (row.date as string).slice(0, 10);
    counts[d] = (counts[d] ?? 0) + 1;
  }

  // Fill all dates in range with 0 if missing
  const allDates = daysBetween(from, to);
  const days = allDates.map((date) => ({ date, count: counts[date] ?? 0 }));

  return NextResponse.json({ days });
}
