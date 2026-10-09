import { describe, it, expect, vi } from "vitest";
import { GET, POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../../__tests__/helpers";
import { DEFAULT_SCHEDULING_RULES } from "@/lib/scheduling-rules";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
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
const WEEK_START = "2026-10-12"; // Monday

// A small store: 9 AM–5 PM, one person, every day.
function tables(overrides: Record<string, { data: any; error: any }> = {}) {
  return {
    employees: { data: [
      { id: 1, name: "Alice Smith", employment_type: "full_time", min_weekly_hours: null, max_weekly_hours: null, max_days_per_week: null },
      { id: 2, name: "Bob Jones", employment_type: "part_time", min_weekly_hours: null, max_weekly_hours: "20.0", max_days_per_week: null },
    ], error: null },
    availability: { data: [{ employee_id: 2, day_of_week: 0, start_minutes: null, end_minutes: null }], error: null },
    time_off_requests: { data: [{ employee_id: 1, date: "2026-10-14", status: "approved" }], error: null },
    callouts: { data: [], error: null },
    employee_preferences: { data: [], error: null },
    coverage_profiles: { data: [{ id: 5, name: "Day" }], error: null },
    coverage_profile_blocks: { data: [{ profile_id: 5, start_minutes: 540, end_minutes: 1020, headcount: 1 }], error: null },
    coverage_day_defaults: { data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, profile_id: 5 })), error: null },
    coverage_date_overrides: { data: [], error: null },
    store_hours: { data: [], error: null },
    app_settings: { data: [{ key: "timezone", value: "America/Chicago" }], error: null },
    schedules: { data: [], error: null },
    draft_schedules: { data: [
      // A manager-made draft covering Monday.
      { id: 31, employee_id: 2, date: WEEK_START, start_minutes: 540, end_minutes: 1020, generation_run_id: null },
    ], error: null },
    ...overrides,
  };
}

function client({
  isManager = true,
  tableOverrides = tables(),
  rpcData = { status: "ok", run_id: 7, inserted: 5, removed: 0 } as any,
  rpcError = null as any,
} = {}) {
  const c = makeSupabaseClient({ user: MOCK_USER, isManager, tableOverrides, rpcData, rpcError });
  // Pay rates come from employee_pay_rates; every other RPC gets rpcData / rpcError.
  c.rpc.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === "employee_pay_rates"
        ? { data: [{ employee_id: 1, pay_rate: 16 }, { employee_id: 2, pay_rate: "15.00" }], error: null }
        : { data: rpcData, error: rpcError }
    )
  );
  mockCreateClient.mockResolvedValue(c as any);
  return c;
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/drafts/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rpcArgs(c: ReturnType<typeof makeSupabaseClient>) {
  const calls = (c.rpc as ReturnType<typeof vi.fn>).mock.calls.filter(([name]) => name !== "employee_pay_rates");
  const [name, args] = calls[0];
  expect(name).toBe("apply_generated_drafts");
  return args;
}

describe("POST /api/drafts/generate — validation", () => {
  it.each([
    [{ mode: "fill" }, /weekStart/],
    [{ weekStart: "2026-02-30", mode: "fill" }, /weekStart/],
    [{ weekStart: WEEK_START, mode: "merge" }, /mode/],
    [{ weekStart: WEEK_START, mode: "fill", seed: -1 }, /seed/],
    [{ weekStart: WEEK_START, mode: "fill", replaceRunId: "7" }, /replaceRunId/],
  ])("rejects %j", async (body, message) => {
    client();
    const res = await POST(postReq(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
  });

  it("rejects invalid rule overrides", async () => {
    client();
    const res = await POST(postReq({ weekStart: WEEK_START, mode: "fill", rules: { overtimePolicy: "always" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/overtimePolicy/);
  });

  it("rejects invalid adjustments", async () => {
    client();
    const res = await POST(postReq({
      weekStart: WEEK_START, mode: "fill",
      adjustments: [{ kind: "employee_off", employeeId: 99, date: WEEK_START }],
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown employee/);
  });
});

describe("POST /api/drafts/generate — auth", () => {
  it("returns 401 when not signed in", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    expect((await POST(postReq({ weekStart: WEEK_START, mode: "fill" }))).status).toBe(401);
  });

  it("returns 403 for non-managers", async () => {
    client({ isManager: false });
    expect((await POST(postReq({ weekStart: WEEK_START, mode: "fill" }))).status).toBe(403);
  });
});

describe("POST /api/drafts/generate", () => {
  it("generates around the week's drafts and saves the run", async () => {
    const c = client();
    const res = await POST(postReq({ weekStart: WEEK_START, mode: "fill", seed: 42 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ runId: 7, weekStart: WEEK_START, mode: "fill", seed: 42, adjustments: [] });
    expect(body.run.metrics.coverageScore).toBe(100);

    const args = rpcArgs(c);
    expect(args).toMatchObject({ p_org: MOCK_ORG_ID, p_week_start: WEEK_START, p_mode: "fill", p_replace_run_id: null, p_seed: 42 });
    expect(args.p_expected).toEqual([[31, 2, WEEK_START, 540, 1020]]);
    expect(args.p_rules).toEqual(DEFAULT_SCHEDULING_RULES);
    expect(args.p_metrics).toEqual(expect.objectContaining({ metrics: body.run.metrics, gaps: [], warnings: expect.any(Array) }));
    // Monday is already covered by the kept draft; Wednesday is Alice's day off,
    // and Sunday Bob's, so each of them covers the other.
    const rows = args.p_rows as { employee_id: number; date: string }[];
    expect(rows.some((r) => r.date === WEEK_START)).toBe(false);
    expect(rows.find((r) => r.date === "2026-10-14")?.employee_id).toBe(2);
    expect(rows.find((r) => r.date === "2026-10-18")?.employee_id).toBe(1);
  });

  it("starts over in replace mode", async () => {
    const c = client();
    await POST(postReq({ weekStart: WEEK_START, mode: "replace", seed: 42 }));
    const args = rpcArgs(c);
    expect(args.p_mode).toBe("replace");
    expect((args.p_rows as { date: string }[]).some((r) => r.date === WEEK_START)).toBe(true);
  });

  it("replaces only the given run's drafts for another version", async () => {
    const c = client({
      tableOverrides: tables({
        draft_schedules: { data: [
          { id: 31, employee_id: 2, date: WEEK_START, start_minutes: 540, end_minutes: 1020, generation_run_id: 6 },
          { id: 32, employee_id: 1, date: "2026-10-13", start_minutes: 540, end_minutes: 1020, generation_run_id: null },
        ], error: null },
      }),
    });
    await POST(postReq({ weekStart: WEEK_START, mode: "fill", replaceRunId: 6, seed: 1 }));
    const args = rpcArgs(c);
    expect(args.p_replace_run_id).toBe(6);
    const rows = args.p_rows as { date: string }[];
    expect(rows.some((r) => r.date === WEEK_START)).toBe(true);       // run 6's Monday is redone
    expect(rows.some((r) => r.date === "2026-10-13")).toBe(false);    // the manager's Tuesday stays
  });

  it("applies rule overrides and adjustments for the run", async () => {
    const c = client();
    const res = await POST(postReq({
      weekStart: WEEK_START, mode: "replace", seed: 3,
      rules: { overtimePolicy: "when_needed" },
      adjustments: [{ kind: "employee_off", employeeId: 1, date: "2026-10-13" }],
    }));
    expect(res.status).toBe(200);
    const args = rpcArgs(c);
    expect(args.p_rules.overtimePolicy).toBe("when_needed");
    expect(args.p_adjustments).toEqual([{ kind: "employee_off", employeeId: 1, date: "2026-10-13" }]);
    expect((args.p_rows as { employee_id: number; date: string }[]).find((r) => r.date === "2026-10-13")?.employee_id).toBe(2);
  });

  it("picks a seed when none is given", async () => {
    client();
    const body = await (await POST(postReq({ weekStart: WEEK_START, mode: "fill" }))).json();
    expect(Number.isInteger(body.run.seed)).toBe(true);
  });

  it("scopes every query to the org", async () => {
    const c = client();
    await POST(postReq({ weekStart: WEEK_START, mode: "fill", seed: 1 }));
    const from = c.from as ReturnType<typeof vi.fn>;
    for (const table of ["availability", "time_off_requests", "employee_preferences", "schedules", "draft_schedules", "coverage_profiles"]) {
      const idx = from.mock.calls.findIndex((call: string[]) => call[0] === table);
      expect(from.mock.results[idx].value.eq).toHaveBeenCalledWith("org_id", MOCK_ORG_ID);
    }
  });

  it.each([
    ["conflict", 409, /changed while generating/],
    ["stale", 409, /already replaced/],
    ["forbidden", 403, /Manager/],
    ["invalid", 500, /Internal/],
  ])("maps a %s result to %i", async (status, code, message) => {
    client({ rpcData: { status } });
    const res = await POST(postReq({ weekStart: WEEK_START, mode: "fill", seed: 1 }));
    expect(res.status).toBe(code);
    expect((await res.json()).error).toMatch(message);
  });

  it("returns 503 when the migration hasn't been applied", async () => {
    client({ tableOverrides: tables({ employees: { data: null, error: { code: "42703", message: "column does not exist" } } }) });
    const res = await POST(postReq({ weekStart: WEEK_START, mode: "fill" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ migrationRequired: true });
  });

  it("returns 503 when PostgREST 13 reports the new table missing", async () => {
    client({ tableOverrides: tables({ employee_preferences: { data: null, error: { code: "PGRST205", message: "Could not find the table" } } }) });
    expect((await POST(postReq({ weekStart: WEEK_START, mode: "fill" }))).status).toBe(503);
  });

  it("returns 503 when the RPC is missing", async () => {
    client({ rpcData: null, rpcError: { code: "PGRST202", message: "function not found" } });
    expect((await POST(postReq({ weekStart: WEEK_START, mode: "fill" }))).status).toBe(503);
  });

  it("returns 500 when loading fails", async () => {
    client({ tableOverrides: tables({ schedules: { data: null, error: { code: "XX000", message: "boom" } } }) });
    expect((await POST(postReq({ weekStart: WEEK_START, mode: "fill" }))).status).toBe(500);
  });
});

describe("GET /api/drafts/generate", () => {
  const RUN = {
    id: 8, week_start: WEEK_START, mode: "fill", seed: "42", created_at: "2026-10-06T12:00:00Z",
    rules: DEFAULT_SCHEDULING_RULES, adjustments: [],
    metrics: { metrics: { coverageScore: 97 }, gaps: [], suggestions: [], warnings: [], employees: [] },
    undone_at: null, published_at: null,
  };

  it("returns 400 without a valid weekStart", async () => {
    client();
    expect((await GET(new Request("http://localhost/api/drafts/generate"))).status).toBe(400);
  });

  it("returns 403 for non-managers", async () => {
    client({ isManager: false });
    expect((await GET(new Request(`http://localhost/api/drafts/generate?weekStart=${WEEK_START}`))).status).toBe(403);
  });

  it("returns the latest run still in effect", async () => {
    client({ tableOverrides: tables({ schedule_generation_runs: { data: [{ ...RUN, id: 9, undone_at: "2026-10-06T13:00:00Z" }, RUN], error: null } }) });
    const body = await (await GET(new Request(`http://localhost/api/drafts/generate?weekStart=${WEEK_START}`))).json();
    expect(body.run).toEqual({
      runId: 8, weekStart: WEEK_START, mode: "fill", seed: 42, createdAt: "2026-10-06T12:00:00Z",
      rules: DEFAULT_SCHEDULING_RULES, adjustments: [],
      metrics: { coverageScore: 97 }, gaps: [], suggestions: [], warnings: [], employees: [],
    });
  });

  it("returns null when every run was undone or published", async () => {
    client({ tableOverrides: tables({ schedule_generation_runs: { data: [{ ...RUN, published_at: "2026-10-07T00:00:00Z" }], error: null } }) });
    const body = await (await GET(new Request(`http://localhost/api/drafts/generate?weekStart=${WEEK_START}`))).json();
    expect(body).toEqual({ run: null });
  });

  it.each(["42P01", "PGRST205"])("returns null with a flag when the migration hasn't been applied (%s)", async (code) => {
    client({ tableOverrides: tables({ schedule_generation_runs: { data: null, error: { code, message: "missing" } } }) });
    const body = await (await GET(new Request(`http://localhost/api/drafts/generate?weekStart=${WEEK_START}`))).json();
    expect(body).toEqual({ run: null, migrationRequired: true });
  });
});
