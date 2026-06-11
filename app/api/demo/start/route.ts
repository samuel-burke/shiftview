import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { DEMO_ORG_ID, DEMO_MANAGER_EMAIL } from "@/lib/demo-org";
import { seedDemoOrg } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";

// Starts a demo session: signs the visitor in anonymously (requires "Allow
// anonymous sign-ins" in Supabase Auth settings), makes them a manager of the
// demo organization, and links them to the seeded demo-manager employee so
// My Schedule and the clock page work. The nightly /api/cron/demo-reset wipes
// memberships and deletes the anonymous users again.
//
// Best-effort rate limit: per-instance memory is all a serverless function
// has, but it still blunts naive loops hitting one warm instance. Real
// abuse pressure should be handled at the platform/WAF layer.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = await createClient();

  // Re-use an existing session where possible; never hijack a real account.
  const { data: { user: existing } } = await supabase.auth.getUser();
  if (existing && !existing.is_anonymous) {
    return NextResponse.json(
      { error: "Already signed in — sign out before starting a demo session" },
      { status: 409 }
    );
  }

  let userId = existing?.id ?? null;
  if (!userId) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      console.error("[api/demo/start] anonymous sign-in failed:", error);
      return NextResponse.json({ error: "Demo is unavailable right now" }, { status: 503 });
    }
    userId = data.user.id;
  }

  const admin = createAdminClient();

  // Manager membership (managers PK is (org_id, user_id), so this is idempotent).
  const { error: managerError } = await admin
    .from("managers")
    .upsert({ org_id: DEMO_ORG_ID, user_id: userId }, { onConflict: "org_id,user_id" });
  if (managerError) {
    console.error("[api/demo/start] manager upsert failed:", managerError);
    return NextResponse.json({ error: "Demo is unavailable right now" }, { status: 503 });
  }

  // Self-heal: if the demo org has never been seeded (or a reset wiped it and
  // the reseed failed), populate it now so the first visitor doesn't land on
  // an empty dashboard. The app_settings (org_id, key) primary key acts as a
  // mutex so concurrent first visitors can't double-seed.
  const { count: employeeCount } = await admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("org_id", DEMO_ORG_ID);
  if ((employeeCount ?? 0) === 0) {
    const { error: lockError } = await admin
      .from("app_settings")
      .insert({ org_id: DEMO_ORG_ID, key: "demo_seed_lock", value: new Date().toISOString() });
    if (!lockError) {
      try {
        await seedDemoOrg(admin);
      } catch (err) {
        console.error("[api/demo/start] self-seed failed:", err);
        // Non-fatal: the session still works, just without sample data.
      }
    }
  }

  // Claim the seeded demo-manager employee row for this visitor. Last visitor
  // wins; an earlier concurrent visitor degrades to manager-only, which every
  // page already handles (managers without a linked employee exist in prod).
  const { error: linkError } = await admin
    .from("employees")
    .update({ user_id: userId })
    .eq("org_id", DEMO_ORG_ID)
    .eq("email", DEMO_MANAGER_EMAIL);
  if (linkError) {
    console.error("[api/demo/start] employee link failed:", linkError);
    // Non-fatal: the session still works as manager-only.
  }

  return NextResponse.json({ ok: true });
}
