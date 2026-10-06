import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { GET as getMissed } from "./missed/route";
import { GET as getCurrent } from "./current/route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const mockCreateClient = vi.mocked(createClient);

type Punch = { id: number; punch_type: string; punched_at: string };

// Supabase mock whose punch_records queries honour gte/lte/lt and ordering
// over `history`, so the routes see exactly what the database would return.
function makeClient(history: Punch[], settings: Record<string, string> = {}) {
  const inserted: Record<string, unknown>[] = [];
  const simple = (data: unknown) => {
    const b: any = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = vi.fn().mockReturnValue(b);
    b.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    b.then = (res: any, rej: any) => Promise.resolve({ data, error: null }).then(res, rej);
    return b;
  };
  const client = {
    inserted,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return simple(null);
      if (table === "employees") return simple({ id: 1, org_id: MOCK_ORG_ID, name: "Casey" });
      if (table === "app_settings") {
        return simple(Object.entries({ timezone: "America/New_York", ...settings }).map(([key, value]) => ({ key, value })));
      }
      if (table === "punch_records") {
        const f: { gte?: string; lte?: string; lt?: string; asc?: boolean; limit?: number } = {};
        const rows = () => {
          let r = history.map((p) => ({ employee_id: 1, ...p })).filter((p) =>
            (!f.gte || p.punched_at >= f.gte) && (!f.lte || p.punched_at <= f.lte) && (!f.lt || p.punched_at < f.lt));
          r = [...r].sort((a, b) => a.punched_at.localeCompare(b.punched_at));
          if (f.asc === false) r.reverse();
          return f.limit ? r.slice(0, f.limit) : r;
        };
        const b: any = {};
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        b.gte = vi.fn().mockImplementation((_c: string, v: string) => { f.gte = new Date(v).toISOString(); return b; });
        b.lte = vi.fn().mockImplementation((_c: string, v: string) => { f.lte = new Date(v).toISOString(); return b; });
        b.lt = vi.fn().mockImplementation((_c: string, v: string) => { f.lt = new Date(v).toISOString(); return b; });
        b.order = vi.fn().mockImplementation((_c: string, o?: { ascending?: boolean }) => { f.asc = o?.ascending ?? true; return b; });
        b.limit = vi.fn().mockImplementation((n: number) => { f.limit = n; return b; });
        b.maybeSingle = vi.fn().mockImplementation(async () => ({ data: rows()[0] ?? null, error: null }));
        b.insert = vi.fn().mockImplementation((row: Record<string, unknown>) => { inserted.push(row); return b; });
        b.single = vi.fn().mockImplementation(async () => ({
          data: { id: 99, employee_id: 1, punched_at: new Date().toISOString(), is_manual: false, ...inserted[inserted.length - 1] },
          error: null,
        }));
        b.then = (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
        return b;
      }
      return simple(null);
    }),
  };
  return client;
}

const punch = (punchType: string) =>
  POST(new Request("http://localhost/api/punches", { method: "POST", body: JSON.stringify({ punchType }) }));
const req = () => new Request("http://localhost/api/punches/missed");

// Casey closes on Jan 15 (New York, EST): clocked in at 4:00 PM.
const CLOSER: Punch[] = [{ id: 1, punch_type: "clock_in", punched_at: "2026-01-15T21:00:00.000Z" }];

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("closing past midnight", () => {
  it("lets the closer clock out at 12:30 AM", async () => {
    vi.setSystemTime(new Date("2026-01-16T05:30:00Z"));
    const client = makeClient(CLOSER);
    mockCreateClient.mockResolvedValue(client as any);
    const res = await punch("clock_out");
    expect(res.status).toBe(201);
    expect(client.inserted[0]).toMatchObject({ punch_type: "clock_out", employee_id: 1 });
  });

  it("lets the closer take and end a break after midnight", async () => {
    vi.setSystemTime(new Date("2026-01-16T05:10:00Z"));
    mockCreateClient.mockResolvedValue(makeClient(CLOSER) as any);
    expect((await punch("break_start")).status).toBe(201);
    mockCreateClient.mockResolvedValue(makeClient([
      ...CLOSER, { id: 2, punch_type: "break_start", punched_at: "2026-01-16T05:10:00.000Z" },
    ]) as any);
    vi.setSystemTime(new Date("2026-01-16T05:25:00Z"));
    expect((await punch("break_end")).status).toBe(201);
  });

  it("counts breaks from before midnight toward the per-shift limit", async () => {
    vi.setSystemTime(new Date("2026-01-16T05:30:00Z"));
    mockCreateClient.mockResolvedValue(makeClient([
      ...CLOSER,
      { id: 2, punch_type: "break_start", punched_at: "2026-01-16T01:00:00.000Z" },
      { id: 3, punch_type: "break_end", punched_at: "2026-01-16T01:30:00.000Z" },
    ], { punch_max_breaks_per_shift: "1" }) as any);
    const res = await punch("break_start");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Break limit/);
  });

  it("won't start a new shift while yesterday's is still open after midnight", async () => {
    vi.setSystemTime(new Date("2026-01-16T05:30:00Z"));
    mockCreateClient.mockResolvedValue(makeClient(CLOSER) as any);
    const res = await punch("clock_in");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still clocked in from your shift that started yesterday/);
  });
});

describe("forgotten clock-outs don't block the next day", () => {
  it("allows clocking in the next morning", async () => {
    vi.setSystemTime(new Date("2026-01-16T12:00:00Z")); // 7:00 AM
    const client = makeClient(CLOSER);
    mockCreateClient.mockResolvedValue(client as any);
    expect((await punch("clock_in")).status).toBe(201);
  });

  it("no longer accepts a clock-out for the old shift after the grace window", async () => {
    vi.setSystemTime(new Date("2026-01-16T12:00:00Z"));
    mockCreateClient.mockResolvedValue(makeClient(CLOSER) as any);
    const res = await punch("clock_out");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no active clock-in/);
  });
});

describe("missed-punch banner", () => {
  it("doesn't flag a closer's shift that's still open after midnight", async () => {
    vi.setSystemTime(new Date("2026-01-16T05:30:00Z"));
    mockCreateClient.mockResolvedValue(makeClient(CLOSER) as any);
    expect(await (await getMissed(req())).json()).toEqual({ missedPunch: null });
  });

  it("doesn't flag a shift that was clocked out after midnight", async () => {
    vi.setSystemTime(new Date("2026-01-16T15:00:00Z"));
    mockCreateClient.mockResolvedValue(makeClient([
      ...CLOSER, { id: 2, punch_type: "clock_out", punched_at: "2026-01-16T05:30:00.000Z" },
    ]) as any);
    expect(await (await getMissed(req())).json()).toEqual({ missedPunch: null });
  });

  it("still flags a genuinely forgotten clock-out", async () => {
    vi.setSystemTime(new Date("2026-01-16T15:00:00Z"));
    mockCreateClient.mockResolvedValue(makeClient(CLOSER) as any);
    const body = await (await getMissed(req())).json();
    expect(body.missedPunch).toMatchObject({ date: "2026-01-15", lastPunchType: "clock_in", suggestedPunchType: "clock_out" });
  });
});

describe("GET /api/punches/current", () => {
  it("returns the open shift from before midnight", async () => {
    vi.setSystemTime(new Date("2026-01-16T05:30:00Z"));
    mockCreateClient.mockResolvedValue(makeClient(CLOSER) as any);
    const body = await (await getCurrent(new Request("http://localhost/api/punches/current"))).json();
    expect(body.carriedOver).toBe(true);
    expect(body.punches).toEqual([expect.objectContaining({ id: 1, punchType: "clock_in", employeeId: 1 })]);
  });

  it("returns nothing for a forgotten shift", async () => {
    vi.setSystemTime(new Date("2026-01-16T12:00:00Z"));
    mockCreateClient.mockResolvedValue(makeClient(CLOSER) as any);
    const body = await (await getCurrent(new Request("http://localhost/api/punches/current"))).json();
    expect(body).toEqual({ carriedOver: false, punches: [] });
  });
});
