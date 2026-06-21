import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { getCurveForDate } from "@/lib/coverage-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/coverage-server", () => ({ getCurveForDate: vi.fn() }));
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
const mockGetCurve = vi.mocked(getCurveForDate);

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

function makeClient({ user = MOCK_USER as any, isManager = true, scheduleRows = [] as any[] } = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: null });
      if (table === "schedules") return builder({ thenData: scheduleRows });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const req = (qs = "") => new Request(`http://localhost/api/reports/coverage-gaps${qs}`);

describe("GET /api/reports/coverage-gaps", () => {
  it("returns 400 when weekStart is missing/malformed", async () => {
    mockGetCurve.mockResolvedValue([]);
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("?weekStart=nope"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("?weekStart=2026-06-15"))).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(req("?weekStart=2026-06-15"))).status).toBe(403);
  });

  it("reports under-staffed ranges against the target curve", async () => {
    // Target of 2 staff from 8:00–9:00 on the first day; nobody scheduled → gap.
    mockGetCurve.mockImplementation(async (_c: any, _o: string, date: string) =>
      date === "2026-06-15" ? [{ startMinutes: 480, endMinutes: 540, headcount: 2 }] : []
    );
    mockCreateClient.mockResolvedValue(makeClient({ scheduleRows: [] }) as any);

    const res = await GET(req("?weekStart=2026-06-15"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalGaps).toBe(1);
    expect(body.summary.worstShortfall).toBe(2);
    expect(body.days).toHaveLength(7);
    const day0 = body.days.find((d: any) => d.date === "2026-06-15");
    expect(day0.gaps[0].shortfall).toBe(2);
  });

  it("reports no gaps when coverage meets the curve", async () => {
    mockGetCurve.mockImplementation(async (_c: any, _o: string, date: string) =>
      date === "2026-06-15" ? [{ startMinutes: 480, endMinutes: 540, headcount: 1 }] : []
    );
    mockCreateClient.mockResolvedValue(
      makeClient({ scheduleRows: [{ date: "2026-06-15", start_minutes: 480, end_minutes: 540 }] }) as any
    );
    const res = await GET(req("?weekStart=2026-06-15"));
    const body = await res.json();
    expect(body.summary.totalGaps).toBe(0);
  });
});
