import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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
  for (const m of ["select", "insert", "eq", "in", "order", "limit"]) {
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
  employeeId = 5 as number | null,
  tills = { thenData: [], single: null } as { thenData?: any; single?: any },
  employees = [] as any[],
} = {}) {
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID, name: "Alex" } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: null });
      if (table === "employees") return builder({ single: employeeRow, thenData: employees });
      if (table === "till_counts") return builder(tills);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/till-counts${qs}`);
const postReq = (body: any) =>
  new Request("http://localhost/api/till-counts", { method: "POST", body: JSON.stringify(body) });

describe("GET /api/till-counts", () => {
  it("returns 400 for a missing/bad date", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(getReq())).status).toBe(400);
    expect((await GET(getReq("?date=x"))).status).toBe(400);
  });
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq("?date=2026-06-17"))).status).toBe(401);
  });
  it("returns the day's counts with counter names", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        tills: { thenData: [{ id: 1, employee_id: 5, count_type: "close", expected_cents: 20000, counted_cents: 19900, variance_cents: -100, note: null, created_at: "t" }] },
        employees: [{ id: 5, name: "Alex" }],
      }) as any
    );
    const res = await GET(getReq("?date=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts[0].varianceCents).toBe(-100);
    expect(body.counts[0].status).toBe("short");
    expect(body.counts[0].counterName).toBe("Alex");
  });
});

describe("POST /api/till-counts", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await POST(postReq({ date: "2026-06-17", type: "open", expectedCents: 20000, countedCents: 20000 }))).status).toBe(401);
  });
  it("returns 403 when the caller has no employee record", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: null }) as any);
    expect((await POST(postReq({ date: "2026-06-17", type: "open", expectedCents: 20000, countedCents: 20000 }))).status).toBe(403);
  });
  it("returns 400 for a bad date or invalid count", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    expect((await POST(postReq({ date: "x", type: "open", expectedCents: 0, countedCents: 0 }))).status).toBe(400);
    expect((await POST(postReq({ date: "2026-06-17", type: "midday", expectedCents: 0, countedCents: 0 }))).status).toBe(400);
  });
  it("computes counted from denominations when provided and records variance", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ employeeId: 5, tills: { single: { id: 9 } } }) as any
    );
    // 10×$20 = $200.00 counted; expected $200.50 → short 50¢.
    const res = await POST(postReq({ date: "2026-06-17", type: "close", expectedCents: 20050, counts: { twenty: 10 } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.countedCents).toBe(20000);
    expect(body.varianceCents).toBe(-50);
    expect(body.status).toBe("short");
  });
  it("accepts an explicit countedCents and returns the variance", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5, tills: { single: { id: 10 } } }) as any);
    const res = await POST(postReq({ date: "2026-06-17", type: "open", expectedCents: 20000, countedCents: 20000 }));
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("balanced");
  });
});
