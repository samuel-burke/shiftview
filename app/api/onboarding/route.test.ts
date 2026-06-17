import { describe, it, expect, vi } from "vitest";
import { GET, POST, PATCH, DELETE } from "./route";
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
  for (const m of ["select", "insert", "update", "delete", "eq", "in", "order", "limit"]) {
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
  items = { thenData: [], single: null } as { thenData?: any; single?: any },
  empExists = true,
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
        return empCall === 1
          ? builder({ single: employeeRow })
          : builder({ single: empExists ? { id: 8, name: "Sam" } : null });
      }
      if (table === "onboarding_items") return builder(items);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/onboarding${qs}`);
const jsonReq = (method: string, body: any) =>
  new Request("http://localhost/api/onboarding", { method, body: JSON.stringify(body) });

describe("GET /api/onboarding", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq())).status).toBe(401);
  });

  it("returns the caller's own checklist", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ employeeId: 5, items: { thenData: [{ id: 1, employee_id: 5, label: "Sign W-4", done: false }] } }) as any
    );
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].label).toBe("Sign W-4");
    expect(body.progress.total).toBe(1);
  });

  it("forbids an employee reading another's checklist", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await GET(getReq("?employeeId=8"))).status).toBe(403);
  });

  it("lets a manager read any checklist", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, employeeId: null, items: { thenData: [] } }) as any);
    expect((await GET(getReq("?employeeId=8"))).status).toBe(200);
  });
});

describe("POST /api/onboarding", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 8, label: "Uniform" }))).status).toBe(403);
  });
  it("returns 400 for an empty label", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 8, label: " " }))).status).toBe(400);
  });
  it("returns 404 when the employee is not in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, empExists: false }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 99, label: "Uniform" }))).status).toBe(404);
  });
  it("adds an item and returns 201", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, items: { single: { id: 12 } } }) as any);
    const res = await POST(jsonReq("POST", { employeeId: 8, label: "Uniform issued" }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe(12);
  });
});

describe("PATCH /api/onboarding", () => {
  it("returns 400 when done is not a boolean", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await PATCH(jsonReq("PATCH", { id: 1, done: "yes" }))).status).toBe(400);
  });
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await PATCH(jsonReq("PATCH", { id: 1, done: true }))).status).toBe(403);
  });
  it("toggles an item and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, items: { single: { id: 1 } } }) as any);
    const res = await PATCH(jsonReq("PATCH", { id: 1, done: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("DELETE /api/onboarding", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    expect((await DELETE(jsonReq("DELETE", { id: 1 }))).status).toBe(403);
  });
  it("deletes and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, items: { single: { id: 1 } } }) as any);
    expect((await DELETE(jsonReq("DELETE", { id: 1 }))).status).toBe(200);
  });
});
