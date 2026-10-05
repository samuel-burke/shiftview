import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { writeAuditLog } from "@/lib/audit";
import { notifyManagers } from "@/lib/notify";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
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
      expect.anything(), MOCK_ORG_ID, "punch_correction_requested", expect.any(String),
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
