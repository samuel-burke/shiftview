import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { POST as SIGN } from "./signoff/route";
import { createClient } from "@/lib/supabase-server";
import { writeAuditLog } from "@/lib/audit";
import { makeQueryBuilder, makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(true) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const mockCreateClient = vi.mocked(createClient);

const WEEKLY = [
  { key: "timezone", value: "America/New_York" },
  { key: "pay_period_frequency", value: "weekly" },
];
const LOCKED_ROW = {
  id: 7, start_date: "2026-10-05", end_date: "2026-10-11", status: "locked",
  approved_at: "2026-10-12T14:00:00Z", locked_at: "2026-10-12T15:00:00Z",
};
const SIGNOFFS = [
  { period_id: 7, employee_id: 5, status: "signed", note: null, signed_at: "2026-10-11T23:00:00Z" },
  { period_id: 7, employee_id: 6, status: "disputed", note: "Missing Thursday", signed_at: "2026-10-12T01:00:00Z" },
];

type Opts = Parameters<typeof makeSupabaseClient>[0] & { settings?: any[]; periods?: any[]; signoffs?: any[] };

function client({ settings = WEEKLY, periods = [LOCKED_ROW], signoffs = SIGNOFFS, ...opts }: Opts = {}) {
  const base = makeSupabaseClient({
    queryData: [],
    ...opts,
    tableOverrides: {
      app_settings: { data: settings, error: null },
      pay_periods: { data: periods, error: null },
      ...(opts.tableOverrides ?? {}),
    },
  });
  const baseFrom = base.from.getMockImplementation()!;
  const signoffQueries: any[] = [];
  base.from.mockImplementation((table: string) => {
    if (table !== "pay_period_signoffs") return baseFrom(table);
    // eq-aware so the employee filter is visible to the test.
    let employeeFilter: number | null = null;
    const b = makeQueryBuilder({ data: signoffs, error: null });
    b.eq = vi.fn((col: string, v: any) => { if (col === "employee_id") employeeFilter = v; return b; });
    b.then = (resolve: any, reject: any) =>
      Promise.resolve({ data: signoffs.filter((s) => employeeFilter === null || s.employee_id === employeeFilter), error: null })
        .then(resolve, reject);
    signoffQueries.push(b);
    return b;
  });
  return Object.assign(base, { signoffQueries });
}

const get = (qs: string) => GET(new Request(`http://localhost/api/pay-periods?${qs}`));
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/pay-periods", { method: "POST", body: JSON.stringify(body) }));
const sign = (body: unknown) =>
  SIGN(new Request("http://localhost/api/pay-periods/signoff", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T16:00:00Z")); // Wednesday in New York
});
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(writeAuditLog).mockClear();
});

describe("GET /api/pay-periods", () => {
  it("401 when signed out", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }) as any);
    expect((await get("date=2026-10-08")).status).toBe(401);
  });

  it("400 without a date, a range or signable", async () => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: true }) as any);
    expect((await get("")).status).toBe(400);
    expect((await get("date=2026-02-30")).status).toBe(400);
    expect((await get("from=2026-10-01")).status).toBe(400);
    expect((await get("from=2026-10-10&to=2026-10-01")).status).toBe(400);
  });

  it("403 for a member with no employee record who isn't a manager", async () => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: false, linkedEmployee: null }) as any);
    expect((await get("date=2026-10-08")).status).toBe(403);
  });

  it("a manager gets the recorded period with every sign-off", async () => {
    const supabase = client({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(supabase as any);
    const res = await get("date=2026-10-08");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ frequency: "weekly", enabled: true, today: "2026-10-14" });
    expect(body.periods).toEqual([
      expect.objectContaining({ id: 7, start: "2026-10-05", end: "2026-10-11", status: "locked" }),
    ]);
    expect(body.periods[0].signoffs.map((s: any) => s.employeeId)).toEqual([5, 6]);
    // Scoped to the caller's org.
    expect(supabase.signoffQueries[0].eq).toHaveBeenCalledWith("org_id", MOCK_ORG_ID);
    expect(supabase.signoffQueries[0].eq).not.toHaveBeenCalledWith("employee_id", expect.anything());
  });

  it("an employee sees only their own sign-off", async () => {
    const supabase = client({ user: MOCK_USER, linkedEmployee: { id: 5, name: "Alex" } });
    mockCreateClient.mockResolvedValue(supabase as any);
    const body = await (await get("date=2026-10-08")).json();
    expect(body.periods[0].signoffs).toEqual([
      { employeeId: 5, status: "signed", note: null, signedAt: "2026-10-11T23:00:00Z" },
    ]);
    expect(supabase.signoffQueries[0].eq).toHaveBeenCalledWith("employee_id", 5);
  });

  it("a period nobody has acted on is computed and open", async () => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: true, periods: [] }) as any);
    const body = await (await get("date=2026-10-14")).json();
    expect(body.periods).toEqual([
      { id: null, start: "2026-10-12", end: "2026-10-18", status: "open", approvedAt: null, lockedAt: null, signoffs: [] },
    ]);
  });

  it("lists recorded and computed periods across a range", async () => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: true }) as any);
    const body = await (await get("from=2026-10-01&to=2026-10-14")).json();
    expect(body.periods.map((p: any) => [p.start, p.status])).toEqual([
      ["2026-09-28", "open"], ["2026-10-05", "locked"], ["2026-10-12", "open"],
    ]);
  });

  it("signable=1 gives the latest period that has reached its last day", async () => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, linkedEmployee: { id: 5, name: "Alex" } }) as any);
    const body = await (await get("signable=1")).json();
    expect(body.periods.map((p: any) => p.start)).toEqual(["2026-10-05"]);
  });

  it("no pay periods: enabled false and no periods", async () => {
    mockCreateClient.mockResolvedValue(client({
      user: MOCK_USER, isManager: true, periods: [], settings: [{ key: "timezone", value: "America/New_York" }],
    }) as any);
    const body = await (await get("signable=1")).json();
    expect(body).toMatchObject({ frequency: "none", enabled: false, periods: [] });
  });
});

describe("POST /api/pay-periods", () => {
  it("401 when signed out", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }) as any);
    expect((await post({ action: "approve", date: "2026-10-08" })).status).toBe(401);
  });

  it("403 for an employee: only managers approve, lock or reopen", async () => {
    for (const action of ["approve", "lock", "reopen"]) {
      const supabase = client({ user: MOCK_USER, isManager: false, linkedEmployee: { id: 5, name: "Alex" } });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await post({ action, date: "2026-10-08", reason: "x" });
      expect(res.status).toBe(403);
      expect(supabase.rpc).not.toHaveBeenCalled();
    }
  });

  it("validates the body", async () => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: true }) as any);
    expect((await post({ action: "delete", date: "2026-10-08" })).status).toBe(400);
    expect((await post({ action: "approve", date: "Oct 8" })).status).toBe(400);
    expect((await post({ action: "reopen", date: "2026-10-08", reason: "   " })).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/pay-periods", { method: "POST", body: "{" }))).status).toBe(400);
  });

  it("approves in the manager's own org, and audits it", async () => {
    const supabase = client({
      user: MOCK_USER, isManager: true,
      rpcData: { id: 7, start_date: "2026-10-05", end_date: "2026-10-11", status: "approved" },
    });
    mockCreateClient.mockResolvedValue(supabase as any);
    const res = await post({ action: "approve", date: "2026-10-08", p_org: "someone-elses-org" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, period: { id: 7, start: "2026-10-05", end: "2026-10-11", status: "approved" },
    });
    expect(supabase.rpc).toHaveBeenCalledWith("pay_period_approve", { p_org: MOCK_ORG_ID, p_date: "2026-10-08" });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "pay_period.approve", orgId: MOCK_ORG_ID }));
  });

  it("locks", async () => {
    const supabase = client({ user: MOCK_USER, isManager: true, rpcData: { id: 7, status: "locked" } });
    mockCreateClient.mockResolvedValue(supabase as any);
    expect((await post({ action: "lock", date: "2026-10-08" })).status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("pay_period_lock", { p_org: MOCK_ORG_ID, p_date: "2026-10-08" });
  });

  it("reopens with the reason", async () => {
    const supabase = client({ user: MOCK_USER, isManager: true, rpcData: { id: 7, status: "open" } });
    mockCreateClient.mockResolvedValue(supabase as any);
    const res = await post({ action: "reopen", date: "2026-10-08", reason: "  Missed clock-out  " });
    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("pay_period_reopen", {
      p_org: MOCK_ORG_ID, p_date: "2026-10-08", p_reason: "Missed clock-out",
    });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "pay_period.reopen", metadata: expect.objectContaining({ reason: "Missed clock-out" }),
    }));
  });

  it.each([
    ["55000", "Approve the pay period before locking it", 409],
    ["23P01", "overlaps", 409],
    ["22023", "A pay period can be approved once it has ended", 400],
    ["42501", "Manager access required", 403],
  ])("maps the database's %s refusal", async (code, message, status) => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: true, rpcError: { code, message } }) as any);
    const res = await post({ action: "lock", date: "2026-10-08" });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(message);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it.each(["approve", "lock"])("refuses to %s while a shift begun in the period is still open, naming it", async (action) => {
    const message = `Can't ${action} this pay period: still clocked in: Alex Kim (from 2026-10-11). Add the missing clock-out first.`;
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: true, rpcError: { code: "55000", message } }) as any);
    const res = await post({ action, date: "2026-10-08" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: message, code: "55000" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("an unexpected database error is a 500 without its details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, isManager: true, rpcError: { code: "XX000", message: "secret" } }) as any);
    const res = await post({ action: "approve", date: "2026-10-08" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});

describe("POST /api/pay-periods/signoff", () => {
  const alex = { id: 5, name: "Alex" };

  it("401 when signed out", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }) as any);
    expect((await sign({ date: "2026-10-11", status: "signed" })).status).toBe(401);
  });

  it("an employee signs their own hours, in their own org", async () => {
    const supabase = client({ user: MOCK_USER, linkedEmployee: alex, rpcData: { period_id: 7, signed_at: "2026-10-14T16:00:00Z" } });
    mockCreateClient.mockResolvedValue(supabase as any);
    const res = await sign({ date: "2026-10-11", status: "signed" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, signoff: { employeeId: 5, status: "signed", note: null, signedAt: "2026-10-14T16:00:00Z" },
    });
    expect(supabase.rpc).toHaveBeenCalledWith("pay_period_sign", {
      p_org: MOCK_ORG_ID, p_date: "2026-10-11", p_status: "signed", p_note: null,
    });
  });

  it("an employee disputes with a note", async () => {
    const supabase = client({ user: MOCK_USER, linkedEmployee: alex, rpcData: { period_id: 7 } });
    mockCreateClient.mockResolvedValue(supabase as any);
    const res = await sign({ date: "2026-10-11", status: "disputed", note: " Missing Thursday " });
    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith("pay_period_sign", expect.objectContaining({ p_status: "disputed", p_note: "Missing Thursday" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "pay_period.dispute" }));
  });

  it("a dispute needs a note", async () => {
    const supabase = client({ user: MOCK_USER, linkedEmployee: alex });
    mockCreateClient.mockResolvedValue(supabase as any);
    expect((await sign({ date: "2026-10-11", status: "disputed", note: "  " })).status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    mockCreateClient.mockResolvedValue(client({ user: MOCK_USER, linkedEmployee: alex }) as any);
    expect((await sign({ date: "2026-10-11", status: "approved" })).status).toBe(400);
    expect((await sign({ date: "yesterday", status: "signed" })).status).toBe(400);
    expect((await sign({ date: "2026-10-11", status: "signed", note: 5 })).status).toBe(400);
    expect((await sign({ date: "2026-10-11", status: "disputed", note: "x".repeat(1001) })).status).toBe(400);
  });

  it("nobody can sign for another employee", async () => {
    const supabase = client({ user: MOCK_USER, linkedEmployee: alex });
    mockCreateClient.mockResolvedValue(supabase as any);
    const res = await sign({ date: "2026-10-11", status: "signed", employeeId: 6 });
    expect(res.status).toBe(403);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("a manager can't sign for an employee either", async () => {
    const supabase = client({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 1, name: "Mgr" } });
    mockCreateClient.mockResolvedValue(supabase as any);
    expect((await sign({ date: "2026-10-11", status: "signed", employeeId: 5 })).status).toBe(403);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("a manager with no employee record has nothing to sign", async () => {
    const supabase = client({ user: MOCK_USER, isManager: true, linkedEmployee: null });
    mockCreateClient.mockResolvedValue(supabase as any);
    expect((await sign({ date: "2026-10-11", status: "signed" })).status).toBe(403);
  });

  it("maps a period that hasn't reached its last day to 400", async () => {
    mockCreateClient.mockResolvedValue(client({
      user: MOCK_USER, linkedEmployee: alex,
      rpcError: { code: "22023", message: "You can sign off on the last day of the pay period (2026-10-18)" },
    }) as any);
    const res = await sign({ date: "2026-10-14", status: "signed" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/last day/);
  });
});
