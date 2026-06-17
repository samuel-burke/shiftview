import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { weekDates } from "@/lib/draft-metrics";
import { getCurveForDate } from "@/lib/coverage-server";
import { findUnderstaffedFromCurves, type CoverageBlock } from "@/lib/coverage";
import { summarizeCoverageGaps, groupGapsByDate } from "@/lib/coverage-gaps";
import type { ShiftSpan } from "@/lib/draft-metrics";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/coverage-gaps?weekStart=YYYY-MM-DD (manager-only)
// Per-day under-staffed ranges for the week, comparing scheduled headcount to
// the target coverage curve. Surfaces where the week is short *before* it's
// worked — until now understaffing was only computed for a single day at the
// moment a shift was saved.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get("weekStart");
  if (!weekStart || !DATE_RE.test(weekStart))
    return NextResponse.json({ error: "weekStart param required (YYYY-MM-DD)" }, { status: 400 });

  const supabase = await createClient();
  const { orgId, error: authError } = await requireManager(supabase, request);
  if (authError) {
    return NextResponse.json(
      { error: authError },
      { status: authError === "Not authenticated" ? 401 : 403 }
    );
  }

  const dates = weekDates(weekStart);

  const { data: rows, error } = await supabase
    .from("schedules")
    .select("date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6])
    .limit(10000);

  if (error) {
    console.error("[api/reports/coverage-gaps]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const shifts: ShiftSpan[] = (rows ?? []).map((s) => ({
    date: s.date,
    startMinutes: s.start_minutes,
    endMinutes: s.end_minutes,
  }));

  // Resolve the target curve for each day, then run the (pure, tested) gap
  // detector across the week.
  const curveEntries = await Promise.all(
    dates.map(async (date) => [date, await getCurveForDate(supabase, orgId!, date)] as const)
  );
  const curves: Record<string, CoverageBlock[]> = Object.fromEntries(curveEntries);

  const ranges = findUnderstaffedFromCurves(shifts, dates, curves);

  return NextResponse.json({
    weekStart,
    days: groupGapsByDate(ranges, dates),
    summary: summarizeCoverageGaps(ranges),
  });
}
