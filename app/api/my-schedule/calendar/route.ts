import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getOrgContext } from "@/lib/org-context";
import { fmtMinutes } from "@/data/types";
import { buildShiftCalendar, type ShiftEvent } from "@/lib/ics";

export const dynamic = "force-dynamic";

// How wide a window of shifts to include in the calendar download.
const PAST_DAYS = 30;
const FUTURE_DAYS = 120;

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
// import into Google/Apple/Outlook calendars.
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

  const now = new Date();
  const from = addDays(now, -PAST_DAYS);
  const to = addDays(now, FUTURE_DAYS);

  const { data, error: dbError } = await supabase
    .from("schedules")
    .select("id, date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .eq("employee_id", emp.id)
    .gte("date", from)
    .lte("date", to)
    .order("date");

  if (dbError) {
    console.error("[api/my-schedule/calendar]", dbError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const events: ShiftEvent[] = (data ?? []).map((s) => ({
    // Stable UID keyed on the schedule row id so re-importing updates the same
    // event instead of creating a duplicate.
    uid: `shiftview-${s.id}-${orgId}@shiftview.app`,
    date: s.date,
    startMinutes: s.start_minutes,
    endMinutes: s.end_minutes,
    summary: `Shift · ${fmtMinutes(s.start_minutes)}–${fmtMinutes(s.end_minutes)}`,
    description: `${emp.name}'s shift`,
  }));

  return icsResponse(
    buildShiftCalendar(events, { calendarName: `${emp.name} — Shifts`, dtstamp: now })
  );
}
