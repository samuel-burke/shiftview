import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { writeAuditLog } from "@/lib/audit";
import { notifyManagers } from "@/lib/notify";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const mockCreateClient = vi.mocked(createClient);
const mockAudit = vi.mocked(writeAuditLog);

type Punch = { punch_type: string; punched_at: string; note?: string | null; is_manual?: boolean };

// A Supabase mock for PUT /api/punches. `history` is the target employee's
// existing punches; prev/next lookups are answered from it like the real
// ordered queries would be. Inserts and updates are captured.
function makeClient({
  isManager = false,
  timezone = "America/New_York",
  history = [] as Punch[],
}: { isManager?: boolean; timezone?: string; history?: Punch[] } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const requested: Record<string, unknown>[] = [];

  const simple = (result: { data: unknown; error: null }) => {
    const b: any = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = vi.fn().mockReturnValue(b);
    b.maybeSingle = vi.fn().mockResolvedValue(result);
    b.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return b;
  };

  const client = {
    inserted,
    updated,
    requested,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "app_settings") {
        return simple({ data: [{ key: "timezone", value: timezone }], error: null });
      }
      if (table === "managers") {
        return simple({ data: isManager ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false } : null, error: null });
      }
      if (table === "employees") {
        return simple({ data: { id: 5, org_id: MOCK_ORG_ID, name: "Alex", user_id: MOCK_USER.id }, error: null });
      }
      if (table === "punch_corrections") {
        const b: any = {};
        b.insert = vi.fn().mockImplementation((row: Record<string, unknown>) => { requested.push(row); return b; });
        b.select = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: { id: 99 }, error: null });
        return b;
      }
      if (table === "punch_records") {
        const filters: { lt?: string; gte?: string; ascending?: boolean } = {};
        const b: any = {};
        for (const m of ["select", "eq", "limit"]) b[m] = vi.fn().mockReturnValue(b);
        b.lt = vi.fn().mockImplementation((_c: string, v: string) => { filters.lt = v; return b; });
        b.gte = vi.fn().mockImplementation((_c: string, v: string) => { filters.gte = v; return b; });
        b.order = vi.fn().mockImplementation((_c: string, o: { ascending: boolean }) => { filters.ascending = o.ascending; return b; });
        b.insert = vi.fn().mockImplementation((row: Record<string, unknown>) => { inserted.push(row); return b; });
        b.update = vi.fn().mockImplementation((row: Record<string, unknown>) => { updated.push(row); return b; });
        b.maybeSingle = vi.fn().mockImplementation(() => {
          const sorted = [...history].sort((a, c) => Date.parse(a.punched_at) - Date.parse(c.punched_at));
          let data: Punch | null = null;
          if (filters.lt) data = [...sorted].reverse().find((p) => Date.parse(p.punched_at) < Date.parse(filters.lt!)) ?? null;
          else if (filters.gte) data = sorted.find((p) => Date.parse(p.punched_at) >= Date.parse(filters.gte!)) ?? null;
          else data = sorted[sorted.length - 1] ?? null; // lookup by id (edit)
          return Promise.resolve({ data, error: null });
        });
        b.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej);
        return b;
      }
      return simple({ data: null, error: null });
    }),
  };
  return client;
}

function put(body: Record<string, unknown>) {
  return PUT(new Request("http://localhost/api/punches", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  mockAudit.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 10:00 EST on the US fall-back day.
  vi.setSystemTime(new Date("2026-11-01T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PUT /api/punches — server-side time conversion", () => {
  it("converts the store-local wall time with the org's timezone, not the browser's", async () => {
    const client = makeClient({ history: [{ punch_type: "clock_in", punched_at: "2026-10-31T13:00:00Z" }] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_out", localDate: "2026-10-31", localTime: "23:30", note: "Forgot" });
    expect(res.status).toBe(202);
    expect(client.requested[0]).toMatchObject({ punched_at: "2026-11-01T03:30:00.000Z", punch_type: "clock_out" }); // 23:30 EDT
  });

  it("resolves the repeated fall-back hour to its first occurrence", async () => {
    const client = makeClient({ history: [{ punch_type: "clock_in", punched_at: "2026-10-31T22:00:00Z" }] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_out", localDate: "2026-11-01", localTime: "01:30", note: "Forgot" });
    expect(res.status).toBe(202);
    expect(client.requested[0].punched_at).toBe("2026-11-01T05:30:00.000Z"); // 01:30 EDT
  });

  it("uses quarter-hour offsets correctly", async () => {
    const client = makeClient({ timezone: "Asia/Kathmandu" });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_in", localDate: "2026-11-01", localTime: "07:00", note: "Forgot" });
    expect(res.status).toBe(202);
    expect(client.requested[0].punched_at).toBe("2026-11-01T01:15:00.000Z");
  });

  it("rejects a time in the future by the server's clock", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await put({ punchType: "clock_in", localDate: "2026-11-01", localTime: "10:30", note: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects malformed or impossible dates and times", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await put({ punchType: "clock_in", localDate: "2026-02-30", localTime: "09:00", note: "x" })).status).toBe(400);
    expect((await put({ punchType: "clock_in", localDate: "2026-10-31", localTime: "25:00", note: "x" })).status).toBe(400);
    expect((await put({ punchType: "clock_in", localDate: "2026-10-31", note: "x" })).status).toBe(400);
  });

  it("normalizes an ISO punchedAt instead of storing the raw client string", async () => {
    const client = makeClient({ isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_in", punchedAt: "2026-11-01T09:00:00+05:30", note: "x", employeeId: 5 });
    expect(res.status).toBe(200);
    expect(client.inserted[0].punched_at).toBe("2026-11-01T03:30:00.000Z");
  });
});

describe("PUT /api/punches — employee manual punch rules", () => {
  it("does not let an employee edit an existing punch", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await put({ id: 42, punchType: "clock_in", localDate: "2026-11-01", localTime: "08:00", note: "x" });
    expect(res.status).toBe(403);
  });

  it("requires a note from employees", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await put({ punchType: "clock_in", localDate: "2026-11-01", localTime: "08:00", note: "  " });
    expect(res.status).toBe(400);
  });

  it("blocks backdating a clock-in ahead of a real late one", async () => {
    const client = makeClient({
      history: [
        { punch_type: "clock_out", punched_at: "2026-10-31T21:00:00Z" },
        { punch_type: "clock_in", punched_at: "2026-11-01T14:30:00Z" }, // real clock-in, 9:30 EST
      ],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_in", localDate: "2026-11-01", localTime: "09:00", note: "I was here" });
    expect(res.status).toBe(409);
    expect(client.inserted).toHaveLength(0);
  });

  it("lets an employee close yesterday's open shift after clocking in today", async () => {
    const client = makeClient({
      history: [
        { punch_type: "clock_in", punched_at: "2026-10-31T13:00:00Z" },  // yesterday, never closed
        { punch_type: "clock_in", punched_at: "2026-11-01T14:00:00Z" },  // today
      ],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_out", localDate: "2026-10-31", localTime: "17:00", note: "Forgot" });
    expect(res.status).toBe(202);
    expect(client.requested[0].punched_at).toBe("2026-10-31T21:00:00.000Z");
  });

  it("files the correction for manager approval instead of creating a punch", async () => {
    vi.mocked(notifyManagers).mockClear();
    const client = makeClient({ history: [{ punch_type: "clock_in", punched_at: "2026-10-31T13:00:00Z" }] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_out", localDate: "2026-10-31", localTime: "17:00", note: " Forgot " });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ pending: true, correctionId: 99 });
    expect(client.inserted).toHaveLength(0); // no punch until a manager approves
    expect(client.requested[0]).toMatchObject({ employee_id: 5, note: "Forgot", requested_by: MOCK_USER.id });
    expect(notifyManagers).toHaveBeenCalledWith(
      MOCK_ORG_ID, "punch_correction_requested", expect.any(String),
      expect.stringContaining("clock out at 5:00 PM on Sat, Oct 31"), expect.objectContaining({ correctionId: 99 })
    );
  });
});

describe("PUT /api/punches — manager edits keep the original in the audit trail", () => {
  it("records the punch's previous values as `before`", async () => {
    const client = makeClient({
      isManager: true,
      history: [{ punch_type: "clock_in", punched_at: "2026-11-01T14:30:00Z", note: null, is_manual: false }],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ id: 7, employeeId: 5, punchType: "clock_in", localDate: "2026-11-01", localTime: "09:00", note: "Badge reader down" });
    expect(res.status).toBe(200);
    expect(client.updated[0]).toMatchObject({ punched_at: "2026-11-01T14:00:00.000Z", is_manual: true });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "punch.correction",
      before: expect.objectContaining({ punchedAt: "2026-11-01T14:30:00Z", isManual: false }),
      after: expect.objectContaining({ punchedAt: "2026-11-01T14:00:00.000Z" }),
    }));
  });
});

describe("PUT /api/punches — managers give a reason too", () => {
  const history = [{ punch_type: "clock_in", punched_at: "2026-11-01T14:30:00Z", note: null, is_manual: false }];

  it("refuses a manager's edit with no reason", async () => {
    for (const note of [undefined, "", "   "]) {
      const client = makeClient({ isManager: true, history });
      mockCreateClient.mockResolvedValue(client as any);
      const res = await put({ id: 7, employeeId: 5, punchType: "clock_in", localDate: "2026-11-01", localTime: "09:00", note });
      expect(res.status).toBe(400);
      expect(client.updated).toHaveLength(0);
    }
  });

  it("refuses a manager's new punch with no reason", async () => {
    const client = makeClient({ isManager: true, history });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ employeeId: 5, punchType: "clock_out", localDate: "2026-11-01", localTime: "09:45" });
    expect(res.status).toBe(400);
    expect(client.inserted).toHaveLength(0);
  });

  it("stores the trimmed reason as the punch's note, which 0053 copies into its history", async () => {
    const client = makeClient({ isManager: true, history });
    mockCreateClient.mockResolvedValue(client as any);
    const edit = await put({ id: 7, employeeId: 5, punchType: "clock_in", localDate: "2026-11-01", localTime: "09:00", note: "  Badge reader down " });
    expect(edit.status).toBe(200);
    expect(client.updated[0]).toMatchObject({ note: "Badge reader down" });
    const add = await put({ employeeId: 5, punchType: "clock_out", localDate: "2026-11-01", localTime: "09:45", note: "Left early, sick" });
    expect(add.status).toBe(200);
    expect(client.inserted[0]).toMatchObject({ note: "Left early, sick", is_manual: true });
  });

  it("still saves the edit when the audit log write fails, and says so in the log", async () => {
    const client = makeClient({ isManager: true, history });
    mockCreateClient.mockResolvedValue(client as any);
    mockAudit.mockResolvedValueOnce(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await put({ id: 7, employeeId: 5, punchType: "clock_in", localDate: "2026-11-01", localTime: "09:00", note: "Badge reader down" });
    expect(res.status).toBe(200);
    expect(client.updated).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("audit log NOT written for edit of punch 7"));
    errorSpy.mockRestore();
  });
});

describe("PUT /api/punches — overnight missed clock-out", () => {
  // Clocked in Oct 31 at 10 PM EDT (02:00Z Nov 1), never clocked out. It is
  // now Nov 1, 10 AM EST. The clock screen pre-fills Oct 31, the clock-in day.
  const history = [{ punch_type: "clock_in", punched_at: "2026-11-01T02:00:00Z" }];

  it("files an employee's 06:00 clock-out for the next morning, after the clock-in", async () => {
    const client = makeClient({ history });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_out", localDate: "2026-10-31", localTime: "06:00", note: "Forgot" });
    expect(res.status).toBe(202);
    expect(client.requested[0].punched_at).toBe("2026-11-01T11:00:00.000Z"); // Nov 1, 6 AM EST
  });

  it("does the same for a manager adding the punch", async () => {
    const client = makeClient({ isManager: true, history });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ employeeId: 5, punchType: "clock_out", localDate: "2026-10-31", localTime: "06:00", note: "Forgot" });
    expect(res.status).toBe(200);
    expect(client.inserted[0].punched_at).toBe("2026-11-01T11:00:00.000Z");
  });

  it("keeps a clock-out later the same evening on the day typed", async () => {
    const client = makeClient({ history });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_out", localDate: "2026-10-31", localTime: "23:30", note: "Forgot" });
    expect(res.status).toBe(202);
    expect(client.requested[0].punched_at).toBe("2026-11-01T03:30:00.000Z");
  });
});

describe("PUT /api/punches — how far back a punch can be added or fixed", () => {
  // Now is 2026-11-01T15:00Z; exactly 30 days earlier is 2026-10-02T15:00Z.
  const THIRTY_DAYS_AGO = "2026-10-02T15:00:00.000Z";
  const JUST_OVER_30_DAYS = "2026-10-02T14:59:00.000Z";

  it("lets an employee ask for a punch exactly 30 days ago", async () => {
    const client = makeClient();
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_in", punchedAt: THIRTY_DAYS_AGO, note: "Forgot" });
    expect(res.status).toBe(202);
    expect(client.requested[0].punched_at).toBe(THIRTY_DAYS_AGO);
  });

  it("refuses an employee's request a minute past 30 days", async () => {
    const client = makeClient();
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_in", punchedAt: JUST_OVER_30_DAYS, note: "Forgot" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/last 30 days/);
    expect(client.requested).toHaveLength(0);
  });

  it("refuses an employee's request typed as a store-local day 31 days ago", async () => {
    const client = makeClient();
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ punchType: "clock_in", localDate: "2026-10-01", localTime: "09:00", note: "Forgot" });
    expect(res.status).toBe(400);
    expect(client.requested).toHaveLength(0);
  });

  it("lets a manager add a punch a minute past 30 days, with a reason", async () => {
    const client = makeClient({ isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ employeeId: 5, punchType: "clock_in", punchedAt: JUST_OVER_30_DAYS, note: "Late payroll fix" });
    expect(res.status).toBe(200);
    expect(client.inserted[0]).toMatchObject({ punched_at: JUST_OVER_30_DAYS, is_manual: true, note: "Late payroll fix" });
  });

  it("lets a manager add a punch a year back, typed as a store-local time", async () => {
    const client = makeClient({ isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ employeeId: 5, punchType: "clock_in", localDate: "2025-11-03", localTime: "09:00", note: "Back pay audit" });
    expect(res.status).toBe(200);
    expect(client.inserted[0].punched_at).toBe("2025-11-03T14:00:00.000Z"); // 9:00 EST
  });

  it("lets a manager fix an existing punch older than 30 days", async () => {
    const client = makeClient({
      isManager: true,
      history: [{ punch_type: "clock_out", punched_at: "2026-08-01T21:00:00Z", note: null, is_manual: false }],
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ id: 7, employeeId: 5, punchType: "clock_out", localDate: "2026-08-01", localTime: "18:00", note: "Closed late" });
    expect(res.status).toBe(200);
    expect(client.updated[0]).toMatchObject({ punched_at: "2026-08-01T22:00:00.000Z", note: "Closed late" });
  });

  it("still requires a manager's reason for an old punch", async () => {
    const client = makeClient({ isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ employeeId: 5, punchType: "clock_in", punchedAt: "2026-06-01T13:00:00Z", note: " " });
    expect(res.status).toBe(400);
    expect(client.inserted).toHaveLength(0);
  });

  it("still refuses a manager's punch in the future", async () => {
    const client = makeClient({ isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await put({ employeeId: 5, punchType: "clock_in", punchedAt: "2026-11-01T15:01:00Z", note: "x" });
    expect(res.status).toBe(400);
    expect(client.inserted).toHaveLength(0);
  });
});
