import { describe, it, expect, vi } from "vitest";
import { GET, PATCH, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER } from "../__tests__/helpers";

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

function makeBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gte", "lte", "in", "or", "not", "is",
    "order", "limit", "filter", "match",
  ]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

function makeNotificationsClient({
  user = MOCK_USER as any,
  isManager = false,
  notificationsResult = { data: [], error: null } as { data: any; error: any },
  updateResult = { data: null, error: null } as { data: any; error: any },
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id } : null;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return makeBuilder({ data: managerRow, error: null });
      if (table === "notifications") {
        const b = makeBuilder(notificationsResult);
        // update() should return a builder that resolves to updateResult
        b.update = vi.fn().mockReturnValue(makeBuilder(updateResult));
        return b;
      }
      return makeBuilder({ data: null, error: null });
    }),
  };
}

// ── GET ────────────────────────────────────────────────────────────────────────

describe("GET /api/notifications", () => {
  it("returns empty array when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient({ user: null }) as any);
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns notifications for authenticated user", async () => {
    const rows = [
      { id: 1, title: "Shift Updated", is_cleared: false },
      { id: 2, title: "Reminder", is_cleared: false },
    ];
    mockCreateClient.mockResolvedValue(
      makeNotificationsClient({ notificationsResult: { data: rows, error: null } }) as any
    );
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeNotificationsClient({ notificationsResult: { data: null, error: { message: "db error" } } }) as any
    );
    const res = await GET(new Request("http://localhost/api/notifications"));
    expect(res.status).toBe(500);
  });
});

// ── DELETE ─────────────────────────────────────────────────────────────────────

describe("DELETE /api/notifications", () => {
  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient({ user: null }) as any);
    const res = await DELETE(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        body: JSON.stringify({ id: 1 }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has neither id nor all", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient() as any);
    const res = await DELETE(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when id is not a positive integer", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient() as any);
    const res = await DELETE(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        body: JSON.stringify({ id: -5 }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("sets is_cleared=true for a single notification and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient() as any);
    const res = await DELETE(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        body: JSON.stringify({ id: 42 }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("sets is_cleared=true for all user notifications when all=true", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient() as any);
    const res = await DELETE(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        body: JSON.stringify({ all: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 500 when database update fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeNotificationsClient({ updateResult: { data: null, error: { message: "db fail" } } }) as any
    );
    const res = await DELETE(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        body: JSON.stringify({ id: 1 }),
      })
    );
    expect(res.status).toBe(500);
  });

  it("allows manager to clear a broadcast notification (user_id is null)", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient({ isManager: true }) as any);
    const res = await DELETE(
      new Request("http://localhost/api/notifications", {
        method: "DELETE",
        body: JSON.stringify({ id: 10 }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ── PATCH (existing behaviour unchanged) ──────────────────────────────────────

describe("PATCH /api/notifications", () => {
  it("returns 400 when ids array is missing", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient() as any);
    const res = await PATCH(
      new Request("http://localhost/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when ids contains a non-positive integer", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient() as any);
    const res = await PATCH(
      new Request("http://localhost/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ ids: [0] }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("marks notifications as read and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeNotificationsClient() as any);
    const res = await PATCH(
      new Request("http://localhost/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ ids: [1, 2] }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
