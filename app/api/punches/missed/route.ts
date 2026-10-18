import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { dateKeyInTz, localDayBoundsUtc, resolveTimezone, todayKeyInTz } from "@/lib/dates";
import { loadCurrentShift } from "@/lib/current-shift-server";

export const dynamic = "force-dynamic";

// GET /api/punches/missed
// Returns the most recent open session from a previous day, if any.
// Used by the clock page on load so associates see the correction requirement
// before they attempt to clock in.
export async function GET(request?: Request) {
  const supabase = await createClient();

  const { ctx, error } = await getOrgContext(supabase, request);
  if (error === "Not authenticated") return NextResponse.json({ missedPunch: null });
  if (error) return NextResponse.json({ missedPunch: null });

  const { orgId, employeeId } = ctx!;

  if (!employeeId) return NextResponse.json({ missedPunch: null });

  const { data: settingsData } = await supabase
    .from("app_settings")
    .select("key, value")
    .eq("org_id", orgId);
  const settingsMap = Object.fromEntries(
    (settingsData ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  );
  const tz = resolveTimezone(settingsMap.timezone);
  const todayKey = todayKeyInTz(tz);
  const { start: todayStart } = localDayBoundsUtc(todayKey, tz);

  const { data: prevPunch } = await supabase
    .from("punch_records")
    .select("punch_type, punched_at")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .lt("punched_at", todayStart.toISOString())
    .order("punched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!prevPunch || prevPunch.punch_type === "clock_out") {
    return NextResponse.json({ missedPunch: null });
  }

  // Not missed while that shift is still the current one (a closer within the
  // overnight grace window), or once it was closed after midnight. Breaks
  // punched after midnight continue it: if it was then left open, the latest
  // of those is the punch to fix.
  const [{ shift }, { data: todays }] = await Promise.all([
    loadCurrentShift(supabase, orgId, employeeId, tz),
    supabase
      .from("punch_records")
      .select("punch_type, punched_at")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .gte("punched_at", todayStart.toISOString())
      .order("punched_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (shift?.carriedOver) return NextResponse.json({ missedPunch: null });
  const rows = (todays ?? []) as { punch_type: string; punched_at: string }[];
  const end = rows.findIndex((p) => p.punch_type === "clock_in" || p.punch_type === "clock_out");
  if (end >= 0 && rows[end].punch_type === "clock_out") return NextResponse.json({ missedPunch: null });
  const continued = end >= 0 ? rows.slice(0, end) : rows;
  const open = continued.length > 0 ? continued[continued.length - 1] : prevPunch;

  return NextResponse.json({
    missedPunch: {
      date: dateKeyInTz(open.punched_at as string, tz),
      lastPunchType: open.punch_type,
      lastPunchedAt: open.punched_at,
      suggestedPunchType: open.punch_type === "break_start" ? "break_end" : "clock_out",
    },
  });
}
