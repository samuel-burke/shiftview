import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PUT, DELETE } from "./route";
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

const MOCK_SCHEDULES_DB = [
  { id: 1, employee_id: 1, date: "2026-05-26", start_minutes: 480, end_minutes: 960 },
];
const MOCK_SCHEDULES = [
  { id: 1, employeeId: 1, date: "2026-05-26", startMinutes: 480, endMinutes: 960 },
];

// ── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/schedules", () => {
  it("returns 400 when date param is missing", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient() as any);
    const res = await GET(new Request("http://localhost/api/schedules"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "date param required" });
  });

  it("returns 400 for an invalid date format", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient() as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=26-05-2026"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "date must be YYYY-MM-DD" });
  });

  it("returns demo fixture schedules for unauthenticated users without querying Supabase", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(res.status).toBe(200);
    expect(client.from).not.toHaveBeenCalledWith("schedules_demo");
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("queries schedules for authenticated users", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_SCHEDULES_DB });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("schedules");
  });

  it("maps snake_case fields to camelCase", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryData: MOCK_SCHEDULES_DB });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(await res.json()).toEqual(MOCK_SCHEDULES);
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, queryError: { message: "db error" } });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(res.status).toBe(500);
  });
});

// ── POST ────────────────────────────────────────────────────────────────────

describe("POST /api/schedules", () => {
  const validBody = { employeeId: 1, date: "2026-05-26", startMinutes: 480, endMinutes: 960 };

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  it("returns 400 when fields are missing", async () => {
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify({ employeeId: 1 }),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify({ ...validBody, date: "bad-date" }),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 422 for invalid shift times", async () => {
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify({ ...validBody, startMinutes: 960, endMinutes: 480 }),
    }));
    expect(res.status).toBe(422);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(403);
  });

  it("returns 201 on success", async () => {
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(201);
  });

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryError: { message: "db error" } }) as any
    );
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(500);
  });
});

// ── PUT ─────────────────────────────────────────────────────────────────────

describe("PUT /api/schedules", () => {
  const validBody = { id: 1, startMinutes: 480, endMinutes: 960 };

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  it("returns 400 when fields are missing", async () => {
    const res = await PUT(new Request("http://localhost/api/schedules", {
      method: "PUT",
      body: JSON.stringify({ id: 1 }),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 422 for invalid shift times", async () => {
    const res = await PUT(new Request("http://localhost/api/schedules", {
      method: "PUT",
      body: JSON.stringify({ ...validBody, endMinutes: 481 }), // only 1 min = too short
    }));
    expect(res.status).toBe(422);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(new Request("http://localhost/api/schedules", {
      method: "PUT",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(new Request("http://localhost/api/schedules", {
      method: "PUT",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(403);
  });

  it("returns 200 on success", async () => {
    const res = await PUT(new Request("http://localhost/api/schedules", {
      method: "PUT",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/schedules", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  it("returns 400 when id is missing", async () => {
    const res = await DELETE(new Request("http://localhost/api/schedules", {
      method: "DELETE",
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when id is not an integer", async () => {
    const res = await DELETE(new Request("http://localhost/api/schedules", {
      method: "DELETE",
      body: JSON.stringify({ id: "abc" }),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await DELETE(new Request("http://localhost/api/schedules", {
      method: "DELETE",
      body: JSON.stringify({ id: 1 }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await DELETE(new Request("http://localhost/api/schedules", {
      method: "DELETE",
      body: JSON.stringify({ id: 1 }),
    }));
    expect(res.status).toBe(403);
  });

  it("returns 200 on success", async () => {
    const res = await DELETE(new Request("http://localhost/api/schedules", {
      method: "DELETE",
      body: JSON.stringify({ id: 1 }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
