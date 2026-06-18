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
  for (const m of [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gte", "lte", "order", "limit", "in",
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
  isManager = true,
  scheduleRows = [] as any[],
  employeeRows = [] as any[],
} = {}) {
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

const req = (qs = "") => new Request(`http://localhost/api/reports/break-requirements${qs}`);

describe("GET /api/reports/break-requirements", () => {
  it("returns 400 when date is missing or malformed", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("?date=2026"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("?date=2026-06-17"))).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(req("?date=2026-06-17"))).status).toBe(403);
  });

  it("flags shifts requiring a meal break and summarizes", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [
          { id: 1, employee_id: 1, start_minutes: 480, end_minutes: 1020 }, // 9h → meal
          { id: 2, employee_id: 2, start_minutes: 540, end_minutes: 900 },  // 6h → no meal
        ],
        employeeRows: [{ id: 1, name: "Alex P" }, { id: 2, name: "Jordan K" }],
      }) as any
    );
    const res = await GET(req("?date=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();

    const alex = body.shifts.find((s: any) => s.scheduleId === 1);
    expect(alex.employeeName).toBe("Alex P");
    expect(alex.mealBreakRequired).toBe(true);
    expect(alex.restBreaks).toBe(2);

    const jordan = body.shifts.find((s: any) => s.scheduleId === 2);
    expect(jordan.mealBreakRequired).toBe(false);

    expect(body.summary.mealBreaksRequired).toBe(1);
    expect(body.summary.totalShifts).toBe(2);
  });

  it("returns an empty report when nothing is scheduled", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);
    const res = await GET(req("?date=2026-06-17"));
    const body = await res.json();
    expect(body.shifts).toEqual([]);
    expect(body.summary.totalShifts).toBe(0);
  });
});
