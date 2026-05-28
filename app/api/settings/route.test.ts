import { describe, it, expect, vi, beforeEach } from "vitest";
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

const MOCK_DB_SETTINGS = [
  { key: "first_day_of_week", value: "1" },
  { key: "optimal_coverage",  value: "4" },
  { key: "minimum_coverage",  value: "3" },
  { key: "timezone",          value: "America/Chicago" },
];

// ── GET /api/settings ─────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  it("returns demo settings for unauthenticated users without querying the DB", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ optimalCoverage: 3, minCoverage: 2, firstDayOfWeek: 1, timezone: "America/New_York" });
    expect(client.from).not.toHaveBeenCalledWith("app_settings");
  });

  it("returns parsed settings including timezone from the database for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_DB_SETTINGS }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      firstDayOfWeek: 1,
      optimalCoverage: 4,
      minCoverage: 3,
      timezone: "America/Chicago",
    });
  });

  it("returns default timezone when not set in database", async () => {
    const noTz = MOCK_DB_SETTINGS.filter((r) => r.key !== "timezone");
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, queryData: noTz }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).timezone).toBe("America/New_York");
  });

  it("returns default values when the table is empty for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, queryData: [] }) as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      firstDayOfWeek: 6,
      optimalCoverage: 3,
      minCoverage: 2,
      timezone: "America/New_York",
    });
  });

  it("returns 500 on database error for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, queryError: { message: "db error" } }) as any
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/settings ─────────────────────────────────────────────────────────

describe("PUT /api/settings", () => {
  function putReq(body: unknown) {
    return new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(403);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("returns 400 when no recognized fields are provided", async () => {
    const res = await PUT(putReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("No valid fields") });
  });

  it("returns 400 when firstDayOfWeek is out of range (> 6)", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 7 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("firstDayOfWeek") });
  });

  it("returns 400 when firstDayOfWeek is negative", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when firstDayOfWeek is a float", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 1.5 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when optimalCoverage is less than 1", async () => {
    const res = await PUT(putReq({ optimalCoverage: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("optimalCoverage") });
  });

  it("returns 400 when minCoverage is negative", async () => {
    const res = await PUT(putReq({ minCoverage: -1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("minCoverage") });
  });

  it("accepts minCoverage of 0", async () => {
    const res = await PUT(putReq({ minCoverage: 0 }));
    expect(res.status).toBe(200);
  });

  it("accepts firstDayOfWeek of 0 (Sunday)", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 0 }));
    expect(res.status).toBe(200);
  });

  it("accepts firstDayOfWeek of 6 (Saturday)", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 6 }));
    expect(res.status).toBe(200);
  });

  // ── Success ─────────────────────────────────────────────────────────────────

  it("returns 200 when updating a single field", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 when updating multiple fields at once", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 1, optimalCoverage: 4, minCoverage: 2 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 when updating timezone", async () => {
    const res = await PUT(putReq({ timezone: "America/Los_Angeles" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 400 when timezone is an empty string", async () => {
    const res = await PUT(putReq({ timezone: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("timezone") });
  });

  it("returns 400 when timezone is not a string", async () => {
    const res = await PUT(putReq({ timezone: 42 }));
    expect(res.status).toBe(400);
  });

  // ── DB error ─────────────────────────────────────────────────────────────────

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryError: { message: "db error" } }) as any
    );
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(500);
  });
});
