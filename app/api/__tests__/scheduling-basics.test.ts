// Route tests against the in-memory database (fake-db.ts), so reads see
// earlier writes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";
import { MOCK_ORG_ID } from "./helpers";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { notify } from "@/lib/notify";
import { hashFeedToken } from "@/lib/calendar-feed";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
  notifyManagers: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

import * as schedules from "../schedules/route";
import * as drafts from "../drafts/route";
import * as publish from "../drafts/publish/route";
import * as timeOff from "../time-off/route";
import * as timeOffDecision from "../time-off/[id]/route";
import * as feed from "../my-schedule/calendar/feed/route";
import * as publicFeed from "../calendar/[token]/route";

const ORG = MOCK_ORG_ID;
const OTHER_ORG = "00000000-0000-0000-0000-0000000000aa";
const MANAGER = { id: "user-manager", email: "m@test.com" };
const ALICE = { id: "user-alice", email: "a@test.com" };
const mockNotify = vi.mocked(notify);

// Far enough ahead to always be "today or later" for time-off requests.
const FUTURE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
})();
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function seed(): Record<string, Record<string, unknown>[]> {
  return {
    managers: [{ id: 1, user_id: MANAGER.id, org_id: ORG, is_owner: true }],
    employees: [
      { id: 5, org_id: ORG, user_id: ALICE.id, name: "Alice" },
      { id: 6, org_id: ORG, user_id: null, name: "Ben" },
      { id: 50, org_id: OTHER_ORG, user_id: "user-other", name: "Other" },
    ],
    app_settings: [],
    schedules: [],
    draft_schedules: [],
    time_off_requests: [],
    availability: [],
    calendar_feeds: [],
  };
}

let db: FakeDb;
function signIn(user: { id: string; email?: string } | null) {
  db = createFakeDb(db ? db.tables : seed(), {
    user,
    unique: {
      schedules: [["org_id", "employee_id", "date"]],
      time_off_requests: [["org_id", "employee_id", "date"]],
      calendar_feeds: [["org_id", "employee_id"], ["token_hash"]],
    },
  });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
}

const req = (method: string, body?: unknown, url = "http://localhost/api/x") =>
  new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  db = undefined as unknown as FakeDb;
  mockNotify.mockClear();
  signIn(MANAGER);
});

describe("removing a shift", () => {
  it("tells the employee their shift is gone", async () => {
    db.rows("schedules").push({ id: 10, org_id: ORG, employee_id: 5, date: FUTURE, start_minutes: 540, end_minutes: 1020 });
    const res = await schedules.DELETE(req("DELETE", { id: 10 }));
    expect(res.status).toBe(200);
    expect(db.rows("schedules")).toHaveLength(0);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG,
      userId: ALICE.id,
      type: "shift_change",
      title: "Shift Removed",
      data: expect.objectContaining({ scheduleId: 10, date: FUTURE, removed: true }),
    }));
  });

  it("notifies nobody when the person has no account", async () => {
    db.rows("schedules").push({ id: 11, org_id: ORG, employee_id: 6, date: FUTURE, start_minutes: 540, end_minutes: 1020 });
    await schedules.DELETE(req("DELETE", { id: 11 }));
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("can't remove (or announce) another org's shift", async () => {
    db.rows("schedules").push({ id: 12, org_id: OTHER_ORG, employee_id: 50, date: FUTURE, start_minutes: 540, end_minutes: 1020 });
    await schedules.DELETE(req("DELETE", { id: 12 }));
    expect(db.rows("schedules")).toHaveLength(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("scheduling rules on hand-made shifts", () => {
  const closing = () =>
    db.rows("schedules").push({ id: 20, org_id: ORG, employee_id: 5, date: FUTURE, start_minutes: 960, end_minutes: 1380 });

  it("warns about a clopen and saves nothing", async () => {
    closing();
    const res = await schedules.POST(req("POST", { employeeId: 5, date: addDays(FUTURE, 1), startMinutes: 360, endMinutes: 840 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflict).toBe("rules");
    expect(body.warnings.map((w: { rule: string }) => w.rule)).toEqual(["rest"]);
    expect(body.message).toMatch(/Only 7h rest/);
    expect(db.rows("schedules")).toHaveLength(1);
  });

  it("follows the org's own rest rule", async () => {
    closing();
    db.rows("app_settings").push({ org_id: ORG, key: "sched_min_rest_minutes", value: "420" });
    const res = await schedules.POST(req("POST", { employeeId: 5, date: addDays(FUTURE, 1), startMinutes: 360, endMinutes: 840 }));
    expect(res.status).toBe(201);
  });

  it("saves when the manager overrides", async () => {
    closing();
    const res = await schedules.POST(req("POST", { employeeId: 5, date: addDays(FUTURE, 1), startMinutes: 360, endMinutes: 840, override: true }));
    expect(res.status).toBe(201);
    expect(db.rows("schedules")).toHaveLength(2);
  });

  it("checks an edit against the person's other shifts, not the shift itself", async () => {
    closing();
    db.rows("schedules").push({ id: 21, org_id: ORG, employee_id: 5, date: addDays(FUTURE, 1), start_minutes: 720, end_minutes: 1200 });
    const later = await schedules.PUT(req("PUT", { id: 21, startMinutes: 780, endMinutes: 1200 }));
    expect(later.status).toBe(200);
    const early = await schedules.PUT(req("PUT", { id: 21, startMinutes: 360, endMinutes: 840 }));
    expect(early.status).toBe(409);
    expect((await early.json()).conflict).toBe("rules");
  });

  it("warns on drafts too, counting both live and draft shifts", async () => {
    db.rows("draft_schedules").push({ id: 30, org_id: ORG, employee_id: 5, date: FUTURE, start_minutes: 960, end_minutes: 1380 });
    const res = await drafts.POST(req("POST", { employeeId: 5, date: addDays(FUTURE, 1), startMinutes: 360, endMinutes: 840 }));
    expect(res.status).toBe(409);
    expect((await res.json()).conflict).toBe("rules");
  });
});

describe("shift notes", () => {
  it("saves, returns, edits, and clears a note", async () => {
    const created = await schedules.POST(req("POST", { employeeId: 6, date: FUTURE, startMinutes: 540, endMinutes: 1020, note: "  Truck at 7  " }));
    expect(created.status).toBe(201);
    const row = db.rows("schedules")[0];
    expect(row.note).toBe("Truck at 7");

    const list = await schedules.GET(new Request(`http://localhost/api/schedules?date=${FUTURE}`));
    expect((await list.json())[0].note).toBe("Truck at 7");

    await schedules.PUT(req("PUT", { id: row.id, startMinutes: 540, endMinutes: 1020, note: "Train Ben" }));
    expect(row.note).toBe("Train Ben");
    // Leaving the note out of an edit keeps it.
    await schedules.PUT(req("PUT", { id: row.id, startMinutes: 600, endMinutes: 1020 }));
    expect(row.note).toBe("Train Ben");
    await schedules.PUT(req("PUT", { id: row.id, startMinutes: 600, endMinutes: 1020, note: "" }));
    expect(row.note).toBeNull();
  });

  it("refuses a note over 280 characters", async () => {
    const res = await schedules.POST(req("POST", { employeeId: 6, date: FUTURE, startMinutes: 540, endMinutes: 1020, note: "x".repeat(281) }));
    expect(res.status).toBe(422);
    expect(db.rows("schedules")).toHaveLength(0);
  });

  it("carries a draft's note to the live schedule when the week is published", async () => {
    const res = await drafts.POST(req("POST", { employeeId: 6, date: FUTURE, startMinutes: 540, endMinutes: 1020, note: "Cover register" }));
    expect(res.status).toBeLessThan(300);
    expect(db.rows("draft_schedules")[0].note).toBe("Cover register");
    const published = await publish.POST(req("POST", { weekStart: FUTURE }));
    expect(published.status).toBe(200);
    expect(db.rows("schedules")).toEqual([expect.objectContaining({ employee_id: 6, date: FUTURE, note: "Cover register" })]);
  });
});

describe("requesting time off", () => {
  beforeEach(() => signIn(ALICE));

  it("stores several days as one request", async () => {
    const res = await timeOff.POST(req("POST", { employeeId: 5, date: FUTURE, endDate: addDays(FUTURE, 2), note: "Trip" }));
    expect(res.status).toBe(201);
    const rows = db.rows("time_off_requests");
    expect(rows.map((r) => r.date)).toEqual([FUTURE, addDays(FUTURE, 1), addDays(FUTURE, 2)]);
    expect(new Set(rows.map((r) => r.group_id)).size).toBe(1);
    expect(rows[0].group_id).toBeTruthy();
    expect(rows.every((r) => r.status === undefined || r.status === "pending")).toBe(true);

    // The employee sees it as one request.
    const mine = await (await timeOff.GET(req("GET"))).json();
    const list = Array.isArray(mine) ? mine : mine.requests ?? mine;
    const entry = list.find((r: { date: string }) => String(r.date).slice(0, 10) === FUTURE);
    expect(entry).toMatchObject({ endDate: addDays(FUTURE, 2), days: 3 });
  });

  it("stores part of a day", async () => {
    const res = await timeOff.POST(req("POST", { employeeId: 5, date: FUTURE, startMinutes: 900, endMinutes: 1080 }));
    expect(res.status).toBe(201);
    expect(db.rows("time_off_requests")[0]).toMatchObject({ start_minutes: 900, end_minutes: 1080 });
    expect(db.rows("time_off_requests")[0].group_id ?? null).toBeNull();
  });

  it("names the days already asked for, and stores none of the new request", async () => {
    db.rows("time_off_requests").push({ id: 1, org_id: ORG, employee_id: 5, date: addDays(FUTURE, 1), status: "denied" });
    const res = await timeOff.POST(req("POST", { employeeId: 5, date: FUTURE, endDate: addDays(FUTURE, 2) }));
    expect(res.status).toBe(409);
    expect((await res.json()).dates).toEqual([addDays(FUTURE, 1)]);
    expect(db.rows("time_off_requests")).toHaveLength(1);
  });

  it("refuses a request for someone else", async () => {
    const res = await timeOff.POST(req("POST", { employeeId: 6, date: FUTURE }));
    expect(res.status).toBe(403);
  });
});

describe("deciding a multi-day request", () => {
  function pending(days: number) {
    for (let i = 0; i < days; i++) {
      db.rows("time_off_requests").push({
        id: 100 + i, org_id: ORG, employee_id: 5, date: addDays(FUTURE, i), status: "pending",
        start_minutes: null, end_minutes: null, group_id: days > 1 ? "group-1" : null,
      });
    }
  }
  const decide = (id: number, body: unknown) =>
    timeOffDecision.PUT(req("PUT", body), params({ id: String(id) }));

  it("approves every day of the request together and tells the employee once", async () => {
    pending(3);
    const res = await decide(101, { status: "approved" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ids: [100, 101, 102] });
    expect(db.rows("time_off_requests").map((r) => r.status)).toEqual(["approved", "approved", "approved"]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: ALICE.id, type: "pto_approved" }));
  });
});
describe("approving time off over scheduled shifts", () => {
  function pending(days: number, window?: { start: number; end: number }) {
    const group = days > 1 ? "group-1" : null;
    for (let i = 0; i < days; i++) {
      db.rows("time_off_requests").push({
        id: 100 + i, org_id: ORG, employee_id: 5, date: addDays(FUTURE, i), status: "pending",
        start_minutes: window?.start ?? null, end_minutes: window?.end ?? null, group_id: group,
      });
    }
  }
  const shift = (id: number, offset: number, start = 540, end = 1020) =>
    db.rows("schedules").push({ id, org_id: ORG, employee_id: 5, date: addDays(FUTURE, offset), start_minutes: start, end_minutes: end });
  const decide = (id: number, body: unknown) =>
    timeOffDecision.PUT(req("PUT", body), params({ id: String(id) }));

  it("approves straight away when nothing clashes", async () => {
    pending(1);
    shift(1, 3);
    const res = await decide(100, { status: "approved" });
    expect(res.status).toBe(200);
    expect(db.rows("time_off_requests")[0].status).toBe("approved");
    expect(db.rows("schedules")).toHaveLength(1);
  });

  it("asks first when they're scheduled, and changes nothing", async () => {
    pending(1);
    shift(1, 0);
    const res = await decide(100, { status: "approved" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ conflict: "scheduled", shifts: [{ id: 1, date: FUTURE, startMinutes: 540, endMinutes: 1020 }] });
    expect(db.rows("time_off_requests")[0].status).toBe("pending");
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("removes the shifts (and matching drafts) when asked, and tells the employee", async () => {
    pending(3);
    shift(1, 0);
    shift(2, 2);
    shift(3, 5); // outside the request
    db.rows("draft_schedules").push({ id: 9, org_id: ORG, employee_id: 5, date: addDays(FUTURE, 1), start_minutes: 540, end_minutes: 1020 });
    const res = await decide(101, { status: "approved", resolve: "remove" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ids: [100, 101, 102], removedShifts: [1, 2], keptShifts: [] });
    expect(db.rows("time_off_requests").every((r) => r.status === "approved")).toBe(true);
    expect(db.rows("schedules").map((s) => s.id)).toEqual([3]);
    expect(db.rows("draft_schedules")).toHaveLength(0);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      userId: ALICE.id,
      type: "pto_approved",
      body: expect.stringMatching(/2 shifts during that time were removed/),
    }));
  });

  it("keeps the shifts when asked", async () => {
    pending(1);
    shift(1, 0);
    const res = await decide(100, { status: "approved", resolve: "keep" });
    expect(await res.json()).toMatchObject({ removedShifts: [], keptShifts: [1] });
    expect(db.rows("schedules")).toHaveLength(1);
    expect(db.rows("time_off_requests")[0].status).toBe("approved");
  });

  it("only counts shifts that meet a part-day request", async () => {
    pending(1, { start: 900, end: 1080 });
    shift(1, 0, 480, 900); // ends as the time off starts
    expect((await decide(100, { status: "approved" })).status).toBe(200);
  });

  it("counts an overnight shift from the day before", async () => {
    pending(1);
    shift(1, -1, 1320, 1800);
    expect((await decide(100, { status: "approved" })).status).toBe(409);
  });

  it("denies the whole multi-day request without looking at shifts", async () => {
    pending(2);
    shift(1, 0);
    const res = await decide(100, { status: "denied" });
    expect(res.status).toBe(200);
    expect(db.rows("time_off_requests").map((r) => r.status)).toEqual(["denied", "denied"]);
    expect(db.rows("schedules")).toHaveLength(1);
  });

  it("answers 404 for another org's request", async () => {
    db.rows("time_off_requests").push({ id: 300, org_id: OTHER_ORG, employee_id: 50, date: FUTURE, status: "pending" });
    expect((await decide(300, { status: "approved" })).status).toBe(404);
    expect(db.rows("time_off_requests")[0].status).toBe("pending");
  });

  it("refuses an unknown resolve", async () => {
    expect((await decide(100, { status: "approved", resolve: "maybe" })).status).toBe(400);
  });
});

describe("calendar subscription", () => {
  beforeEach(() => signIn(ALICE));

  it("creates a feed whose URL serves only the person's shifts, then replaces and turns it off", async () => {
    db.rows("schedules").push(
      { id: 1, org_id: ORG, employee_id: 5, date: addDays(new Date().toISOString().slice(0, 10), 2), start_minutes: 540, end_minutes: 1020, note: "Inventory" },
      { id: 2, org_id: ORG, employee_id: 6, date: addDays(new Date().toISOString().slice(0, 10), 2), start_minutes: 540, end_minutes: 1020 },
    );
    expect(await (await feed.GET(req("GET"))).json()).toMatchObject({ active: false });

    const created = await feed.POST(req("POST", undefined, "https://app.test/api/my-schedule/calendar/feed"));
    expect(created.status).toBe(201);
    const { url } = await created.json();
    expect(url).toMatch(/^https:\/\/app\.test\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    const token = url.split("/").pop()!.replace(/\.ics$/, "");
    // Only the hash is stored.
    expect(db.rows("calendar_feeds")).toEqual([expect.objectContaining({ org_id: ORG, employee_id: 5, token_hash: hashFeedToken(token) })]);
    expect(JSON.stringify(db.rows("calendar_feeds"))).not.toContain(token);
    expect(await (await feed.GET(req("GET"))).json()).toMatchObject({ active: true });

    const ics = await publicFeed.GET(req("GET"), params({ token: `${token}.ics` }));
    expect(ics.status).toBe(200);
    expect(ics.headers.get("Content-Type")).toMatch(/text\/calendar/);
    const text = await ics.text();
    expect(text).toContain(`shiftview-1-${ORG}`);
    expect(text).not.toContain(`shiftview-2-${ORG}`);
    expect(text).toContain("Inventory");
    expect(text).toContain("REFRESH-INTERVAL");

    // A new link replaces the old one.
    const again = await (await feed.POST(req("POST", undefined, "https://app.test/x"))).json();
    expect(db.rows("calendar_feeds")).toHaveLength(1);
    expect((await publicFeed.GET(req("GET"), params({ token: `${token}.ics` }))).status).toBe(404);
    const newToken = again.url.split("/").pop()!.replace(/\.ics$/, "");
    expect((await publicFeed.GET(req("GET"), params({ token: newToken }))).status).toBe(200);

    // Turning it off kills the link.
    expect((await feed.DELETE(req("DELETE"))).status).toBe(200);
    expect(db.rows("calendar_feeds")).toHaveLength(0);
    expect((await publicFeed.GET(req("GET"), params({ token: newToken }))).status).toBe(404);
  });

  it("refuses malformed and unknown tokens without a lookup", async () => {
    expect((await publicFeed.GET(req("GET"), params({ token: "nope.ics" }))).status).toBe(404);
    expect(db.calls.some((c) => c.table === "calendar_feeds")).toBe(false);
    expect((await publicFeed.GET(req("GET"), params({ token: "a".repeat(43) }))).status).toBe(404);
  });

  it("needs a signed-in team member", async () => {
    signIn(null);
    expect((await feed.POST(req("POST"))).status).toBe(401);
    signIn(MANAGER); // a manager with no employee record has no schedule
    expect((await feed.POST(req("POST"))).status).toBe(403);
    expect(db.rows("calendar_feeds")).toHaveLength(0);
  });
});
