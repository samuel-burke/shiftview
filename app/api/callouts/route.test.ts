import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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

// Non-manager employee client. `callouts` rows come back from `calloutRows`.
function makeEmployeeClient(
  emp: { id: number; name: string } | null = { id: 5, name: "Alice Smith" },
  calloutRows: any[] = [],
  {
    shiftDates = [] as string[],   // dates the employee is scheduled
    clockInRows = [] as any[],     // clock-ins returned for "today"
    timezone = "America/New_York",
  } = {}
) {
  const empWithOrg = emp ? { ...emp, org_id: MOCK_ORG_ID } : null;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn().mockImplementation((table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "order", "gte", "lte", "in", "insert", "upsert", "limit"])
        b[m] = vi.fn().mockReturnValue(b);
      if (table === "managers") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        b.then = (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve);
        return b;
      }
      if (table === "employees") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: empWithOrg, error: null });
        b.then = (resolve: any) =>
          Promise.resolve({ data: empWithOrg ? [empWithOrg] : [], error: null }).then(resolve);
        return b;
      }
      if (table === "app_settings") {
        b.then = (resolve: any) =>
          Promise.resolve({ data: [{ key: "timezone", value: timezone }], error: null }).then(resolve);
        return b;
      }
      if (table === "schedules") {
        let date: string | null = null;
        b.eq = vi.fn().mockImplementation((c: string, v: any) => { if (c === "date") date = v; return b; });
        b.then = (resolve: any) =>
          Promise.resolve({ data: date && shiftDates.includes(date) ? [{ id: 1 }] : [], error: null }).then(resolve);
        return b;
      }
      if (table === "punch_records") {
        b.then = (resolve: any) => Promise.resolve({ data: clockInRows, error: null }).then(resolve);
        return b;
      }
      // callouts
      b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      b.single = vi.fn().mockResolvedValue({ data: { id: 99 }, error: null });
      b.then = (resolve: any) => Promise.resolve({ data: calloutRows, error: null }).then(resolve);
      return b;
    }),
  };
}

const MOCK_CALLOUTS = [{ id: 1, employee_id: 5, date: "2099-06-15", reason: "Sick" }];

// ── GET ───────────────────────────────────────────────────────────────────────

describe("GET /api/callouts", () => {
  it("returns 401 for unauthenticated users", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the caller's own call-outs with ?mine=true", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(undefined, MOCK_CALLOUTS) as any);
    const res = await GET(new Request("http://localhost/api/callouts?mine=true"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.callouts)).toBe(true);
    expect(body.callouts[0]).toMatchObject({ employeeId: 5, date: "2099-06-15", employeeName: "Alice Smith" });
  });

  it("returns org-wide call-outs for a given ?date", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(undefined, MOCK_CALLOUTS) as any);
    const res = await GET(new Request("http://localhost/api/callouts?date=2099-06-15"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.callouts)).toBe(true);
  });

  it("returns 400 for a malformed date param", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient() as any);
    const res = await GET(new Request("http://localhost/api/callouts?date=15-06-2099"));
    expect(res.status).toBe(400);
  });

  it("returns 403 when the caller has no organization membership", async () => {
    mockCreateClient.mockResolvedValue(makeEmployeeClient(null) as any);
    const res = await GET(new Request("http://localhost/api/callouts?mine=true"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "No organization membership" });
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe("POST /api/callouts", () => {
  // 10:00 AM in New York on Nov 1, 2026: today is Nov 1, tomorrow Nov 2.
  const TODAY = "2026-11-01";
  const TOMORROW = "2026-11-02";
  const post = (body: Record<string, unknown>) =>
    POST(new Request("http://localhost/api/callouts", { method: "POST", body: JSON.stringify(body) }));
  const client = (opts: Parameters<typeof makeEmployeeClient>[2] = {}) =>
    mockCreateClient.mockResolvedValue(makeEmployeeClient(undefined, [], opts) as any);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T15:00:00Z"));
    client({ shiftDates: [TODAY, TOMORROW] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 400 for missing employeeId", async () => {
    expect((await post({ date: TODAY })).status).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await post({ employeeId: 5, date: "31-12-2099" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "date must be YYYY-MM-DD" });
  });

  it("returns 401 for unauthenticated request", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    expect((await post({ employeeId: 5, date: TODAY })).status).toBe(401);
  });

  it("returns 403 when filing for someone else", async () => {
    expect((await post({ employeeId: 999, date: TODAY })).status).toBe(403);
  });

  it("allows calling out for today's shift", async () => {
    const res = await post({ employeeId: 5, date: TODAY, reason: "Flu" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 99, ok: true });
  });

  it("allows calling out for tomorrow's shift, even after clocking in today", async () => {
    client({ shiftDates: [TOMORROW], clockInRows: [{ id: 1 }] });
    expect((await post({ employeeId: 5, date: TOMORROW })).status).toBe(201);
  });

  it("rejects past dates and dates beyond tomorrow", async () => {
    for (const date of ["2026-10-31", "2026-11-03", "2099-12-31"]) {
      client({ shiftDates: [date] });
      const res = await post({ employeeId: 5, date });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "You can only call out for today's or tomorrow's shift" });
    }
  });

  it("rejects a day with no scheduled shift", async () => {
    client({ shiftDates: [] });
    const res = await post({ employeeId: 5, date: TOMORROW });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "You don't have a shift scheduled that day" });
  });

  it("rejects today's call-out once clocked in for the shift", async () => {
    client({ shiftDates: [TODAY], clockInRows: [{ id: 1 }] });
    const res = await post({ employeeId: 5, date: TODAY });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "You've already clocked in for today's shift" });
  });

  it("uses the store's calendar day, not UTC's", async () => {
    // 10:00 PM Nov 1 in New York is already Nov 2 in UTC.
    vi.setSystemTime(new Date("2026-11-02T03:00:00Z"));
    client({ shiftDates: ["2026-11-01", "2026-11-03"] });
    expect((await post({ employeeId: 5, date: "2026-11-01" })).status).toBe(201);
    expect((await post({ employeeId: 5, date: "2026-11-03" })).status).toBe(400);
    // The same instant is midday Nov 2 in Tokyo: Nov 3 is tomorrow there.
    client({ shiftDates: ["2026-11-01", "2026-11-03"], timezone: "Asia/Tokyo" });
    expect((await post({ employeeId: 5, date: "2026-11-01" })).status).toBe(400);
    expect((await post({ employeeId: 5, date: "2026-11-03" })).status).toBe(201);
  });
});

// ── Org scoping ───────────────────────────────────────────────────────────────

describe("org scoping — callouts routes", () => {
  it("POST stamps org_id onto the inserted row (withOrg)", async () => {
    let upsertedRow: any = null;
    const client: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        const b: any = {};
        for (const m of ["select", "eq", "order", "gte", "lte", "in", "limit"])
          b[m] = vi.fn().mockReturnValue(b);
        b.upsert = vi.fn().mockImplementation((row: any) => {
          if (table === "callouts") upsertedRow = row;
          return b;
        });
        b.maybeSingle = vi.fn().mockResolvedValue({
          data:
            table === "employees"
              ? { id: 5, name: "Alice Smith", org_id: MOCK_ORG_ID }
              : null,
          error: null,
        });
        b.single = vi.fn().mockResolvedValue({ data: { id: 7 }, error: null });
        b.then = (resolve: any) =>
          Promise.resolve({ data: table === "schedules" ? [{ id: 1 }] : [], error: null }).then(resolve);
        return b;
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T15:00:00Z"));
    await POST(
      new Request("http://localhost/api/callouts", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, date: "2026-11-02" }),
      })
    );
    vi.useRealTimers();
    expect(upsertedRow).toMatchObject({ org_id: MOCK_ORG_ID, employee_id: 5, date: "2026-11-02" });
  });
});
