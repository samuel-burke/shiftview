import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { buildShiftCalendar } from "@/lib/ics";
import { getOrgTimezone } from "@/lib/org-timezone";
import { buildEmployeeCalendar } from "@/lib/calendar-feed";

export const dynamic = "force-dynamic";

function icsResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="my-shifts.ics"',
      "Cache-Control": "no-store",
    },
  });
}

// GET /api/my-schedule/calendar
// Downloads the signed-in employee's upcoming shifts as an .ics file they can
// import into Google/Apple/Outlook calendars. For a calendar that keeps up
// with changes, see ./feed (a subscription URL).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { ctx, error } = await getOrgContext(supabase, request);

  if (error === "Not authenticated")
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (error)
    return NextResponse.json({ error }, { status: 403 });

  const { orgId, employeeId } = ctx!;

  // No employee record → an empty (still valid) calendar rather than an error,
  // so a manager-only account importing the feed just sees nothing.
  if (employeeId == null) {
    return icsResponse(buildShiftCalendar([], { calendarName: "My Shifts — ShiftView" }));
  }

  const { data: emp } = await supabase
    .from("employees")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (!emp) {
    return icsResponse(buildShiftCalendar([], { calendarName: "My Shifts — ShiftView" }));
  }

  const tz = await getOrgTimezone(supabase, orgId);
  const { ics, error: dbError } = await buildEmployeeCalendar(supabase, { orgId, employee: emp, timezone: tz });
  if (dbError) {
    console.error("[api/my-schedule/calendar]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return icsResponse(ics);
}
