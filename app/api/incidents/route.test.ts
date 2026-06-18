import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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

function builder({ thenData = null as any, single = null as any } = {}) {
  const b: any = {};
  for (const m of ["select", "insert", "eq", "in", "gte", "lte", "order", "limit"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: thenData, error: null }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  isManager = false,
  employeeId = 5 as number | null,
  incidents = { thenData: [] } as { thenData?: any },
  employees = [] as any[],
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: employeeRow, thenData: employees });
      if (table === "incidents") return builder(incidents);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/incidents${qs}`);
const postReq = (body: any) =>
  new Request("http://localhost/api/incidents", { method: "POST", body: JSON.stringify(body) });

describe("GET /api/incidents (manager-only)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq("?from=2026-06-01&to=2026-06-30"))).status).toBe(401);
  });
  it("returns 403 for a non-manager (sensitive)", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(getReq("?from=2026-06-01&to=2026-06-30"))).status).toBe(403);
  });
  it("returns 400 for a missing/bad range", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await GET(getReq())).status).toBe(400);
  });
  it("returns incidents with involved-employee names", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        isManager: true,
        incidents: { thenData: [{ id: 1, employee_id: 8, date: "2026-06-17", severity: "moderate", description: "Burn", created_at: "t" }] },
        employees: [{ id: 8, name: "Sam" }],
      }) as any
    );
    const res = await GET(getReq("?from=2026-06-01&to=2026-06-30"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incidents[0].severity).toBe("moderate");
    expect(body.incidents[0].employeeName).toBe("Sam");
  });
});

describe("POST /api/incidents (any member)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await POST(postReq({ date: "2026-06-17", severity: "minor", description: "x" }))).status).toBe(401);
  });
  it("returns 400 for an invalid incident", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    expect((await POST(postReq({ date: "2026-06-17", severity: "nope", description: "x" }))).status).toBe(400);
  });
  it("lets any member file an incident", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    const res = await POST(postReq({ date: "2026-06-17", severity: "minor", description: "Slipped" }));
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
  });
});
