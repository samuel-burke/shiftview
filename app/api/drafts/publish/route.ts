import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { withOrgAll } from "@/lib/org-scope";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { weekDates } from "@/lib/draft-metrics";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const { weekStart } = await request.json();

  if (!weekStart)
    return NextResponse.json({ error: "weekStart required" }, { status: 400 });
  if (!DATE_RE.test(weekStart))
    return NextResponse.json({ error: "weekStart must be YYYY-MM-DD" }, { status: 400 });

  const supabase = await createClient();
  const { user, orgId, error: authError } = await requireManager(supabase, request);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const dates = weekDates(weekStart);

  const { data: drafts, error: draftsError } = await supabase
    .from("draft_schedules")
    .select("id, employee_id, date, start_minutes, end_minutes")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6]);

  if (draftsError) {
    console.error("[api/drafts/publish]", draftsError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!drafts?.length)
    return NextResponse.json({ error: "No draft shifts to publish for this week" }, { status: 400 });

  const { data: existing, error: existingError } = await supabase
    .from("schedules")
    .select("employee_id, date")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6]);

  if (existingError) {
    console.error("[api/drafts/publish]", existingError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const dateKey = (d: unknown) => (typeof d === "string" ? d.slice(0, 10) : String(d));
  const taken = new Set((existing ?? []).map((s) => `${s.employee_id}|${dateKey(s.date)}`));

  const toPublish = drafts.filter((d) => !taken.has(`${d.employee_id}|${dateKey(d.date)}`));

  if (toPublish.length > 0) {
    const { error: insertError } = await supabase
      .from("schedules")
      .insert(withOrgAll(orgId!, toPublish.map((d) => ({
        employee_id:   d.employee_id,
        date:          dateKey(d.date),
        start_minutes: d.start_minutes,
        end_minutes:   d.end_minutes,
      }))));

    if (insertError) {
      console.error("[api/drafts/publish]", insertError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  const { error: deleteError } = await supabase
    .from("draft_schedules")
    .delete()
    .eq("org_id", orgId)
    .in("id", drafts.map((d) => d.id));

  if (deleteError) {
    console.error("[api/drafts/publish] cleanup failed", deleteError);
  }

  const publishedEmployeeIds = [...new Set(toPublish.map((d) => d.employee_id))];
  if (publishedEmployeeIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, user_id")
      .eq("org_id", orgId)
      .in("id", publishedEmployeeIds);
    for (const emp of emps ?? []) {
      if (!emp.user_id) continue;
      notify(supabase, {
        orgId:  orgId!,
        userId: emp.user_id,
        type:   "shift_change",
        title:  "Schedule Published",
        body:   `Your schedule for the week of ${dates[0]} has been published`,
        data:   { weekStart: dates[0] },
      }).catch(() => {});
    }
  }

  writeAuditLog({
    action:       "draft_schedule.publish",
    orgId:        orgId!,
    actorId:      user?.id,
    resourceType: "draft_schedule",
    resourceId:   weekStart,
    after: { published: toPublish.length, skipped: drafts.length - toPublish.length },
    metadata: { weekStart: dates[0], weekEnd: dates[6] },
  }).catch(() => {});

  return NextResponse.json({ published: toPublish.length, skipped: drafts.length - toPublish.length });
}
