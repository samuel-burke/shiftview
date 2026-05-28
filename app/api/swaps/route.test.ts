import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

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

// A query builder that also supports .or() for the GET route
function makeSwapsQueryBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "gte", "lte", "order", "or"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

function makeSwapsClient({
  user = null as any,
  isManager = false,
  linkedEmployee = undefined as Record<string, unknown> | null | undefined,
  swapsData = null as any,
  swapsError = null as any,
  schedulesData = null as any,
  schedulesError = null as any,
  insertData = null as any,
  insertError = null as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id } : null;

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers")
        return makeSwapsQueryBuilder({ data: managerRow, error: null });
      if (table === "employees" && linkedEmployee !== undefined)
        return makeSwapsQueryBuilder({ data: linkedEmployee, error: null });
      if (table === "shift_swaps") {
        const b = makeSwapsQueryBuilder({ data: swapsData, error: swapsError });
        // Override insert to support .select().maybeSingle() chain
        b.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: insertData, error: insertError }),
          }),
        });
        return b;
      }
      if (table === "schedules")
        return makeSwapsQueryBuilder({ data: schedulesData, error: schedulesError });
      return makeSwapsQueryBuilder({ data: null, error: null });
    }),
  };
}

// ── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/swaps", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const client = makeSwapsClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Not authenticated" });
  });

  it("returns pending swaps for a manager (all pending)", async () => {
    const swaps = [
      { id: 1, status: "pending", requester_id: 10, target_id: 20, schedule_a_id: 1, schedule_b_id: 2 },
    ];
    const client = makeSwapsClient({
      user: MOCK_USER,
      isManager: true,
      swapsData: swaps,
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(swaps);
  });

  it("returns empty array when manager sees no pending swaps", async () => {
    const client = makeSwapsClient({
      user: MOCK_USER,
      isManager: true,
      swapsData: [],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns empty array for authenticated employee with no employee record", async () => {
    const client = makeSwapsClient({
      user: MOCK_USER,
      isManager: false,
      linkedEmployee: null,
      swapsData: [],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns pending swaps for authenticated employee (filtered by .or)", async () => {
    const swaps = [{ id: 2, status: "pending", requester_id: 5, target_id: 10 }];
    const client = makeSwapsClient({
      user: MOCK_USER,
      isManager: false,
      linkedEmployee: { id: 5 },
      swapsData: swaps,
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(swaps);
  });

  it("returns 500 on database error", async () => {
    const client = makeSwapsClient({
      user: MOCK_USER,
      isManager: true,
      swapsError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ── POST ─────────────────────────────────────────────────────────────────────

describe("POST /api/swaps", () => {
  function postReq(body: unknown) {
    return new Request("http://localhost/api/swaps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 when scheduleAId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeSwapsClient({ user: MOCK_USER }) as any);
    const res = await POST(postReq({ scheduleBId: 2 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns 400 when scheduleBId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeSwapsClient({ user: MOCK_USER }) as any);
    const res = await POST(postReq({ scheduleAId: 1 }));
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const client = makeSwapsClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ scheduleAId: 1, scheduleBId: 2 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user has no employee record", async () => {
    const client = makeSwapsClient({
      user: MOCK_USER,
      linkedEmployee: null,
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ scheduleAId: 1, scheduleBId: 2 }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when one or both schedules are not found", async () => {
    const client = makeSwapsClient({
      user: MOCK_USER,
      linkedEmployee: { id: 5 },
      schedulesData: null,
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ scheduleAId: 1, scheduleBId: 2 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("returns 400 when both schedules belong to the same employee (swap with yourself)", async () => {
    // Need to return the same employee for both schedule lookups
    let callCount = 0;
    const scheduleData = { id: 1, employee_id: 5 };
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers")
          return makeSwapsQueryBuilder({ data: null, error: null });
        if (table === "employees")
          return makeSwapsQueryBuilder({ data: { id: 5 }, error: null });
        if (table === "schedules") {
          // Both schedule fetches return employee_id: 5
          return makeSwapsQueryBuilder({ data: { id: ++callCount, employee_id: 5 }, error: null });
        }
        return makeSwapsQueryBuilder({ data: null, error: null });
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ scheduleAId: 1, scheduleBId: 2 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("yourself") });
  });

  it("returns 200 and creates a swap request successfully", async () => {
    // Two separate schedule lookups: scheduleA has employee 5, scheduleB has employee 10
    let scheduleCallCount = 0;
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers")
          return makeSwapsQueryBuilder({ data: null, error: null });
        if (table === "employees")
          return makeSwapsQueryBuilder({ data: { id: 5 }, error: null });
        if (table === "schedules") {
          const empId = scheduleCallCount++ === 0 ? 5 : 10;
          return makeSwapsQueryBuilder({ data: { id: scheduleCallCount, employee_id: empId }, error: null });
        }
        if (table === "shift_swaps") {
          const b = makeSwapsQueryBuilder({ data: null, error: null });
          b.insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 42 }, error: null }),
            }),
          });
          return b;
        }
        return makeSwapsQueryBuilder({ data: null, error: null });
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ scheduleAId: 1, scheduleBId: 2 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, id: 42 });
  });

  it("returns 500 on database insert error", async () => {
    let scheduleCallCount = 0;
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers")
          return makeSwapsQueryBuilder({ data: null, error: null });
        if (table === "employees")
          return makeSwapsQueryBuilder({ data: { id: 5 }, error: null });
        if (table === "schedules") {
          const empId = scheduleCallCount++ === 0 ? 5 : 10;
          return makeSwapsQueryBuilder({ data: { id: scheduleCallCount, employee_id: empId }, error: null });
        }
        if (table === "shift_swaps") {
          const b = makeSwapsQueryBuilder({ data: null, error: null });
          b.insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "duplicate key" } }),
            }),
          });
          return b;
        }
        return makeSwapsQueryBuilder({ data: null, error: null });
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(postReq({ scheduleAId: 1, scheduleBId: 2 }));
    expect(res.status).toBe(500);
  });
});
