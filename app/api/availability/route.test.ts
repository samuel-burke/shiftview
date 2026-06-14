import { describe, it, expect, vi } from "vitest";
import { GET, POST, DELETE } from "./route";
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

// ── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/availability", () => {
  it("returns full record array (id, dayOfWeek, startMinutes, endMinutes, note)", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      linkedEmployee: { id: 1, user_id: MOCK_USER.id },
      queryData: [
        { id: 1, day_of_week: 0, start_minutes: null, end_minutes: null, note: "Family time" },
        { id: 2, day_of_week: 6, start_minutes: 720, end_minutes: 1320, note: null },
      ],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability?employeeId=1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([
      { id: 1, dayOfWeek: 0, startMinutes: null, endMinutes: null, note: "Family time" },
      { id: 2, dayOfWeek: 6, startMinutes: 720, endMinutes: 1320, note: null },
    ]);
  });

  it("returns empty array when no records", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      linkedEmployee: { id: 1, user_id: MOCK_USER.id },
      queryData: [],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability?employeeId=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability?employeeId=1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 if employeeId is missing", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ error: expect.stringContaining("employeeId") });
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      linkedEmployee: { id: 1, user_id: MOCK_USER.id },
      queryError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability?employeeId=1"));
    expect(res.status).toBe(500);
  });
});

// ── POST ─────────────────────────────────────────────────────────────────────

describe("POST /api/availability", () => {
  function postReq(body: unknown) {
    return new Request("http://localhost/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("sets full-day unavailable (null, null) → 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 0, startMinutes: null, endMinutes: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("sets window (720, 1320) → 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: 720, endMinutes: 1320 }));
    expect(res.status).toBe(200);
  });

  it("accepts optional note → 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: 720, endMinutes: 1320, note: "Only afternoons" }));
    expect(res.status).toBe(200);
  });

  it("returns 422 when startMinutes >= endMinutes", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: 960, endMinutes: 480 }));
    expect(res.status).toBe(422);
  });

  it("returns 422 when window < 30 minutes", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: 480, endMinutes: 509 }));
    expect(res.status).toBe(422);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: null, endMinutes: null }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when non-manager sets ANOTHER employee's availability", async () => {
    // User is linked to employee #2, but request has employeeId: 1 → should 403
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: false,
      linkedEmployee: { id: 2, user_id: MOCK_USER.id },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: null, endMinutes: null }));
    expect(res.status).toBe(403);
  });

  it("returns 200 when employee sets OWN availability", async () => {
    // User is linked to employee #1, request has employeeId: 1 → should succeed
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: false,
      linkedEmployee: { id: 1, user_id: MOCK_USER.id },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: null, endMinutes: null }));
    expect(res.status).toBe(200);
  });

  it("returns 500 on db error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1, startMinutes: null, endMinutes: null }));
    expect(res.status).toBe(500);
  });
});

// ── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/availability", () => {
  function deleteReq(body: unknown) {
    return new Request("http://localhost/api/availability", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("deletes by id → 200 (manager)", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      tableOverrides: {
        availability: { data: { id: 5, employee_id: 1 }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await DELETE(deleteReq({ id: 5 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await DELETE(deleteReq({ id: 5 }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when id missing", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await DELETE(deleteReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 403 when non-manager tries to delete another employee's record", async () => {
    // Record belongs to employee 99, user is linked to employee 1
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: false,
      linkedEmployee: { id: 1, user_id: MOCK_USER.id },
      tableOverrides: {
        availability: { data: { id: 5, employee_id: 99 }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await DELETE(deleteReq({ id: 5 }));
    expect(res.status).toBe(403);
  });

  it("returns 200 when employee deletes own record", async () => {
    // Record belongs to employee 1, user is linked to employee 1
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: false,
      linkedEmployee: { id: 1, user_id: MOCK_USER.id },
      tableOverrides: {
        availability: { data: { id: 5, employee_id: 1 }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await DELETE(deleteReq({ id: 5 }));
    expect(res.status).toBe(200);
  });
});
