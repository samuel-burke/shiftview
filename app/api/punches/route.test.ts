import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { notifyManagers } from "@/lib/notify";
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
const mockNotifyManagers = vi.mocked(notifyManagers);

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

// ── POST /api/punches — late clock-in notification timezone correctness ───────

function makeTimezoneClockInClient({
  punchedAtUTC,
  scheduleStartMinutes,
  timezone = "America/New_York",
  empName = "Alice",
}: {
  punchedAtUTC: string;
  scheduleStartMinutes: number;
  timezone?: string;
  empName?: string;
}) {
  const insertData = {
    id: 99,
    employee_id: 1,
    schedule_id: 10,
    punch_type: "clock_in",
    punched_at: punchedAtUTC,
    lat: null,
    lng: null,
    is_manual: false,
    note: null,
  };

  const buildSimple = (data: any) => {
    const b: any = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "gte", "lte", "order", "limit"]) {
      b[m] = vi.fn().mockReturnValue(b);
    }
    b.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    b.single = vi.fn().mockResolvedValue({ data, error: null });
    b.then = (resolve: any, _rej: any) => Promise.resolve({ data, error: null }).then(resolve, _rej);
    return b;
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers")    return buildSimple(null);
      if (table === "employees")   return buildSimple({ id: 1, name: empName });
      if (table === "app_settings") return buildSimple([{ key: "timezone", value: timezone }]);
      if (table === "schedules")   return buildSimple({ start_minutes: scheduleStartMinutes, date: "2026-05-26", employee_id: 1 });
      if (table === "punch_records") {
        const b: any = {};
        for (const m of ["select", "insert", "eq", "gte", "lte", "order", "limit"]) {
          b[m] = vi.fn().mockReturnValue(b);
        }
        b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        b.single = vi.fn().mockResolvedValue({ data: insertData, error: null });
        b.then = (resolve: any, _rej: any) =>
          Promise.resolve({ data: insertData, error: null }).then(resolve, _rej);
        return b;
      }
      return buildSimple(null);
    }),
  };
}

describe("POST /api/punches — late clock-in notification uses store timezone", () => {
  beforeEach(() => {
    mockNotifyManagers.mockClear();
  });

  it("does NOT fire notification when employee clocks in early in store timezone (UTC would appear late)", async () => {
    mockCreateClient.mockResolvedValue(
      makeTimezoneClockInClient({
        punchedAtUTC: "2026-05-26T16:47:00.000Z",
        scheduleStartMinutes: 840,
        timezone: "America/New_York",
      }) as any
    );
    await POST(makePostRequest({ punchType: "clock_in", scheduleId: 10 }));
    expect(mockNotifyManagers).not.toHaveBeenCalled();
  });

  it("fires notification with correct lateMinutes when employee is genuinely late in store timezone", async () => {
    mockCreateClient.mockResolvedValue(
      makeTimezoneClockInClient({
        punchedAtUTC: "2026-05-26T12:15:00.000Z",
        scheduleStartMinutes: 480,
        timezone: "America/New_York",
      }) as any
    );
    await POST(makePostRequest({ punchType: "clock_in", scheduleId: 10 }));
    expect(mockNotifyManagers).toHaveBeenCalledOnce();
    const callArgs = mockNotifyManagers.mock.calls[0];
    expect(callArgs[4]).toMatchObject({ lateMinutes: 15 });
    expect(callArgs[3]).toContain("15m late");
  });

  it("does NOT fire notification when within the 5-minute grace window", async () => {
    mockCreateClient.mockResolvedValue(
      makeTimezoneClockInClient({
        punchedAtUTC: "2026-05-26T12:04:00.000Z",
        scheduleStartMinutes: 480,
        timezone: "America/New_York",
      }) as any
    );
    await POST(makePostRequest({ punchType: "clock_in", scheduleId: 10 }));
    expect(mockNotifyManagers).not.toHaveBeenCalled();
  });

  it("uses America/New_York as fallback when timezone missing from app_settings", async () => {
    const client = makeTimezoneClockInClient({
      punchedAtUTC: "2026-05-26T16:47:00.000Z",
      scheduleStartMinutes: 840,
      timezone: "America/New_York",
    });
    const originalFrom = client.from;
    client.from = vi.fn().mockImplementation((table: string) => {
      if (table === "app_settings") {
        const b: any = {};
        for (const m of ["select", "insert", "eq"]) b[m] = vi.fn().mockReturnValue(b);
        b.maybeSingle = vi.fn().mockResolvedValue({ data: [], error: null });
        b.single = vi.fn().mockResolvedValue({ data: [], error: null });
        b.then = (resolve: any, _rej: any) => Promise.resolve({ data: [], error: null }).then(resolve, _rej);
        return b;
      }
      return originalFrom(table);
    });
    mockCreateClient.mockResolvedValue(client as any);
    await POST(makePostRequest({ punchType: "clock_in", scheduleId: 10 }));
    expect(mockNotifyManagers).not.toHaveBeenCalled();
  });

  it("fires exact notification text with employee name and scheduled time", async () => {
    mockCreateClient.mockResolvedValue(
      makeTimezoneClockInClient({
        punchedAtUTC: "2026-05-26T13:12:00.000Z",
        scheduleStartMinutes: 540,
        timezone: "America/New_York",
        empName: "Bob",
      }) as any
    );
    await POST(makePostRequest({ punchType: "clock_in", scheduleId: 10 }));
    expect(mockNotifyManagers).toHaveBeenCalledOnce();
    const msg = mockNotifyManagers.mock.calls[0][3] as string;
    expect(msg).toContain("Bob");
    expect(msg).toContain("12m late");
    expect(msg).toContain("9:00 AM");
  });
});

// ── PUT /api/punches — manual punch corrections ───────────────────────────────

function makeManualPunchClient({ manualEnabled = true }: { manualEnabled?: boolean } = {}) {
  const settingsRow = manualEnabled
    ? []
    : [{ key: "manual_punches_enabled", value: "false" }];
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "app_settings") return makeBuilder({ data: settingsRow, error: null });
      if (table === "managers") return makeBuilder({ data: { user_id: MOCK_USER.id }, error: null });
      if (table === "employees") return makeBuilder({ data: { id: 1 }, error: null });
      if (table === "punch_records") return makeBuilder({ data: null, error: null });
      return makeBuilder({ data: null, error: null });
    }),
  };
}

function makePutRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/punches", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validPutBody = {
  punchType: "clock_in",
  punchedAt: new Date(Date.now() - 60_000).toISOString(),
  note: "Forgot to punch",
  employeeId: 1,
};

describe("PUT /api/punches — manual punches setting", () => {
  it("returns 200 when manual punches are enabled (default)", async () => {
    mockCreateClient.mockResolvedValue(makeManualPunchClient({ manualEnabled: true }) as any);
    const res = await PUT(makePutRequest(validPutBody));
    expect(res.status).toBe(200);
  });

  it("returns 403 when manual_punches_enabled is false", async () => {
    mockCreateClient.mockResolvedValue(makeManualPunchClient({ manualEnabled: false }) as any);
    const res = await PUT(makePutRequest(validPutBody));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/manual/i);
  });
});
