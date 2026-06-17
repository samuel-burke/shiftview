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
  for (const m of ["select", "eq", "gte", "lte", "order", "limit", "in"]) {
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

const req = (qs = "") => new Request(`http://localhost/api/reports/hours-fairness${qs}`);

describe("GET /api/reports/hours-fairness", () => {
  it("returns 400 when weekStart is missing/malformed", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("?weekStart=x"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("?weekStart=2026-06-15"))).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(req("?weekStart=2026-06-15"))).status).toBe(403);
  });

  it("classifies under/over/fair against the team mean", async () => {
    const days = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"];
    const scheduleRows = [
      // Emp 1: 5 × 8h = 40h
      ...days.map(() => ({ employee_id: 1, start_minutes: 480, end_minutes: 960 })),
      // Emp 2: 1 × 10h
      { employee_id: 2, start_minutes: 480, end_minutes: 1080 },
    ];
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows,
        employeeRows: [{ id: 1, name: "Alex P" }, { id: 2, name: "Jordan K" }],
      }) as any
    );
    const res = await GET(req("?weekStart=2026-06-15"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // mean = (2400 + 600) / 2 = 1500; tolerance 480 → 2400 over, 600 under.
    const alex = body.employees.find((e: any) => e.employeeId === 1);
    expect(alex.status).toBe("over");
    expect(alex.employeeName).toBe("Alex P");
    const jordan = body.employees.find((e: any) => e.employeeId === 2);
    expect(jordan.status).toBe("under");
    expect(body.summary.meanMinutes).toBe(1500);
  });

  it("returns an empty report when nothing is scheduled", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);
    const body = await (await GET(req("?weekStart=2026-06-15"))).json();
    expect(body.employees).toEqual([]);
    expect(body.summary.count).toBe(0);
  });
});
