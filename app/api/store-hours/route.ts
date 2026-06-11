import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { getOrgContext } from "@/lib/org-context";
import { withOrg } from "@/lib/org-scope";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError)
    return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { error } = await supabase
    .from("store_hours")
    .upsert(withOrg(orgId!, { day_of_week: dayOfWeek, open_minutes: openMinutes, close_minutes: closeMinutes }), { onConflict: "org_id,day_of_week" });

  if (error) {
    console.error("[api/store-hours]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "store_hours.update",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "store_hours",
    after: { dayOfWeek, openMinutes, closeMinutes },
    metadata: {
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek] ?? null,
      openMinutes,
      closeMinutes,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function GET(request?: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error === "No organization membership") {
    return NextResponse.json({ error: "No organization membership" }, { status: 403 });
  }

  const { orgId } = ctx!;

  const { data, error: dbError } = await supabase
    .from("store_hours")
    .select("day_of_week, open_minutes, close_minutes")
    .eq("org_id", orgId)
    .order("day_of_week");

  if (dbError) {
    console.error("[api/store-hours]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const mapped = Object.fromEntries(
    data.map((row) => [
      row.day_of_week,
      { open: row.open_minutes, close: row.close_minutes },
    ])
  );

  return NextResponse.json(mapped);
}
