import { describe, it, expect, vi } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

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

function builder({ thenData = null as any, single = null as any }, spy?: Record<string, number>) {
  const b: any = {};
  for (const m of [
    "select", "insert", "delete", "upsert",
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in", "like", "range",
  ]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.update = vi.fn().mockImplementation(() => {
    if (spy) spy.update = (spy.update ?? 0) + 1;
    return b;
  });
  b.insert = vi.fn().mockImplementation(() => {
    if (spy) spy.insert = (spy.insert ?? 0) + 1;
    return b;
  });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: thenData, error: null }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  isManager = true,
  tables = {} as Record<string, { thenData?: any; single?: any }>,
  spies = {} as Record<string, Record<string, number>>,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: tables.employees?.single ?? null });
      const t = tables[table] ?? {};
      spies[table] = spies[table] ?? {};
      return builder({ thenData: t.thenData ?? [], single: t.single ?? null }, spies[table]);
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const OPEN_SHIFT = { id: 3, date: "2026-07-05", start_minutes: 480, end_minutes: 960, status: "open" };
const params = { params: Promise.resolve({ id: "3" }) };

function req(body: any) {
  return new Request("http://localhost/api/open-shifts/3", { method: "PUT", body: JSON.stringify(body) });
}

describe("PUT /api/open-shifts/[id]", () => {
  it("returns 400 for an unknown action", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await PUT(req({ action: "frobnicate" }), params);
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    const res = await PUT(req({ action: "cancel" }), params);
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const res = await PUT(req({ action: "cancel" }), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the open shift is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ tables: { open_shifts: { single: null } } }) as any);
    const res = await PUT(req({ action: "cancel" }), params);
    expect(res.status).toBe(404);
  });

  it("returns 409 when the shift is already resolved", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ tables: { open_shifts: { single: { ...OPEN_SHIFT, status: "filled" } } } }) as any
    );
    const res = await PUT(req({ action: "cancel" }), params);
    expect(res.status).toBe(409);
  });

  it("cancels an open shift", async () => {
    const spies: Record<string, Record<string, number>> = {};
    mockCreateClient.mockResolvedValue(
      makeClient({ tables: { open_shifts: { single: OPEN_SHIFT } }, spies }) as any
    );
    const res = await PUT(req({ action: "cancel" }), params);
    expect(res.status).toBe(200);
    expect(spies.open_shifts.update).toBeGreaterThanOrEqual(1);
  });

  it("requires a claimId to approve", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ tables: { open_shifts: { single: OPEN_SHIFT } } }) as any
    );
    const res = await PUT(req({ action: "approve" }), params);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the claim is not found", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        tables: { open_shifts: { single: OPEN_SHIFT }, open_shift_claims: { single: null } },
      }) as any
    );
    const res = await PUT(req({ action: "approve", claimId: 9 }), params);
    expect(res.status).toBe(404);
  });

  it("approves a claim: creates a schedule row and marks the shift filled", async () => {
    const spies: Record<string, Record<string, number>> = {};
    mockCreateClient.mockResolvedValue(
      makeClient({
        tables: {
          open_shifts: { single: OPEN_SHIFT },
          open_shift_claims: { single: { id: 9, open_shift_id: 3, employee_id: 5, status: "pending" } },
          employees: { single: { user_id: "u-5", name: "Alex P" } },
        },
        spies,
      }) as any
    );
    const res = await PUT(req({ action: "approve", claimId: 9 }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // A schedules row was inserted and the open shift was updated to filled.
    expect(spies.schedules.insert).toBeGreaterThanOrEqual(1);
    expect(spies.open_shifts.update).toBeGreaterThanOrEqual(1);
    // Winning claim approved + others denied → at least two claim updates.
    expect(spies.open_shift_claims.update).toBeGreaterThanOrEqual(2);
  });
});
