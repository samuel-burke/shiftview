import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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

function makeEmployeeClient(emp: { id: number; name: string } | null = { id: 5, name: "Alice Smith" }) {
  // linkedEmployee drives the employees table lookup in getOrgContext/GET
  const empWithOrg = emp ? { ...emp, org_id: MOCK_ORG_ID } : null;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") {
        // Not a manager
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
        b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        b.then = (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve);
        return b;
      }
      if (table === "employees") {
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
        b.maybeSingle = vi.fn().mockResolvedValue({ data: empWithOrg, error: null });
        b.then = (resolve: any) => Promise.resolve({ data: empWithOrg ? [empWithOrg] : [], error: null }).then(resolve);
        return b;
      }
      // time_off_requests
      const b: any = {};
      for (const m of ["select", "eq", "order", "gte", "lte", "in", "insert", "limit"]) b[m] = vi.fn().mockReturnValue(b);
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
          for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
          b.maybeSingle = vi.fn().mockResolvedValue({ data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }, error: null });
          b.then = (resolve: any) =>
            Promise.resolve({ data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }, error: null }).then(resolve);
          return b;
        }
        if (table === "employees") {
          const b: any = {};
          for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
          b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 5, name: "Alice Smith", org_id: MOCK_ORG_ID }, error: null });
          b.then = (resolve: any) =>
            Promise.resolve({ data: [{ id: 5, name: "Alice Smith", org_id: MOCK_ORG_ID }], error: null }).then(resolve);
          return b;
        }
        // time_off_requests
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
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

  it("returns 403 when employee not found (no organization membership)", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(null) as any);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "No organization membership" });
  });

  it("takes the employee code path (calls maybeSingle) for managers with ?mine=true", async () => {
    // The manager path uses .in() for batch employee name lookup — never calls maybeSingle on employees
    // after org resolution. The employee path calls employees.maybeSingle() to get the linked emp record.
    const employeesMaybeSingleSpy = vi.fn().mockResolvedValue({
      data: { id: 5, name: "Alice Smith", org_id: MOCK_ORG_ID },
      error: null,
    });

    const client: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") {
          const b: any = {};
          for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
          b.maybeSingle = vi.fn().mockResolvedValue({ data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }, error: null });
          b.then = (resolve: any) =>
            Promise.resolve({ data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }, error: null }).then(resolve);
          return b;
        }
        if (table === "employees") {
          const b: any = {};
          for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
          b.maybeSingle = employeesMaybeSingleSpy;
          b.then = (resolve: any) =>
            Promise.resolve({ data: [], error: null }).then(resolve);
          return b;
        }
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"]) b[m] = vi.fn().mockReturnValue(b);
        b.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);

    // Without mine=true: manager path — employees.maybeSingle only serves org resolution.
    await GET(new Request("http://localhost/api/time-off"));

    // With mine=true: employee path runs, employees.maybeSingle called again (for emp lookup)
    const res = await GET(new Request("http://localhost/api/time-off?mine=true"));
    expect(res.status).toBe(200);
    // The employee path calls maybeSingle at least once (for org resolution and emp lookup)
    expect(employeesMaybeSingleSpy).toHaveBeenCalled();
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

// ── Org scoping ───────────────────────────────────────────────────────────────

describe("org scoping — time-off routes", () => {
  it("GET /api/time-off (manager) scopes time_off_requests query to org_id", async () => {
    const timeOffEqArgs: [string, unknown][] = [];
    const client: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        const b: any = {};
        for (const m of ["select", "order", "gte", "lte", "in", "insert", "limit"]) b[m] = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
          if (table === "time_off_requests") timeOffEqArgs.push([col, val]);
          return b;
        });
        b.maybeSingle = vi.fn().mockResolvedValue({
          data: table === "managers" ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID } : null,
          error: null,
        });
        b.then = (resolve: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    await GET(new Request("http://localhost/api/time-off"));
    expect(timeOffEqArgs.some(([col]) => col === "org_id")).toBe(true);
  });
});
