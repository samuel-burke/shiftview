import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { DEMO_COVERAGE_DEFAULTS } from "@/data/demo-fixtures";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Which coverage profile applies to which day: a default per day of week
 * plus date-specific overrides (holidays etc.).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to)))
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ defaults: DEMO_COVERAGE_DEFAULTS, overrides: {} });

  let overridesQuery = supabase.from("coverage_date_overrides").select("date, profile_id");
  if (from) overridesQuery = overridesQuery.gte("date", from);
  if (to) overridesQuery = overridesQuery.lte("date", to);

  const [{ data: defaults, error: defaultsError }, { data: overrides, error: overridesError }] = await Promise.all([
    supabase.from("coverage_day_defaults").select("day_of_week, profile_id"),
    overridesQuery,
  ]);

  if (defaultsError || overridesError) {
    console.error("[api/coverage-assignments]", defaultsError ?? overridesError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    defaults: Object.fromEntries((defaults ?? []).map((d) => [d.day_of_week, d.profile_id])),
    overrides: Object.fromEntries(
      (overrides ?? []).map((o) => [typeof o.date === "string" ? o.date.slice(0, 10) : o.date, o.profile_id])
    ),
  });
}

/** Set (or clear, with profileId: null) the default profile for a day of week. */
export async function PUT(request: Request) {
  const { dayOfWeek, profileId } = await request.json();

  if (dayOfWeek == null || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    return NextResponse.json({ error: "dayOfWeek must be 0–6" }, { status: 400 });
  if (profileId !== null && !Number.isInteger(profileId))
    return NextResponse.json({ error: "profileId must be an integer or null" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = profileId === null
    ? await supabase.from("coverage_day_defaults").delete().eq("day_of_week", dayOfWeek)
    : await supabase.from("coverage_day_defaults").upsert({ day_of_week: dayOfWeek, profile_id: profileId }, { onConflict: "day_of_week" });

  if (error) {
    console.error("[api/coverage-assignments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "coverage_default.update",
    actorId:      user?.id,
    resourceType: "coverage_day_default",
    resourceId:   String(dayOfWeek),
    after: { dayOfWeek, profileId },
    metadata: { dayName: DAY_NAMES[dayOfWeek] ?? null, profileId },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

/** Override the profile for a specific calendar date. */
export async function POST(request: Request) {
  const { date, profileId } = await request.json();

  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if (!Number.isInteger(profileId))
    return NextResponse.json({ error: "profileId must be an integer" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("coverage_date_overrides")
    .upsert({ date, profile_id: profileId }, { onConflict: "date" });

  if (error) {
    console.error("[api/coverage-assignments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "coverage_override.set",
    actorId:      user?.id,
    resourceType: "coverage_date_override",
    resourceId:   date,
    after: { date, profileId },
    metadata: { date, profileId },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

/** Remove a date override (the day falls back to its day-of-week default). */
export async function DELETE(request: Request) {
  const { date } = await request.json();

  if (!date || !DATE_RE.test(date))
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("coverage_date_overrides")
    .delete()
    .eq("date", date);

  if (error) {
    console.error("[api/coverage-assignments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "coverage_override.clear",
    actorId:      user?.id,
    resourceType: "coverage_date_override",
    resourceId:   date,
    metadata: { date },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
