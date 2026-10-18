import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { writeAuditLog } from "@/lib/audit";
import { MOCK_USER, MOCK_ORG_ID } from "../../../__tests__/helpers";

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

type Opts = {
  user?: any;
  isManager?: boolean;
  // The employee row the org-scoped lookup finds (null: not in this org).
  employee?: { id: number; name: string } | null;
  rates?: any[];
  writeError?: any;
  deleted?: any[];
  tz?: string;
};

function makeClient({ user = MOCK_USER, isManager = true, employee = { id: 7, name: "Ann" }, rates = [], writeError = null, deleted, tz = "Pacific/Kiritimati" }: Opts = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const calls: Record<string, any[]> = { upsert: [], delete: [], eq: [] };
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "order", "in", "is", "limit"]) b[m] = vi.fn().mockReturnValue(b);
    b.eq = vi.fn((c: string, v: unknown) => { calls.eq.push([table, c, v]); return b; });
    b.upsert = vi.fn((row: any, opts: any) => { calls.upsert.push([row, opts]); return b; });
    b.delete = vi.fn(() => { calls.delete.push(table); return b; });
    const data = () => {
      if (table === "managers") return managerRow;
      if (table === "employees") return isManager ? employee : { id: 7, org_id: MOCK_ORG_ID };
      if (table === "app_settings") return [{ key: "timezone", value: tz }];
      if (table === "employee_pay_rates") {
        if (calls.upsert.length) return writeError ? null : { id: 99, ...calls.upsert[calls.upsert.length - 1][0] };
        if (calls.delete.length) return deleted ?? [];
        return rates;
      }
      return null;
    };
    b.maybeSingle = vi.fn(async () => ({ data: data(), error: table === "employee_pay_rates" ? writeError : null }));
    b.single = b.maybeSingle;
    b.then = (resolve: any, reject: any) => {
      const d = data();
      return Promise.resolve({ data: table === "managers" ? (d ? [d] : []) : d, error: null }).then(resolve, reject);
    };
    return b;
  };
  return {
    calls,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation(builder),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const ctx = (id = "7") => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/api/employees/7/pay-rates", { method: "POST", body: JSON.stringify(body) });
const del = (qs: string) => new Request(`http://localhost/api/employees/7/pay-rates?${qs}`, { method: "DELETE" });
const get = () => new Request("http://localhost/api/employees/7/pay-rates");

beforeEach(() => vi.clearAllMocks());

describe("GET /api/employees/[id]/pay-rates", () => {
  it("returns 401 signed out and 403 for an employee, without reading rates", async () => {
    const out = makeClient({ user: null });
    mockCreateClient.mockResolvedValue(out as any);
    expect((await GET(get(), ctx())).status).toBe(401);
    const emp = makeClient({ isManager: false, rates: [{ id: 1 }] });
    mockCreateClient.mockResolvedValue(emp as any);
    const res = await GET(get(), ctx());
    expect(res.status).toBe(403);
    expect(emp.from).not.toHaveBeenCalledWith("employee_pay_rates");
  });

  it("returns 404 for an employee of another organization", async () => {
    const c = makeClient({ employee: null });
    mockCreateClient.mockResolvedValue(c as any);
    expect((await GET(get(), ctx())).status).toBe(404);
    expect(c.from).not.toHaveBeenCalledWith("employee_pay_rates");
  });

  it("returns 400 for a bad id", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(get(), ctx("abc"))).status).toBe(400);
  });

  it("lists the history with the store's today", async () => {
    const c = makeClient({
      rates: [
        { id: 2, employee_id: 7, position_id: null, effective_from: "2026-06-10", hourly_rate: "20.00" },
        { id: 1, employee_id: 7, position_id: 3, effective_from: "1900-01-01", hourly_rate: "25" },
      ],
    });
    mockCreateClient.mockResolvedValue(c as any);
    const body = await (await GET(get(), ctx())).json();
    expect(body.rates).toEqual([
      { id: 2, positionId: null, effectiveFrom: "2026-06-10", hourlyRate: 20 },
      { id: 1, positionId: 3, effectiveFrom: "1900-01-01", hourlyRate: 25 },
    ]);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.beginning).toBe("1900-01-01");
    // Scoped to the manager's org and this employee.
    expect(c.calls.eq).toContainEqual(["employee_pay_rates", "org_id", MOCK_ORG_ID]);
    expect(c.calls.eq).toContainEqual(["employee_pay_rates", "employee_id", 7]);
  });
});

describe("POST /api/employees/[id]/pay-rates", () => {
  it("adds a rate from a date, keyed so the same day replaces it", async () => {
    const c = makeClient();
    mockCreateClient.mockResolvedValue(c as any);
    const res = await POST(post({ hourlyRate: 21.5, effectiveFrom: "2026-07-01" }), ctx());
    expect(res.status).toBe(200);
    expect(c.calls.upsert).toEqual([[
      { org_id: MOCK_ORG_ID, employee_id: 7, position_id: null, effective_from: "2026-07-01", hourly_rate: 21.5 },
      { onConflict: "employee_id,position_id,effective_from" },
    ]]);
    expect((await res.json()).rate).toEqual({ id: 99, positionId: null, effectiveFrom: "2026-07-01", hourlyRate: 21.5 });
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(expect.objectContaining({ action: "employee.pay_rate", resourceId: "7" }));
  });

  it("defaults the date to today in the store's timezone", async () => {
    const c = makeClient({ tz: "Pacific/Kiritimati" });
    mockCreateClient.mockResolvedValue(c as any);
    await POST(post({ hourlyRate: 18 }), ctx());
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(c.calls.upsert[0][0].effective_from).toBe(today);
  });

  it("adds a position rate", async () => {
    const c = makeClient();
    mockCreateClient.mockResolvedValue(c as any);
    expect((await POST(post({ hourlyRate: 25, positionId: 3, effectiveFrom: "2026-07-01" }), ctx())).status).toBe(200);
    expect(c.calls.upsert[0][0]).toMatchObject({ position_id: 3, hourly_rate: 25 });
  });

  it("ends the base rate with null, but not a position rate", async () => {
    const c = makeClient();
    mockCreateClient.mockResolvedValue(c as any);
    expect((await POST(post({ hourlyRate: null, effectiveFrom: "2026-07-01" }), ctx())).status).toBe(200);
    expect((await POST(post({ hourlyRate: null, positionId: 3 }), ctx())).status).toBe(400);
  });

  it("validates the rate, date and position", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    for (const body of [
      { hourlyRate: -1 }, { hourlyRate: "20" }, { hourlyRate: 100000 }, { hourlyRate: 12.345 }, {},
      { hourlyRate: 20, effectiveFrom: "2026-02-30" }, { hourlyRate: 20, effectiveFrom: "07/01/2026" },
      { hourlyRate: 20, positionId: 0 }, { hourlyRate: 20, positionId: "3" },
    ]) expect((await POST(post(body), ctx())).status, JSON.stringify(body)).toBe(400);
  });

  it("refuses an employee (403) and writes nothing", async () => {
    const c = makeClient({ isManager: false });
    mockCreateClient.mockResolvedValue(c as any);
    expect((await POST(post({ hourlyRate: 50 }), ctx())).status).toBe(403);
    expect(c.calls.upsert).toEqual([]);
  });

  it("refuses an employee of another organization (404)", async () => {
    const c = makeClient({ employee: null });
    mockCreateClient.mockResolvedValue(c as any);
    expect((await POST(post({ hourlyRate: 50 }), ctx())).status).toBe(404);
    expect(c.calls.upsert).toEqual([]);
  });

  it("says when the position isn't this store's", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ writeError: { code: "23503" } }) as any);
    expect((await POST(post({ hourlyRate: 20, positionId: 99 }), ctx())).status).toBe(400);
  });

  it("returns 500 on another database error", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ writeError: { code: "XX000" } }) as any);
    expect((await POST(post({ hourlyRate: 20 }), ctx())).status).toBe(500);
  });
});

describe("DELETE /api/employees/[id]/pay-rates", () => {
  it("removes one row of this employee in this org", async () => {
    const c = makeClient({ deleted: [{ id: 5, employee_id: 7, position_id: null, effective_from: "2026-07-01", hourly_rate: "20" }] });
    mockCreateClient.mockResolvedValue(c as any);
    expect((await DELETE(del("rateId=5"), ctx())).status).toBe(200);
    expect(c.calls.eq).toEqual(expect.arrayContaining([
      ["employee_pay_rates", "org_id", MOCK_ORG_ID], ["employee_pay_rates", "employee_id", 7], ["employee_pay_rates", "id", 5],
    ]));
  });

  it("returns 404 when nothing matched", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ deleted: [] }) as any);
    expect((await DELETE(del("rateId=5"), ctx())).status).toBe(404);
  });

  it("validates rateId and refuses an employee", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await DELETE(del("rateId=x"), ctx())).status).toBe(400);
    const c = makeClient({ isManager: false });
    mockCreateClient.mockResolvedValue(c as any);
    expect((await DELETE(del("rateId=5"), ctx())).status).toBe(403);
    expect(c.calls.delete).toEqual([]);
  });
});
