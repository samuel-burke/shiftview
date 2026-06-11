import { describe, it, expect, vi, beforeEach } from "vitest";

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
} = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "schedules") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: schedules, error: schedErr }),
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
    vi.mocked(notify).mockResolvedValue(undefined as any);
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
});
