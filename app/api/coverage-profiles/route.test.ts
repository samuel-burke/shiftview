import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PUT, DELETE } from "./route";
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

function postReq(body: unknown) {
  return new Request("http://localhost/api/coverage-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function putReq(body: unknown) {
  return new Request("http://localhost/api/coverage-profiles", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteReq(body: unknown) {
  return new Request("http://localhost/api/coverage-profiles", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const MOCK_PROFILES_DB = [
  { id: 1, name: "Weekday" },
  { id: 2, name: "Weekend" },
];

const MOCK_BLOCKS_DB = [
  { profile_id: 1, start_minutes: 480, end_minutes: 720, headcount: 2 },
  { profile_id: 1, start_minutes: 720, end_minutes: 960, headcount: 3 },
  { profile_id: 2, start_minutes: 600, end_minutes: 1080, headcount: 2 },
];

// ── GET /api/coverage-profiles ────────────────────────────────────────────────

describe("GET /api/coverage-profiles", () => {
  it("returns DEMO_COVERAGE_PROFILES for unauthenticated users without querying the DB", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/coverage-profiles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Demo profiles have id, name, blocks
    expect(body[0]).toHaveProperty("id");
    expect(body[0]).toHaveProperty("name");
    expect(body[0]).toHaveProperty("blocks");
    // DB should not be queried for profiles or blocks
    expect(client.from).not.toHaveBeenCalledWith("coverage_profiles");
    expect(client.from).not.toHaveBeenCalledWith("coverage_profile_blocks");
  });

  it("returns camelCase blocks for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles:      { data: MOCK_PROFILES_DB, error: null },
          coverage_profile_blocks: { data: MOCK_BLOCKS_DB, error: null },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-profiles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    const weekday = body.find((p: any) => p.name === "Weekday");
    expect(weekday).toBeDefined();
    expect(weekday.blocks).toHaveLength(2);
    // Blocks should have camelCase keys
    expect(weekday.blocks[0]).toMatchObject({
      startMinutes: 480,
      endMinutes:   720,
      headcount:    2,
    });
    // snake_case keys should NOT be present
    expect(weekday.blocks[0]).not.toHaveProperty("start_minutes");
    expect(weekday.blocks[0]).not.toHaveProperty("end_minutes");
  });

  it("returns profiles with empty blocks array when a profile has no blocks", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles:       { data: [{ id: 3, name: "Empty" }], error: null },
          coverage_profile_blocks: { data: [], error: null },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-profiles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].blocks).toEqual([]);
  });

  it("returns 500 when profiles query fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles:       { data: null, error: { message: "db error" } },
          coverage_profile_blocks: { data: [], error: null },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-profiles"));
    expect(res.status).toBe(500);
  });

  it("returns 500 when blocks query fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles:       { data: MOCK_PROFILES_DB, error: null },
          coverage_profile_blocks: { data: null, error: { message: "db error" } },
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/coverage-profiles"));
    expect(res.status).toBe(500);
  });
});

// ── POST /api/coverage-profiles ───────────────────────────────────────────────

describe("POST /api/coverage-profiles", () => {
  const validBlocks = [
    { startMinutes: 480, endMinutes: 960, headcount: 2 },
  ];

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles:       { data: { id: 10 }, error: null },
          coverage_profile_blocks: { data: null, error: null },
        },
      }) as any
    );
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(postReq({ blocks: validBlocks }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("name") });
  });

  it("returns 400 when name is empty string", async () => {
    const res = await POST(postReq({ name: "  ", blocks: validBlocks }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when name exceeds 60 characters", async () => {
    const longName = "a".repeat(61);
    const res = await POST(postReq({ name: longName, blocks: validBlocks }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("60") });
  });

  it("returns 422 when blocks are invalid (non-15-min alignment)", async () => {
    const res = await POST(postReq({
      name: "Bad Blocks",
      blocks: [{ startMinutes: 481, endMinutes: 960, headcount: 1 }],
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("15") });
  });

  it("returns 422 when blocks overlap", async () => {
    const res = await POST(postReq({
      name: "Overlapping",
      blocks: [
        { startMinutes: 480, endMinutes: 720, headcount: 1 },
        { startMinutes: 600, endMinutes: 900, headcount: 2 },
      ],
    }));
    expect(res.status).toBe(422);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await POST(postReq({ name: "Valid", blocks: validBlocks }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await POST(postReq({ name: "Valid", blocks: validBlocks }));
    expect(res.status).toBe(403);
  });

  it("returns 409 on duplicate name (Postgres error code 23505)", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles: { data: null, error: { code: "23505", message: "unique violation" } },
          coverage_profile_blocks: { data: null, error: null },
        },
      }) as any
    );
    const res = await POST(postReq({ name: "Duplicate", blocks: validBlocks }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("already exists") });
  });

  it("returns 201 with id on success", async () => {
    const res = await POST(postReq({ name: "New Profile", blocks: validBlocks }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: 10 });
  });

  it("returns 201 when blocks array is empty (optional)", async () => {
    const res = await POST(postReq({ name: "Empty Profile" }));
    expect(res.status).toBe(201);
  });

  it("returns 500 on internal DB error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles: { data: null, error: { message: "internal error" } },
          coverage_profile_blocks: { data: null, error: null },
        },
      }) as any
    );
    const res = await POST(postReq({ name: "Profile", blocks: validBlocks }));
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/coverage-profiles ────────────────────────────────────────────────

describe("PUT /api/coverage-profiles", () => {
  const existingProfile = { id: 1, name: "Weekday" };

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles:       { data: existingProfile, error: null },
          coverage_profile_blocks: { data: null, error: null },
        },
      }) as any
    );
  });

  it("returns 400 when id is missing", async () => {
    const res = await PUT(putReq({ name: "Updated" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when id is not an integer", async () => {
    const res = await PUT(putReq({ id: "abc", name: "Updated" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither name nor blocks are provided", async () => {
    const res = await PUT(putReq({ id: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("name or blocks") });
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await PUT(putReq({ id: 1, name: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("invalid name") });
  });

  it("returns 422 when blocks are invalid", async () => {
    const res = await PUT(putReq({
      id: 1,
      blocks: [{ startMinutes: 481, endMinutes: 960, headcount: 1 }],
    }));
    expect(res.status).toBe(422);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(putReq({ id: 1, name: "Updated" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(putReq({ id: 1, name: "Updated" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when profile is not found", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles:       { data: null, error: null },
          coverage_profile_blocks: { data: null, error: null },
        },
      }) as any
    );
    const res = await PUT(putReq({ id: 999, name: "Updated" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("returns 200 ok on success when updating name", async () => {
    const res = await PUT(putReq({ id: 1, name: "Updated Name" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 200 ok on success when updating blocks", async () => {
    const res = await PUT(putReq({
      id: 1,
      blocks: [{ startMinutes: 480, endMinutes: 960, headcount: 2 }],
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 200 ok when updating both name and blocks", async () => {
    const res = await PUT(putReq({
      id: 1,
      name: "Updated",
      blocks: [{ startMinutes: 480, endMinutes: 960, headcount: 2 }],
    }));
    expect(res.status).toBe(200);
  });
});

// ── DELETE /api/coverage-profiles ─────────────────────────────────────────────

describe("DELETE /api/coverage-profiles", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles: { data: { id: 1, name: "Weekday" }, error: null },
        },
      }) as any
    );
  });

  it("returns 400 when id is missing", async () => {
    const res = await DELETE(deleteReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("id") });
  });

  it("returns 400 when id is not an integer", async () => {
    const res = await DELETE(deleteReq({ id: "abc" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(403);
  });

  it("returns 200 ok on success", async () => {
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        isManager: true,
        user: MOCK_USER,
        tableOverrides: {
          coverage_profiles: { data: null, error: { message: "db error" } },
        },
      }) as any
    );
    const res = await DELETE(deleteReq({ id: 1 }));
    expect(res.status).toBe(500);
  });
});
