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
  tables = {} as Record<string, { thenData?: any; single?: any }>,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID, name: "Alex P" } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees" && tables.employees) return builder(tables.employees);
      if (table === "employees") return builder({ single: employeeRow });
      const t = tables[table] ?? {};
      return builder({ thenData: t.thenData ?? [], single: t.single ?? null });
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const postReq = (body: any) =>
  new Request("http://localhost/api/schedule-acks", { method: "POST", body: JSON.stringify(body) });
const getReq = (weekStart?: string) =>
  new Request(weekStart ? `http://localhost/api/schedule-acks?weekStart=${weekStart}` : "http://localhost/api/schedule-acks");

describe("POST /api/schedule-acks", () => {
  it("returns 400 for a malformed weekStart", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await POST(postReq({ weekStart: "nope" }))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await POST(postReq({ weekStart: "2026-07-06" }))).status).toBe(401);
  });

  it("returns 403 when the caller has no employee record", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, employeeId: null }) as any);
    expect((await POST(postReq({ weekStart: "2026-07-06" }))).status).toBe(403);
  });

  it("acknowledges the week and returns 201", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ employeeId: 5, tables: { schedule_acknowledgements: { single: { id: 1 } } } }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-07-06" }));
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("GET /api/schedule-acks", () => {
  it("returns 400 when weekStart is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(getReq())).status).toBe(400);
  });

  it("returns the caller's own ack state for an employee", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        employeeId: 5,
        tables: { schedule_acknowledgements: { thenData: [{ employee_id: 5, acknowledged_at: "t" }] } },
      }) as any
    );
    const res = await GET(getReq("2026-07-06"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acknowledged).toBe(true);
  });

  it("returns the confirmed/pending split for a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        isManager: true,
        employeeId: null,
        tables: {
          schedules: { thenData: [{ employee_id: 1 }, { employee_id: 2 }] },
          employees: { thenData: [{ id: 1, name: "Alex P" }, { id: 2, name: "Jordan K" }] },
          schedule_acknowledgements: { thenData: [{ employee_id: 1, acknowledged_at: "t" }] },
        },
      }) as any
    );
    const res = await GET(getReq("2026-07-06"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmedCount).toBe(1);
    expect(body.pendingCount).toBe(1);
    expect(body.confirmed[0].employeeId).toBe(1);
    expect(body.pending[0].employeeId).toBe(2);
  });
});
