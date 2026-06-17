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
  target = { id: 5, name: "Alex P", phone: "555-111-2222", emergency_contact_name: "Pat", emergency_contact_phone: "555-333-4444" } as any,
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

const getReq = (qs = "") => new Request(`http://localhost/api/employees/contact${qs}`);
const putReq = (body: any) =>
  new Request("http://localhost/api/employees/contact", { method: "PUT", body: JSON.stringify(body) });

describe("GET /api/employees/contact", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq())).status).toBe(401);
  });

  it("returns the caller's own contact info", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phone).toBe("555-111-2222");
    expect(body.emergencyContactName).toBe("Pat");
  });

  it("lets a manager read another employee's contact by id", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, employeeId: null, target: { id: 8, name: "Sam", phone: "555-000-1111", emergency_contact_name: null, emergency_contact_phone: null } }) as any
    );
    const res = await GET(getReq("?employeeId=8"));
    expect(res.status).toBe(200);
    expect((await res.json()).employeeId).toBe(8);
  });

  it("forbids an employee reading someone else's contact", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await GET(getReq("?employeeId=8"))).status).toBe(403);
  });
});

describe("PUT /api/employees/contact", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await PUT(putReq({ phone: "555-123-4567" }))).status).toBe(401);
  });

  it("returns 400 for an invalid phone", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    expect((await PUT(putReq({ phone: "abc" }))).status).toBe(400);
  });

  it("updates the caller's own contact info", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    const res = await PUT(putReq({ phone: "555-123-4567", emergencyContactName: "Pat Doe" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("forbids an employee editing someone else's contact", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await PUT(putReq({ employeeId: 8, phone: "555-123-4567" }))).status).toBe(403);
  });

  it("lets a manager edit another employee's contact", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, employeeId: null, target: { id: 8, name: "Sam" } }) as any
    );
    const res = await PUT(putReq({ employeeId: 8, phone: "555-123-4567" }));
    expect(res.status).toBe(200);
  });
});
