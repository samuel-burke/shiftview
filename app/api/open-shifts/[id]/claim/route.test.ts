import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined), notifyManagers: vi.fn().mockResolvedValue(undefined) }));
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
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in", "like", "range",
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
  employeeId = 5 as number | null,
  tables = {} as Record<string, { thenData?: any; single?: any }>,
} = {}) {
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID, name: "Alex P" } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: null });
      if (table === "employees") return builder({ single: employeeRow });
      const t = tables[table] ?? {};
      return builder({ thenData: t.thenData ?? [], single: t.single ?? null });
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const OPEN_SHIFT = { id: 3, date: "2026-07-05", start_minutes: 480, end_minutes: 960, status: "open" };

function req() {
  return new Request("http://localhost/api/open-shifts/3/claim", { method: "POST" });
}
const params = { params: Promise.resolve({ id: "3" }) };

describe("POST /api/open-shifts/[id]/claim", () => {
  it("returns 400 for an invalid id", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await POST(req(), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the shift does not exist", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ tables: { open_shifts: { single: null } } }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("returns 409 when the shift is no longer open", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ tables: { open_shifts: { single: { ...OPEN_SHIFT, status: "filled" } } } }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
  });

  it("returns 409 when the employee is not eligible (called out)", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        tables: {
          open_shifts: { single: OPEN_SHIFT },
          callouts: { thenData: [{ date: "2026-07-05" }] },
        },
      }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/called out/i);
  });

  it("creates a pending claim and returns 201", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        tables: {
          open_shifts: { single: OPEN_SHIFT },
          schedules: { thenData: [] },
          time_off_requests: { thenData: [] },
          callouts: { thenData: [] },
          open_shift_claims: { single: { id: 11 } },
        },
      }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(11);
  });
});
