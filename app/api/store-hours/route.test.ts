import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

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

const MOCK_DB_ROWS = [
  { day_of_week: 0, open_minutes: 480, close_minutes: 1200 },
  { day_of_week: 1, open_minutes: 360, close_minutes: 1320 },
];

const EXPECTED_MAPPED = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
};

describe("GET /api/store-hours", () => {
  it("returns store hours keyed by day of week", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ queryData: MOCK_DB_ROWS }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPECTED_MAPPED);
  });

  it("maps snake_case DB fields to open/close", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ queryData: MOCK_DB_ROWS }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body[0]).toHaveProperty("open", 480);
    expect(body[0]).toHaveProperty("close", 1200);
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ queryError: { message: "db error" } }) as any
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/store-hours ─────────────────────────────────────────────────────

describe("PUT /api/store-hours", () => {
  const validBody = { dayOfWeek: 1, openMinutes: 360, closeMinutes: 1320 };

  function putReq(body: unknown) {
    return new Request("http://localhost/api/store-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  it("returns 400 when required fields are missing", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ dayOfWeek: 1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when dayOfWeek is out of range (> 6)", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ ...validBody, dayOfWeek: 7 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("dayOfWeek") });
  });

  it("returns 400 when dayOfWeek is negative", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ ...validBody, dayOfWeek: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when dayOfWeek is not an integer", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ ...validBody, dayOfWeek: 1.5 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when openMinutes is out of range (>= 1440)", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ ...validBody, openMinutes: 1440 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("openMinutes") });
  });

  it("returns 400 when openMinutes is negative", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ ...validBody, openMinutes: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when closeMinutes is 0 (must be > 0)", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ ...validBody, closeMinutes: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("closeMinutes") });
  });

  it("returns 400 when closeMinutes exceeds 1440", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ ...validBody, closeMinutes: 1441 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when open equals close", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ dayOfWeek: 1, openMinutes: 480, closeMinutes: 480 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("open must be before close") });
  });

  it("returns 400 when open is after close", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ dayOfWeek: 1, openMinutes: 960, closeMinutes: 480 }));
    expect(res.status).toBe(400);
  });

  it("accepts closeMinutes of exactly 1440 (midnight)", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await PUT(putReq({ dayOfWeek: 1, openMinutes: 360, closeMinutes: 1440 }));
    expect(res.status).toBe(200);
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(403);
  });

  // ── Success / DB error ──────────────────────────────────────────────────────

  it("returns 200 on success", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryError: { message: "db error" } }) as any
    );
    const res = await PUT(putReq(validBody));
    expect(res.status).toBe(500);
  });
});
