import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/require-manager", () => ({
  requireManager: vi.fn(),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { requireManager } from "@/lib/require-manager";

const mockCreateClient = vi.mocked(createClient);
const mockRequireManager = vi.mocked(requireManager);

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

function makeQueryBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "update", "eq", "order"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

/** Build a Supabase client whose `from("shift_swaps")` resolves with swapData. */
function makeClient({
  swapData = null as any,
  swapError = null as any,
  scheduleAData = { id: 1, employee_id: 10 } as any,
  scheduleBData = { id: 2, employee_id: 20 } as any,
  scheduleError = null as any,
  updateError = null as any,
} = {}) {
  let scheduleCallCount = 0;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "shift_swaps") {
        const b = makeQueryBuilder({ data: swapData, error: swapError });
        // .update().eq() for status update
        b.update = vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: updateError }),
        });
        return b;
      }
      if (table === "schedules") {
        const call = scheduleCallCount++;
        if (call === 0)
          return makeQueryBuilder({ data: scheduleAData, error: scheduleError });
        // For second schedule fetch AND revert attempts
        return makeQueryBuilder({ data: scheduleBData, error: scheduleError });
      }
      return makeQueryBuilder({ data: null, error: null });
    }),
  };
}

describe("PUT /api/swaps/:id", () => {
  beforeEach(() => {
    mockRequireManager.mockResolvedValue({ user: MOCK_USER as any, error: null });
  });

  // ── Validation ───────────────────────────────────────────────────────────────

  it("returns 400 for a non-integer swap id", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const [req, ctx] = putReq("abc", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Invalid") });
  });

  it("returns 400 when status is not approved or denied", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const [req, ctx] = putReq("1", { status: "pending" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockRequireManager.mockResolvedValue({ user: null, error: "Not authenticated" });
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockRequireManager.mockResolvedValue({ user: MOCK_USER as any, error: "Manager access required" });
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(403);
  });

  // ── Denied path ───────────────────────────────────────────────────────────────

  it("returns 200 when manager denies a swap", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ swapData: { id: 1, status: "pending", schedule_a_id: 1, schedule_b_id: 2 } }) as any
    );
    const [req, ctx] = putReq("1", { status: "denied" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // ── Approved path ─────────────────────────────────────────────────────────────

  it("returns 404 when swap is not found", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ swapData: null }) as any
    );
    const [req, ctx] = putReq("999", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("returns 409 when the swap is already resolved (double-approval blocked)", async () => {
    // Bug 2: swap.status is "approved" — should be rejected immediately
    mockCreateClient.mockResolvedValue(
      makeClient({
        swapData: { schedule_a_id: 1, schedule_b_id: 2, status: "approved" },
      }) as any
    );
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("already resolved") });
  });

  it("returns 409 when the swap was previously denied", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        swapData: { schedule_a_id: 1, schedule_b_id: 2, status: "denied" },
      }) as any
    );
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(409);
  });

  it("returns 200 and swaps schedules when manager approves a pending swap", async () => {
    // Provide a full client that chains correctly for the approved path
    let scheduleCallCount = 0;
    let swapsUpdateCalled = false;

    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "shift_swaps") {
          const b: any = {};
          b.select = vi.fn().mockReturnValue(b);
          b.eq = vi.fn().mockReturnValue(b);
          b.maybeSingle = vi.fn().mockResolvedValue({
            data: { schedule_a_id: 1, schedule_b_id: 2, status: "pending" },
            error: null,
          });
          b.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          });
          b.then = (resolve: any, reject: any) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject);
          return b;
        }
        if (table === "schedules") {
          const call = scheduleCallCount++;
          const data = call === 0
            ? { id: 1, employee_id: 10 }
            : { id: 2, employee_id: 20 };
          const b: any = {};
          for (const m of ["select", "eq"]) b[m] = vi.fn().mockReturnValue(b);
          b.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
          b.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          });
          b.then = (resolve: any, reject: any) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject);
          return b;
        }
        return makeQueryBuilder({ data: null, error: null });
      }),
    };

    mockCreateClient.mockResolvedValue(client as any);
    const [req, ctx] = putReq("1", { status: "approved" });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
