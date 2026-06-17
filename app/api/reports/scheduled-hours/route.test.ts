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
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in", "like", "range",
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
      if (table === "employees") return builder({ thenData: employeeRows, single: null });
      if (table === "schedules") return builder({ thenData: scheduleRows });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function req(weekStart?: string) {
  const url = weekStart
    ? `http://localhost/api/reports/scheduled-hours?weekStart=${weekStart}`
    : "http://localhost/api/reports/scheduled-hours";
  return new Request(url);
}

describe("GET /api/reports/scheduled-hours", () => {
  it("returns 400 when weekStart is missing or malformed", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("07-06-2026"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("2026-07-06"))).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(req("2026-07-06"))).status).toBe(403);
  });

  it("summarizes weekly hours and flags overtime", async () => {
    // Employee 1: 5 × 9h = 45h → overtime. Employee 2: 1 × 8h = 8h.
    const scheduleRows = [
      ...["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"].map((date) => ({
        date, employee_id: 1, start_minutes: 480, end_minutes: 1020,
      })),
      { date: "2026-07-06", employee_id: 2, start_minutes: 480, end_minutes: 960 },
    ];
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows,
        employeeRows: [{ id: 1, name: "Alex P" }, { id: 2, name: "Jordan K" }],
      }) as any
    );
    const res = await GET(req("2026-07-06"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weekStart).toBe("2026-07-06");
    expect(body.employees).toHaveLength(2);

    const alex = body.employees.find((e: any) => e.employeeId === 1);
    expect(alex.employeeName).toBe("Alex P");
    expect(alex.totalMinutes).toBe(2700);
    expect(alex.isOvertime).toBe(true);
    expect(alex.overtimeMinutes).toBe(300);

    const jordan = body.employees.find((e: any) => e.employeeId === 2);
    expect(jordan.isOvertime).toBe(false);
  });

  it("returns an empty list when nothing is scheduled", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);
    const res = await GET(req("2026-07-06"));
    const body = await res.json();
    expect(body.employees).toEqual([]);
  });
});
