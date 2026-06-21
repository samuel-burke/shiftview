import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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

// A builder whose `.maybeSingle()/.single()` resolve to `single` and whose
// awaited (thenable) result is `{ data: thenData }`, so one mock can serve both
// the single-row lookups (getOrgContext) and the list queries (resolveNames).
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
  isManager = false,
  employeeId = null as number | null,
  tables = {} as Record<string, { thenData?: any; single?: any }>,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees")
        return builder({ single: employeeRow, thenData: tables.employees?.thenData ?? [] });
      const t = tables[table] ?? {};
      return builder({ thenData: t.thenData ?? [], single: t.single ?? null });
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe("GET /api/open-shifts", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns all active open shifts for a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        isManager: true,
        tables: {
          open_shifts: {
            thenData: [
              { id: 1, date: "2026-07-01", start_minutes: 480, end_minutes: 960, note: null, status: "open", filled_by: null },
            ],
          },
          open_shift_claims: { thenData: [] },
        },
      }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openShifts).toHaveLength(1);
    expect(body.openShifts[0].id).toBe(1);
  });

  it("returns an empty list for an employee when nothing is open", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: false, employeeId: 5, tables: { open_shifts: { thenData: [] } } }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body.openShifts).toEqual([]);
  });

  it("filters out shifts the employee is not eligible for", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        isManager: false,
        employeeId: 5,
        tables: {
          open_shifts: {
            thenData: [
              { id: 1, date: "2026-07-01", start_minutes: 480, end_minutes: 960, note: null, status: "open", filled_by: null },
              { id: 2, date: "2026-07-02", start_minutes: 480, end_minutes: 960, note: null, status: "open", filled_by: null },
            ],
          },
          // Existing shift overlapping open shift #2 → ineligible for #2.
          schedules: { thenData: [{ date: "2026-07-02", start_minutes: 600, end_minutes: 1020 }] },
          time_off_requests: { thenData: [] },
          callouts: { thenData: [] },
          open_shift_claims: { thenData: [] },
        },
      }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body.openShifts.map((s: any) => s.id)).toEqual([1]);
  });

  it("always surfaces a shift the employee has already claimed", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        isManager: false,
        employeeId: 5,
        tables: {
          open_shifts: {
            thenData: [
              { id: 2, date: "2026-07-02", start_minutes: 480, end_minutes: 960, note: null, status: "open", filled_by: null },
            ],
          },
          // Overlapping schedule would normally make #2 ineligible…
          schedules: { thenData: [{ date: "2026-07-02", start_minutes: 600, end_minutes: 1020 }] },
          time_off_requests: { thenData: [] },
          callouts: { thenData: [] },
          // …but the employee already has a claim on it.
          open_shift_claims: { thenData: [{ id: 9, open_shift_id: 2, employee_id: 5, status: "pending" }] },
        },
      }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body.openShifts).toHaveLength(1);
    expect(body.openShifts[0].myClaimStatus).toBe("pending");
  });
});

describe("POST /api/open-shifts", () => {
  const valid = { date: "2026-07-01", startMinutes: 480, endMinutes: 960 };

  function req(body: any) {
    return new Request("http://localhost/api/open-shifts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("returns 400 for an invalid shift", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    const res = await POST(req({ date: "2026-07-01", startMinutes: 480, endMinutes: 500 }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const res = await POST(req(valid));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false, employeeId: 5 }) as any);
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
  });

  it("creates an open shift and returns 201 with id", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, tables: { open_shifts: { single: { id: 7 } } } }) as any
    );
    const res = await POST(req(valid));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(7);
  });
});
