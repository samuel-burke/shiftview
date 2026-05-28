import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: { json: (data: any, init?: any) => new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }) }
}));

const mockCreateClient = vi.mocked(createClient);

function req(body: any) {
  return new Request("http://localhost/api/schedules/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCopyClient({ user, isManager, existingSchedules = [], sourceSchedules = [], insertError = null }: any) {
  const managerRow = isManager && user ? { user_id: user.id } : null;
  let scheduleCallCount = 0;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      const b: any = {};
      for (const m of ["select", "insert", "eq", "filter"]) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      if (table === "managers") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: managerRow, error: null });
        b.then = (res: any) => Promise.resolve({ data: managerRow, error: null }).then(res);
        return b;
      }
      if (table === "schedules") {
        scheduleCallCount++;
        if (scheduleCallCount === 1) {
          // existing schedules for toDate
          b.then = (res: any) => Promise.resolve({ data: existingSchedules, error: null }).then(res);
        } else if (scheduleCallCount === 2) {
          // source schedules from fromDate
          b.then = (res: any) => Promise.resolve({ data: sourceSchedules, error: null }).then(res);
        } else {
          // insert
          b.then = (res: any) => Promise.resolve({ data: null, error: insertError }).then(res);
        }
        return b;
      }
      return b;
    }),
  };
}

describe("POST /api/schedules/copy", () => {
  it("returns 400 when fromDate is missing", async () => {
    mockCreateClient.mockResolvedValue(makeCopyClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await POST(req({ toDate: "2026-05-28" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "fromDate and toDate required" });
  });

  it("returns 400 when toDate is missing", async () => {
    mockCreateClient.mockResolvedValue(makeCopyClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await POST(req({ fromDate: "2026-05-21" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "fromDate and toDate required" });
  });

  it("returns 400 for invalid fromDate format", async () => {
    mockCreateClient.mockResolvedValue(makeCopyClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await POST(req({ fromDate: "21-05-2026", toDate: "2026-05-28" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "dates must be YYYY-MM-DD" });
  });

  it("returns 400 for invalid toDate format", async () => {
    mockCreateClient.mockResolvedValue(makeCopyClient({ user: MOCK_USER, isManager: true }) as any);
    const res = await POST(req({ fromDate: "2026-05-21", toDate: "28-05-2026" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "dates must be YYYY-MM-DD" });
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeCopyClient({ user: null, isManager: false }) as any);
    const res = await POST(req({ fromDate: "2026-05-21", toDate: "2026-05-28" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeCopyClient({ user: MOCK_USER, isManager: false }) as any);
    const res = await POST(req({ fromDate: "2026-05-21", toDate: "2026-05-28" }));
    expect(res.status).toBe(403);
  });

  it("returns 200 with { copied: 2, skipped: 1 } when some shifts already exist on toDate", async () => {
    const existingSchedules = [{ employee_id: 1 }];
    const sourceSchedules = [
      { employee_id: 1, start_minutes: 480, end_minutes: 960 },
      { employee_id: 2, start_minutes: 600, end_minutes: 1080 },
      { employee_id: 3, start_minutes: 720, end_minutes: 1200 },
    ];
    mockCreateClient.mockResolvedValue(
      makeCopyClient({ user: MOCK_USER, isManager: true, existingSchedules, sourceSchedules }) as any
    );
    const res = await POST(req({ fromDate: "2026-05-21", toDate: "2026-05-28" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copied: 2, skipped: 1 });
  });

  it("returns 200 with { copied: 3, skipped: 0 } when no existing shifts on toDate", async () => {
    const sourceSchedules = [
      { employee_id: 1, start_minutes: 480, end_minutes: 960 },
      { employee_id: 2, start_minutes: 600, end_minutes: 1080 },
      { employee_id: 3, start_minutes: 720, end_minutes: 1200 },
    ];
    mockCreateClient.mockResolvedValue(
      makeCopyClient({ user: MOCK_USER, isManager: true, existingSchedules: [], sourceSchedules }) as any
    );
    const res = await POST(req({ fromDate: "2026-05-21", toDate: "2026-05-28" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copied: 3, skipped: 0 });
  });

  it("returns 200 with { copied: 0, skipped: 2 } when all employees already scheduled", async () => {
    const existingSchedules = [{ employee_id: 1 }, { employee_id: 2 }];
    const sourceSchedules = [
      { employee_id: 1, start_minutes: 480, end_minutes: 960 },
      { employee_id: 2, start_minutes: 600, end_minutes: 1080 },
    ];
    mockCreateClient.mockResolvedValue(
      makeCopyClient({ user: MOCK_USER, isManager: true, existingSchedules, sourceSchedules }) as any
    );
    const res = await POST(req({ fromDate: "2026-05-21", toDate: "2026-05-28" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copied: 0, skipped: 2 });
  });

  it("returns 500 on DB fetch error", async () => {
    const managerRow = { user_id: MOCK_USER.id };
    let scheduleCallCount = 0;
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
      from: vi.fn().mockImplementation((table: string) => {
        const b: any = {};
        for (const m of ["select", "insert", "eq", "filter"]) {
          b[m] = vi.fn().mockReturnValue(b);
        }
        if (table === "managers") {
          b.maybeSingle = vi.fn().mockResolvedValue({ data: managerRow, error: null });
          b.then = (res: any) => Promise.resolve({ data: managerRow, error: null }).then(res);
          return b;
        }
        if (table === "schedules") {
          scheduleCallCount++;
          if (scheduleCallCount === 1) {
            // existing schedules for toDate
            b.then = (res: any) => Promise.resolve({ data: [], error: null }).then(res);
          } else {
            // source schedules — DB error
            b.then = (res: any) => Promise.resolve({ data: null, error: { message: "db error" } }).then(res);
          }
          return b;
        }
        return b;
      }),
    };
    mockCreateClient.mockResolvedValue(client as any);
    const res = await POST(req({ fromDate: "2026-05-21", toDate: "2026-05-28" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "db error" });
  });
});
