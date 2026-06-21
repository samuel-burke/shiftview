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
  for (const m of ["select", "insert", "delete", "eq", "in", "order", "limit"]) {
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
  notes = { thenData: [], single: null } as { thenData?: any; single?: any },
  empExists = true,
  authors = [] as any[],
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  let empCall = 0;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") {
        empCall++;
        // First call: getOrgContext employee lookup (none → org from manager).
        // Later: target employee existence / author names.
        if (empCall === 1) return builder({ single: null });
        return builder({ single: empExists ? { id: 8, name: "Sam" } : null, thenData: authors });
      }
      if (table === "employee_notes") return builder(notes);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/employee-notes${qs}`);
const jsonReq = (method: string, body: any) =>
  new Request("http://localhost/api/employee-notes", { method, body: JSON.stringify(body) });

describe("GET /api/employee-notes", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq("?employeeId=8"))).status).toBe(401);
  });

  it("returns 403 for a non-manager (these are private)", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await GET(getReq("?employeeId=8"))).status).toBe(403);
  });

  it("returns 400 when employeeId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await GET(getReq())).status).toBe(400);
  });

  it("returns notes for an employee with author names", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        isManager: true,
        notes: { thenData: [{ id: 1, employee_id: 8, author_id: "mgr-1", body: "Coached", created_at: "t" }] },
        authors: [{ user_id: "mgr-1", name: "Boss" }],
      }) as any
    );
    const res = await GET(getReq("?employeeId=8"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes[0].body).toBe("Coached");
  });
});

describe("POST /api/employee-notes", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 8, body: "Note" }))).status).toBe(403);
  });
  it("returns 400 for an empty body", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 8, body: " " }))).status).toBe(400);
  });
  it("returns 404 when the employee is not in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, empExists: false }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 99, body: "Note" }))).status).toBe(404);
  });
  it("adds a note and returns 201", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, notes: { single: { id: 5 } } }) as any);
    const res = await POST(jsonReq("POST", { employeeId: 8, body: "Coached on lateness" }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe(5);
  });
});

describe("DELETE /api/employee-notes", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await DELETE(jsonReq("DELETE", { id: 1 }))).status).toBe(403);
  });
  it("deletes and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, notes: { single: { id: 1 } } }) as any);
    expect((await DELETE(jsonReq("DELETE", { id: 1 }))).status).toBe(200);
  });
});
