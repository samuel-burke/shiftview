// POST /api/punches: what an employee can send with a live punch beyond its
// type (a note), and the geofence rules.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(true) }));
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

function builder(result: { data: unknown; error: unknown }) {
  const b: any = {};
  for (const m of ["select", "insert", "eq", "gt", "gte", "lte", "lt", "order", "limit", "is", "in"]) b[m] = vi.fn().mockReturnValue(b);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.single = vi.fn().mockResolvedValue(result);
  b.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return b;
}

type Punch = { punch_type: string; punched_at: string; break_paid?: boolean };

// A signed-in employee (id 1) of MOCK_ORG_ID. `settings` are app_settings
// rows; `today` the employee's punches in the current-shift window. Every
// insert into punch_records is captured; `insertError` makes it fail.
function makeClient({
  settings = {} as Record<string, string>,
  today = [] as Punch[],
  insertError = null as unknown,
  tables = {} as Record<string, unknown>,
  rpc = {} as Record<string, unknown>,
} = {}) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    inserted,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    rpc: vi.fn().mockImplementation((fn: string) => Promise.resolve({ data: rpc[fn] ?? [], error: null })),
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ data: null, error: null });
      if (table === "employees") return builder({ data: { id: 1, org_id: MOCK_ORG_ID, name: "Tess" }, error: null });
      if (table === "app_settings")
        return builder({ data: Object.entries({ timezone: "America/New_York", ...settings }).map(([key, value]) => ({ key, value })), error: null });
      if (table in tables) return builder({ data: tables[table], error: null });
      if (table === "punch_records") {
        const b = builder({ data: today, error: null });
        b.insert = vi.fn((row: Record<string, unknown>) => { inserted.push(row); return b; });
        b.single = vi.fn().mockImplementation(() => Promise.resolve(insertError
          ? { data: null, error: insertError }
          : {
              data: {
                id: 9, employee_id: 1, schedule_id: null, punched_at: new Date().toISOString(),
                is_manual: false, note: null, ...inserted[inserted.length - 1],
              },
              error: null,
            }));
        return b;
      }
      return builder({ data: null, error: null });
    }),
  };
  return client;
}

function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/punches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => vi.clearAllMocks());

describe("POST /api/punches — an employee's note on a live punch", () => {
  it("stores the cleaned note with the punch and returns it", async () => {
    const client = makeClient();
    mockCreateClient.mockResolvedValue(client as any);
    const res = await post({ punchType: "clock_in", note: "  covering\u200B for   Sam \n" });
    expect(res.status).toBe(201);
    expect(client.inserted[0]).toMatchObject({ punch_type: "clock_in", employee_note: "covering for Sam" });
    expect((await res.json()).employeeNote).toBe("covering for Sam");
  });

  it("never puts the employee's note in `note`, which is a manager's reason", async () => {
    const client = makeClient();
    mockCreateClient.mockResolvedValue(client as any);
    await post({ punchType: "clock_in", note: "hi" });
    expect(client.inserted[0]).not.toHaveProperty("note");
    expect(client.inserted[0]).not.toHaveProperty("is_manual");
  });

  it("stores no note when none, or only whitespace, is sent", async () => {
    for (const note of [undefined, null, "", "   \u200B "]) {
      const client = makeClient();
      mockCreateClient.mockResolvedValue(client as any);
      const res = await post({ punchType: "clock_in", note });
      expect(res.status).toBe(201);
      expect(client.inserted[0].employee_note).toBeNull();
    }
  });

  it("accepts a 140-character note and refuses a 141-character one", async () => {
    const ok = makeClient();
    mockCreateClient.mockResolvedValue(ok as any);
    expect((await post({ punchType: "clock_in", note: "n".repeat(140) })).status).toBe(201);

    const tooLong = makeClient();
    mockCreateClient.mockResolvedValue(tooLong as any);
    const res = await post({ punchType: "clock_in", note: "n".repeat(141) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/140 characters/);
    expect(tooLong.inserted).toHaveLength(0);
  });

  it("refuses a note that isn't a string", async () => {
    const client = makeClient();
    mockCreateClient.mockResolvedValue(client as any);
    const res = await post({ punchType: "clock_in", note: { text: "x" } });
    expect(res.status).toBe(400);
    expect(client.inserted).toHaveLength(0);
  });

  it("takes a note on a break or clock-out too", async () => {
    const client = makeClient({ today: [{ punch_type: "clock_in", punched_at: minutesAgo(60) }] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await post({ punchType: "clock_out", note: "Left at close" });
    expect(res.status).toBe(201);
    expect(client.inserted[0]).toMatchObject({ punch_type: "clock_out", employee_note: "Left at close" });
  });
});

describe("POST /api/punches — the geofence applies with or without 'Require GPS'", () => {
  // 100m around lower Manhattan.
  const fence = (gpsRequired: boolean, extra: Record<string, string> = {}) => ({
    gps_required: String(gpsRequired),
    geofence_enabled: "true",
    geofence_lat: "40.7128",
    geofence_lng: "-74.006",
    geofence_radius: "100",
    ...extra,
  });
  const INSIDE = { lat: 40.7129, lng: -74.0061 };
  const OUTSIDE = { lat: 40.73, lng: -74.006 }; // about 2 km north

  for (const gpsRequired of [true, false]) {
    describe(`GPS ${gpsRequired ? "required" : "not required"}`, () => {
      it("accepts a clock-in inside the fence", async () => {
        const client = makeClient({ settings: fence(gpsRequired) });
        mockCreateClient.mockResolvedValue(client as any);
        const res = await post({ punchType: "clock_in", ...INSIDE });
        expect(res.status).toBe(201);
        expect(client.inserted[0]).toMatchObject(INSIDE);
      });

      it("refuses a clock-in outside the fence", async () => {
        const client = makeClient({ settings: fence(gpsRequired) });
        mockCreateClient.mockResolvedValue(client as any);
        const res = await post({ punchType: "clock_in", ...OUTSIDE });
        expect(res.status).toBe(422);
        expect((await res.json()).error).toMatch(/Outside geofence/);
        expect(client.inserted).toHaveLength(0);
      });

      it("refuses a clock-in with no location and says location is needed", async () => {
        const client = makeClient({ settings: fence(gpsRequired) });
        mockCreateClient.mockResolvedValue(client as any);
        const res = await post({ punchType: "clock_in" });
        expect(res.status).toBe(422);
        expect((await res.json()).error).toMatch(/Location needed/);
        expect(client.inserted).toHaveLength(0);
      });

      it("fails closed on a misconfigured centre", async () => {
        const client = makeClient({ settings: fence(gpsRequired, { geofence_lat: "nope" }) });
        mockCreateClient.mockResolvedValue(client as any);
        const res = await post({ punchType: "clock_in", ...INSIDE });
        expect(res.status).toBe(422);
        expect((await res.json()).error).toMatch(/misconfigured/);
      });
    });
  }

  it("doesn't fence a break", async () => {
    const client = makeClient({ settings: fence(false), today: [{ punch_type: "clock_in", punched_at: minutesAgo(30) }] });
    mockCreateClient.mockResolvedValue(client as any);
    expect((await post({ punchType: "break_start" })).status).toBe(201);
  });

  it("lets a clock-in without location through when the geofence is off, GPS required or not", async () => {
    for (const gpsRequired of [true, false]) {
      const client = makeClient({ settings: fence(gpsRequired, { geofence_enabled: "false" }) });
      mockCreateClient.mockResolvedValue(client as any);
      expect((await post({ punchType: "clock_in" })).status).toBe(201);
    }
  });

  it("lets a clock-in without location through when no centre has been saved", async () => {
    const client = makeClient({ settings: fence(false, { geofence_lat: "", geofence_lng: "" }) });
    mockCreateClient.mockResolvedValue(client as any);
    expect((await post({ punchType: "clock_in" })).status).toBe(201);
  });

  it("maps the database's own refusal (GF002) to 422", async () => {
    const client = makeClient({
      settings: { geofence_enabled: "false" },
      insertError: { code: "GF002", message: "Location needed to clock in" },
    });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await post({ punchType: "clock_in" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Location needed/);
  });
});
