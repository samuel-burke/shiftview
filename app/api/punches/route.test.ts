import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER } from "../__tests__/helpers";

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
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn().mockResolvedValue(undefined) }));

const mockCreateClient = vi.mocked(createClient);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a query builder that is chainable (select/eq/gte/lte/order/limit all
 * return `this`) and whose terminal methods resolve a configurable result.
 */
function makeBuilder(result: { data: any; error: any }) {
  const b: any = {};
  for (const m of ["select", "insert", "eq", "gte", "lte", "order", "limit", "upsert"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.single = vi.fn().mockResolvedValue(result);
  // Make the builder directly awaitable (for `await supabase.from(...).insert(...)`)
  b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return b;
}

/**
 * Build a Supabase client mock tailored for the punches POST route.
 *
 * `lastPunch` – what the state-machine look-up returns (null = no punch today).
 * `insertResult` – what the INSERT returns (defaults to a valid punch row).
 * `empRow` – the linked employee row (defaults to { id: 1 }).
 */
function makePunchClient({
  user = MOCK_USER as any,
  empRow = { id: 1 } as Record<string, unknown> | null,
  lastPunch = null as { punch_type: string } | null,
  lastPunchError = null as any,
  insertData = {
    id: 1,
    employee_id: 1,
    schedule_id: null,
    punch_type: "clock_in",
    punched_at: new Date().toISOString(),
    lat: null,
    lng: null,
    is_manual: false,
    note: null,
  } as any,
  insertError = null as any,
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return makeBuilder({ data: null, error: null });
      if (table === "employees") return makeBuilder({ data: empRow, error: null });
      if (table === "punch_records") {
        // The state-machine query ends with .maybeSingle()
        // The insert query ends with .single()
        // We distinguish them by returning a builder that tracks calls:
        // first call = state-machine read, second call = insert.
        let callCount = 0;
        const b: any = {};
        for (const m of ["select", "insert", "eq", "gte", "lte", "order", "limit", "upsert"]) {
          b[m] = vi.fn().mockReturnValue(b);
        }
        b.maybeSingle = vi.fn().mockResolvedValue({ data: lastPunch, error: lastPunchError });
        b.single = vi.fn().mockResolvedValue({ data: insertData, error: insertError });
        b.then = (resolve: any, _reject: any) => {
          callCount++;
          return Promise.resolve({ data: insertData, error: insertError }).then(resolve, _reject);
        };
        return b;
      }
      if (table === "schedules") return makeBuilder({ data: null, error: null });
      return makeBuilder({ data: null, error: null });
    }),
  };
}

function makePostRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/punches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── POST /api/punches — input validation ─────────────────────────────────────

describe("POST /api/punches — input validation", () => {
  it("returns 400 when punchType is missing", async () => {
    mockCreateClient.mockResolvedValue(makePunchClient() as any);
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/punchType/);
  });

  it("returns 400 for an unknown punchType", async () => {
    mockCreateClient.mockResolvedValue(makePunchClient() as any);
    const res = await POST(makePostRequest({ punchType: "super_punch" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makePunchClient({ user: null }) as any);
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when no employee record is linked", async () => {
    mockCreateClient.mockResolvedValue(makePunchClient({ empRow: null }) as any);
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(403);
  });
});

// ── POST /api/punches — state-machine guard ───────────────────────────────────

describe("POST /api/punches — state-machine guard", () => {
  it("allows clock_in when no punch exists today", async () => {
    mockCreateClient.mockResolvedValue(makePunchClient({ lastPunch: null }) as any);
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(201);
  });

  it("allows clock_in after clock_out", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "clock_out" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(201);
  });

  it("allows clock_in after break_end", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "break_end" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(201);
  });

  it("rejects clock_in when already clocked in (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "clock_in" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/clock_in/);
  });

  it("rejects clock_in after break_start (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "break_start" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(409);
  });

  it("allows clock_out after clock_in", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({
        lastPunch: { punch_type: "clock_in" },
        insertData: {
          id: 2, employee_id: 1, schedule_id: null, punch_type: "clock_out",
          punched_at: new Date().toISOString(), lat: null, lng: null, is_manual: false, note: null,
        },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_out" }));
    expect(res.status).toBe(201);
  });

  it("allows clock_out after break_end", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({
        lastPunch: { punch_type: "break_end" },
        insertData: {
          id: 2, employee_id: 1, schedule_id: null, punch_type: "clock_out",
          punched_at: new Date().toISOString(), lat: null, lng: null, is_manual: false, note: null,
        },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_out" }));
    expect(res.status).toBe(201);
  });

  it("rejects clock_out when not clocked in (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: null }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_out" }));
    expect(res.status).toBe(409);
  });

  it("rejects double clock_out (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "clock_out" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_out" }));
    expect(res.status).toBe(409);
  });

  it("allows break_start after clock_in", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({
        lastPunch: { punch_type: "clock_in" },
        insertData: {
          id: 3, employee_id: 1, schedule_id: null, punch_type: "break_start",
          punched_at: new Date().toISOString(), lat: null, lng: null, is_manual: false, note: null,
        },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "break_start" }));
    expect(res.status).toBe(201);
  });

  it("rejects break_start when not clocked in (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: null }) as any
    );
    const res = await POST(makePostRequest({ punchType: "break_start" }));
    expect(res.status).toBe(409);
  });

  it("rejects double break_start (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "break_start" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "break_start" }));
    expect(res.status).toBe(409);
  });

  it("allows break_end after break_start", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({
        lastPunch: { punch_type: "break_start" },
        insertData: {
          id: 4, employee_id: 1, schedule_id: null, punch_type: "break_end",
          punched_at: new Date().toISOString(), lat: null, lng: null, is_manual: false, note: null,
        },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "break_end" }));
    expect(res.status).toBe(201);
  });

  it("rejects break_end when not on a break (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "clock_in" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "break_end" }));
    expect(res.status).toBe(409);
  });

  it("returns 500 when last-punch query fails", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunchError: { message: "db error" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});
