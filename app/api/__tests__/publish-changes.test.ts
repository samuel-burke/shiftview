// Changing a published week in Draft mode, end to end against the in-memory
// database: draft a change or removal of a live shift, publish, and each
// person gets one notification saying what changed for them.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";
import { publishDrafts } from "./fake-publish";
import { MOCK_ORG_ID } from "./helpers";
import { createClient } from "@/lib/supabase-server";
import { notify } from "@/lib/notify";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined), notifyManagers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

import * as drafts from "../drafts/route";
import * as publish from "../drafts/publish/route";

const ORG = MOCK_ORG_ID;
const OTHER_ORG = "00000000-0000-0000-0000-0000000000aa";
const MANAGER = { id: "user-manager" };
const WEEK = "2026-10-17"; // a Saturday
const day = (n: number) => {
  const d = new Date(`${WEEK}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mockNotify = vi.mocked(notify);

let db: FakeDb;
beforeEach(() => {
  mockNotify.mockClear();
  db = createFakeDb(
    {
      managers: [{ id: 1, user_id: MANAGER.id, org_id: ORG, is_owner: true }],
      employees: [
        { id: 5, org_id: ORG, user_id: "user-alice", name: "Alice" },
        { id: 6, org_id: ORG, user_id: "user-ben", name: "Ben" },
        { id: 7, org_id: ORG, user_id: "user-cara", name: "Cara" },
      ],
      app_settings: [],
      availability: [],
      time_off_requests: [],
      schedule_generation_runs: [],
      schedules: [
        { id: 1, org_id: ORG, employee_id: 5, date: day(1), start_minutes: 540, end_minutes: 1020, note: null },
        { id: 2, org_id: ORG, employee_id: 5, date: day(2), start_minutes: 540, end_minutes: 1020, note: null },
        { id: 3, org_id: ORG, employee_id: 6, date: day(1), start_minutes: 540, end_minutes: 1020, note: null },
        { id: 50, org_id: OTHER_ORG, employee_id: 99, date: day(1), start_minutes: 540, end_minutes: 1020 },
      ],
      draft_schedules: [],
    },
    {
      user: MANAGER,
      rpc: { publish_drafts: publishDrafts },
      unique: {
        schedules: [["org_id", "employee_id", "date"]],
        draft_schedules: [["org_id", "employee_id", "date"], ["replaces_schedule_id"]],
      },
    }
  );
  vi.mocked(createClient).mockResolvedValue(db.client as never);
});

const post = (body: unknown) => drafts.POST(new Request("http://localhost/api/drafts", { method: "POST", body: JSON.stringify(body) }));
const put = (body: unknown) => drafts.PUT(new Request("http://localhost/api/drafts", { method: "PUT", body: JSON.stringify(body) }));
const publishWeek = () => publish.POST(new Request("http://localhost/api/drafts/publish", { method: "POST", body: JSON.stringify({ weekStart: WEEK }) }));
const live = (id: number) => db.rows("schedules").find((s) => s.id === id);

describe("drafting a change to a live shift", () => {
  it("records the change without touching the live shift or telling anyone", async () => {
    const res = await post({ replacesScheduleId: 1, startMinutes: 600, endMinutes: 1080, note: "Open late" });
    expect(res.status).toBe(201);
    expect(db.rows("draft_schedules")).toEqual([
      expect.objectContaining({ employee_id: 5, date: day(1), start_minutes: 600, end_minutes: 1080, note: "Open late", replaces_schedule_id: 1 }),
    ]);
    expect(live(1)).toMatchObject({ start_minutes: 540, end_minutes: 1020 });
    expect(mockNotify).not.toHaveBeenCalled();

    const list = await (await drafts.GET(new Request(`http://localhost/api/drafts?weekStart=${WEEK}`))).json();
    expect(list[0]).toMatchObject({ replacesScheduleId: 1, removes: false, startMinutes: 600 });
  });

  it("keeps the live shift's note unless the change says otherwise", async () => {
    live(1)!.note = "Keys";
    await post({ replacesScheduleId: 1, startMinutes: 600, endMinutes: 1080 });
    expect(db.rows("draft_schedules")[0].note).toBe("Keys");
  });

  it("drafts a removal", async () => {
    expect((await post({ replacesScheduleId: 2, remove: true })).status).toBe(201);
    expect(db.rows("draft_schedules")[0]).toMatchObject({ replaces_schedule_id: 2, removes: true, start_minutes: 540, end_minutes: 1020 });
  });

  it("allows one draft per live shift", async () => {
    await post({ replacesScheduleId: 1, startMinutes: 600, endMinutes: 1080 });
    expect((await post({ replacesScheduleId: 1, remove: true })).status).toBe(409);
  });

  it("refuses another org's shift", async () => {
    expect((await post({ replacesScheduleId: 50, remove: true })).status).toBe(404);
    expect(db.rows("draft_schedules")).toHaveLength(0);
  });

  it("still refuses a plain new draft on a day with an unchanged live shift", async () => {
    const res = await post({ employeeId: 5, date: day(1), startMinutes: 600, endMinutes: 1080 });
    expect(res.status).toBe(409);
    expect((await res.json()).live).toBe(true);
  });

  it("checks the scheduling rules against the changed times, not the old ones", async () => {
    // Alice works 9–5 on day 2. Moving day 1 to close at 11 PM leaves 10h rest: fine.
    expect((await post({ replacesScheduleId: 1, startMinutes: 900, endMinutes: 1380 })).status).toBe(201);
    // Now moving day 2 to open at 6 AM leaves 7h after the changed day 1: a clopen.
    const res = await post({ replacesScheduleId: 2, startMinutes: 360, endMinutes: 840 });
    expect(res.status).toBe(409);
    expect((await res.json()).conflict).toBe("rules");
  });

  it("turns a removal back into a change when it's edited", async () => {
    await post({ replacesScheduleId: 2, remove: true });
    const id = db.rows("draft_schedules")[0].id;
    expect((await put({ id, startMinutes: 600, endMinutes: 1020 })).status).toBe(200);
    expect(db.rows("draft_schedules")[0]).toMatchObject({ removes: false, start_minutes: 600 });
  });
});

describe("publishing changes", () => {
  it("applies changes, removals and new shifts, and tells each person once", async () => {
    await post({ replacesScheduleId: 1, startMinutes: 600, endMinutes: 1080 });  // Alice day 1: changed
    await post({ replacesScheduleId: 2, remove: true });                           // Alice day 2: removed
    await post({ employeeId: 7, date: day(3), startMinutes: 540, endMinutes: 1020 }); // Cara: new week

    const res = await publishWeek();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ published: 1, changed: 1, removed: 1, skipped: 0 });

    expect(live(1)).toMatchObject({ start_minutes: 600, end_minutes: 1080 });
    expect(live(2)).toBeUndefined();
    expect(db.rows("schedules").find((s) => s.employee_id === 7)).toMatchObject({ date: day(3) });
    expect(live(3)).toMatchObject({ start_minutes: 540 }); // Ben untouched
    expect(db.rows("draft_schedules")).toHaveLength(0);

    expect(mockNotify).toHaveBeenCalledTimes(2);
    const byUser = Object.fromEntries(mockNotify.mock.calls.map(([n]) => [n.userId, n]));
    expect(byUser["user-alice"]).toMatchObject({ title: "Schedule Updated" });
    expect(byUser["user-alice"].body).toMatch(/→/);
    expect(byUser["user-alice"].body).toMatch(/removed/);
    expect(byUser["user-cara"]).toMatchObject({ title: "Schedule Published" });
    expect(byUser["user-ben"]).toBeUndefined();
  });

  it("lets a new shift take a day freed by a removal in the same publish", async () => {
    await post({ replacesScheduleId: 3, remove: true }); // Ben day 1
    // The removal is the day's one draft for Ben; a different person can be added that day.
    await post({ employeeId: 7, date: day(1), startMinutes: 540, endMinutes: 1020 });
    const out = await (await publishWeek()).json();
    expect(out).toMatchObject({ published: 1, removed: 1 });
    expect(db.rows("schedules").filter((s) => s.date === day(1) && s.org_id === ORG).map((s) => s.employee_id).sort()).toEqual([5, 7]);
  });

  it("drops a change whose live shift was deleted meanwhile, without telling anyone", async () => {
    db.rows("draft_schedules").push({ id: 77, org_id: ORG, employee_id: 5, date: day(4), start_minutes: 540, end_minutes: 1020, replaces_schedule_id: 999, removes: false });
    const out = await (await publishWeek()).json();
    expect(out).toMatchObject({ published: 0, changed: 0, removed: 0 });
    expect(db.rows("draft_schedules")).toHaveLength(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("applies each draft once when two publishes race", async () => {
    await post({ replacesScheduleId: 1, startMinutes: 600, endMinutes: 1080 });
    await post({ employeeId: 7, date: day(3), startMinutes: 540, endMinutes: 1020 });
    const [a, b] = await Promise.all([publishWeek(), publishWeek()]);
    const results = [await a.json(), await b.json()];
    expect(results.reduce((n, r) => n + (r.published ?? 0), 0)).toBe(1);
    expect(results.reduce((n, r) => n + (r.changed ?? 0), 0)).toBe(1);
    expect(db.rows("schedules").filter((s) => s.employee_id === 7)).toHaveLength(1);
    expect(mockNotify).toHaveBeenCalledTimes(2); // Alice once, Cara once
  });

  it("skips a change that changes nothing", async () => {
    await post({ replacesScheduleId: 1, startMinutes: 540, endMinutes: 1020 });
    const out = await (await publishWeek()).json();
    expect(out).toMatchObject({ changed: 0 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(db.rows("draft_schedules")).toHaveLength(0);
  });
});
