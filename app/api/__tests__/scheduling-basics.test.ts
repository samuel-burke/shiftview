// Route tests against the in-memory database (fake-db.ts), so reads see
// earlier writes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db";
import { MOCK_ORG_ID } from "./helpers";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { notify } from "@/lib/notify";

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
  };
}

let db: FakeDb;
function signIn(user: { id: string; email?: string } | null) {
  db = createFakeDb(db ? db.tables : seed(), {
    user,
    unique: {
      schedules: [["org_id", "employee_id", "date"]],
      time_off_requests: [["org_id", "employee_id", "date"]],
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

  it("denies the whole multi-day request", async () => {
    pending(2);
    const res = await decide(100, { status: "denied" });
    expect(res.status).toBe(200);
    expect(db.rows("time_off_requests").map((r) => r.status)).toEqual(["denied", "denied"]);
  });

  it("answers 404 for another org's request", async () => {
    db.rows("time_off_requests").push({ id: 300, org_id: OTHER_ORG, employee_id: 50, date: FUTURE, status: "pending" });
    expect((await decide(300, { status: "approved" })).status).toBe(404);
    expect(db.rows("time_off_requests")[0].status).toBe("pending");
  });
});
