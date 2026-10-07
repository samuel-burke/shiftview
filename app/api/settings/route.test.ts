import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";
import { DEFAULT_PUNCH_POLICY } from "@/lib/punch-policy";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";

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

const MOCK_DB_SETTINGS = [
  { key: "first_day_of_week", value: "1" },
  { key: "timezone",          value: "America/Chicago" },
];

// ── GET /api/settings ─────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  it("returns 401 for unauthenticated users without querying the DB", async () => {
    const client = makeSupabaseClient({ user: null });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(client.from).not.toHaveBeenCalledWith("app_settings");
  });

  it("returns parsed settings including timezone from the database for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: MOCK_DB_SETTINGS }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      coverageAlertsEnabled: true,
      emailNotifications: false,
      firstDayOfWeek: 1,
      timezone: "America/Chicago",
      manualPunchesEnabled: true,
      gpsRequired: false,
      geofenceEnabled: false,
      geofenceLat: null,
      geofenceLng: null,
      geofenceRadius: 100,
      geofenceAddress: null,
      punchPolicy: DEFAULT_PUNCH_POLICY,
      schedulingRules: DEFAULT_SCHEDULING_RULES,
    });
    expect(body).not.toHaveProperty("optimalCoverage");
    expect(body).not.toHaveProperty("minCoverage");
  });

  it("returns the scheduling rules parsed from sched_* settings", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryData: [
          { key: "sched_min_rest_minutes", value: "720" },
          { key: "sched_pt_max_hours", value: "24" },
        ],
      }) as any
    );
    const res = await GET();
    expect((await res.json()).schedulingRules).toEqual({
      ...DEFAULT_SCHEDULING_RULES,
      minRestMinutes: 720,
      partTimeMaxHours: 24,
    });
  });

  it("returns default timezone when not set in database", async () => {
    const noTz = MOCK_DB_SETTINGS.filter((r) => r.key !== "timezone");
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: noTz }) as any
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).timezone).toBe("America/New_York");
  });


  it("returns default values when the table is empty for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: [] }) as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      coverageAlertsEnabled: true,
      emailNotifications: false,
      firstDayOfWeek: 6,
      timezone: "America/New_York",
      manualPunchesEnabled: true,
      gpsRequired: false,
      geofenceEnabled: false,
      geofenceLat: null,
      geofenceLng: null,
      geofenceRadius: 100,
      geofenceAddress: null,
      punchPolicy: DEFAULT_PUNCH_POLICY,
      schedulingRules: DEFAULT_SCHEDULING_RULES,
    });
    expect(body).not.toHaveProperty("optimalCoverage");
    expect(body).not.toHaveProperty("minCoverage");
  });

  it("returns manualPunchesEnabled=false and gpsRequired=true when set in DB", async () => {
    const dbSettings = [
      ...MOCK_DB_SETTINGS,
      { key: "manual_punches_enabled", value: "false" },
      { key: "gps_required",           value: "true"  },
    ];
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: dbSettings }) as any
    );
    const res = await GET();
    const body = await res.json();
    expect(body.manualPunchesEnabled).toBe(false);
    expect(body.gpsRequired).toBe(true);
  });

  it("returns 500 on database error for authenticated users", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryError: { message: "db error" } }) as any
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ── PUT /api/settings ─────────────────────────────────────────────────────────

describe("PUT /api/settings", () => {
  function putReq(body: unknown) {
    return new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }) as any
    );
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(403);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("returns 400 when no recognized fields are provided", async () => {
    const res = await PUT(putReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("No valid fields") });
  });

  it("returns 400 when firstDayOfWeek is out of range (> 6)", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 7 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("firstDayOfWeek") });
  });

  it("returns 400 when firstDayOfWeek is negative", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when firstDayOfWeek is a float", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 1.5 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when unknown-only fields are provided (optimalCoverage is no longer a field)", async () => {
    const res = await PUT(putReq({ optimalCoverage: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("No valid fields") });
  });

  it("returns 400 when only removed fields are provided (minCoverage is no longer a field)", async () => {
    const res = await PUT(putReq({ minCoverage: -1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("No valid fields") });
  });

  it("accepts firstDayOfWeek of 0 (Sunday)", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 0 }));
    expect(res.status).toBe(200);
  });

  it("accepts firstDayOfWeek of 6 (Saturday)", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 6 }));
    expect(res.status).toBe(200);
  });

  // ── Success ─────────────────────────────────────────────────────────────────

  it("returns 200 when updating a single field", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 when updating multiple fields at once", async () => {
    const res = await PUT(putReq({ firstDayOfWeek: 1, coverageAlertsEnabled: true, emailNotifications: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 when updating timezone", async () => {
    const res = await PUT(putReq({ timezone: "America/Los_Angeles" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 400 when timezone is an empty string", async () => {
    const res = await PUT(putReq({ timezone: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("timezone") });
  });

  it("returns 400 when timezone is not a string", async () => {
    const res = await PUT(putReq({ timezone: 42 }));
    expect(res.status).toBe(400);
  });

  it("returns 422 when timezone is not a valid IANA identifier", async () => {
    const res = await PUT(putReq({ timezone: "Not/Real" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/IANA|valid/i) });
  });

  // ── manualPunchesEnabled / gpsRequired ─────────────────────────────────────

  it("returns 200 when updating manualPunchesEnabled to false", async () => {
    const res = await PUT(putReq({ manualPunchesEnabled: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 400 when manualPunchesEnabled is not a boolean", async () => {
    const res = await PUT(putReq({ manualPunchesEnabled: "yes" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("manualPunchesEnabled") });
  });

  it("returns 200 when updating gpsRequired to true", async () => {
    const res = await PUT(putReq({ gpsRequired: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 400 when gpsRequired is not a boolean", async () => {
    const res = await PUT(putReq({ gpsRequired: 1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("gpsRequired") });
  });

  // ── Scheduling rules ─────────────────────────────────────────────────────────

  function upsertedRows(client: ReturnType<typeof makeSupabaseClient>) {
    const results = (client.from as ReturnType<typeof vi.fn>).mock.results;
    for (const r of results) {
      const calls = (r.value.upsert as ReturnType<typeof vi.fn>).mock.calls;
      if (calls.length) return calls[0][0] as { key: string; value: string }[];
    }
    return [];
  }

  it("saves a valid schedulingRules patch as sched_* rows", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, queryData: [] });
    mockCreateClient.mockResolvedValue(client as any);
    const res = await PUT(putReq({ schedulingRules: { maxShiftMinutes: 600, overtimePolicy: "when_needed" } }));
    expect(res.status).toBe(200);
    expect(upsertedRows(client)).toEqual([
      { key: "sched_max_shift_minutes", value: "600", org_id: MOCK_ORG_ID },
      { key: "sched_overtime_policy", value: "when_needed", org_id: MOCK_ORG_ID },
    ]);
  });

  it("returns 400 for a malformed schedulingRules field", async () => {
    const res = await PUT(putReq({ schedulingRules: { startGranularityMinutes: 45 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/startGranularityMinutes/);
  });

  it("returns 400 when schedulingRules is not an object", async () => {
    const res = await PUT(putReq({ schedulingRules: "fast" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the patch would invert a stored min/max range", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({
        user: MOCK_USER,
        isManager: true,
        queryData: [{ key: "sched_max_shift_minutes", value: "300" }],
      }) as any
    );
    const res = await PUT(putReq({ schedulingRules: { minShiftMinutes: 360 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("minShiftMinutes cannot exceed maxShiftMinutes");
  });

  // ── DB error ─────────────────────────────────────────────────────────────────

  it("returns 500 on database error", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, queryError: { message: "db error" } }) as any
    );
    const res = await PUT(putReq({ firstDayOfWeek: 1 }));
    expect(res.status).toBe(500);
  });

  // ── Org scoping ──────────────────────────────────────────────────────────────

  it("stamps org_id on every row passed to upsert", async () => {
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true });
    mockCreateClient.mockResolvedValue(client as any);
    await PUT(putReq({ firstDayOfWeek: 1 }));
    // Find the upsert call on the app_settings builder
    const calls = (client.from as ReturnType<typeof vi.fn>).mock.calls;
    const settingsCallIdx = calls.findIndex((c: string[]) => c[0] === "app_settings");
    const builder = (client.from as ReturnType<typeof vi.fn>).mock.results[settingsCallIdx].value;
    const upsertArgs = (builder.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as any[];
    expect(upsertArgs[0]).toMatchObject({ org_id: MOCK_ORG_ID });
  });
});
