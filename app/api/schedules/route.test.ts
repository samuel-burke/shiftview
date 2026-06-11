import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PUT, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";
// Silence notify/email side-effects in tests
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

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

  it("returns 401 for unauthenticated users", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(res.status).toBe(401);
  });

  it("queries schedules for authenticated users", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_SCHEDULES_DB });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(res.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("schedules");
  });

  it("maps snake_case fields to camelCase", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_SCHEDULES_DB });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(await res.json()).toEqual(MOCK_SCHEDULES);
  });

  it("returns 500 on database error", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryError: { message: "db error" } });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    expect(res.status).toBe(500);
  });

  it("scopes query to org_id", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_SCHEDULES_DB });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/schedules?date=2026-05-26"));
    const schedulesBuilder = (client.from as any).mock.results.find(
      (r: any) => (client.from as any).mock.calls[
        (client.from as any).mock.results.indexOf(r)
      ]?.[0] === "schedules"
    )?.value;
    expect(schedulesBuilder?.eq).toHaveBeenCalledWith("org_id", MOCK_ORG_ID);
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

  it("returns 409 when the employee is already scheduled on that date", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: { id: 99 } }) as any
    );
    const res = await POST(new Request("http://localhost/api/schedules", {
      method: "POST",
      body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("already scheduled") });
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

// ── POST conflict detection ──────────────────────────────────────────────────
// Date "2026-05-25" is a Monday = day 1

describe("POST /api/schedules — conflict detection", () => {
  const conflictDate = "2026-05-25"; // Monday = dayOfWeek 1

  function postReq(body: unknown) {
    return new Request("http://localhost/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 409 { conflict: 'time_off' } when approved time-off exists", async () => {
    // schedules.maybeSingle = null (no duplicate), time_off_requests = approved record
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      tableOverrides: {
        // no duplicate schedule
        schedules: { data: null, error: null },
        // approved time-off
        time_off_requests: { data: { id: 10, status: "approved" }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, date: conflictDate, startMinutes: 480, endMinutes: 960 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ conflict: "time_off" });
  });

  it("returns 409 { conflict: 'availability', window: null } when fully unavailable", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      tableOverrides: {
        schedules: { data: null, error: null },
        time_off_requests: { data: null, error: null },
        availability: { data: { id: 3, start_minutes: null, end_minutes: null }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, date: conflictDate, startMinutes: 480, endMinutes: 960 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ conflict: "availability", window: null });
  });

  it("returns 409 { conflict: 'availability', window: {...} } when shift starts before window (480-960 vs 720-1320)", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      tableOverrides: {
        schedules: { data: null, error: null },
        time_off_requests: { data: null, error: null },
        availability: { data: { id: 3, start_minutes: 720, end_minutes: 1320 }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, date: conflictDate, startMinutes: 480, endMinutes: 960 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ conflict: "availability", window: { startMinutes: 720, endMinutes: 1320 } });
  });

  it("returns 409 { conflict: 'availability', window: {...} } when shift ends after window (480-960 vs 360-720)", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      tableOverrides: {
        schedules: { data: null, error: null },
        time_off_requests: { data: null, error: null },
        availability: { data: { id: 3, start_minutes: 360, end_minutes: 720 }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, date: conflictDate, startMinutes: 480, endMinutes: 960 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ conflict: "availability", window: { startMinutes: 360, endMinutes: 720 } });
  });

  it("returns 201 when shift fits inside window (720-900 vs 720-1320)", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      tableOverrides: {
        schedules: { data: null, error: null },
        time_off_requests: { data: null, error: null },
        availability: { data: { id: 3, start_minutes: 720, end_minutes: 1320 }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, date: conflictDate, startMinutes: 720, endMinutes: 900 }));
    expect(res.status).toBe(201);
  });

  it("returns 201 when override:true bypasses availability conflict", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      tableOverrides: {
        schedules: { data: null, error: null },
        time_off_requests: { data: null, error: null },
        availability: { data: { id: 3, start_minutes: null, end_minutes: null }, error: null },
      },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ employeeId: 1, date: conflictDate, startMinutes: 480, endMinutes: 960, override: true }));
    expect(res.status).toBe(201);
  });
});
