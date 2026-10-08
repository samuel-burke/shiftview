import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: any) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

import { createAdminClient } from "@/lib/supabase-admin";
import { notify } from "@/lib/notify";

function makeAdminClient({
  schedules = [] as any[],
  schedErr = null as any,
  employees = [] as any[],
  empErr = null as any,
  demoOrgs = [] as any[],
  timezones = [] as { org_id: string; value: string }[],
} = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: demoOrgs, error: null }),
        };
      }
      if (table === "schedules") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: schedules, error: schedErr }),
        };
      }
      if (table === "app_settings") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: timezones, error: null }),
        };
      }
      if (table === "employees") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: employees, error: empErr }),
        };
      }
      return {};
    }),
  };
}

describe("GET /api/cron/reminders", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(notify).mockReset();
    vi.mocked(notify).mockResolvedValue(undefined as any);
    // The cron fires at 22:00 UTC; on 2026-01-01 that is 5 PM in New York, so
    // "tomorrow" for a default-timezone org is 2026-01-02.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T22:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when x-cron-secret header missing", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders");
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when secret wrong", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "wrong-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns { sent: 0, skipped: 0 } when no schedules tomorrow", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient({ schedules: [] }) as any);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(0);
  });

  it("sends notifications to employees with user_id", async () => {
    const schedules = [
      { id: 1, employee_id: 1, org_id: "org-1", date: "2026-01-02", start_minutes: 480, end_minutes: 960 },
      { id: 2, employee_id: 2, org_id: "org-1", date: "2026-01-02", start_minutes: 540, end_minutes: 1020 },
    ];
    const employees = [
      { id: 1, org_id: "org-1", name: "Alice", user_id: "user-1" },
      { id: 2, org_id: "org-1", name: "Bob", user_id: "user-2" },
    ];
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient({ schedules, employees }) as any);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(body.skipped).toBe(0);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("skips employees without user_id", async () => {
    const schedules = [
      { id: 1, employee_id: 1, org_id: "org-1", date: "2026-01-02", start_minutes: 480, end_minutes: 960 },
      { id: 2, employee_id: 2, org_id: "org-1", date: "2026-01-02", start_minutes: 540, end_minutes: 1020 },
    ];
    const employees = [
      { id: 1, org_id: "org-1", name: "Alice", user_id: null },
      { id: 2, org_id: "org-1", name: "Bob", user_id: "user-2" },
    ];
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient({ schedules, employees }) as any);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it("skips schedules belonging to demo organizations", async () => {
    const schedules = [
      { id: 1, employee_id: 1, org_id: "demo-org", date: "2026-01-02", start_minutes: 480, end_minutes: 960 },
      { id: 2, employee_id: 2, org_id: "org-1", date: "2026-01-02", start_minutes: 540, end_minutes: 1020 },
    ];
    const employees = [
      { id: 1, org_id: "demo-org", name: "Jordan Martinez", user_id: "anon-1" },
      { id: 2, org_id: "org-1", name: "Bob", user_id: "user-2" },
    ];
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({ schedules, employees, demoOrgs: [{ id: "demo-org" }] }) as any
    );
    vi.mocked(notify).mockClear();

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "org-1" })
    );
  });

  it("passes the schedule's org_id to notify", async () => {
    const schedules = [
      { id: 1, employee_id: 1, org_id: "org-abc", date: "2026-01-02", start_minutes: 480, end_minutes: 960 },
    ];
    const employees = [
      { id: 1, org_id: "org-abc", name: "Alice", user_id: "user-1" },
    ];
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient({ schedules, employees }) as any);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    });
    await GET(req);
    expect(notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "org-abc" })
    );
  });

  it("uses each org's own timezone to decide what 'tomorrow' is", async () => {
    // At 22:00 UTC on Jan 1 it is already 07:00 on Jan 2 in Tokyo, so a Tokyo
    // store's "tomorrow" is Jan 3 — its Jan 2 shift is today, not tomorrow.
    const schedules = [
      { id: 1, employee_id: 1, org_id: "org-ny", date: "2026-01-02", start_minutes: 480, end_minutes: 960 },
      { id: 2, employee_id: 1, org_id: "org-tokyo", date: "2026-01-02", start_minutes: 480, end_minutes: 960 },
      { id: 3, employee_id: 2, org_id: "org-tokyo", date: "2026-01-03", start_minutes: 540, end_minutes: 1020 },
    ];
    const employees = [
      { id: 1, org_id: "org-ny", name: "Alice", user_id: "user-1" },
      { id: 1, org_id: "org-tokyo", name: "Kenji", user_id: "user-2" },
      { id: 2, org_id: "org-tokyo", name: "Yuki", user_id: "user-3" },
    ];
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminClient({ schedules, employees, timezones: [{ org_id: "org-tokyo", value: "Asia/Tokyo" }] }) as any
    );

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    }));
    const body = await res.json();
    expect(body.sent).toBe(2);
    const sentScheduleIds = vi.mocked(notify).mock.calls.map((c) => (c[1] as any).data.scheduleId).sort();
    expect(sentScheduleIds).toEqual([1, 3]);
  });

  it("formats the reminder date from the schedule's calendar date", async () => {
    const schedules = [
      { id: 1, employee_id: 1, org_id: "org-1", date: "2026-01-02", start_minutes: 480, end_minutes: 960 },
    ];
    const employees = [{ id: 1, org_id: "org-1", name: "Alice", user_id: "user-1" }];
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient({ schedules, employees }) as any);

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    }));
    expect((vi.mocked(notify).mock.calls[0][1] as any).body).toContain("Friday, January 2");
  });
});
