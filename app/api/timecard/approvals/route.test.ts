import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { writeAuditLog } from "@/lib/audit";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

const mockCreateClient = vi.mocked(createClient);
const mockWriteAuditLog = vi.mocked(writeAuditLog);

// A chainable builder whose awaited result is `rows` (arrays), with separate
// terminal results for maybeSingle/single.
function builder({
  rows = [] as any[],
  maybeSingle = null as any,
  single = null as any,
}) {
  const b: any = {};
  for (const m of ["select", "insert", "delete", "eq", "gte", "lte", "order", "limit"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: maybeSingle, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  return b;
}

const INSERTED = {
  id: 1, employee_id: 5, period_start: "2026-06-01", period_end: "2026-06-14",
  note: null, approved_by: MOCK_USER.id, approved_at: "2026-06-15T00:00:00.000Z",
};

function makeClient({
  user = MOCK_USER as any,
  isManager = true,
  emp = { id: 5, name: "Alice", org_id: MOCK_ORG_ID } as Record<string, unknown> | null,
  approvalRows = [] as any[],          // awaited result for overlap (POST) / list (GET)
  existingRow = null as any,           // maybeSingle for DELETE row load
  inserted = INSERTED as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: true } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ rows: managerRow ? [managerRow] : [], maybeSingle: managerRow });
      if (table === "employees") return builder({ rows: emp ? [emp] : [], maybeSingle: emp });
      if (table === "timecard_approvals")
        return builder({ rows: approvalRows, maybeSingle: existingRow, single: inserted });
      return builder({});
    }),
  };
}

function postReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/timecard/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function deleteReq(query = "") {
  return new Request(`http://localhost/api/timecard/approvals${query}`, { method: "DELETE" });
}
function getReq(query = "") {
  return new Request(`http://localhost/api/timecard/approvals${query}`, { method: "GET" });
}

const validBody = { employeeId: 5, periodStart: "2026-06-01", periodEnd: "2026-06-14" };

beforeEach(() => mockWriteAuditLog.mockClear());

// ── POST — validation ─────────────────────────────────────────────────────────

describe("POST /api/timecard/approvals — validation", () => {
  it("400 when employeeId is not an integer", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await POST(postReq({ ...validBody, employeeId: "x" }));
    expect(res.status).toBe(400);
  });

  it("400 for a malformed date", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await POST(postReq({ ...validBody, periodEnd: "2026-6-1" }));
    expect(res.status).toBe(400);
  });

  it("400 when periodStart is after periodEnd", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await POST(postReq({ ...validBody, periodStart: "2026-06-20" }));
    expect(res.status).toBe(400);
  });

  it("400 when the period exceeds 366 days", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await POST(postReq({ employeeId: 5, periodStart: "2026-01-01", periodEnd: "2027-06-01" }));
    expect(res.status).toBe(400);
  });
});

// ── POST — auth ───────────────────────────────────────────────────────────────

describe("POST /api/timecard/approvals — auth", () => {
  it("401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(401);
  });

  it("403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(403);
  });
});

// ── POST — business rules ─────────────────────────────────────────────────────

describe("POST /api/timecard/approvals — business rules", () => {
  it("404 when the employee is not in the caller's org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ emp: null }) as any);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(404);
  });

  it("409 when the period overlaps an existing approval", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ approvalRows: [{ id: 9, period_start: "2026-06-10", period_end: "2026-06-24" }] }) as any
    );
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/overlap/i);
  });

  it("201 and writes an audit log on success", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ approvalRows: [] }) as any);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ id: 1, employeeId: 5, periodStart: "2026-06-01", periodEnd: "2026-06-14" });
    expect(mockWriteAuditLog).toHaveBeenCalledOnce();
    expect(mockWriteAuditLog.mock.calls[0][0]).toMatchObject({ action: "timecard.approved" });
  });
});

// ── DELETE — reopen ───────────────────────────────────────────────────────────

describe("DELETE /api/timecard/approvals", () => {
  it("400 when id is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(400);
  });

  it("403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    const res = await DELETE(deleteReq("?id=1"));
    expect(res.status).toBe(403);
  });

  it("404 when the approval does not exist in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ existingRow: null }) as any);
    const res = await DELETE(deleteReq("?id=1"));
    expect(res.status).toBe(404);
  });

  it("200 and audits the reopen on success", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ existingRow: { id: 1, employee_id: 5, period_start: "2026-06-01", period_end: "2026-06-14" } }) as any
    );
    const res = await DELETE(deleteReq("?id=1"));
    expect(res.status).toBe(200);
    expect(mockWriteAuditLog).toHaveBeenCalledOnce();
    expect(mockWriteAuditLog.mock.calls[0][0]).toMatchObject({ action: "timecard.reopened" });
  });
});

// ── GET — list ────────────────────────────────────────────────────────────────

describe("GET /api/timecard/approvals", () => {
  it("400 when employeeId is invalid", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await GET(getReq("?employeeId=abc"));
    expect(res.status).toBe(400);
  });

  it("401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const res = await GET(getReq("?employeeId=5"));
    expect(res.status).toBe(401);
  });

  it("403 when a non-manager queries another employee", async () => {
    // ctx.employeeId resolves to 5 (the linked employee); querying 6 is forbidden.
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    const res = await GET(getReq("?employeeId=6"));
    expect(res.status).toBe(403);
  });

  it("200 and returns mapped rows for a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        approvalRows: [
          { id: 1, employee_id: 5, period_start: "2026-06-01", period_end: "2026-06-14", note: "ok", approved_by: MOCK_USER.id, approved_at: "2026-06-15T00:00:00.000Z" },
        ],
      }) as any
    );
    const res = await GET(getReq("?employeeId=5"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ id: 1, periodStart: "2026-06-01", periodEnd: "2026-06-14", note: "ok" });
  });

  it("200 when a non-manager queries their own record", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    const res = await GET(getReq("?employeeId=5"));
    expect(res.status).toBe(200);
  });
});
