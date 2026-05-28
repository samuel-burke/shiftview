import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseClient, MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: any) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { createClient } from "@/lib/supabase-server";

async function callRoute(url: string) {
  const { GET } = await import("./route");
  return GET(new Request(url));
}

describe("GET /api/reports/coverage", () => {
  beforeEach(() => { vi.resetModules(); });

  it("returns 400 for missing params", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const res = await callRoute("http://localhost/api/reports/coverage");
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: null }) as any
    );
    const res = await callRoute("http://localhost/api/reports/coverage?from=2026-06-01&to=2026-06-07");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-manager", async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await callRoute("http://localhost/api/reports/coverage?from=2026-06-01&to=2026-06-07");
    expect(res.status).toBe(403);
  });

  it("returns days with counts and fills missing dates with 0", async () => {
    const scheduleData = [
      { date: "2026-06-02", employee_id: 1 },
      { date: "2026-06-02", employee_id: 2 },
      { date: "2026-06-04", employee_id: 1 },
    ];

    const schedulesBuilder: any = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: scheduleData, error: null }),
    };

    const managersBuilder = makeSupabaseClient({ user: MOCK_USER, isManager: true }).from("managers");
    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") return managersBuilder;
        if (table === "schedules") return schedulesBuilder;
        return {} as any;
      }),
    };
    vi.mocked(createClient).mockResolvedValue(supabase as any);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/reports/coverage?from=2026-06-01&to=2026-06-04"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toHaveLength(4);
    expect(body.days[0]).toEqual({ date: "2026-06-01", count: 0 });
    expect(body.days[1]).toEqual({ date: "2026-06-02", count: 2 });
    expect(body.days[2]).toEqual({ date: "2026-06-03", count: 0 });
    expect(body.days[3]).toEqual({ date: "2026-06-04", count: 1 });
  });

  it("returns 500 on DB error", async () => {
    const schedulesBuilder: any = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
    };
    const managersBuilder = makeSupabaseClient({ user: MOCK_USER, isManager: true }).from("managers");
    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") return managersBuilder;
        if (table === "schedules") return schedulesBuilder;
        return {} as any;
      }),
    };
    vi.mocked(createClient).mockResolvedValue(supabase as any);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/reports/coverage?from=2026-06-01&to=2026-06-04"));
    expect(res.status).toBe(500);
  });
});
