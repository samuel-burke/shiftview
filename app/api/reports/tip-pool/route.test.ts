import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
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
  for (const m of ["select", "eq", "in", "order", "limit"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: thenData, error: null }).then(resolve, reject);
  return b;
}

function makeClient({ user = MOCK_USER as any, isManager = true, scheduleRows = [] as any[], employeeRows = [] as any[] } = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ thenData: employeeRows });
      if (table === "schedules") return builder({ thenData: scheduleRows });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const req = (qs = "") => new Request(`http://localhost/api/reports/tip-pool${qs}`);

describe("GET /api/reports/tip-pool", () => {
  it("returns 400 for a missing/bad date", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req("?poolCents=10000"))).status).toBe(400);
    expect((await GET(req("?date=x&poolCents=10000"))).status).toBe(400);
  });

  it("returns 400 for a non-positive pool", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req("?date=2026-06-17&poolCents=0"))).status).toBe(400);
    expect((await GET(req("?date=2026-06-17&poolCents=-5"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("?date=2026-06-17&poolCents=10000"))).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(req("?date=2026-06-17&poolCents=10000"))).status).toBe(403);
  });

  it("splits the pool by hours worked, summing exactly to the pool", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [
          { employee_id: 1, start_minutes: 480, end_minutes: 840 }, // 6h
          { employee_id: 2, start_minutes: 600, end_minutes: 720 }, // 2h
        ],
        employeeRows: [{ id: 1, name: "Alex P" }, { id: 2, name: "Jordan K" }],
      }) as any
    );
    const res = await GET(req("?date=2026-06-17&poolCents=8000"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const alex = body.shares.find((s: any) => s.employeeId === 1);
    expect(alex.cents).toBe(6000);
    expect(alex.employeeName).toBe("Alex P");
    expect(body.shares.reduce((s: number, x: any) => s + x.cents, 0)).toBe(8000);
    expect(body.poolCents).toBe(8000);
  });

  it("returns an empty split when nobody is scheduled", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);
    const body = await (await GET(req("?date=2026-06-17&poolCents=8000"))).json();
    expect(body.shares).toEqual([]);
  });
});
