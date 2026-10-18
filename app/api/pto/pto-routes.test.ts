import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@/lib/supabase-server";
import { fakeSupabase, type FakeOptions } from "../__tests__/fake-supabase";
import { MOCK_ORG_ID } from "../__tests__/helpers";
import { GET as getBalances } from "./balances/route";
import { GET as getPolicy, PUT as putPolicy } from "./policy/route";
import { POST as postAccruals } from "./accruals/route";
import { POST as postAdjustment } from "./adjustments/route";
import { GET as getLedger } from "./ledger/route";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const mockCreateClient = vi.mocked(createClient);
const ORG = MOCK_ORG_ID;
const OTHER = "00000000-0000-0000-0000-0000000000ff";

function world(userId: string | null, extra: Partial<FakeOptions> = {}, tables: Record<string, any[]> = {}) {
  const client = fakeSupabase({
    userId,
    tables: {
      managers: [
        { user_id: "mgr", org_id: ORG, is_owner: true },
        { user_id: "other-mgr", org_id: OTHER, is_owner: true },
      ],
      employees: [
        { id: 1, org_id: ORG, user_id: "emp1", name: "Ann", archived_at: null, hire_date: null, created_at: "2025-01-01T12:00:00Z" },
        { id: 2, org_id: ORG, user_id: "emp2", name: "Bob", archived_at: null, hire_date: "2026-10-10", created_at: "2026-10-01T12:00:00Z" },
        { id: 3, org_id: ORG, user_id: null, name: "Cy (left)", archived_at: "2026-09-01T12:00:00Z", hire_date: null, created_at: "2025-01-01T12:00:00Z" },
        { id: 9, org_id: OTHER, user_id: "zed", name: "Zed", archived_at: null, hire_date: null, created_at: "2025-01-01T12:00:00Z" },
      ],
      pto_balances: [
        { org_id: ORG, employee_id: 1, leave_type: "pto", balance: "12.50" },
        { org_id: ORG, employee_id: 2, leave_type: "sick", balance: 3 },
        { org_id: OTHER, employee_id: 9, leave_type: "pto", balance: 99 },
      ],
      app_settings: [{ org_id: ORG, key: "timezone", value: "America/New_York" }],
      ...tables,
    },
    ...extra,
  });
  mockCreateClient.mockResolvedValue(client as any);
  return client;
}

const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const put = (url: string, body: unknown) => req(url, { method: "PUT", body: JSON.stringify(body) });
const post = (url: string, body?: unknown) => req(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/pto/balances", () => {
  it("401 when signed out", async () => {
    world(null);
    expect((await getBalances(req("/api/pto/balances"))).status).toBe(401);
  });

  it("a manager sees every current employee of their org, zero when no rows", async () => {
    world("mgr");
    const res = await getBalances(req("/api/pto/balances"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balances).toEqual([
      { employeeId: 1, employeeName: "Ann", pto: 12.5, sick: 0 },
      { employeeId: 2, employeeName: "Bob", pto: 0, sick: 3 },
    ]);
  });

  it("lists a bank as in use when someone has hours, even with no policy", async () => {
    world("mgr");
    const body = await (await getBalances(req("/api/pto/balances"))).json();
    expect(body.types.map((t: any) => [t.leaveType, t.accrues])).toEqual([["pto", false], ["sick", false]]);
  });

  it("no banks in use at a store that doesn't use PTO", async () => {
    world("mgr", {}, { pto_balances: [] });
    const body = await (await getBalances(req("/api/pto/balances"))).json();
    expect(body.types).toEqual([]);
  });

  it("an employee sees only their own", async () => {
    world("emp1");
    const body = await (await getBalances(req("/api/pto/balances"))).json();
    expect(body.balances).toEqual([{ employeeId: 1, employeeName: "Ann", pto: 12.5, sick: 0 }]);
  });

  it("an employee cannot ask for someone else's", async () => {
    world("emp1");
    expect((await getBalances(req("/api/pto/balances?employeeId=2"))).status).toBe(403);
  });

  it("another org's manager does not see this org's balances", async () => {
    world("other-mgr");
    const body = await (await getBalances(req("/api/pto/balances"))).json();
    expect(body.balances).toEqual([{ employeeId: 9, employeeName: "Zed", pto: 99, sick: 0 }]);
  });

  it("400 on a bad employeeId", async () => {
    world("mgr");
    expect((await getBalances(req("/api/pto/balances?employeeId=abc"))).status).toBe(400);
  });

  it("500 when balances can't be read", async () => {
    world("mgr", { failing: ["pto_balances"] });
    expect((await getBalances(req("/api/pto/balances"))).status).toBe(500);
  });
});

describe("/api/pto/policy", () => {
  it("GET: any member reads the policies (default: none)", async () => {
    world("emp1");
    const body = await (await getPolicy(req("/api/pto/policy"))).json();
    expect(body.policies.pto.method).toBe("none");
    expect(body.policies.sick.method).toBe("none");
  });

  it("PUT: an employee cannot change them", async () => {
    world("emp1");
    expect((await putPolicy(put("/api/pto/policy", { sick: { method: "per_hours_worked" } }))).status).toBe(403);
  });

  it("PUT: a manager turns on 1 h per 30 h sick leave, starting today (store time)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:30 UTC on Oct 19 is still Oct 18 in New York.
    vi.setSystemTime(new Date("2026-10-19T01:30:00Z"));
    try {
      const client = world("mgr");
      const res = await putPolicy(put("/api/pto/policy", { sick: { method: "per_hours_worked", hoursEarned: 1, perHoursWorked: 30, carryoverCap: 40 } }));
      expect(res.status).toBe(200);
      const upsert = client.writes.find((w) => w.table === "app_settings")!;
      const rows = upsert.rows as { org_id: string; key: string; value: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].org_id).toBe(ORG);
      expect(rows[0].key).toBe("pto_policy_sick");
      expect(JSON.parse(rows[0].value)).toMatchObject({ method: "per_hours_worked", perHoursWorked: 30, carryoverCap: 40, startsOn: "2026-10-18" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("PUT: refuses a bad policy", async () => {
    world("mgr");
    const res = await putPolicy(put("/api/pto/policy", { pto: { method: "per_period", period: "fortnight" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("pto");
  });

  it("PUT: refuses an empty body", async () => {
    world("mgr");
    expect((await putPolicy(put("/api/pto/policy", {}))).status).toBe(400);
  });
});

describe("POST /api/pto/accruals", () => {
  afterEach(() => vi.useRealTimers());

  const punch = (id: number, employee_id: number, punch_type: string, punched_at: string) =>
    ({ id, org_id: ORG, employee_id, punch_type, punched_at });

  it("an employee cannot run accruals", async () => {
    world("emp1");
    expect((await postAccruals(post("/api/pto/accruals"))).status).toBe(403);
  });

  it("does nothing when no policy accrues", async () => {
    const client = world("mgr");
    const res = await postAccruals(post("/api/pto/accruals"));
    expect(res.status).toBe(200);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("posts each closed week's hours-worked accrual from payroll hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T16:00:00Z")); // Tue Oct 20, New York
    const punches = [];
    let id = 1;
    // Ann: 10h Mon–Wed of the week of Oct 5 (EDT = UTC−4), 15h the next week.
    for (const d of ["05", "06", "07"]) {
      punches.push(punch(id++, 1, "clock_in", `2026-10-${d}T13:00:00.000Z`));
      punches.push(punch(id++, 1, "clock_out", `2026-10-${d}T23:00:00.000Z`));
    }
    punches.push(punch(id++, 1, "clock_in", "2026-10-12T13:00:00.000Z"));
    punches.push(punch(id++, 1, "clock_out", "2026-10-13T04:00:00.000Z"));
    // This week isn't over: it earns nothing yet.
    punches.push(punch(id++, 1, "clock_in", "2026-10-19T13:00:00.000Z"));
    punches.push(punch(id++, 1, "clock_out", "2026-10-19T23:00:00.000Z"));
    const client = world("mgr", {
      rpc: () => ({ data: { status: "ok", accrual_rows: 2, carryover_rows: 0 }, error: null }),
    }, {
      app_settings: [
        { org_id: ORG, key: "timezone", value: "America/New_York" },
        { org_id: ORG, key: "pto_policy_sick", value: JSON.stringify({ method: "per_hours_worked", hoursEarned: 1, perHoursWorked: 30, period: "month", annualCap: null, carryoverCap: 40, startsOn: "2026-10-05" }) },
      ],
      punch_records: punches,
    });

    const res = await postAccruals(post("/api/pto/accruals"));
    expect(res.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = client.rpc.mock.calls[0] as [string, any];
    expect(fn).toBe("post_pto_accruals");
    expect(args).toMatchObject({ p_org: ORG, p_leave_type: "sick", p_window_start: "2026-10-05", p_through: "2026-10-19", p_carryover_cap: 40 });
    expect(args.p_entries).toEqual([
      { employee_id: 1, period_start: "2026-10-05", period_end: "2026-10-11", hours: 1, worked_hours: 30 },
      { employee_id: 1, period_start: "2026-10-12", period_end: "2026-10-18", hours: 0.5, worked_hours: 15 },
    ]);
    const body = await res.json();
    expect(body.results.find((r: any) => r.leaveType === "sick")).toMatchObject({ accrualRows: 2, entries: 2 });
  });

  it("fixed monthly accrual credits only employees there the whole month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T16:00:00Z"));
    const client = world("mgr", {
      rpc: () => ({ data: { status: "ok", accrual_rows: 1, carryover_rows: 0 }, error: null }),
    }, {
      app_settings: [
        { org_id: ORG, key: "pto_policy_pto", value: JSON.stringify({ method: "per_period", hoursEarned: 8, perHoursWorked: 30, period: "month", annualCap: null, carryoverCap: null, startsOn: "2026-10-01" }) },
      ],
    });
    expect((await postAccruals(post("/api/pto/accruals"))).status).toBe(200);
    const args = client.rpc.mock.calls[0][1] as any;
    // Ann (hired before), not Bob (hired Oct 10), not Cy (left in September),
    // not Zed (another org).
    expect(args.p_entries).toEqual([
      { employee_id: 1, period_start: "2026-10-01", period_end: "2026-10-31", hours: 8, worked_hours: null },
    ]);
  });

  it("refuses to accrue from a truncated set of punches", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T16:00:00Z"));
    const punches = Array.from({ length: 50_001 }, (_, i) => punch(i + 1, 1, "clock_in", `2026-10-06T13:00:00.000Z`));
    const client = world("mgr", {}, {
      app_settings: [{ org_id: ORG, key: "pto_policy_sick", value: JSON.stringify({ method: "per_hours_worked", hoursEarned: 1, perHoursWorked: 30, period: "month", annualCap: null, carryoverCap: null, startsOn: "2026-10-05" }) }],
      punch_records: punches,
    });
    expect((await postAccruals(post("/api/pto/accruals"))).status).toBe(422);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("500 when the database refuses the post", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T16:00:00Z"));
    world("mgr", { rpc: () => ({ data: null, error: { message: "x" } }) }, {
      app_settings: [{ org_id: ORG, key: "pto_policy_pto", value: JSON.stringify({ method: "per_period", hoursEarned: 8, perHoursWorked: 30, period: "month", annualCap: null, carryoverCap: null, startsOn: "2026-10-01" }) }],
    });
    expect((await postAccruals(post("/api/pto/accruals"))).status).toBe(500);
  });
});

describe("POST /api/pto/adjustments", () => {
  const good = { employeeId: 1, leaveType: "pto", hours: 4, reason: "Opening balance" };

  it("a manager adds hours with a reason", async () => {
    const client = world("mgr", { insertResult: { pto_ledger: { data: { id: 7, balance_after: "16.50" }, error: null } } });
    const res = await postAdjustment(post("/api/pto/adjustments", good));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: 7, balance: 16.5 });
    const write = client.writes.find((w) => w.table === "pto_ledger")!;
    expect(write.rows).toMatchObject({ org_id: ORG, employee_id: 1, leave_type: "pto", kind: "adjustment", hours: 4, reason: "Opening balance", created_by: "mgr" });
  });

  it.each([
    [{ ...good, reason: "  " }, "reason"],
    [{ ...good, reason: undefined }, "reason"],
    [{ ...good, hours: 0 }, "hours"],
    [{ ...good, hours: 1.234 }, "hours"],
    [{ ...good, hours: "4" }, "hours"],
    [{ ...good, leaveType: "unpaid" }, "leaveType"],
    [{ ...good, employeeId: "1" }, "employeeId"],
  ])("400 for %j", async (body, field) => {
    world("mgr");
    const res = await postAdjustment(post("/api/pto/adjustments", body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.toLowerCase()).toContain(field.toLowerCase());
  });

  it("an employee cannot adjust", async () => {
    world("emp1");
    expect((await postAdjustment(post("/api/pto/adjustments", good))).status).toBe(403);
  });

  it("404 for an employee of another org (same-org foreign key)", async () => {
    world("mgr", { insertResult: { pto_ledger: { data: null, error: { code: "23503" } } } });
    expect((await postAdjustment(post("/api/pto/adjustments", { ...good, employeeId: 9 }))).status).toBe(404);
  });
});

describe("GET /api/pto/ledger", () => {
  const rows = [
    { id: 1, org_id: ORG, employee_id: 1, leave_type: "pto", kind: "adjustment", hours: "10.00", balance_after: "10.00", effective_date: "2026-10-01", period_start: null, period_end: null, worked_hours: null, request_id: null, reason: "Opening", created_at: "2026-10-01T12:00:00Z" },
    { id: 2, org_id: ORG, employee_id: 1, leave_type: "pto", kind: "usage", hours: "-8.00", balance_after: "2.00", effective_date: "2026-10-20", period_start: null, period_end: null, worked_hours: null, request_id: 44, reason: null, created_at: "2026-10-02T12:00:00Z" },
    { id: 3, org_id: ORG, employee_id: 2, leave_type: "sick", kind: "accrual", hours: "1.00", balance_after: "1.00", effective_date: "2026-10-11", period_start: "2026-10-05", period_end: "2026-10-11", worked_hours: "30.00", request_id: null, reason: null, created_at: "2026-10-12T12:00:00Z" },
  ];

  it("an employee reads their own, newest first, as numbers", async () => {
    world("emp1", {}, { pto_ledger: rows });
    const body = await (await getLedger(req("/api/pto/ledger"))).json();
    expect(body.entries.map((e: any) => [e.id, e.kind, e.hours, e.balanceAfter])).toEqual([[2, "usage", -8, 2], [1, "adjustment", 10, 10]]);
  });

  it("an employee cannot read another's", async () => {
    world("emp1", {}, { pto_ledger: rows });
    expect((await getLedger(req("/api/pto/ledger?employeeId=2"))).status).toBe(403);
  });

  it("a manager reads anyone's in the org, with the hours that earned an accrual", async () => {
    world("mgr", {}, { pto_ledger: rows });
    const body = await (await getLedger(req("/api/pto/ledger?employeeId=2"))).json();
    expect(body.entries).toEqual([expect.objectContaining({ id: 3, kind: "accrual", workedHours: 30, periodStart: "2026-10-05" })]);
  });

  it("another org's manager reads nothing of this org", async () => {
    world("other-mgr", {}, { pto_ledger: rows });
    const body = await (await getLedger(req("/api/pto/ledger?employeeId=1"))).json();
    expect(body.entries).toEqual([]);
  });

  it("a manager must name the employee", async () => {
    world("mgr", {}, { pto_ledger: rows });
    expect((await getLedger(req("/api/pto/ledger"))).status).toBe(400);
  });
});
