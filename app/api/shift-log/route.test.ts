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
    "eq", "neq", "gte", "lte", "order", "limit", "in",
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
  entries = { thenData: [], single: null } as { thenData?: any; single?: any },
  employeesThen = [] as any[],
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID, name: "Alex P" } : null;
  let empCall = 0;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") {
        empCall++;
        return empCall === 1 ? builder({ single: employeeRow }) : builder({ thenData: employeesThen });
      }
      if (table === "shift_log_entries") return builder(entries);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/shift-log${qs}`);
const postReq = (body: any) =>
  new Request("http://localhost/api/shift-log", { method: "POST", body: JSON.stringify(body) });
const delReq = (body: any) =>
  new Request("http://localhost/api/shift-log", { method: "DELETE", body: JSON.stringify(body) });

describe("GET /api/shift-log", () => {
  it("returns 400 when date is missing or malformed", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(getReq())).status).toBe(400);
    expect((await GET(getReq("?date=bad"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq("?date=2026-06-17"))).status).toBe(401);
  });

  it("returns the day's entries with author names", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        entries: { thenData: [{ id: 1, employee_id: 5, body: "Freezer warm", created_at: "t" }] },
        employeesThen: [{ id: 5, name: "Alex P" }],
      }) as any
    );
    const res = await GET(getReq("?date=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries[0].body).toBe("Freezer warm");
    expect(body.entries[0].authorName).toBe("Alex P");
  });
});

describe("POST /api/shift-log", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await POST(postReq({ date: "2026-06-17", body: "Hi" }))).status).toBe(401);
  });

  it("returns 403 when the caller has no employee record", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, employeeId: null }) as any);
    expect((await POST(postReq({ date: "2026-06-17", body: "Hi" }))).status).toBe(403);
  });

  it("returns 400 for an empty body", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    expect((await POST(postReq({ date: "2026-06-17", body: "  " }))).status).toBe(400);
  });

  it("returns 400 for a malformed date", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5 }) as any);
    expect((await POST(postReq({ date: "x", body: "Hi" }))).status).toBe(400);
  });

  it("posts an entry and returns 201", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ employeeId: 5, entries: { single: { id: 12 } } }) as any
    );
    const res = await POST(postReq({ date: "2026-06-17", body: "Freezer warm" }));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe(12);
  });
});

describe("DELETE /api/shift-log", () => {
  it("returns 404 when the entry is not in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ employeeId: 5, entries: { single: null } }) as any);
    expect((await DELETE(delReq({ id: 1 }))).status).toBe(404);
  });

  it("lets the author delete their own entry", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ employeeId: 5, entries: { single: { id: 1, employee_id: 5 } } }) as any
    );
    const res = await DELETE(delReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("forbids deleting someone else's entry when not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: false, employeeId: 5, entries: { single: { id: 1, employee_id: 9 } } }) as any
    );
    expect((await DELETE(delReq({ id: 1 }))).status).toBe(403);
  });

  it("lets a manager delete anyone's entry", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, employeeId: null, entries: { single: { id: 1, employee_id: 9 } } }) as any
    );
    expect((await DELETE(delReq({ id: 1 }))).status).toBe(200);
  });
});
