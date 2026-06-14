import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { notifyManagers } from "@/lib/notify";
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
  for (const m of ["select", "insert", "eq", "gte", "lte", "lt", "order", "limit", "upsert"]) {
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
  empRow = { id: 1, org_id: MOCK_ORG_ID } as Record<string, unknown> | null,
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
        const b: any = {};
        for (const m of ["select", "insert", "eq", "gte", "lte", "lt", "order", "limit", "upsert"]) {
          b[m] = vi.fn().mockReturnValue(b);
        }
        // Both maybeSingle calls (today's state-machine + missed-punch check) return lastPunch.
        // For most tests lastPunch is null or clock_out, so the missed-punch check passes.
        b.maybeSingle = vi.fn().mockResolvedValue({ data: lastPunch, error: lastPunchError });
        b.single = vi.fn().mockResolvedValue({ data: insertData, error: insertError });
        b.then = (resolve: any, _reject: any) =>
          Promise.resolve({ data: insertData, error: insertError }).then(resolve, _reject);
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

  it("rejects clock_in after break_end — must clock out first (returns 409)", async () => {
    mockCreateClient.mockResolvedValue(
      makePunchClient({ lastPunch: { punch_type: "break_end" } }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(409);
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

  it("scopes state machine to current local day — uses gte/lte date filter", async () => {
    // The day-scoped state machine uses gte/lte to restrict the look-up to today's
    // local-timezone bounds. A 9pm EST clock-in (= 1am UTC next day) is still
    // within the local day window so clock-out succeeds.
    let gteCallCount = 0;
    const client = makePunchClient({ lastPunch: { punch_type: "clock_in" } });
    const origFrom = (client as any).from.bind(client);
    (client as any).from = vi.fn().mockImplementation((table: string) => {
      const b = origFrom(table);
      if (table === "punch_records") {
        const origGte = b.gte.bind(b);
        b.gte = vi.fn().mockImplementation((...args: unknown[]) => { gteCallCount++; return origGte(...args); });
      }
      return b;
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(makePostRequest({ punchType: "clock_out" }));
    expect(res.status).toBe(201);
    // One gte call — the state-machine query uses a local-day date filter
    expect(gteCallCount).toBe(1);
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
      if (table === "employees")   return buildSimple({ id: 1, name: empName, org_id: MOCK_ORG_ID });
      if (table === "app_settings") return buildSimple([{ key: "timezone", value: timezone }]);
      if (table === "schedules")   return buildSimple({ start_minutes: scheduleStartMinutes, date: "2026-05-26", employee_id: 1 });
      if (table === "punch_records") {
        const b: any = {};
        for (const m of ["select", "insert", "eq", "gte", "lte", "lt", "order", "limit"]) {
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
    expect(callArgs[5]).toMatchObject({ lateMinutes: 15 });
    expect(callArgs[4]).toContain("15m late");
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
    const msg = mockNotifyManagers.mock.calls[0][4] as string;
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
      if (table === "managers") return makeBuilder({ data: { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID }, error: null });
      if (table === "employees") return makeBuilder({ data: { id: 1, org_id: MOCK_ORG_ID }, error: null });
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

// ── GET /api/punches — timezone-aware day boundaries ─────────────────────────

function makeGetRequest(date?: string) {
  const url = date
    ? `http://localhost/api/punches?date=${date}`
    : `http://localhost/api/punches`;
  return new Request(url, { method: "GET" });
}

/**
 * Builds a Supabase client for GET tests.
 * Captures the gte/lte values passed to punch_records for assertion,
 * and optionally filters the provided punchRows through those bounds.
 */
function makeGetClient({
  timezone = "America/New_York",
  isManager = true,
  punchRows = [] as any[],
} = {}) {
  let capturedGte: string | undefined;
  let capturedLte: string | undefined;

  const client = {
    _getCaptured: () => ({ gte: capturedGte, lte: capturedLte }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      b.then = (resolve: any, _rej: any) =>
        Promise.resolve({ data: null, error: null }).then(resolve, _rej);

      if (table === "app_settings") {
        b.then = (resolve: any, _rej: any) =>
          Promise.resolve({
            data: [{ key: "timezone", value: timezone }],
            error: null,
          }).then(resolve, _rej);
        return b;
      }

      if (table === "managers") {
        b.maybeSingle = vi.fn().mockResolvedValue({
          data: isManager ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID } : null,
          error: null,
        });
        return b;
      }

      if (table === "employees") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 1, org_id: MOCK_ORG_ID }, error: null });
        return b;
      }

      if (table === "punch_records") {
        b.gte = vi.fn().mockImplementation((_col: string, val: string) => {
          capturedGte = val;
          return b;
        });
        b.lte = vi.fn().mockImplementation((_col: string, val: string) => {
          capturedLte = val;
          return b;
        });
        b.then = (resolve: any, _rej: any) => {
          const filtered = punchRows.filter((p) => {
            const t = new Date(p.punched_at).getTime();
            const lo = capturedGte ? new Date(capturedGte).getTime() : -Infinity;
            const hi = capturedLte ? new Date(capturedLte).getTime() : Infinity;
            return t >= lo && t <= hi;
          });
          return Promise.resolve({ data: filtered, error: null }).then(resolve, _rej);
        };
        return b;
      }

      return b;
    }),
  };
  return client;
}

describe("GET /api/punches — input validation", () => {
  it("returns 400 when date param is missing", async () => {
    mockCreateClient.mockResolvedValue(makeGetClient() as any);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/date/i);
  });

  it("returns 400 when date format is invalid", async () => {
    mockCreateClient.mockResolvedValue(makeGetClient() as any);
    const res = await GET(makeGetRequest("not-a-date"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/punches — timezone-aware day filtering", () => {
  it("computes EDT-aligned UTC boundaries: midnight EDT = 04:00 UTC", async () => {
    const client = makeGetClient({ timezone: "America/New_York" });
    mockCreateClient.mockResolvedValue(client as any);

    await GET(makeGetRequest("2026-06-01"));

    const { gte, lte } = client._getCaptured();
    // EDT = UTC-4: midnight EDT on Jun 1 = 04:00 UTC; 23:59:59.999 EDT = Jun 2 03:59:59.999 UTC
    expect(gte).toBe("2026-06-01T04:00:00.000Z");
    expect(lte).toBe("2026-06-02T03:59:59.999Z");
  });

  it("computes EST-aligned UTC boundaries in winter: midnight EST = 05:00 UTC", async () => {
    const client = makeGetClient({ timezone: "America/New_York" });
    mockCreateClient.mockResolvedValue(client as any);

    await GET(makeGetRequest("2026-01-15"));

    const { gte, lte } = client._getCaptured();
    // EST = UTC-5: midnight EST on Jan 15 = 05:00 UTC; 23:59:59.999 EST = Jan 16 04:59:59.999 UTC
    expect(gte).toBe("2026-01-15T05:00:00.000Z");
    expect(lte).toBe("2026-01-16T04:59:59.999Z");
  });

  it("excludes a 9:53 PM EDT punch when querying the following local date", async () => {
    // 2026-06-01T01:53:08Z = 9:53 PM EDT on May 31 — must NOT appear in June 1 results
    const prevNightPunch = {
      id: 1, employee_id: 1, schedule_id: null, punch_type: "clock_in",
      punched_at: "2026-06-01T01:53:08.000Z",
      lat: null, lng: null, is_manual: false, note: null,
    };
    const client = makeGetClient({ timezone: "America/New_York", punchRows: [prevNightPunch] });
    mockCreateClient.mockResolvedValue(client as any);

    const res = await GET(makeGetRequest("2026-06-01"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it("includes the same 9:53 PM EDT punch when querying May 31", async () => {
    const prevNightPunch = {
      id: 1, employee_id: 1, schedule_id: null, punch_type: "clock_in",
      punched_at: "2026-06-01T01:53:08.000Z",
      lat: null, lng: null, is_manual: false, note: null,
    };
    const client = makeGetClient({ timezone: "America/New_York", punchRows: [prevNightPunch] });
    mockCreateClient.mockResolvedValue(client as any);

    const res = await GET(makeGetRequest("2026-05-31"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].punchType).toBe("clock_in");
  });

  it("uses America/New_York as fallback when timezone is absent from app_settings", async () => {
    const client = makeGetClient({ timezone: "America/New_York" });
    // Override app_settings to return an empty array (no timezone key)
    const origFrom = client.from.bind(client);
    client.from = vi.fn().mockImplementation((table: string) => {
      if (table === "app_settings") {
        const b: any = {};
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.then = (resolve: any, _rej: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve, _rej);
        return b;
      }
      return origFrom(table);
    });
    mockCreateClient.mockResolvedValue(client as any);

    await GET(makeGetRequest("2026-06-01"));

    const { gte } = client._getCaptured();
    // Fallback to America/New_York (EDT = UTC-4 in June)
    expect(gte).toBe("2026-06-01T04:00:00.000Z");
  });
});

// ── POST /api/punches — missed punch detection ────────────────────────────────

/**
 * Builds a client where today's state-machine query returns `todayLastPunch`
 * and the previous-day missed-punch query returns `prevDayLastPunch`.
 * Counter increments across all builders from the same client instance so the
 * two `maybeSingle()` calls on separate `from("punch_records")` invocations
 * get the right value.
 */
function makeMissedPunchClient({
  todayLastPunch = null as { punch_type: string } | null,
  prevDayLastPunch = null as { punch_type: string; punched_at: string } | null,
} = {}) {
  let maybeSingleCallCount = 0;
  const insertData = {
    id: 1, employee_id: 1, schedule_id: null, punch_type: "clock_in",
    punched_at: new Date().toISOString(), lat: null, lng: null, is_manual: false, note: null,
  };
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers")   return makeBuilder({ data: null, error: null });
      if (table === "employees")  return makeBuilder({ data: { id: 1, name: "Alice", org_id: MOCK_ORG_ID }, error: null });
      if (table === "app_settings") return makeBuilder({ data: null, error: null });
      if (table === "schedules")  return makeBuilder({ data: null, error: null });
      if (table === "punch_records") {
        const b: any = {};
        for (const m of ["select", "insert", "eq", "gte", "lte", "lt", "order", "limit", "upsert"]) {
          b[m] = vi.fn().mockReturnValue(b);
        }
        b.maybeSingle = vi.fn().mockImplementation(() => {
          maybeSingleCallCount++;
          if (maybeSingleCallCount === 1)
            return Promise.resolve({ data: todayLastPunch, error: null });
          // Second call is the missed-punch check (only for clock_in)
          return Promise.resolve({ data: prevDayLastPunch, error: null });
        });
        b.single   = vi.fn().mockResolvedValue({ data: insertData, error: null });
        b.then     = (resolve: any, _rej: any) =>
          Promise.resolve({ data: insertData, error: null }).then(resolve, _rej);
        return b;
      }
      return makeBuilder({ data: null, error: null });
    }),
  };
}

describe("POST /api/punches — missed punch detection", () => {
  it("allows clock_in when the most recent previous-day punch is clock_in (missed punch is non-blocking)", async () => {
    mockCreateClient.mockResolvedValue(
      makeMissedPunchClient({
        todayLastPunch: null,
        prevDayLastPunch: { punch_type: "clock_in", punched_at: "2026-06-04T22:00:00.000Z" },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(201);
  });

  it("allows clock_in when the previous day ended with break_start (missed punch is non-blocking)", async () => {
    mockCreateClient.mockResolvedValue(
      makeMissedPunchClient({
        todayLastPunch: null,
        prevDayLastPunch: { punch_type: "break_start", punched_at: "2026-06-04T20:00:00.000Z" },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(201);
  });

  it("allows clock_in when the most recent previous-day punch is clock_out", async () => {
    mockCreateClient.mockResolvedValue(
      makeMissedPunchClient({
        todayLastPunch: null,
        prevDayLastPunch: { punch_type: "clock_out", punched_at: "2026-06-04T22:00:00.000Z" },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(201);
  });

  it("allows clock_in when there are no previous punches at all", async () => {
    mockCreateClient.mockResolvedValue(
      makeMissedPunchClient({
        todayLastPunch: null,
        prevDayLastPunch: null,
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_in" }));
    expect(res.status).toBe(201);
  });

  it("does not run missed-punch check for clock_out (only for clock_in)", async () => {
    // Previous day has an open session, but since we're clocking OUT (same-day session),
    // the missed-punch check is not triggered.
    mockCreateClient.mockResolvedValue(
      makeMissedPunchClient({
        todayLastPunch: { punch_type: "clock_in" },
        prevDayLastPunch: { punch_type: "clock_in", punched_at: "2026-06-04T22:00:00.000Z" },
      }) as any
    );
    const res = await POST(makePostRequest({ punchType: "clock_out" }));
    expect(res.status).toBe(201);
  });


});

// ── Org scoping assertions ────────────────────────────────────────────────────

describe("org scoping — punches routes", () => {
  it("POST /api/punches scopes punch_records insert to the resolved org_id", async () => {
    // Spy on the eq calls on the punch_records builder to verify org_id is stamped.
    const client = makePunchClient({ lastPunch: null });
    const origFrom = (client as any).from.bind(client);
    const punchRecordsEqArgs: [string, unknown][] = [];
    (client as any).from = vi.fn().mockImplementation((table: string) => {
      const b = origFrom(table);
      if (table === "punch_records") {
        const origEq = b.eq.bind(b);
        b.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
          punchRecordsEqArgs.push([col, val]);
          return origEq(col, val);
        });
      }
      return b;
    });
    mockCreateClient.mockResolvedValue(client as any);
    await POST(makePostRequest({ punchType: "clock_in" }));
    // The state-machine query on punch_records must include org_id scoping
    expect(punchRecordsEqArgs.some(([col]) => col === "org_id")).toBe(true);
  });

  it("GET /api/punches scopes app_settings to the resolved org_id", async () => {
    const client = makeGetClient({ timezone: "America/New_York", isManager: true });
    const origFrom = client.from.bind(client);
    const appSettingsEqArgs: [string, unknown][] = [];
    client.from = vi.fn().mockImplementation((table: string) => {
      const b = origFrom(table);
      if (table === "app_settings") {
        const origEq = b.eq.bind(b);
        b.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
          appSettingsEqArgs.push([col, val]);
          return origEq(col, val);
        });
      }
      return b;
    });
    mockCreateClient.mockResolvedValue(client as any);
    await GET(makeGetRequest("2026-06-01"));
    expect(appSettingsEqArgs.some(([col]) => col === "org_id")).toBe(true);
  });
});
