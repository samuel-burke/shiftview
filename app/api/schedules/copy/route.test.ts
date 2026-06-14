import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
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

// ── Mock factory ─────────────────────────────────────────────────────────────

function makeCopyClient({
  user = MOCK_USER as any,
  isManager = true,
  existingSchedules = [] as Array<{ employee_id: number }>,
  fromSchedules = [] as Array<{ employee_id: number; start_minutes: number; end_minutes: number }>,
  insertError = null as { message: string } | null,
  existingError = null as { message: string } | null,
  fromError = null as { message: string } | null,
} = {}) {
  const managerRow =
    isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID } : null;

  // Track how many times "schedules" table has been called to distinguish
  // the first call (existing/toDate) from the second call (fromDate)
  let scheduleCallCount = 0;

  // Build a full-featured query builder that supports limit() for getOrgContext
  function makeFullBuilder(result: { data: any; error: any }) {
    const b: any = {};
    for (const m of ["select", "eq", "limit", "order", "gte", "lte", "like", "in", "or"]) {
      b[m] = vi.fn().mockReturnValue(b);
    }
    b.maybeSingle = vi.fn().mockResolvedValue(result);
    b.single = vi.fn().mockResolvedValue(result);
    b.range = vi.fn().mockReturnValue(b);
    b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    return b;
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") {
        return makeFullBuilder({ data: managerRow, error: null });
      }

      // getOrgContext also queries employees table
      if (table === "employees") {
        return makeFullBuilder({ data: null, error: null });
      }

      if (table === "schedules") {
        const callIndex = scheduleCallCount++;

        // Third call is insert
        if (callIndex === 2) {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: insertError }),
          };
        }

        const b: any = {};
        ["select", "eq"].forEach((m) => (b[m] = vi.fn().mockReturnValue(b)));
        // first call → existing schedules (toDate), second call → fromDate schedules
        if (callIndex === 0) {
          b.then = (resolve: any) =>
            Promise.resolve({ data: existingSchedules, error: existingError }).then(resolve);
        } else {
          b.then = (resolve: any) =>
            Promise.resolve({ data: fromSchedules, error: fromError }).then(resolve);
        }
        return b;
      }

      const b: any = {};
      return b;
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/schedules/copy", () => {
  const validBody = { fromDate: "2026-05-19", toDate: "2026-05-26" };

  const FROM_SCHEDULES = [
    { employee_id: 1, start_minutes: 480, end_minutes: 960 },
    { employee_id: 2, start_minutes: 360, end_minutes: 840 },
  ];

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(makeCopyClient() as any);
  });

  it("returns 400 when fromDate is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify({ toDate: "2026-05-26" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns 400 when toDate is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify({ fromDate: "2026-05-19" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid fromDate format", async () => {
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify({ fromDate: "19-05-2026", toDate: "2026-05-26" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("YYYY-MM-DD") });
  });

  it("returns 400 for invalid toDate format", async () => {
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify({ fromDate: "2026-05-19", toDate: "bad-date" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(
      makeCopyClient({ user: null, isManager: false }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-manager", async () => {
    mockCreateClient.mockResolvedValue(
      makeCopyClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns { copied: N, skipped: M } when some employees are already scheduled", async () => {
    // Employee 1 is already scheduled on toDate; only employee 2 should be copied
    mockCreateClient.mockResolvedValue(
      makeCopyClient({
        existingSchedules: [{ employee_id: 1 }],
        fromSchedules: FROM_SCHEDULES,
      }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copied: 1, skipped: 1 });
  });

  it("returns { copied: N, skipped: 0 } when no employees are pre-scheduled", async () => {
    mockCreateClient.mockResolvedValue(
      makeCopyClient({
        existingSchedules: [],
        fromSchedules: FROM_SCHEDULES,
      }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copied: 2, skipped: 0 });
  });

  it("returns { copied: 0, skipped: 0 } when fromDate has no schedules", async () => {
    mockCreateClient.mockResolvedValue(
      makeCopyClient({
        existingSchedules: [],
        fromSchedules: [],
      }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copied: 0, skipped: 0 });
  });

  it("returns 500 when fetching existing schedules fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeCopyClient({
        existingError: { message: "db error on existing" },
      }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when fetching fromDate schedules fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeCopyClient({
        fromError: { message: "db error on from" },
      }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when insert fails", async () => {
    mockCreateClient.mockResolvedValue(
      makeCopyClient({
        existingSchedules: [],
        fromSchedules: FROM_SCHEDULES,
        insertError: { message: "insert failed" },
      }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(500);
  });

  it("scopes insert to org_id", async () => {
    const client = makeCopyClient({
      existingSchedules: [],
      fromSchedules: FROM_SCHEDULES,
    });
    mockCreateClient.mockResolvedValue(client as any);
    await POST(
      new Request("http://localhost/api/schedules/copy", {
        method: "POST",
        body: JSON.stringify(validBody),
      })
    );
    // Find the insert call on schedules (3rd call to from("schedules"))
    const schedulesInsertBuilder = (client.from as any).mock.results.find(
      (_: any, i: number) => (client.from as any).mock.calls[i]?.[0] === "schedules" &&
        (client.from as any).mock.results[i]?.value?.insert != null
    )?.value;
    if (schedulesInsertBuilder) {
      const insertArg = schedulesInsertBuilder.insert.mock.calls[0]?.[0];
      expect(Array.isArray(insertArg)).toBe(true);
      expect(insertArg[0]).toMatchObject({ org_id: MOCK_ORG_ID });
    }
  });
});
