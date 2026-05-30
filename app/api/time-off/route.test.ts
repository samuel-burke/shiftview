import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeManagerClient(overrides?: Parameters<typeof makeSupabaseClient>[0]) {
  return makeSupabaseClient({ user: MOCK_USER, isManager: true, ...overrides });
}

function makeEmployeeClient(emp: { id: number; name: string } | null = { id: 5, name: "Alice Smith" }) {
  // linkedEmployee drives the employees table lookup in requireManager/GET
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") {
        // Not a manager
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in"]) b[m] = vi.fn().mockReturnValue(b);
        b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        b.then = (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve);
        return b;
      }
      if (table === "employees") {
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in"]) b[m] = vi.fn().mockReturnValue(b);
        b.maybeSingle = vi.fn().mockResolvedValue({ data: emp, error: null });
        b.then = (resolve: any) => Promise.resolve({ data: emp ? [emp] : [], error: null }).then(resolve);
        return b;
      }
      // time_off_requests
      const b: any = {};
      for (const m of ["select", "eq", "order", "gte", "lte", "in", "insert"]) b[m] = vi.fn().mockReturnValue(b);
      b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      b.single = vi.fn().mockResolvedValue({ data: { id: 99 }, error: null });
      b.then = (resolve: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return b;
    }),
  };
}

const MOCK_PENDING_REQUESTS = [
  { id: 1, employee_id: 5, date: "2026-06-15", status: "pending", note: "Vacation" },
];

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/time-off", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns pending requests for manager", async () => {
    const client: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") {
          const b: any = {};
          for (const m of ["select", "eq", "order", "gte", "lte", "in"]) b[m] = vi.fn().mockReturnValue(b);
          b.maybeSingle = vi.fn().mockResolvedValue({ data: { user_id: MOCK_USER.id }, error: null });
          b.then = (resolve: any) =>
            Promise.resolve({ data: { user_id: MOCK_USER.id }, error: null }).then(resolve);
          return b;
        }
        if (table === "employees") {
          const b: any = {};
          for (const m of ["select", "eq", "order", "gte", "lte", "in"]) b[m] = vi.fn().mockReturnValue(b);
          b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 5, name: "Alice Smith" }, error: null });
          b.then = (resolve: any) =>
            Promise.resolve({ data: [{ id: 5, name: "Alice Smith" }], error: null }).then(resolve);
          return b;
        }
        // time_off_requests
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in"]) b[m] = vi.fn().mockReturnValue(b);
        b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        b.then = (resolve: any) =>
          Promise.resolve({ data: MOCK_PENDING_REQUESTS, error: null }).then(resolve);
        return b;
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("requests");
    expect(Array.isArray(body.requests)).toBe(true);
  });

  it("returns own requests for employee (non-manager)", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient() as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("requests");
    expect(Array.isArray(body.requests)).toBe(true);
  });

  it("returns empty requests when employee not found", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(null) as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [] });
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("POST /api/time-off", () => {
  const futureDate = "2099-12-31";

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient() as any);
  });

  it("returns 400 for missing employeeId", async () => {
    const res = await POST(
      new Request("http://localhost/api/time-off", {
        method: "POST",
        body: JSON.stringify({ date: futureDate }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await POST(
      new Request("http://localhost/api/time-off", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: "31-12-2099" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "date must be YYYY-MM-DD" });
  });

  it("returns 400 for past date", async () => {
    const res = await POST(
      new Request("http://localhost/api/time-off", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: "2020-01-01" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("future") });
  });

  it("returns 401 for unauthenticated request", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await POST(
      new Request("http://localhost/api/time-off", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: futureDate }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 201 and id for valid request", async () => {
    const res = await POST(
      new Request("http://localhost/api/time-off", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: futureDate, note: "Family event" }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.ok).toBe(true);
  });
});
