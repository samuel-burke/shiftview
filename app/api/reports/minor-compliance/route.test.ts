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

const req = (qs = "") => new Request(`http://localhost/api/reports/minor-compliance${qs}`);

describe("GET /api/reports/minor-compliance", () => {
  it("returns 400 when date is missing/malformed", async () => {
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

  it("flags only minors with violating shifts", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [
          { id: 1, employee_id: 1, start_minutes: 900, end_minutes: 1380 }, // ends 23:00
          { id: 2, employee_id: 2, start_minutes: 600, end_minutes: 960 },  // adult, fine
          { id: 3, employee_id: 3, start_minutes: 600, end_minutes: 900 },  // minor, compliant
        ],
        employeeRows: [
          { id: 1, name: "Teen A", date_of_birth: "2010-01-01" }, // minor
          { id: 2, name: "Adult B", date_of_birth: "1990-01-01" },
          { id: 3, name: "Teen C", date_of_birth: "2010-01-01" }, // minor, compliant
        ],
      }) as any
    );
    const res = await GET(req("?date=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the minor with a violating shift is reported.
    expect(body.violations).toHaveLength(1);
    expect(body.violations[0].employeeId).toBe(1);
    expect(body.violations[0].issues.length).toBeGreaterThan(0);
    expect(body.summary.minorsWithViolations).toBe(1);
  });

  it("ignores employees with no date of birth", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        scheduleRows: [{ id: 1, employee_id: 1, start_minutes: 900, end_minutes: 1380 }],
        employeeRows: [{ id: 1, name: "Unknown DOB", date_of_birth: null }],
      }) as any
    );
    const res = await GET(req("?date=2026-06-17"));
    const body = await res.json();
    expect(body.violations).toEqual([]);
  });
});
