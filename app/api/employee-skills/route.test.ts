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
  isManager = false,
  skills = { thenData: [], single: null } as { thenData?: any; single?: any },
  employees = [] as any[],
  empExists = true,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  let empCall = 0;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") {
        empCall++;
        if (empCall === 1) return builder({ single: { id: 5, org_id: MOCK_ORG_ID } });
        return builder({ thenData: employees, single: empExists ? { id: 8, name: "Sam" } : null });
      }
      if (table === "employee_skills") return builder(skills);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/employee-skills${qs}`);
const jsonReq = (method: string, body: any) =>
  new Request("http://localhost/api/employee-skills", { method, body: JSON.stringify(body) });

describe("GET /api/employee-skills", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq("?employeeId=8"))).status).toBe(401);
  });

  it("returns 400 when neither employeeId nor skill is given", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(getReq())).status).toBe(400);
  });

  it("lists an employee's skills (?employeeId=)", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ skills: { thenData: [{ id: 1, employee_id: 8, name: "Keyholder" }] } }) as any
    );
    const res = await GET(getReq("?employeeId=8"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toEqual([{ id: 1, name: "Keyholder" }]);
  });

  it("finds who has a skill (?skill=)", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        skills: { thenData: [{ employee_id: 8, name: "Barista" }, { employee_id: 9, name: "Barista" }] },
        employees: [{ id: 8, name: "Sam" }, { id: 9, name: "Lee" }],
      }) as any
    );
    const res = await GET(getReq("?skill=Barista"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skill).toBe("Barista");
    expect(body.employees.map((e: any) => e.name).sort()).toEqual(["Lee", "Sam"]);
  });
});

describe("POST /api/employee-skills", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 8, name: "Keyholder" }))).status).toBe(403);
  });
  it("returns 400 for an empty name", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 8, name: "" }))).status).toBe(400);
  });
  it("returns 404 when the employee is not in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, empExists: false }) as any);
    expect((await POST(jsonReq("POST", { employeeId: 99, name: "Keyholder" }))).status).toBe(404);
  });
  it("adds a skill and returns 201", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, skills: { single: { id: 3 } } }) as any);
    const res = await POST(jsonReq("POST", { employeeId: 8, name: "Keyholder" }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe(3);
  });
  it("returns 409 on a duplicate skill", async () => {
    const client = makeClient({ isManager: true }) as any;
    const orig = client.from;
    client.from = vi.fn().mockImplementation((t: string) => {
      const b = orig(t);
      if (t === "employee_skills") b.single = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });
      return b;
    });
    mockCreateClient.mockResolvedValue(client);
    expect((await POST(jsonReq("POST", { employeeId: 8, name: "Keyholder" }))).status).toBe(409);
  });
});

describe("DELETE /api/employee-skills", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await DELETE(jsonReq("DELETE", { id: 1 }))).status).toBe(403);
  });
  it("deletes and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, skills: { single: { id: 1 } } }) as any);
    expect((await DELETE(jsonReq("DELETE", { id: 1 }))).status).toBe(200);
  });
});
