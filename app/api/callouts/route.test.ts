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

// Non-manager employee client. `callouts` rows come back from `calloutRows`.
function makeEmployeeClient(
  emp: { id: number; name: string } | null = { id: 5, name: "Alice Smith" },
  calloutRows: any[] = []
) {
  const empWithOrg = emp ? { ...emp, org_id: MOCK_ORG_ID } : null;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn().mockImplementation((table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "order", "gte", "lte", "in", "insert", "upsert", "limit"])
        b[m] = vi.fn().mockReturnValue(b);
      if (table === "managers") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        b.then = (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve);
        return b;
      }
      if (table === "employees") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: empWithOrg, error: null });
        b.then = (resolve: any) =>
          Promise.resolve({ data: empWithOrg ? [empWithOrg] : [], error: null }).then(resolve);
        return b;
      }
      // callouts
      b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      b.single = vi.fn().mockResolvedValue({ data: { id: 99 }, error: null });
      b.then = (resolve: any) => Promise.resolve({ data: calloutRows, error: null }).then(resolve);
      return b;
    }),
  };
}

const MOCK_CALLOUTS = [{ id: 1, employee_id: 5, date: "2099-06-15", reason: "Sick" }];

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/callouts", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the caller's own call-outs with ?mine=true", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(undefined, MOCK_CALLOUTS) as any);
    const res = await GET(new Request("http://localhost/api/callouts?mine=true"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.callouts)).toBe(true);
    expect(body.callouts[0]).toMatchObject({ employeeId: 5, date: "2099-06-15", employeeName: "Alice Smith" });
  });

  it("returns org-wide call-outs for a given ?date", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(undefined, MOCK_CALLOUTS) as any);
    const res = await GET(new Request("http://localhost/api/callouts?date=2099-06-15"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.callouts)).toBe(true);
  });

  it("returns 400 for a malformed date param", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient() as any);
    const res = await GET(new Request("http://localhost/api/callouts?date=15-06-2099"));
    expect(res.status).toBe(400);
  });

  it("returns 403 when the caller has no organization membership", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(null) as any);
    const res = await GET(new Request("http://localhost/api/callouts?mine=true"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "No organization membership" });
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("POST /api/callouts", () => {
  const futureDate = "2099-12-31";

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient() as any);
  });

  it("returns 400 for missing employeeId", async () => {
    const res = await POST(
      new Request("http://localhost/api/callouts", {
        method: "POST",
        body: JSON.stringify({ date: futureDate }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await POST(
      new Request("http://localhost/api/callouts", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: "31-12-2099" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "date must be YYYY-MM-DD" });
  });

  it("returns 400 for a past date", async () => {
    const res = await POST(
      new Request("http://localhost/api/callouts", {
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
      new Request("http://localhost/api/callouts", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: futureDate }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when filing for someone else", async () => {
    const res = await POST(
      new Request("http://localhost/api/callouts", {
        method: "POST",
        body: JSON.stringify({ employeeId: 999, date: futureDate }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 201 and id for a valid call-out", async () => {
    const res = await POST(
      new Request("http://localhost/api/callouts", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: futureDate, reason: "Flu" }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(body.ok).toBe(true);
  });
});

// ── Org scoping ───────────────────────────────────────────────────────────────

describe("org scoping — callouts routes", () => {
  it("POST stamps org_id onto the inserted row (withOrg)", async () => {
    let upsertedRow: any = null;
    const client: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"])
          b[m] = vi.fn().mockReturnValue(b);
        b.upsert = vi.fn().mockImplementation((row: any) => {
          if (table === "callouts") upsertedRow = row;
          return b;
        });
        b.maybeSingle = vi.fn().mockResolvedValue({
          data:
            table === "employees"
              ? { id: 5, name: "Alice Smith", org_id: MOCK_ORG_ID }
              : null,
          error: null,
        });
        b.single = vi.fn().mockResolvedValue({ data: { id: 7 }, error: null });
        b.then = (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve);
        return b;
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    await POST(
      new Request("http://localhost/api/callouts", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: "2099-12-31" }),
      })
    );
    expect(upsertedRow).toMatchObject({ org_id: MOCK_ORG_ID, employee_id: 5, date: "2099-12-31" });
  });
});
