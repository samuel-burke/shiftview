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

function builder({ single = null as any } = {}) {
  const b: any = {};
  for (const m of ["select", "update", "eq", "in", "order", "limit"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  isManager = false,
  employeeId = 5 as number | null,
  target = { id: 5, name: "Alex P", preferred_shift_types: "opener,closer" } as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID } : null;
  let empCall = 0;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") {
        empCall++;
        return empCall === 1 ? builder({ single: employeeRow }) : builder({ single: target });
      }
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/employees/shift-preferences${qs}`);
const putReq = (body: any) =>
  new Request("http://localhost/api/employees/shift-preferences", { method: "PUT", body: JSON.stringify(body) });

describe("GET /api/employees/shift-preferences", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq())).status).toBe(401);
  });
  it("returns the caller's own preferences parsed to an array", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).shiftTypes).toEqual(["opener", "closer"]);
  });
  it("forbids an employee reading another's preferences", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await GET(getReq("?employeeId=8"))).status).toBe(403);
  });
});

describe("PUT /api/employees/shift-preferences", () => {
  it("returns 400 for an invalid shift type", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    expect((await PUT(putReq({ shiftTypes: ["graveyard"] }))).status).toBe(400);
  });
  it("updates the caller's own preferences", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    const res = await PUT(putReq({ shiftTypes: ["opener"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
  it("forbids an employee editing another's preferences", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await PUT(putReq({ employeeId: 8, shiftTypes: ["opener"] }))).status).toBe(403);
  });
  it("lets a manager edit anyone's preferences", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, employeeId: null, target: { id: 8, name: "Sam" } }) as any);
    expect((await PUT(putReq({ employeeId: 8, shiftTypes: ["mid"] }))).status).toBe(200);
  });
});
