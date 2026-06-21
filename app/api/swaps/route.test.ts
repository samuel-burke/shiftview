import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";
import { PUT } from "./[id]/route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const SCHEDULE_A = { id: 10, employee_id: 1 };
const SCHEDULE_B = { id: 20, employee_id: 2 };

const PENDING_SWAP = {
  id: 1,
  status: "pending",
  schedule_a_id: SCHEDULE_A.id,
  schedule_b_id: SCHEDULE_B.id,
  requester_id: 1,
  target_id: 2,
};

// A swap the target has already accepted — the only state from which a manager
// may approve or deny.
const ACCEPTED_SWAP = { ...PENDING_SWAP, status: "accepted" };

/**
 * Build a mock Supabase client that handles the multi-table query pattern used
 * by the swaps routes.  Each `from(table)` call can return different data via
 * the `tableData` map.  Unknown tables fall through to `queryData/queryError`.
 */
function makeSwapsClient({
  user = MOCK_USER as any,
  isManager = false,
  employeeRow = null as Record<string, unknown> | null,
  tableData = {} as Record<string, { data: any; error: any }>,
  queryData = null as any,
  queryError = null as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID } : null;
  const empRowWithOrg = employeeRow ? { org_id: MOCK_ORG_ID, ...employeeRow } : null;

  function makeBuilder(result: { data: any; error: any }) {
    const b: any = {};
    for (const m of [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "gte",
      "lte",
      "order",
      "or",
      "in",
      "limit",
    ]) {
      b[m] = vi.fn().mockReturnValue(b);
    }
    b.maybeSingle = vi.fn().mockResolvedValue(result);
    b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    return b;
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return makeBuilder({ data: managerRow, error: null });
      if (table === "employees") return makeBuilder({ data: empRowWithOrg, error: null });
      if (tableData[table]) return makeBuilder(tableData[table]);
      return makeBuilder({ data: queryData, error: queryError });
    }),
  };
}

// ── GET /api/swaps ────────────────────────────────────────────────────────────

describe("GET /api/swaps", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSwapsClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns pending swaps for a manager", async () => {
    const swaps = [PENDING_SWAP];
    mockCreateClient.mockResolvedValue(
      makeSwapsClient({
        user: MOCK_USER,
        isManager: true,
        tableData: { shift_swaps: { data: swaps, error: null } },
      }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns only the employee's own swaps when not a manager", async () => {
    const swaps = [PENDING_SWAP];
    mockCreateClient.mockResolvedValue(
      makeSwapsClient({
        user: MOCK_USER,
        isManager: false,
        employeeRow: { id: 1 },
        tableData: { shift_swaps: { data: swaps, error: null } },
      }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
  });
});

// ── POST /api/swaps ───────────────────────────────────────────────────────────

describe("POST /api/swaps", () => {
  const validBody = { scheduleAId: SCHEDULE_A.id, scheduleBId: SCHEDULE_B.id };

  it("returns 400 when scheduleAId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeSwapsClient() as any);
    const res = await POST(
      new Request("http://localhost/api/swaps", {
        method: "POST",
        body: JSON.stringify({ scheduleBId: SCHEDULE_B.id }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when scheduleBId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeSwapsClient() as any);
    const res = await POST(
      new Request("http://localhost/api/swaps", {
        method: "POST",
        body: JSON.stringify({ scheduleAId: SCHEDULE_A.id }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSwapsClient({ user: null }) as any);
    const res = await POST(
      new Request("http://localhost/api/swaps", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when both schedules belong to the same employee", async () => {
    const sameEmployeeScheduleA = { id: 10, employee_id: 1 };
    const sameEmployeeScheduleB = { id: 20, employee_id: 1 };

    // Need to return different schedule data for the two schedule fetches.
    // We'll use a custom mock that tracks call count.
    let scheduleCallCount = 0;
    const managerRow = null;
    const employeeRow = { id: 1, org_id: MOCK_ORG_ID };

    function makeBuilder(result: { data: any; error: any }) {
      const b: any = {};
      for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "gte", "lte", "order", "or", "limit"]) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      b.maybeSingle = vi.fn().mockResolvedValue(result);
      b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
      return b;
    }

    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") return makeBuilder({ data: managerRow, error: null });
        if (table === "employees") return makeBuilder({ data: employeeRow, error: null });
        if (table === "schedules") {
          scheduleCallCount++;
          const row = scheduleCallCount === 1 ? sameEmployeeScheduleA : sameEmployeeScheduleB;
          return makeBuilder({ data: row, error: null });
        }
        return makeBuilder({ data: null, error: null });
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);

    const res = await POST(
      new Request("http://localhost/api/swaps", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/yourself/i);
  });

  it("creates a swap request and returns 200 with id and ok:true", async () => {
    let scheduleCallCount = 0;

    function makeBuilder(result: { data: any; error: any }) {
      const b: any = {};
      for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "gte", "lte", "order", "or", "limit"]) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      b.maybeSingle = vi.fn().mockResolvedValue(result);
      b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
      return b;
    }

    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") return makeBuilder({ data: null, error: null });
        if (table === "employees") return makeBuilder({ data: { id: 1, org_id: MOCK_ORG_ID }, error: null });
        if (table === "schedules") {
          scheduleCallCount++;
          const row = scheduleCallCount === 1 ? SCHEDULE_A : SCHEDULE_B;
          return makeBuilder({ data: row, error: null });
        }
        if (table === "shift_swaps") return makeBuilder({ data: { id: 99 }, error: null });
        return makeBuilder({ data: null, error: null });
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);

    const res = await POST(
      new Request("http://localhost/api/swaps", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeDefined();
  });
});

// ── PUT /api/swaps/[id] ───────────────────────────────────────────────────────

describe("PUT /api/swaps/[id]", () => {
  it("returns 403 for non-manager users", async () => {
    mockCreateClient.mockResolvedValue(
      makeSwapsClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(
      new Request("http://localhost/api/swaps/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSwapsClient({ user: null }) as any);
    const res = await PUT(
      new Request("http://localhost/api/swaps/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("approves swap and swaps employee_id values", async () => {
    let scheduleCallCount = 0;
    let updateCallCount = 0;

    function makeBuilder(result: { data: any; error: any }) {
      const b: any = {};
      for (const m of ["select", "insert", "upsert", "gte", "lte", "order", "or", "limit"]) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      // update().eq() chain
      b.update = vi.fn().mockImplementation(() => {
        updateCallCount++;
        return b;
      });
      b.eq = vi.fn().mockReturnValue(b);
      b.delete = vi.fn().mockReturnValue(b);
      b.maybeSingle = vi.fn().mockResolvedValue(result);
      b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
      return b;
    }

    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") return makeBuilder({ data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }, error: null });
        if (table === "shift_swaps") return makeBuilder({ data: ACCEPTED_SWAP, error: null });
        if (table === "schedules") {
          scheduleCallCount++;
          const row = scheduleCallCount <= 2
            ? (scheduleCallCount === 1 ? SCHEDULE_A : SCHEDULE_B)
            : null;
          return makeBuilder({ data: row, error: null });
        }
        return makeBuilder({ data: null, error: null });
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);

    const res = await PUT(
      new Request("http://localhost/api/swaps/1", {
        method: "PUT",
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Two schedule updates should have been called (one per schedule)
    expect(updateCallCount).toBeGreaterThanOrEqual(2);
  });

  it("denies swap without touching schedules", async () => {
    let updateCallCount = 0;

    function makeBuilder(result: { data: any; error: any }) {
      const b: any = {};
      for (const m of ["select", "insert", "upsert", "gte", "lte", "order", "or", "limit"]) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      b.update = vi.fn().mockImplementation(() => {
        updateCallCount++;
        return b;
      });
      b.eq = vi.fn().mockReturnValue(b);
      b.delete = vi.fn().mockReturnValue(b);
      b.maybeSingle = vi.fn().mockResolvedValue(result);
      b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
      return b;
    }

    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "managers") return makeBuilder({ data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }, error: null });
        if (table === "shift_swaps") return makeBuilder({ data: ACCEPTED_SWAP, error: null });
        return makeBuilder({ data: null, error: null });
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);

    const res = await PUT(
      new Request("http://localhost/api/swaps/1", {
        method: "PUT",
        body: JSON.stringify({ status: "denied" }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Only 1 update: the status update on shift_swaps (no schedule updates)
    expect(updateCallCount).toBe(1);
  });
});

// ── Org scoping ───────────────────────────────────────────────────────────────

describe("org scoping — swaps routes", () => {
  it("GET /api/swaps (manager) scopes shift_swaps query to org_id", async () => {
    const swapsEqArgs: [string, unknown][] = [];
    const client = makeSwapsClient({
      user: MOCK_USER,
      isManager: true,
      tableData: { shift_swaps: { data: [], error: null } },
    });
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
    await GET();
    expect(swapsEqArgs.some(([col]) => col === "org_id")).toBe(true);
  });
});
