import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
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

function builder({ thenData = null as any, single = null as any } = {}) {
  const b: any = {};
  for (const m of [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in",
  ]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: thenData, error: null }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  isManager = false,
  employeeId = 5 as number | null,
  empLookup = null as any,
  timeOffRows = [] as any[],
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID, name: "Alex P" } : null;
  let employeeCall = 0;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") {
        employeeCall++;
        // First employees lookup resolves the caller (getOrgContext); subsequent
        // ones resolve the target employee's allowance/name.
        return employeeCall === 1
          ? builder({ single: employeeRow })
          : builder({ single: empLookup ?? employeeRow });
      }
      if (table === "time_off_requests") return builder({ thenData: timeOffRows });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/time-off/balance${qs}`);
const putReq = (body: any) =>
  new Request("http://localhost/api/time-off/balance", { method: "PUT", body: JSON.stringify(body) });

describe("GET /api/time-off/balance", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq())).status).toBe(401);
  });

  it("returns the caller's own balance with used and remaining days", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        employeeId: 5,
        empLookup: { id: 5, name: "Alex P", pto_allowance_days: 15 },
        timeOffRows: [{ date: "2026-02-01" }, { date: "2026-03-15" }],
      }) as any
    );
    const res = await GET(getReq("?year=2026"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tracked).toBe(true);
    expect(body.allowanceDays).toBe(15);
    expect(body.usedDays).toBe(2);
    expect(body.remainingDays).toBe(13);
  });

  it("reports untracked when the employee has no allowance", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        employeeId: 5,
        empLookup: { id: 5, name: "Alex P", pto_allowance_days: null },
        timeOffRows: [{ date: "2026-02-01" }],
      }) as any
    );
    const res = await GET(getReq("?year=2026"));
    const body = await res.json();
    expect(body.tracked).toBe(false);
    expect(body.usedDays).toBe(1);
    expect(body.remainingDays).toBeNull();
  });

  it("lets a manager query another employee by id", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        isManager: true,
        employeeId: null,
        empLookup: { id: 8, name: "Sam B", pto_allowance_days: 10 },
        timeOffRows: [],
      }) as any
    );
    const res = await GET(getReq("?employeeId=8&year=2026"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employeeId).toBe(8);
    expect(body.remainingDays).toBe(10);
  });
});

describe("PUT /api/time-off/balance", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await PUT(putReq({ employeeId: 8, allowanceDays: 12 }))).status).toBe(403);
  });

  it("returns 400 for a negative allowance", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await PUT(putReq({ employeeId: 8, allowanceDays: -1 }))).status).toBe(400);
  });

  it("sets an allowance and returns ok", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, empLookup: { id: 8, name: "Sam B" } }) as any
    );
    const res = await PUT(putReq({ employeeId: 8, allowanceDays: 12 }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("clears an allowance with null", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, empLookup: { id: 8, name: "Sam B" } }) as any
    );
    const res = await PUT(putReq({ employeeId: 8, allowanceDays: null }));
    expect(res.status).toBe(200);
  });
});
