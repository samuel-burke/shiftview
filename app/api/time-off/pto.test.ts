// Time-off requests with a type and paid hours (migration 0064): filing,
// deciding (with the balance check) and cancelling.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@/lib/supabase-server";
import { fakeSupabase, type FakeOptions } from "../__tests__/fake-supabase";
import { MOCK_ORG_ID } from "../__tests__/helpers";
import { GET, POST } from "./route";
import { PUT } from "./[id]/route";
import { POST as CANCEL } from "./[id]/cancel/route";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const mockCreateClient = vi.mocked(createClient);
const ORG = MOCK_ORG_ID;

function world(userId: string | null, extra: Partial<FakeOptions> = {}, tables: Record<string, any[]> = {}) {
  const client = fakeSupabase({
    userId,
    tables: {
      managers: [{ user_id: "mgr", org_id: ORG, is_owner: true }],
      employees: [
        { id: 1, org_id: ORG, user_id: "emp1", name: "Ann" },
        { id: 2, org_id: ORG, user_id: "emp2", name: "Bob" },
      ],
      app_settings: [{ org_id: ORG, key: "timezone", value: "America/New_York" }],
      time_off_requests: [
        { id: 10, org_id: ORG, employee_id: 1, date: "2026-10-28", status: "pending", note: null, leave_type: "pto", paid_hours: "8.00" },
        { id: 11, org_id: ORG, employee_id: 2, date: "2026-10-29", status: "pending", note: null, leave_type: "unpaid", paid_hours: null },
        { id: 12, org_id: ORG, employee_id: 1, date: "2026-10-30", status: "cancelled", note: null, leave_type: "pto", paid_hours: "8.00" },
      ],
      pto_balances: [{ org_id: ORG, employee_id: 1, leave_type: "pto", balance: "5.00" }],
      ...tables,
    },
    insertResult: { time_off_requests: { data: { id: 99 }, error: null } },
    ...extra,
  });
  mockCreateClient.mockResolvedValue(client as any);
  return client;
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T16:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("POST /api/time-off with a type", () => {
  const file = (body: Record<string, unknown>) =>
    POST(new Request("http://localhost/api/time-off", json("POST", { employeeId: 1, date: "2026-10-26", ...body })));

  it("is unpaid by default, with no hours (as before)", async () => {
    const client = world("emp1");
    const res = await file({});
    expect(res.status).toBe(201);
    expect(client.writes[0].rows).toMatchObject({ leave_type: "unpaid", paid_hours: null });
  });

  it("a PTO day defaults to the day's scheduled hours", async () => {
    const client = world("emp1", {}, {
      schedules: [{ org_id: ORG, employee_id: 1, date: "2026-10-26", start_minutes: 540, end_minutes: 1005 }],
    });
    const res = await file({ leaveType: "pto" });
    expect(res.status).toBe(201);
    expect(client.writes[0].rows).toMatchObject({ leave_type: "pto", paid_hours: 7.75 });
    expect(await res.json()).toMatchObject({ leaveType: "pto", paidHours: 7.75 });
  });

  it("a sick day with no schedule is 8 hours", async () => {
    const client = world("emp1", {}, { schedules: [] });
    await file({ leaveType: "sick" });
    expect(client.writes[0].rows).toMatchObject({ leave_type: "sick", paid_hours: 8 });
  });

  it("a paid day on a DST night counts the real hours scheduled", async () => {
    const client = world("emp1", {}, {
      // Midnight–8 AM on the fall-back night is 9 hours.
      schedules: [{ org_id: ORG, employee_id: 1, date: "2026-11-01", start_minutes: 0, end_minutes: 480 }],
    });
    await POST(new Request("http://localhost/api/time-off", json("POST", { employeeId: 1, date: "2026-11-01", leaveType: "pto" })));
    expect(client.writes[0].rows).toMatchObject({ paid_hours: 9 });
  });

  it("keeps hours the employee gives", async () => {
    const client = world("emp1");
    await file({ leaveType: "pto", paidHours: 4 });
    expect(client.writes[0].rows).toMatchObject({ leave_type: "pto", paid_hours: 4 });
  });

  it("drops hours given for an unpaid day", async () => {
    const client = world("emp1");
    await file({ leaveType: "unpaid", paidHours: 4 });
    expect(client.writes[0].rows).toMatchObject({ leave_type: "unpaid", paid_hours: null });
  });

  it.each([[{ leaveType: "vacation" }], [{ leaveType: "pto", paidHours: 0 }], [{ leaveType: "pto", paidHours: 25 }], [{ leaveType: "pto", paidHours: "8" }]])(
    "400 for %j", async (body) => {
      world("emp1");
      expect((await file(body)).status).toBe(400);
    });

  it("an employee cannot file a paid day for someone else", async () => {
    world("emp1");
    expect((await POST(new Request("http://localhost/api/time-off", json("POST", { employeeId: 2, date: "2026-10-26", leaveType: "pto" })))).status).toBe(403);
  });
});

describe("GET /api/time-off with types", () => {
  it("the manager's queue shows type, hours and the employee's balance", async () => {
    world("mgr");
    const body = await (await GET(new Request("http://localhost/api/time-off"))).json();
    expect(body.requests).toEqual([
      expect.objectContaining({ id: 10, leaveType: "pto", paidHours: 8, balance: 5 }),
      expect.objectContaining({ id: 11, leaveType: "unpaid", paidHours: null, balance: null }),
    ]);
  });

  it("an employee's own list leaves out cancelled requests, so the day can be asked again", async () => {
    world("emp1");
    const body = await (await GET(new Request("http://localhost/api/time-off?mine=true"))).json();
    expect(body.requests.map((r: any) => r.id)).toEqual([10]);
  });
});

describe("PUT /api/time-off/[id] with paid hours", () => {
  const decide = (id: string, body: unknown) =>
    PUT(new Request(`http://localhost/api/time-off/${id}`, json("PUT", body)), params(id));

  it("passes the manager's type, hours and choice to decide_time_off", async () => {
    const client = world("mgr", { rpc: () => ({ data: { status: "ok", leave_type: "pto", paid_hours: 6, balance: -1 }, error: null }) });
    const res = await decide("10", { status: "approved", paidHours: 6, leaveType: "pto", allowNegative: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, balance: -1 });
    expect(client.rpc).toHaveBeenCalledWith("decide_time_off", {
      p_request: 10, p_status: "approved", p_leave_type: "pto", p_paid_hours: 6, p_allow_negative: true,
    });
  });

  it("refuses by default when the balance is short, saying how short", async () => {
    world("mgr", { rpc: () => ({ data: { status: "insufficient", leave_type: "pto", balance: 5, hours: 8 }, error: null }) });
    const res = await decide("10", { status: "approved" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "insufficient_balance", balance: 5, hours: 8, leaveType: "pto" });
  });

  it("an approval that races another and loses the balance is still refused", async () => {
    // The ledger trigger's backstop (TO001) when a direct path got there first.
    world("mgr", { rpc: () => ({ data: null, error: { code: "TO001", message: "Not enough pto balance" } }) });
    expect((await decide("10", { status: "approved" })).status).toBe(409);
  });

  it("409 for a request already cancelled or approved", async () => {
    world("mgr", { rpc: () => ({ data: { status: "conflict", current: "cancelled" }, error: null }) });
    const res = await decide("12", { status: "approved" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ current: "cancelled" });
  });

  it("404 when decide_time_off doesn't find it in the org", async () => {
    world("mgr", { rpc: () => ({ data: { status: "not_found" }, error: null }) });
    expect((await decide("77", { status: "approved" })).status).toBe(404);
  });

  it.each([[{ status: "approved", paidHours: 30 }], [{ status: "approved", leaveType: "holiday" }], [{ status: "approved", allowNegative: "yes" }]])(
    "400 for %j", async (body) => {
      const client = world("mgr");
      expect((await decide("10", body)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    });

  it("an employee cannot decide", async () => {
    const client = world("emp1");
    expect((await decide("10", { status: "approved" })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/time-off/[id]/cancel", () => {
  const cancel = (id: string) => CANCEL(new Request(`http://localhost/api/time-off/${id}/cancel`, { method: "POST" }), params(id));

  it("401 when signed out", async () => {
    world(null);
    expect((await cancel("10")).status).toBe(401);
  });

  it("cancels through cancel_time_off", async () => {
    const client = world("emp1", { rpc: () => ({ data: { status: "ok", was: "approved" }, error: null }) });
    const res = await cancel("10");
    expect(res.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("cancel_time_off", { p_request: 10 });
  });

  it.each([
    ["not_found", 404],
    ["past", 403],
    ["conflict", 409],
  ])("maps %s to %i", async (status, code) => {
    world("emp2", { rpc: () => ({ data: { status }, error: null }) });
    expect((await cancel("10")).status).toBe(code);
  });

  it("500 on a database error", async () => {
    world("emp1", { rpc: () => ({ data: null, error: { message: "x" } }) });
    expect((await cancel("10")).status).toBe(500);
  });

  it("400 for a bad id", async () => {
    world("emp1");
    expect((await cancel("abc")).status).toBe(400);
  });
});
