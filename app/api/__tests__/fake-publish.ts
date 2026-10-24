import type { FakeDb } from "./fake-db";

// publish_drafts (migration 0071): takes the drafts it's given and applies
// them in one go, as the SQL function does in one transaction.
export function publishDrafts({ p_org, p_draft_ids }: Record<string, any>, db: FakeDb) {
  const drafts = db.rows("draft_schedules");
  const claimed = drafts.filter((d) => d.org_id === p_org && p_draft_ids.includes(d.id));
  db.tables.draft_schedules = drafts.filter((d) => !claimed.includes(d));
  const removes = new Set(claimed.filter((c) => c.removes).map((c) => c.replaces_schedule_id));
  db.tables.schedules = db.rows("schedules").filter((s) => !(s.org_id === p_org && removes.has(s.id)));
  for (const c of claimed.filter((c) => c.replaces_schedule_id != null && !c.removes)) {
    const live = db.rows("schedules").find((s) => s.org_id === p_org && s.id === c.replaces_schedule_id);
    if (live) Object.assign(live, { start_minutes: c.start_minutes, end_minutes: c.end_minutes, note: c.note ?? null });
  }
  let nextId = Math.max(0, ...db.rows("schedules").map((s) => s.id)) + 1;
  for (const c of claimed.filter((c) => c.replaces_schedule_id == null)) {
    db.rows("schedules").push({ id: nextId++, org_id: p_org, employee_id: c.employee_id, date: c.date, start_minutes: c.start_minutes, end_minutes: c.end_minutes, note: c.note ?? null });
  }
  return { status: "ok", claimed };
}
