import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

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
  for (const m of ["select", "update", "eq", "in", "order", "limit"]) {
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
  isManager = true,
  employeeRows = [] as any[],
  target = { id: 8, name: "Sam" } as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ thenData: employeeRows, single: target });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/reports/anniversaries${qs}`);
const putReq = (body: any) =>
  new Request("http://localhost/api/reports/anniversaries", { method: "PUT", body: JSON.stringify(body) });

describe("GET /api/reports/anniversaries", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq())).status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(getReq())).status).toBe(403);
  });

  it("lists upcoming anniversaries within the window", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        employeeRows: [
          { id: 1, name: "Alex P", hire_date: "2020-06-20" },
          { id: 2, name: "Jordan K", hire_date: "2019-12-01" }, // far off
          { id: 3, name: "No Date", hire_date: null },
        ],
      }) as any
    );
    const res = await GET(getReq("?asOf=2026-06-17&within=30"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anniversaries).toHaveLength(1);
    expect(body.anniversaries[0]).toMatchObject({ employeeId: 1, employeeName: "Alex P", years: 6 });
  });
});

describe("PUT /api/reports/anniversaries (set hire date)", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await PUT(putReq({ employeeId: 8, hireDate: "2024-01-01" }))).status).toBe(403);
  });

  it("returns 400 for a malformed hire date", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await PUT(putReq({ employeeId: 8, hireDate: "01/2024" }))).status).toBe(400);
  });

  it("sets a hire date and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    const res = await PUT(putReq({ employeeId: 8, hireDate: "2024-01-01" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("clears a hire date with null", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await PUT(putReq({ employeeId: 8, hireDate: null }))).status).toBe(200);
  });
});
