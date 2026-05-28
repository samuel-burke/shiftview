import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseClient, MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: any) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

import { createClient } from "@/lib/supabase-server";
import { sendEmail } from "@/lib/email";

async function callRoute(headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  const req = new Request("http://localhost/api/cron/reminders", { headers });
  return GET(req);
}

describe("GET /api/cron/reminders", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.mocked(sendEmail).mockResolvedValue(undefined);
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

  it("returns { sent, skipped } on success", async () => {
    const schedules = [
      { employee_id: 1, start_minutes: 480, end_minutes: 960 },
      { employee_id: 2, start_minutes: 540, end_minutes: 1020 },
    ];
    const employees = [
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
    ];

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "schedules") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: schedules, error: null }),
          };
        }
        if (table === "employees") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: employees, error: null }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createClient).mockResolvedValue(supabase as any);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/reminders", {
      headers: { "x-cron-secret": "test-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(body.skipped).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("skips employees without email", async () => {
    const schedules = [
      { employee_id: 1, start_minutes: 480, end_minutes: 960 },
      { employee_id: 2, start_minutes: 540, end_minutes: 1020 },
    ];
    const employees = [
      { id: 1, name: "Alice", email: null },
      { id: 2, name: "Bob", email: "bob@example.com" },
    ];

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "schedules") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: schedules, error: null }),
          };
        }
        if (table === "employees") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: employees, error: null }),
          };
        }
        return {};
      }),
    };
    vi.mocked(createClient).mockResolvedValue(supabase as any);

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
});
