import { createAdminClient } from "@/lib/supabase-admin";
import { buildEmployeeCalendar, hashFeedToken, isFeedTokenShape } from "@/lib/calendar-feed";
import { resolveTimezone } from "@/lib/dates";

export const dynamic = "force-dynamic";

// How often calendar apps are asked to re-fetch a feed.
const REFRESH_MINUTES = 60;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// GET /api/calendar/<token>.ics — a person's shifts as a subscribable
// calendar. No session: calendar apps fetch it on their own, so the secret
// token in the URL is the credential. It's looked up by hash and only ever
// returns the one employee's shifts in the token's own organization.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
  if (!isFeedTokenShape(token)) return notFound();

  const admin = createAdminClient();
  const { data: feed } = await admin
    .from("calendar_feeds")
    .select("org_id, employee_id")
    .eq("token_hash", hashFeedToken(token))
    .maybeSingle();
  if (!feed) return notFound();

  const [{ data: emp }, { data: tzRows }] = await Promise.all([
    admin.from("employees").select("id, name").eq("org_id", feed.org_id).eq("id", feed.employee_id).maybeSingle(),
    admin.from("app_settings").select("key, value").eq("org_id", feed.org_id).eq("key", "timezone"),
  ]);
  if (!emp) return notFound();

  const timezone = resolveTimezone((tzRows ?? []).find((r: { key: string }) => r.key === "timezone")?.value);
  const { ics, error } = await buildEmployeeCalendar(admin, {
    orgId: feed.org_id,
    employee: emp,
    timezone,
    refreshMinutes: REFRESH_MINUTES,
  });
  if (error) {
    console.error("[api/calendar/feed]", error);
    return new Response("Calendar unavailable", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="shifts.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
