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

function makeClient({
  user = MOCK_USER as any,
  isManager = true,
  scheduleRows = [] as any[],
  punchRows = [] as any[],
  employeeRows = [] as any[],
  settings = [{ key: "timezone", value: "UTC" }] as any[],
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: null, thenData: employeeRows });
      if (table === "schedules") return builder({ thenData: scheduleRows });
      if (table === "punch_records") return builder({ thenData: punchRows });
      if (table === "app_settings") return builder({ thenData: settings });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const req = (qs = "") => new Request(`http://localhost/api/reports/punctuality${qs}`);

describe("GET /api/reports/punctuality", () => {
  it("returns 400 for a missing/bad date", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("?date=x"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("?date=2026-06-17"))).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(req("?date=2026-06-17"))).status).toBe(403);
  });

  it("classifies on_time / late / absent against scheduled starts (UTC tz)", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [
          { employee_id: 1, start_minutes: 540 }, // 9:00
          { employee_id: 2, start_minutes: 540 },
          { employee_id: 3, start_minutes: 600 },
        ],
        punchRows: [
          { employee_id: 1, punch_type: "clock_in", punched_at: "2026-06-17T09:03:00Z" }, // 543 → on_time (grace 6)
          { employee_id: 2, punch_type: "clock_in", punched_at: "2026-06-17T09:20:00Z" }, // 560 → late
          // emp 3 never clocked in → absent
        ],
        employeeRows: [{ id: 1, name: "Alex" }, { id: 2, name: "Jordan" }, { id: 3, name: "Sam" }],
      }) as any
    );
    const res = await GET(req("?date=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(body.rows.map((r: any) => [r.employeeId, r.status]));
    expect(byId[1]).toBe("on_time");
    expect(byId[2]).toBe("late");
    expect(byId[3]).toBe("absent");
    expect(body.summary).toMatchObject({ total: 3, onTime: 1, late: 1, absent: 1, onTimeRate: 50 });
  });

  it("returns an empty report when nothing is scheduled", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);
    const body = await (await GET(req("?date=2026-06-17"))).json();
    expect(body.rows).toEqual([]);
    expect(body.summary.total).toBe(0);
  });
});
