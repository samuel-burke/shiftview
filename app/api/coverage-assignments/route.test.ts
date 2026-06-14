import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT, POST, DELETE } from "./route";
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

function putReq(body: unknown) {
  return new Request("http://localhost/api/coverage-assignments", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/coverage-assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteReq(body: unknown) {
  return new Request("http://localhost/api/coverage-assignments", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MOCK_DEFAULTS_DB = [
  { day_of_week: 1, profile_id: 1 },
  { day_of_week: 2, profile_id: 1 },
  { day_of_week: 6, profile_id: 2 },
];

const MOCK_OVERRIDES_DB = [
  { date: "2026-06-10", profile_id: 3 },
  { date: "2026-07-04", profile_id: 4 },
];

// ── GET /api/coverage-assignments ─────────────────────────────────────────────

describe("GET /api/coverage-assignments", () => {
  it("returns 401 for unauthenticated users without querying the DB", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/coverage-assignments"));
    expect(res.status).toBe(401);
    expect(client.from).not.toHaveBeenCalledWith("coverage_day_defaults");
    expect(client.from).not.toHaveBeenCalledWith("coverage_date_overrides");
  });

  it("returns defaults and overrides from DB for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        tableOverrides: {
          coverage_day_defaults:  { data: MOCK_DEFAULTS_DB, error: null },
          coverage_date_overrides: { data: MOCK_OVERRIDES_DB, error: null },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-assignments"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // defaults: day_of_week → profile_id (string keys from Object.fromEntries)
    expect(body.defaults).toMatchObject({ "1": 1, "2": 1, "6": 2 });
    // overrides: date → profile_id
    expect(body.overrides).toMatchObject({ "2026-06-10": 3, "2026-07-04": 4 });
  });

  it("returns 400 when from date format is invalid", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient() as any);
    const res = await GET(new Request("http://localhost/api/coverage-assignments?from=01-01-2026"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("YYYY-MM-DD") });
  });

  it("returns 400 when to date format is invalid", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient() as any);
    const res = await GET(new Request("http://localhost/api/coverage-assignments?to=not-a-date"));
    expect(res.status).toBe(400);
  });

  it("accepts valid from/to query parameters", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        tableOverrides: {
          coverage_day_defaults:   { data: [], error: null },
          coverage_date_overrides: { data: [], error: null },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-assignments?from=2026-06-01&to=2026-06-30"));
    expect(res.status).toBe(200);
  });

  it("returns 500 when defaults query fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        tableOverrides: {
          coverage_day_defaults:   { data: null, error: { message: "db error" } },
          coverage_date_overrides: { data: [], error: null },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-assignments"));
    expect(res.status).toBe(500);
  });

  it("returns 500 when overrides query fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        tableOverrides: {
          coverage_day_defaults:   { data: [], error: null },
          coverage_date_overrides: { data: null, error: { message: "db error" } },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-assignments"));
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/coverage-assignments (day-of-week default) ───────────────────────

describe("PUT /api/coverage-assignments", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  it("returns 400 when dayOfWeek is missing", async () => {
    const res = await PUT(putReq({ profileId: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("dayOfWeek") });
  });

  it("returns 400 when dayOfWeek is out of range (7)", async () => {
    const res = await PUT(putReq({ dayOfWeek: 7, profileId: 1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when dayOfWeek is negative", async () => {
    const res = await PUT(putReq({ dayOfWeek: -1, profileId: 1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when dayOfWeek is a float", async () => {
    const res = await PUT(putReq({ dayOfWeek: 2.5, profileId: 1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when profileId is not an integer or null", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, profileId: "abc" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("profileId") });
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(putReq({ dayOfWeek: 1, profileId: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(putReq({ dayOfWeek: 1, profileId: 1 }));
    expect(res.status).toBe(403);
  });

  it("returns 200 ok when upserting a day-of-week default", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, profileId: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 200 ok when clearing a day-of-week default (profileId: null)", async () => {
    const res = await PUT(putReq({ dayOfWeek: 1, profileId: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("accepts dayOfWeek 0 (Sunday)", async () => {
    const res = await PUT(putReq({ dayOfWeek: 0, profileId: 1 }));
    expect(res.status).toBe(200);
  });

  it("accepts dayOfWeek 6 (Saturday)", async () => {
    const res = await PUT(putReq({ dayOfWeek: 6, profileId: 2 }));
    expect(res.status).toBe(200);
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryError: { message: "db error" },
      }) as any
    );
    const res = await PUT(putReq({ dayOfWeek: 1, profileId: 1 }));
    expect(res.status).toBe(500);
  });
});

// ── POST /api/coverage-assignments (date override) ────────────────────────────

describe("POST /api/coverage-assignments", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  it("returns 400 when date is missing", async () => {
    const res = await POST(postReq({ profileId: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("date") });
  });

  it("returns 400 when date format is invalid", async () => {
    const res = await POST(postReq({ date: "10-06-2026", profileId: 1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when profileId is missing", async () => {
    const res = await POST(postReq({ date: "2026-06-10" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("profileId") });
  });

  it("returns 400 when profileId is not an integer", async () => {
    const res = await POST(postReq({ date: "2026-06-10", profileId: "abc" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await POST(postReq({ date: "2026-06-10", profileId: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await POST(postReq({ date: "2026-06-10", profileId: 1 }));
    expect(res.status).toBe(403);
  });

  it("returns 200 ok on success", async () => {
    const res = await POST(postReq({ date: "2026-06-10", profileId: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryError: { message: "db error" },
      }) as any
    );
    const res = await POST(postReq({ date: "2026-06-10", profileId: 1 }));
    expect(res.status).toBe(500);
  });
});

// ── DELETE /api/coverage-assignments (date override) ─────────────────────────

describe("DELETE /api/coverage-assignments", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  it("returns 400 when date is missing", async () => {
    const res = await DELETE(deleteReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("date") });
  });

  it("returns 400 when date format is invalid", async () => {
    const res = await DELETE(deleteReq({ date: "not-a-date" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await DELETE(deleteReq({ date: "2026-06-10" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await DELETE(deleteReq({ date: "2026-06-10" }));
    expect(res.status).toBe(403);
  });

  it("returns 200 ok on success", async () => {
    const res = await DELETE(deleteReq({ date: "2026-06-10" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryError: { message: "db error" },
      }) as any
    );
    const res = await DELETE(deleteReq({ date: "2026-06-10" }));
    expect(res.status).toBe(500);
  });
});
