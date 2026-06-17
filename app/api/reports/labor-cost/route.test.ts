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

const req = (weekStart?: string) =>
  new Request(
    weekStart
      ? `http://localhost/api/reports/labor-cost?weekStart=${weekStart}`
      : "http://localhost/api/reports/labor-cost"
  );

describe("GET /api/reports/labor-cost", () => {
  it("returns 400 when weekStart is missing or malformed", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("nope"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("2026-07-06"))).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(req("2026-07-06"))).status).toBe(403);
  });

  it("computes per-employee and total labor cost with overtime at 1.5x", async () => {
    // Emp 1: 5 × 9h = 45h. Emp 2: 1 × 8h = 8h.
    const scheduleRows = [
      ...["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"].map((date) => ({
        date, employee_id: 1, start_minutes: 480, end_minutes: 1020,
      })),
      { date: "2026-07-06", employee_id: 2, start_minutes: 480, end_minutes: 960 },
    ];
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows,
        employeeRows: [
          { id: 1, name: "Alex P", pay_rate: 20 },
          { id: 2, name: "Jordan K", pay_rate: 15 },
        ],
      }) as any
    );
    const res = await GET(req("2026-07-06"));
    expect(res.status).toBe(200);
    const body = await res.json();

    const alex = body.employees.find((e: any) => e.employeeId === 1);
    expect(alex.cost).toBe(950); // 40×20 + 5×20×1.5
    const jordan = body.employees.find((e: any) => e.employeeId === 2);
    expect(jordan.cost).toBe(120); // 8×15

    expect(body.totalCost).toBe(1070);
    expect(body.employeesMissingRate).toBe(0);
  });

  it("flags scheduled employees with no pay rate set", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [{ date: "2026-07-06", employee_id: 3, start_minutes: 480, end_minutes: 960 }],
        employeeRows: [{ id: 3, name: "Sam B", pay_rate: null }],
      }) as any
    );
    const res = await GET(req("2026-07-06"));
    const body = await res.json();
    expect(body.employeesMissingRate).toBe(1);
    expect(body.employees[0].cost).toBeNull();
  });

  it("returns an empty summary when nothing is scheduled", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);
    const res = await GET(req("2026-07-06"));
    const body = await res.json();
    expect(body.employees).toEqual([]);
    expect(body.totalCost).toBe(0);
  });
});
