import { beforeEach, describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { notifyManagers } from "@/lib/notify";
import { writeAuditLog } from "@/lib/audit";
import { MOCK_USER, MOCK_ORG_ID } from "../../../__tests__/helpers";

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

function builder({ thenData = null as any, single = null as any, error = null as any } = {}) {
  const b: any = {};
  let dates: string[] | undefined;
  for (const m of [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in", "like", "range",
  ]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  // Honor date filters so a missing neighboring-day lookup hides the fixture.
  b.eq.mockImplementation((column: string, value: string) => {
    if (column === "date") dates = [value];
    return b;
  });
  b.in.mockImplementation((column: string, values: string[]) => {
    if (column === "date") dates = values;
    return b;
  });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({
      data: dates ? thenData?.filter((row: any) => dates?.includes(row.date)) : thenData,
      error,
    }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  employeeId = 5 as number | null,
  tables = {} as Partial<Record<string, { thenData?: any; single?: any; error?: any }>>,
} = {}) {
  const employeeRow = employeeId != null ? { id: employeeId, org_id: MOCK_ORG_ID, name: "Alex P" } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: null });
      if (table === "employees") return builder({ single: employeeRow });
      const t = tables[table] ?? {};
      return builder({ thenData: t.thenData ?? [], single: t.single ?? null, error: t.error ?? null });
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const OPEN_SHIFT = { id: 3, date: "2026-07-05", start_minutes: 480, end_minutes: 960, status: "open" };
const OVERNIGHT_SHIFT = { ...OPEN_SHIFT, start_minutes: 1320, end_minutes: 1800 };

function req() {
  return new Request("http://localhost/api/open-shifts/3/claim", { method: "POST" });
}
const params = { params: Promise.resolve({ id: "3" }) };

describe("POST /api/open-shifts/[id]/claim", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for an invalid id", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await POST(req(), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the shift does not exist", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ tables: { open_shifts: { single: null } } }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("returns 409 when the shift is no longer open", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ tables: { open_shifts: { single: { ...OPEN_SHIFT, status: "filled" } } } }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
  });

  it("returns 409 when the employee is not eligible (called out)", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        tables: {
          open_shifts: { single: OPEN_SHIFT },
          callouts: { thenData: [{ date: "2026-07-05" }] },
        },
      }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/called out/i);
  });

  it.each([
    {
      name: "an overlapping overnight schedule from the previous day",
      shift: { ...OPEN_SHIFT, date: "2027-01-01", start_minutes: 300 },
      commitments: { schedules: { thenData: [{ date: "2026-12-31", start_minutes: 1320, end_minutes: 1800 }] } },
      reason: /scheduled/i,
    },
    {
      name: "an overlapping schedule on the following day",
      shift: { ...OVERNIGHT_SHIFT, date: "2026-07-31" },
      commitments: { schedules: { thenData: [{ date: "2026-08-01", start_minutes: 300, end_minutes: 600 }] } },
      reason: /scheduled/i,
    },
    {
      name: "approved time off on the following day of an overnight shift",
      shift: OVERNIGHT_SHIFT,
      commitments: { time_off_requests: { thenData: [{ date: "2026-07-06", status: "approved" }] } },
      reason: /time off/i,
    },
    {
      name: "a callout on the following day of an overnight shift",
      shift: OVERNIGHT_SHIFT,
      commitments: { callouts: { thenData: [{ date: "2026-07-06" }] } },
      reason: /called out/i,
    },
  ])("rejects $name before creating a claim or notifying managers", async ({ shift, commitments, reason }) => {
    const client = makeClient({ tables: {
      open_shifts: { single: shift },
      open_shift_claims: { single: { id: 11 } },
      ...commitments,
    } });
    mockCreateClient.mockResolvedValue(client as any);

    const res = await POST(req(), params);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(reason);
    expect(client.from).not.toHaveBeenCalledWith("open_shift_claims");
    expect(notifyManagers).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it.each(["schedules", "time_off_requests", "callouts"])("returns 500 if the %s eligibility lookup fails", async (table) => {
    const client = makeClient({ tables: {
      open_shifts: { single: OVERNIGHT_SHIFT },
      open_shift_claims: { single: { id: 11 } },
      [table]: { thenData: null, error: { message: "Lookup failed" } },
    } });
    mockCreateClient.mockResolvedValue(client as any);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await POST(req(), params);

      expect(res.status).toBe(500);
      expect(client.from).not.toHaveBeenCalledWith("open_shift_claims");
      expect(notifyManagers).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    { name: "a daytime shift with next-day time off and a callout", shift: OPEN_SHIFT, nextStart: 300, timeOffStatus: "approved", calloutDate: "2026-07-06" },
    { name: "a shift ending at midnight with next-day time off and a callout", shift: { ...OVERNIGHT_SHIFT, end_minutes: 1440 }, nextStart: 0, timeOffStatus: "approved", calloutDate: "2026-07-06" },
    { name: "an overnight shift that only touches the next schedule's start", shift: OVERNIGHT_SHIFT, nextStart: 360, timeOffStatus: "pending", calloutDate: "2026-07-04" },
  ])("allows $name", async ({ shift, nextStart, timeOffStatus, calloutDate }) => {
    mockCreateClient.mockResolvedValue(makeClient({ tables: {
      open_shifts: { single: shift },
      open_shift_claims: { single: { id: 11 } },
      schedules: { thenData: [{ date: "2026-07-06", start_minutes: nextStart, end_minutes: 960 }] },
      time_off_requests: { thenData: [{ date: "2026-07-06", status: timeOffStatus }] },
      callouts: { thenData: [{ date: calloutDate }] },
    } }) as any);

    const res = await POST(req(), params);

    expect(res.status).toBe(201);
    expect(notifyManagers).toHaveBeenCalledOnce();
  });

  it("creates a pending claim and returns 201", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        tables: {
          open_shifts: { single: OPEN_SHIFT },
          schedules: { thenData: [] },
          time_off_requests: { thenData: [] },
          callouts: { thenData: [] },
          open_shift_claims: { single: { id: 11 } },
        },
      }) as any
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(11);
  });
});
