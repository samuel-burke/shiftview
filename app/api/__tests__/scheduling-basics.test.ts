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

const ORG = MOCK_ORG_ID;
const OTHER_ORG = "00000000-0000-0000-0000-0000000000aa";
const MANAGER = { id: "user-manager", email: "m@test.com" };
const ALICE = { id: "user-alice", email: "a@test.com" };
const mockNotify = vi.mocked(notify);

// A day safely in the future.
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
    availability: [],
    time_off_requests: [],
  };
}

let db: FakeDb;
function signIn(user: { id: string; email?: string } | null) {
  db = createFakeDb(db ? db.tables : seed(), {
    user,
    unique: {
      schedules: [["org_id", "employee_id", "date"]],
    },
  });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
}

const req = (method: string, body?: unknown, url = "http://localhost/api/x") =>
  new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

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
