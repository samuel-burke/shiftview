import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { DEMO_ORG_ID } from "@/lib/demo-org";
import { seedDemoOrg } from "@/lib/demo-seed";
import { sendNtfy } from "@/lib/ntfy";

export const dynamic = "force-dynamic";

function alertCronFailed(reason: string) {
  return sendNtfy({
    title: "Demo reset cron failed",
    message: `${reason}. The demo may be empty or stale until it's fixed; check the server logs.`,
    tags: ["warning"],
    priority: 4,
  });
}

// Nightly demo reset: wipe everything in the demo org (reset_demo_org is a
// SECURITY DEFINER function that hard-fails on non-demo orgs), reseed fresh
// sample data on a rolling window around today, and purge the anonymous auth
// users left behind by demo sessions. Also invocable manually:
//   curl -H "x-cron-secret: $CRON_SECRET" <site>/api/cron/demo-reset
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Collect this cycle's demo visitors before their membership rows are wiped.
  const [{ data: managerRows }, { data: employeeRows }] = await Promise.all([
    admin.from("managers").select("user_id").eq("org_id", DEMO_ORG_ID),
    admin.from("employees").select("user_id").eq("org_id", DEMO_ORG_ID).not("user_id", "is", null),
  ]);
  const visitorIds = [
    ...new Set([
      ...(managerRows ?? []).map((r) => r.user_id),
      ...(employeeRows ?? []).map((r) => r.user_id),
    ]),
  ].filter((id): id is string => Boolean(id));

  const { error: resetError } = await admin.rpc("reset_demo_org", { p_org: DEMO_ORG_ID });
  if (resetError) {
    console.error("[cron/demo-reset] reset_demo_org failed:", resetError);
    await alertCronFailed("reset_demo_org failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  // Pay periods a demo visitor approved or locked (migration 0062) would
  // otherwise outlive the reset and lock tomorrow's sample punches.
  const { error: periodsError } = await admin.rpc("pay_periods_reset_demo", { p_org: DEMO_ORG_ID });
  if (periodsError) {
    console.error("[cron/demo-reset] pay_periods_reset_demo failed:", periodsError);
    await alertCronFailed("pay_periods_reset_demo failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  let seeded;
  try {
    seeded = await seedDemoOrg(admin);
  } catch (err) {
    console.error("[cron/demo-reset] seed failed:", err);
    await alertCronFailed("reseeding the demo failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Delete only anonymous users — a real account that somehow ended up with
  // demo membership must never be destroyed by a cron job.
  let deletedUsers = 0;
  for (const id of visitorIds) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error || !data.user?.is_anonymous) continue;
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) {
      console.error(`[cron/demo-reset] failed to delete anonymous user ${id}:`, deleteError);
      continue;
    }
    deletedUsers++;
  }

  // A daily recap of the day's demo traffic, sent only when there was some.
  if (visitorIds.length > 0) {
    await sendNtfy({
      title: "Daily demo recap",
      message: `${visitorIds.length} demo visitor${visitorIds.length === 1 ? "" : "s"} since the last reset.`,
      tags: ["bar_chart"],
      priority: 2,
    });
  }

  return NextResponse.json({ ...seeded, deletedUsers });
}
