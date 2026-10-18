import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
  notifyManagers: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ntfy", () => ({ sendNtfy: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { createAdminClient } from "@/lib/supabase-admin";
import { notify, notifyManagers } from "@/lib/notify";
import { GET } from "./route";

const ORG = "org-1";

// A query builder whose filters are no-ops and whose .range() pages through
// the table's rows, as PostgREST does.
function makeAdminClient(tables: Record<string, unknown[]>) {
  return {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "gte", "lte", "order"]) builder[m] = () => builder;
      builder.range = (a: number, b: number) => Promise.resolve({ data: rows.slice(a, b + 1), error: null });
      return builder;
    }),
  };
}

// Monday 2026-03-02, 10:30 AM in New York (EST): Casey's 9:00 AM shift is past
// the 60-minute no-call-no-show window.
const NOW = "2026-03-02T15:30:00Z";

function tables(sentKeys: string[] = []) {
  return {
    organizations: [{ id: ORG, is_demo: false }, { id: "demo", is_demo: true }],
    app_settings: [{ org_id: ORG, key: "timezone", value: "America/New_York" }],
    schedules: [
      { id: 1, org_id: ORG, employee_id: 7, date: "2026-03-02", start_minutes: 540, end_minutes: 1020 },
      // The demo org's no-show is never alerted.
      { id: 2, org_id: "demo", employee_id: 7, date: "2026-03-02", start_minutes: 540, end_minutes: 1020 },
    ],
    punch_records: [],
    callouts: [],
    employees: [
      { id: 7, org_id: ORG, name: "Casey", user_id: "user-7" },
      { id: 7, org_id: "demo", name: "Demo", user_id: null },
    ],
    notifications: sentKeys.map((k, i) => ({ id: i + 1, org_id: ORG, data: { alertKey: k } })),
  };
}

const authed = () =>
  new Request("http://localhost/api/cron/attendance", { headers: { authorization: "Bearer test-secret" } });

describe("GET /api/cron/attendance", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(notify).mockClear();
    vi.mocked(notifyManagers).mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("rejects a request without the cron secret", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient(tables()) as never);
    const res = await GET(new Request("http://localhost/api/cron/attendance"));
    expect(res.status).toBe(401);
    const wrong = await GET(new Request("http://localhost/api/cron/attendance", { headers: { "x-cron-secret": "nope" } }));
    expect(wrong.status).toBe(401);
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it("alerts managers to a no-show once", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient(tables()) as never);
    const res = await GET(authed());
    expect(await res.json()).toEqual({ noShows: 1, missedClockOuts: 0, overtime: 0 });
    expect(notifyManagers).toHaveBeenCalledTimes(1);
    expect(notifyManagers).toHaveBeenCalledWith(
      ORG,
      "no_show",
      "No-Show",
      "Casey hasn't clocked in for their 9:00 AM shift",
      expect.objectContaining({ alertKey: "no_show:7:2026-03-02:540", employeeId: 7 })
    );
  });

  it("does not resend an alert whose key is already in notifications", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient(tables(["no_show:7:2026-03-02:540"])) as never);
    const res = await GET(authed());
    expect(await res.json()).toEqual({ noShows: 0, missedClockOuts: 0, overtime: 0 });
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it("tells the employee and managers about a missed clock-out", async () => {
    const t = tables();
    t.schedules = [{ id: 1, org_id: ORG, employee_id: 7, date: "2026-03-02", start_minutes: 0, end_minutes: 480 }];
    // Clocked in at midnight for a midnight–8 AM shift; it's 10:30 AM.
    (t.punch_records as unknown[]) = [
      { id: 50, org_id: ORG, employee_id: 7, punch_type: "clock_in", punched_at: "2026-03-02T05:00:00Z" },
    ];
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient(t) as never);
    const res = await GET(authed());
    expect(await res.json()).toEqual({ noShows: 0, missedClockOuts: 1, overtime: 0 });
    expect(notifyManagers).toHaveBeenCalledWith(
      ORG, "missed_clock_out", "Missed Clock-Out", expect.stringContaining("Casey is still clocked in from 12:00 AM"),
      expect.objectContaining({ alertKey: "missed_clock_out:7:50" })
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG, userId: "user-7", type: "missed_clock_out",
      data: expect.objectContaining({ alertKey: "missed_clock_out:7:50" }),
    }));
  });
});
