import { describe, it, expect, vi } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
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

const mockCreateClient = vi.mocked(createClient);

function putReq(id: string, body: unknown) {
  return [
    new Request(`http://localhost/api/swaps/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

/**
 * Build a Supabase mock that satisfies both getOrgContext() (managers +
 * employees lookups by user_id) and the swaps route's own queries.
 *
 * - `isManager`       → whether a managers row exists for the caller.
 * - `callerEmployeeId`→ the caller's employee id in this org (null = none).
 * - `swapData`        → the shift_swaps row the route fetches.
 * Tracks how many .update() calls each table receives via `client.__updates`.
 */
function makeClient({
  user = MOCK_USER as any,
  isManager = false,
  callerEmployeeId = null as number | null,
  swapData = null as any,
  swapError = null as any,
  scheduleAData = { id: 1, employee_id: 10 } as any,
  scheduleBData = { id: 2, employee_id: 20 } as any,
  approveResult = "approved" as string,
} = {}) {
  const updates: Record<string, number> = { schedules: 0, shift_swaps: 0 };
  const rpcCalls: Array<{ fn: string; args: any }> = [];
  let scheduleFetch = 0;

  const managerRow = isManager && user
    ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false }
    : null;
  const employeeRow = callerEmployeeId != null
    ? { id: callerEmployeeId, org_id: MOCK_ORG_ID, user_id: user?.id, name: "Caller" }
    : null;

  function updateChain() {
    const u: any = {};
    u.eq = vi.fn().mockReturnValue(u);
    u.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej);
    return u;
  }

  function makeBuilder(getResult: () => { data: any; error: any }, table: string) {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = vi.fn().mockReturnValue(b);
    b.update = vi.fn().mockImplementation(() => {
      updates[table] = (updates[table] ?? 0) + 1;
      return updateChain();
    });
    b.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(getResult()));
    b.then = (res: any, rej: any) => Promise.resolve(getResult()).then(res, rej);
    return b;
  }

  return {
    __updates: updates,
    __rpcCalls: rpcCalls,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    rpc: vi.fn().mockImplementation((fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (fn === "approve_shift_swap") return Promise.resolve({ data: approveResult, error: null });
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return makeBuilder(() => ({ data: managerRow, error: null }), "managers");
      if (table === "employees") return makeBuilder(() => ({ data: employeeRow, error: null }), "employees");
      if (table === "shift_swaps") return makeBuilder(() => ({ data: swapData, error: swapError }), "shift_swaps");
      if (table === "schedules") {
        return makeBuilder(() => {
          const n = scheduleFetch++;
          return { data: n === 0 ? scheduleAData : scheduleBData, error: null };
        }, "schedules");
      }
      return makeBuilder(() => ({ data: null, error: null }), "other");
    }),
  };
}

const ACCEPTED_SWAP = { id: 1, status: "accepted", schedule_a_id: 1, schedule_b_id: 2, requester_id: 10, target_id: 20 };
const PENDING_SWAP  = { id: 1, status: "pending",  schedule_a_id: 1, schedule_b_id: 2, requester_id: 10, target_id: 20 };

describe("PUT /api/swaps/:id — validation & auth", () => {
  it("returns 400 for a non-integer swap id", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    const [req, ctx] = putReq("abc", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Invalid") });
  });

  it("returns 400 for an unrecognized status", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    const [req, ctx] = putReq("1", { status: "pending" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the swap does not exist", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, swapData: null }) as any);
    const [req, ctx] = putReq("999", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(404);
  });
});

// ── Target acceptance / decline ───────────────────────────────────────────────
describe("PUT /api/swaps/:id — target consent", () => {
  it("lets the target accept a pending swap", async () => {
    const client = makeClient({ callerEmployeeId: 20, swapData: PENDING_SWAP });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "accepted" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Only the swap status row is updated; no schedules move yet.
    expect(client.__updates.shift_swaps).toBe(1);
    expect(client.__updates.schedules).toBe(0);
  });

  it("lets the target decline a pending swap", async () => {
    const client = makeClient({ callerEmployeeId: 20, swapData: PENDING_SWAP });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "declined" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(client.__updates.schedules).toBe(0);
  });

  it("rejects a non-target employee trying to respond", async () => {
    const client = makeClient({ callerEmployeeId: 99, swapData: PENDING_SWAP });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "accepted" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(403);
    expect(client.__updates.shift_swaps).toBe(0);
  });

  it("rejects a target response once the swap is no longer pending", async () => {
    const client = makeClient({ callerEmployeeId: 20, swapData: ACCEPTED_SWAP });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "accepted" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
  });
});

// ── Manager approval / denial ──────────────────────────────────────────────────
describe("PUT /api/swaps/:id — manager decision", () => {
  it("blocks approval while the swap is still pending the target's acceptance", async () => {
    const client = makeClient({ isManager: true, swapData: PENDING_SWAP });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("acceptance") });
    // The schedules must NOT have been swapped.
    expect(client.__updates.schedules).toBe(0);
    expect(client.__updates.shift_swaps).toBe(0);
  });

  it("approves an accepted swap via the atomic RPC", async () => {
    const client = makeClient({ isManager: true, swapData: ACCEPTED_SWAP, approveResult: "approved" });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The exchange is delegated to the DB function, not done as separate JS
    // updates, so no schedule/swap updates happen client-side.
    expect(client.__updates.schedules).toBe(0);
    expect(client.__rpcCalls.some((c) => c.fn === "approve_shift_swap" && c.args.p_swap_id === 1)).toBe(true);
  });

  it("surfaces a race where the RPC reports the swap is no longer approvable", async () => {
    // Pre-check passed (status accepted) but the locked apply found it resolved.
    const client = makeClient({ isManager: true, swapData: ACCEPTED_SWAP, approveResult: "approved" });
    // Override just the RPC to report a lost race.
    client.rpc = vi.fn().mockResolvedValue({ data: "denied", error: null });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
  });

  it("denies an accepted swap without touching schedules", async () => {
    const client = makeClient({ isManager: true, swapData: ACCEPTED_SWAP });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "denied" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(client.__updates.schedules).toBe(0);
    expect(client.__updates.shift_swaps).toBe(1);
  });

  it("returns 409 when an accepted swap was already resolved", async () => {
    const client = makeClient({ isManager: true, swapData: { ...ACCEPTED_SWAP, status: "approved" } });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("already resolved") });
  });

  it("rejects a non-manager attempting a manager decision", async () => {
    // A member (employee) who is not the target tries to approve.
    const client = makeClient({ callerEmployeeId: 99, swapData: ACCEPTED_SWAP });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(403);
    expect(client.__updates.schedules).toBe(0);
  });
});

// ── Org scoping ────────────────────────────────────────────────────────────────
describe("org scoping — swaps/[id] route", () => {
  it("fetches shift_swaps with an org_id filter", async () => {
    const swapsEqArgs: [string, unknown][] = [];
    const client = makeClient({ isManager: true, swapData: ACCEPTED_SWAP });
    const origFrom = (client as any).from.bind(client);
    (client as any).from = vi.fn().mockImplementation((table: string) => {
      const b = origFrom(table);
      if (table === "shift_swaps") {
        const origEq = b.eq.bind(b);
        b.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
          swapsEqArgs.push([col, val]);
          return origEq(col, val);
        });
      }
      return b;
    });
    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "denied" });
    await PUT(req, ctx);
    expect(swapsEqArgs.some(([col]) => col === "org_id")).toBe(true);
  });
});
