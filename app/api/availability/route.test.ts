import { describe, it, expect, vi, beforeEach } from "vitest";
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
  it("returns unavailable days for an employee", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      queryData: [{ day_of_week: 0 }, { day_of_week: 6 }],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability?employeeId=1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ unavailableDays: [0, 6] });
  });

  it("returns empty array when employee has no unavailable days", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: [] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability?employeeId=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unavailableDays: [] });
  });

  it("returns 401 when unauthenticated", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/availability?employeeId=1"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: expect.stringContaining("authenticated") });
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
    const client = makeSupabaseClient({ user: MOCK_USER, queryError: { message: "db error" } });
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

  it("requires manager auth — returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1 }));
    expect(res.status).toBe(401);
  });

  it("requires manager auth — returns 403 for non-manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 1 }));
    expect(res.status).toBe(403);
  });

  it("sets a day unavailable and returns 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 3 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 400 when dayOfWeek is less than 0", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: -1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("dayOfWeek") });
  });

  it("returns 400 when dayOfWeek is greater than 6", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 7 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("dayOfWeek") });
  });

  it("returns 400 when dayOfWeek is a non-integer", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 2.5 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("dayOfWeek") });
  });

  it("returns 400 when employeeId is missing", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const res = await POST(postReq({ dayOfWeek: 2 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("employeeId") });
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, dayOfWeek: 2 }));
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

  it("requires manager auth — returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await DELETE(deleteReq({ employeeId: 1, dayOfWeek: 1 }));
    expect(res.status).toBe(401);
  });

  it("removes a day and returns 200", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await DELETE(deleteReq({ employeeId: 1, dayOfWeek: 3 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 400 when dayOfWeek is missing", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
    const res = await DELETE(deleteReq({ employeeId: 1 }));
    expect(res.status).toBe(400);
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      queryError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await DELETE(deleteReq({ employeeId: 1, dayOfWeek: 2 }));
    expect(res.status).toBe(500);
  });
});
