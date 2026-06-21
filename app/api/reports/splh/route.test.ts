import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

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
  for (const m of ["select", "insert", "update", "upsert", "eq", "in", "order", "limit"]) {
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
  sales = null as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: null });
      if (table === "schedules") return builder({ thenData: scheduleRows });
      if (table === "daily_sales") return builder({ single: sales });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/reports/splh${qs}`);
const putReq = (body: any) =>
  new Request("http://localhost/api/reports/splh", { method: "PUT", body: JSON.stringify(body) });

describe("GET /api/reports/splh", () => {
  it("returns 400 for a missing/bad date", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(getReq())).status).toBe(400);
  });
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(getReq("?date=2026-06-17"))).status).toBe(403);
  });
  it("computes SPLH from sales and scheduled labor", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        sales: { amount_cents: 100000 }, // $1000
        scheduleRows: [
          { start_minutes: 480, end_minutes: 1200 }, // 12h
          { start_minutes: 480, end_minutes: 1200 }, // 12h → 24h... use 40h below
        ],
      }) as any
    );
    const res = await GET(getReq("?date=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.salesCents).toBe(100000);
    expect(body.laborMinutes).toBe(1440); // 24h
    // 100000*60/1440 = 4166.67 → 4167
    expect(body.splhCents).toBe(4167);
  });
  it("reports null SPLH when no labor is scheduled", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ sales: { amount_cents: 50000 }, scheduleRows: [] }) as any);
    const body = await (await GET(getReq("?date=2026-06-17"))).json();
    expect(body.splhCents).toBeNull();
  });
  it("treats missing sales as zero", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ sales: null, scheduleRows: [{ start_minutes: 480, end_minutes: 960 }] }) as any
    );
    const body = await (await GET(getReq("?date=2026-06-17"))).json();
    expect(body.salesCents).toBe(0);
    expect(body.splhCents).toBe(0);
  });
});

describe("PUT /api/reports/splh (record sales)", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await PUT(putReq({ date: "2026-06-17", amountCents: 50000 }))).status).toBe(403);
  });
  it("returns 400 for a bad amount", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await PUT(putReq({ date: "2026-06-17", amountCents: -5 }))).status).toBe(400);
  });
  it("upserts the day's sales", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    const res = await PUT(putReq({ date: "2026-06-17", amountCents: 50000 }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
