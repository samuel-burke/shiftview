import { describe, it, expect, vi } from "vitest";
import { GET, POST, DELETE } from "./route";
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
  for (const m of [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in",
  ]) {
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
  certs = { thenData: [], single: null } as { thenData?: any; single?: any },
  empLookup = { id: 5, org_id: MOCK_ORG_ID, name: "Alex P" } as any,
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
        return empCall === 1 ? builder({ single: employeeRow }) : builder({ single: empLookup });
      }
      if (table === "certifications") return builder(certs);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const postReq = (body: any) =>
  new Request("http://localhost/api/certifications", { method: "POST", body: JSON.stringify(body) });
const delReq = (body: any) =>
  new Request("http://localhost/api/certifications", { method: "DELETE", body: JSON.stringify(body) });

describe("GET /api/certifications", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(new Request("http://localhost/api/certifications"))).status).toBe(401);
  });

  it("returns the caller's own certifications with status", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        employeeId: 5,
        certs: { thenData: [{ id: 1, employee_id: 5, name: "Food Handler", issued_on: null, expires_on: "2020-01-01" }] },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/certifications?today=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.certifications[0].name).toBe("Food Handler");
    expect(body.certifications[0].status).toBe("expired");
  });

  it("lets a manager query another employee by id", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, employeeId: null, certs: { thenData: [] } }) as any
    );
    const res = await GET(new Request("http://localhost/api/certifications?employeeId=8"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/certifications", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await POST(postReq({ employeeId: 5, name: "Food Handler" }))).status).toBe(403);
  });

  it("returns 400 for a missing name", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await POST(postReq({ employeeId: 5, name: "" }))).status).toBe(400);
  });

  it("returns 400 for a malformed expires_on", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await POST(postReq({ employeeId: 5, name: "Food Handler", expiresOn: "06/2026" }))).status).toBe(400);
  });

  it("creates a certification and returns 201", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, certs: { single: { id: 9 } } }) as any
    );
    const res = await POST(postReq({ employeeId: 5, name: "Food Handler", expiresOn: "2027-01-01" }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe(9);
  });
});

describe("DELETE /api/certifications", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await DELETE(delReq({ id: 1 }))).status).toBe(403);
  });

  it("deletes and returns ok", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, certs: { single: { id: 1, name: "Food Handler" } } }) as any
    );
    const res = await DELETE(delReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
