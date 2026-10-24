import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { notify } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { weekDates } from "@/lib/draft-metrics";
import { isRealChange, summarizeChanges, type ScheduleChange } from "@/lib/schedule-changes";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type LiveRow = { id: number; employee_id: number; date: string; start_minutes: number; end_minutes: number; note?: string | null };
type DraftRow = LiveRow & { replaces_schedule_id?: number | null; removes?: boolean; generation_run_id?: number | null };

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

  // "*": replaces_schedule_id / removes come with migration 0071.
  const { data: draftData, error: draftsError } = await supabase
    .from("draft_schedules")
    .select("*")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6]);

  if (draftsError) {
    console.error("[api/drafts/publish]", draftsError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const drafts = (draftData ?? []) as DraftRow[];

  if (!drafts.length)
    return NextResponse.json({ error: "No draft shifts to publish for this week" }, { status: 400 });

  const { data: liveData, error: existingError } = await supabase
    .from("schedules")
    .select("id, employee_id, date, start_minutes, end_minutes, note")
    .eq("org_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates[6]);

  if (existingError) {
    console.error("[api/drafts/publish]", existingError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const liveRows = (liveData ?? []) as LiveRow[];
  const liveById = new Map(liveRows.map((r) => [r.id, r]));
  const hadLive = new Set(liveRows.map((r) => r.employee_id));

  const dateKey = (d: unknown) => (typeof d === "string" ? d.slice(0, 10) : String(d));
  const changesFor = new Map<number, ScheduleChange[]>();
  const record = (employeeId: number, c: ScheduleChange) => changesFor.set(employeeId, [...(changesFor.get(employeeId) ?? []), c]);
  const times = (r: { date: unknown; start_minutes: number; end_minutes: number; note?: string | null }) => ({
    date: dateKey(r.date), startMinutes: r.start_minutes, endMinutes: r.end_minutes, note: r.note ?? null,
  });

  // What publishing will do: changes to live shifts, then new shifts. A
  // draft for someone who still has a live shift that day (one no draft
  // changes or removes) is skipped and kept, so the manager can see it and
  // decide; never silently dropped.
  const changeDrafts = drafts.filter((d) => d.replaces_schedule_id != null);
  const removing = new Set(changeDrafts.filter((d) => d.removes && liveById.has(d.replaces_schedule_id!)).map((d) => d.replaces_schedule_id!));
  const taken = new Set(liveRows.filter((r) => !removing.has(r.id)).map((s) => `${s.employee_id}|${dateKey(s.date)}`));
  const newDrafts = drafts.filter((d) => d.replaces_schedule_id == null);
  const planned = newDrafts.filter((d) => !taken.has(`${d.employee_id}|${dateKey(d.date)}`));
  const skipped = newDrafts.filter((d) => taken.has(`${d.employee_id}|${dateKey(d.date)}`));

  // Take those drafts off the board and apply them in one transaction
  // (publish_drafts, migration 0071). It applies only the drafts it deleted:
  // a second publish running at the same time (a double click, two
  // managers) gets none of them, so nothing is applied twice. If any write
  // fails, every draft is kept and no live shift has changed.
  let claimed: DraftRow[] = [];
  const claimIds = [...changeDrafts, ...planned].map((d) => d.id);
  if (claimIds.length > 0) {
    const { data, error: publishError } = await supabase.rpc("publish_drafts", { p_org: orgId, p_draft_ids: claimIds });
    const result = data as { status?: string; claimed?: DraftRow[] } | null;
    if (publishError || result?.status !== "ok") {
      console.error("[api/drafts/publish]", publishError ?? result);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    claimed = result.claimed ?? [];
  }

  // What changed for whom. A change whose live shift is gone (deleted in
  // Live mode meanwhile) had nothing left to change.
  let changed = 0;
  let removed = 0;
  for (const d of claimed.filter((c) => c.replaces_schedule_id != null)) {
    const live = liveById.get(d.replaces_schedule_id!);
    if (!live) continue;
    if (d.removes) {
      removed++;
      record(live.employee_id, { kind: "removed", shift: times(live) });
      continue;
    }
    const before = times(live);
    const after = times(d);
    if (!isRealChange(before, after)) continue;
    changed++;
    record(live.employee_id, { kind: "changed", before, after });
  }
  const toPublish = claimed.filter((c) => c.replaces_schedule_id == null);
  for (const d of toPublish) record(d.employee_id, { kind: "added", shift: times(d) });

  if (toPublish.length > 0) {
    // Auto-schedule runs for the week can't be undone once their drafts are live.
    const { error: runsError } = await supabase
      .from("schedule_generation_runs")
      .update({ published_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("week_start", dates[0])
      .is("published_at", null);
    if (runsError) {
      console.error("[api/drafts/publish] marking generation runs published failed", runsError);
    }
  }

  // One notification per person, saying what changed for them.
  const affected = [...changesFor.keys()];
  if (affected.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, user_id")
      .eq("org_id", orgId)
      .in("id", affected);
    for (const emp of (emps ?? []) as { id: number; user_id: string | null }[]) {
      if (!emp.user_id) continue;
      const summary = summarizeChanges(dates[0], changesFor.get(emp.id) ?? [], hadLive.has(emp.id));
      if (!summary) continue;
      notify({
        orgId:  orgId!,
        userId: emp.user_id,
        type:   "shift_change",
        title:  summary.title,
        body:   summary.body,
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
    after: { published: toPublish.length, changed, removed, skipped: skipped.length },
    metadata: { weekStart: dates[0], weekEnd: dates[6] },
  }).catch(() => {});

  return NextResponse.json({
    published: toPublish.length,
    changed,
    removed,
    skipped: skipped.length,
    // Still drafts: these people already have a live shift that day.
    skippedDrafts: skipped.map((d) => ({ id: d.id, employeeId: d.employee_id, date: dateKey(d.date) })),
  });
}
