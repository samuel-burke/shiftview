import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

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

const STORE_HOURS_DB = [
  { day_of_week: 0, budget_hours: 40 },
  { day_of_week: 1, budget_hours: 32 },
  { day_of_week: 2, budget_hours: 0 },
  { day_of_week: 3, budget_hours: 24 },
  { day_of_week: 4, budget_hours: 24 },
  { day_of_week: 5, budget_hours: 48 },
  { day_of_week: 6, budget_hours: 48 },
];

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/budgets", () => {
  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns budgets map on success", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: STORE_HOURS_DB }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("budgets");
    expect(body.budgets[0]).toBe(40);
    expect(body.budgets[1]).toBe(32);
    expect(body.budgets[5]).toBe(48);
  });

  it("returns all 7 days in budgets object keyed by 0–6", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: STORE_HOURS_DB }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body.budgets)).toHaveLength(7);
    for (let i = 0; i < 7; i++) {
      expect(body.budgets).toHaveProperty(String(i));
    }
  });

  it("fills missing days with 0", async () => {
    // Only return rows for days 1 and 5
    const partialData = [
      { day_of_week: 1, budget_hours: 32 },
      { day_of_week: 5, budget_hours: 48 },
    ];
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: partialData }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body.budgets[0]).toBe(0);
    expect(body.budgets[2]).toBe(0);
    expect(body.budgets[1]).toBe(32);
    expect(body.budgets[5]).toBe(48);
  });

  it("returns migrationRequired:true with zeroed budgets when select errors", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryError: { message: "column budget_hours does not exist" },
      }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.migrationRequired).toBe(true);
    expect(body.budgets).toBeDefined();
    for (let i = 0; i < 7; i++) {
      expect(body.budgets[i]).toBe(0);
    }
  });

  it("does not include migrationRequired on successful fetch", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: STORE_HOURS_DB }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body.migrationRequired).toBeUndefined();
  });

  it("treats null budget_hours as 0", async () => {
    const dataWithNull = [{ day_of_week: 3, budget_hours: null }];
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: dataWithNull }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body.budgets[3]).toBe(0);
  });
});

// ── PUT ───────────────────────────────────────────────────────────────────────

describe("PUT /api/budgets", () => {
  const validBody = { dayOfWeek: 1, budgetHours: 32 };

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  function putReq(body: unknown) {
    return new Request("http://localhost/api/budgets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 when dayOfWeek is missing", async () => {
    const res = await PUT(putReq({ budgetHours: 32 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns 400 when budgetHours is missing", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns 400 when dayOfWeek is not an integer", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1.5, budgetHours: 32 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("0–6") });
  });

  it("returns 400 when dayOfWeek is negative", async () => {
    const res = await PUT(putReq({ dayOfWeek: -1, budgetHours: 32 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("0–6") });
  });

  it("returns 400 when dayOfWeek is greater than 6", async () => {
    const res = await PUT(putReq({ dayOfWeek: 7, budgetHours: 32 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("0–6") });
  });

  it("returns 400 when budgetHours is not an integer", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, budgetHours: 32.5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("0–999") });
  });

  it("returns 400 when budgetHours is negative", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, budgetHours: -1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("0–999") });
  });

  it("returns 400 when budgetHours exceeds 999", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, budgetHours: 1000 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("0–999") });
  });

  it("accepts boundary value dayOfWeek=0", async () => {
    const res = await PUT(putReq({ dayOfWeek: 0, budgetHours: 32 }));
    expect(res.status).toBe(200);
  });

  it("accepts boundary value dayOfWeek=6", async () => {
    const res = await PUT(putReq({ dayOfWeek: 6, budgetHours: 32 }));
    expect(res.status).toBe(200);
  });

  it("accepts boundary value budgetHours=0", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, budgetHours: 0 }));
    expect(res.status).toBe(200);
  });

  it("accepts boundary value budgetHours=999", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, budgetHours: 999 }));
    expect(res.status).toBe(200);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(403);
  });

  it("returns 200 { ok: true } on success", async () => {
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryError: { message: "db error" },
      }) as any
    );
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(500);
  });
});
