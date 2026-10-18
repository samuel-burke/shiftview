import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST as identify } from "./identify/route";
import { POST as punch } from "./punch/route";
import { GET as status } from "./status/route";
import { createAdminClient } from "@/lib/supabase-admin";
import { writeAuditLog } from "@/lib/audit";
import { notifyManagers } from "@/lib/notify";
import { hashKioskToken, KIOSK_COOKIE, newKioskToken } from "@/lib/kiosk-server";
import { todayKeyInTz, zonedTimeToUtc } from "@/lib/dates";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn().mockResolvedValue(undefined) }));

const mockAdmin = vi.mocked(createAdminClient);
const ORG = "11111111-1111-1111-1111-111111111111";
const TOKEN = newKioskToken();
const TZ = "America/New_York";

type Punch = { punch_type: string; punched_at: string };

// A fake service-role client: kiosk_identify answers `identifyResult`; the
// employee's punches since yesterday are `punches`; the insert answers
// `insertResult`.
function makeAdmin({
  identifyResult = { status: "ok", org_id: ORG, kiosk_id: 7, employee_id: 42, employee_name: "Erin One" } as Record<string, unknown>,
  statusResult = { status: "ok", org_id: ORG, kiosk_id: 7, kiosk_name: "Front counter", org_name: "Alder Street" } as Record<string, unknown>,
  punches = [] as Punch[],
  settings = [{ key: "timezone", value: TZ }] as { key: string; value: string }[],
  schedules = [] as Record<string, unknown>[],
  insertResult = { data: { id: 900, punch_type: "clock_in", punched_at: new Date().toISOString() }, error: null } as { data: any; error: any },
  rpcError = null as any,
} = {}) {
  const inserts: Record<string, unknown>[] = [];
  const queries: { table: string; eqs: [string, unknown][] }[] = [];
  const rpc = vi.fn(async (fn: string) => {
    if (rpcError) return { data: null, error: rpcError };
    if (fn === "kiosk_identify") return { data: identifyResult, error: null };
    if (fn === "kiosk_status") return { data: statusResult, error: null };
    return { data: null, error: { message: "unexpected rpc " + fn } };
  });
  const from = vi.fn((table: string) => {
    const q = { table, eqs: [] as [string, unknown][] };
    queries.push(q);
    const b: any = {};
    for (const m of ["select", "gte", "lte", "lt", "gt", "order", "limit"]) b[m] = vi.fn(() => b);
    b.eq = vi.fn((c: string, v: unknown) => { q.eqs.push([c, v]); return b; });
    b.insert = vi.fn((row: Record<string, unknown>) => { inserts.push(row); return b; });
    b.single = vi.fn(async () => insertResult);
    b.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const list = table === "app_settings" ? settings
      : table === "punch_records" ? punches.map((p, i) => ({ id: i + 1, employee_id: 42, ...p }))
      : table === "schedules" ? schedules : [];
    b.then = (res: any, rej: any) => Promise.resolve({ data: list, error: null }).then(res, rej);
    return b;
  });
  const client = { rpc, from };
  mockAdmin.mockReturnValue(client as any);
  return { client, rpc, from, inserts, queries };
}

function req(path: string, body?: unknown, { token = TOKEN as string | null, raw }: { token?: string | null; raw?: string } = {}) {
  return new Request(`https://app.test/api/kiosk/${path}`, {
    method: body === undefined && raw === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { cookie: `${KIOSK_COOKIE}=${token}` } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

// ── /api/kiosk/identify ──────────────────────────────────────────────────────

describe("POST /api/kiosk/identify", () => {
  it("without a kiosk cookie: 401, and the database is never asked", async () => {
    const { rpc } = makeAdmin();
    const res = await identify(req("identify", { pin: "4821" }, { token: null }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_kiosk");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a cookie that isn't a token we issued is refused before the database", async () => {
    const { rpc } = makeAdmin();
    const res = await identify(req("identify", { pin: "4821" }, { token: "x".repeat(10) }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the database the token's hash, never the token", async () => {
    const { rpc } = makeAdmin();
    await identify(req("identify", { pin: "4821" }));
    expect(rpc).toHaveBeenCalledWith("kiosk_identify", { p_token_hash: hashKioskToken(TOKEN), p_pin: "4821" });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
  });

  it("a malformed PIN still goes to the database, which counts it as a wrong attempt", async () => {
    const { rpc } = makeAdmin({ identifyResult: { status: "wrong", attempts_left: 4 } });
    const res = await identify(req("identify", { pin: 1234 }));
    expect(res.status).toBe(401);
    expect(rpc).toHaveBeenCalledWith("kiosk_identify", expect.objectContaining({ p_pin: "" }));
  });

  it("a very long PIN is cut before it reaches the hash", async () => {
    const { rpc } = makeAdmin({ identifyResult: { status: "wrong", attempts_left: 4 } });
    await identify(req("identify", { pin: "9".repeat(5000) }));
    expect((rpc.mock.calls[0] as any)[1].p_pin).toHaveLength(16);
  });

  it("returns 400 for a malformed body without spending an attempt", async () => {
    const { rpc } = makeAdmin();
    const res = await identify(req("identify", undefined, { raw: "{pin:" }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the right PIN: the employee's own name, state and next punches — nothing else", async () => {
    makeAdmin({ punches: [{ punch_type: "clock_in", punched_at: ago(90) }] });
    const res = await identify(req("identify", { pin: "4821" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ employeeName: "Erin One", state: "on_shift", actions: ["break_start", "clock_out"] });
    expect(Math.abs(new Date(body.since).getTime() - (Date.now() - 90 * 60_000))).toBeLessThan(5_000);
    expect(Object.keys(body).sort()).toEqual(["actions", "employeeName", "since", "state"]);
  });

  it("loads punches for the PIN's employee in the PIN's store only", async () => {
    const { queries } = makeAdmin();
    await identify(req("identify", { pin: "4821" }));
    const pq = queries.find((q) => q.table === "punch_records")!;
    expect(pq.eqs).toEqual(expect.arrayContaining([["org_id", ORG], ["employee_id", 42]]));
    for (const q of queries) expect(q.eqs).toContainEqual(["org_id", ORG]);
  });

  it("clocked out: offers clock in only, with no since", async () => {
    makeAdmin({ punches: [{ punch_type: "clock_in", punched_at: ago(300) }, { punch_type: "clock_out", punched_at: ago(10) }] });
    const body = await (await identify(req("identify", { pin: "4821" }))).json();
    expect(body).toMatchObject({ state: "clocked_out", actions: ["clock_in"], since: null });
  });

  it("on break: offers end break only", async () => {
    makeAdmin({ punches: [{ punch_type: "clock_in", punched_at: ago(120) }, { punch_type: "break_start", punched_at: ago(5) }] });
    const body = await (await identify(req("identify", { pin: "4821" }))).json();
    expect(body).toMatchObject({ state: "on_break", actions: ["break_end"] });
  });

  it("a wrong PIN (unknown, another store's, an archived employee's): one generic 401", async () => {
    makeAdmin({ identifyResult: { status: "wrong", attempts_left: 2 } });
    const res = await identify(req("identify", { pin: "6284" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "PIN not recognized", code: "wrong_pin", attemptsLeft: 2 });
  });

  it("the attempt that locks the kiosk is audited", async () => {
    makeAdmin({ identifyResult: { status: "wrong", attempts_left: 0 } });
    const res = await identify(req("identify", { pin: "0007" }));
    expect(res.status).toBe(401);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "kiosk.locked", orgId: ORG, resourceId: "7" }));
  });

  it("locked: 429 with Retry-After, and no employee data", async () => {
    const { from } = makeAdmin({ identifyResult: { status: "locked", needs_manager: false, retry_after: 200 } });
    const res = await identify(req("identify", { pin: "4821" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("200");
    expect(from).not.toHaveBeenCalled();
  });

  it("locked for the day: 423 until a manager unlocks", async () => {
    makeAdmin({ identifyResult: { status: "locked", needs_manager: true } });
    const res = await identify(req("identify", { pin: "4821" }));
    expect(res.status).toBe(423);
  });

  it("a revoked kiosk's token: 401 no_kiosk", async () => {
    makeAdmin({ identifyResult: { status: "no_kiosk" } });
    const res = await identify(req("identify", { pin: "4821" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_kiosk");
  });

  it("kiosk mode off: 403", async () => {
    makeAdmin({ identifyResult: { status: "disabled" } });
    expect((await identify(req("identify", { pin: "4821" }))).status).toBe(403);
  });

  it("a database error is a 500 with nothing leaked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    makeAdmin({ rpcError: { message: "boom", code: "XX000" } });
    const res = await identify(req("identify", { pin: "4821" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

// ── /api/kiosk/punch ─────────────────────────────────────────────────────────

describe("POST /api/kiosk/punch", () => {
  it("an unknown punchType is 400 and costs no PIN attempt", async () => {
    const { rpc } = makeAdmin();
    const res = await punch(req("punch", { pin: "4821", punchType: "super_punch" }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("checks the PIN again with the punch, and a wrong one writes nothing", async () => {
    const { rpc, inserts } = makeAdmin({ identifyResult: { status: "wrong", attempts_left: 3 } });
    const res = await punch(req("punch", { pin: "1357", punchType: "clock_in" }));
    expect(res.status).toBe(401);
    expect(rpc).toHaveBeenCalledWith("kiosk_identify", { p_token_hash: hashKioskToken(TOKEN), p_pin: "1357" });
    expect(inserts).toHaveLength(0);
  });

  it("a revoked kiosk writes nothing", async () => {
    const { inserts } = makeAdmin({ identifyResult: { status: "no_kiosk" } });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("without a cookie writes nothing", async () => {
    const { inserts, rpc } = makeAdmin();
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }, { token: null }))).status).toBe(401);
    expect(inserts).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("locked: 429 and nothing written", async () => {
    const { inserts } = makeAdmin({ identifyResult: { status: "locked", needs_manager: false, retry_after: 60 } });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(429);
    expect(inserts).toHaveLength(0);
  });

  it("writes a kiosk punch: the PIN's employee and store, source kiosk, the kiosk id, no time or GPS from the client", async () => {
    const { inserts } = makeAdmin();
    const res = await punch(req("punch", {
      pin: "4821", punchType: "clock_in",
      // Ignored: the store, employee, time and location never come from the kiosk.
      orgId: "22222222-2222-2222-2222-222222222222", employeeId: 1, punchedAt: "2020-01-01T00:00:00Z", lat: 1, lng: 2,
    }));
    expect(res.status).toBe(201);
    expect(inserts).toEqual([{
      org_id: ORG, employee_id: 42, schedule_id: null, punch_type: "clock_in", source: "kiosk", kiosk_id: 7,
    }]);
    expect(await res.json()).toMatchObject({ employeeName: "Erin One", punchType: "clock_in", state: "on_shift" });
  });

  it("refuses a second clock-in with a readable 409 and writes nothing", async () => {
    const { inserts } = makeAdmin({ punches: [{ punch_type: "clock_in", punched_at: ago(30) }] });
    const res = await punch(req("punch", { pin: "4821", punchType: "clock_in" }));
    expect(res.status).toBe(409);
    expect(inserts).toHaveLength(0);
  });

  it("refuses a break end without a break", async () => {
    const { inserts } = makeAdmin({ punches: [{ punch_type: "clock_in", punched_at: ago(30) }] });
    expect((await punch(req("punch", { pin: "4821", punchType: "break_end" }))).status).toBe(409);
    expect(inserts).toHaveLength(0);
  });

  it("refuses a clock-out when not clocked in", async () => {
    const { inserts } = makeAdmin();
    const res = await punch(req("punch", { pin: "4821", punchType: "clock_out" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not clocked in/);
    expect(inserts).toHaveLength(0);
  });

  it("applies the store's break cap", async () => {
    const { inserts } = makeAdmin({
      settings: [{ key: "timezone", value: TZ }, { key: "punch_max_breaks_per_shift", value: "1" }],
      punches: [
        { punch_type: "clock_in", punched_at: ago(240) },
        { punch_type: "break_start", punched_at: ago(120) },
        { punch_type: "break_end", punched_at: ago(100) },
      ],
    });
    const res = await punch(req("punch", { pin: "4821", punchType: "break_start" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Break limit/);
    expect(inserts).toHaveLength(0);
  });

  it("a punch that lost a race in the database (23P01) is 409", async () => {
    makeAdmin({ insertResult: { data: null, error: { code: "23P01", message: "conflict" } } });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(409);
  });

  it("a kiosk revoked between the PIN and the punch (KP001) is 401", async () => {
    makeAdmin({ insertResult: { data: null, error: { code: "KP001", message: "not active" } } });
    const res = await punch(req("punch", { pin: "4821", punchType: "clock_in" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("no_kiosk");
  });

  it("an archived employee (0054, 42501) is 403", async () => {
    makeAdmin({ insertResult: { data: null, error: { code: "42501", message: "archived" } } });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(403);
  });

  it("any other database error is a 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    makeAdmin({ insertResult: { data: null, error: { code: "XX000", message: "boom" } } });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(500);
  });

  it("books a clock-in against the employee's shift running now", async () => {
    const today = todayKeyInTz(TZ);
    const nowMin = Math.round((Date.now() - zonedTimeToUtc(today, 0, TZ).getTime()) / 60_000);
    const start = Math.max(1, nowMin - 30);
    const { inserts } = makeAdmin({
      schedules: [{ id: 55, employee_id: 42, date: today, start_minutes: start, end_minutes: start + 240 }],
    });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(201);
    expect(inserts[0].schedule_id).toBe(55);
  });

  it("alerts managers of a late clock-in, as the phone clock does", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(zonedTimeToUtc(todayKeyInTz(TZ), 600, TZ)); // 10:00 store time
    const today = todayKeyInTz(TZ);
    makeAdmin({
      settings: [{ key: "timezone", value: TZ }],
      schedules: [{ id: 56, employee_id: 42, date: today, start_minutes: 540, end_minutes: 1020 }], // 9:00
      insertResult: { data: { id: 901, punch_type: "clock_in", punched_at: new Date().toISOString() }, error: null },
    });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(201);
    expect(notifyManagers).toHaveBeenCalledWith(ORG, "late_clock_in", "Late Clock-In", expect.stringContaining("60m late at the kiosk"), expect.objectContaining({ scheduleId: 56 }));
  });

  it.each([
    ["the spring-forward day", "2026-03-08"],
    ["the fall-back day", "2026-11-01"],
  ])("on %s, books the clock-in to that store day's shift and measures lateness in store time", async (_label, day) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(zonedTimeToUtc(day, 600, TZ)); // 10:00 store time
    const { inserts } = makeAdmin({
      schedules: [
        { id: 70, employee_id: 42, date: day, start_minutes: 540, end_minutes: 1020 },
        // An old shift: not one a clock-in now is for.
        { id: 69, employee_id: 42, date: "2026-01-01", start_minutes: 540, end_minutes: 1020 },
      ],
      insertResult: { data: { id: 902, punch_type: "clock_in", punched_at: new Date().toISOString() }, error: null },
    });
    expect((await punch(req("punch", { pin: "4821", punchType: "clock_in" }))).status).toBe(201);
    expect(inserts[0].schedule_id).toBe(70);
    expect(notifyManagers).toHaveBeenCalledWith(ORG, "late_clock_in", "Late Clock-In", expect.stringContaining("60m late"), expect.anything());
  });

  it("audits the punch as a kiosk punch with no user actor", async () => {
    makeAdmin();
    await punch(req("punch", { pin: "4821", punchType: "clock_in" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "punch.clock_in", orgId: ORG, actorId: null,
      metadata: expect.objectContaining({ source: "kiosk", kioskId: 7, employeeId: 42 }),
    }));
  });
});

// ── /api/kiosk/status ────────────────────────────────────────────────────────

describe("GET /api/kiosk/status", () => {
  it("names the kiosk and store for a working kiosk", async () => {
    const { rpc } = makeAdmin();
    const res = await status(req("status"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kioskName: "Front counter", orgName: "Alder Street" });
    expect(rpc).toHaveBeenCalledWith("kiosk_status", { p_token_hash: hashKioskToken(TOKEN) });
  });

  it("no cookie: 401 without asking the database", async () => {
    const { rpc } = makeAdmin();
    expect((await status(req("status", undefined, { token: null }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a revoked kiosk: 401, and the useless cookie is cleared", async () => {
    makeAdmin({ statusResult: { status: "no_kiosk" } });
    const res = await status(req("status"));
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toMatch(new RegExp(`^${KIOSK_COOKIE}=;.*Max-Age=0`));
  });

  it("kiosk mode off: 403, cookie kept (turning it back on revives the kiosk)", async () => {
    makeAdmin({ statusResult: { status: "disabled" } });
    const res = await status(req("status"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});
