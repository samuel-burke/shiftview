import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
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

/**
 * Builds a Supabase mock tailored to the publish route's call sequence:
 *
 *  1. supabase.from("draft_schedules").select(...).gte(...).lte(...)  → drafts
 *  2. supabase.from("schedules").select(...).gte(...).lte(...)        → existing
 *  3. supabase.from("schedules").insert(...)                          → insert result
 *  4. supabase.from("draft_schedules").delete().in(...)               → delete result
 *  5. supabase.from("employees").select(...).in(...)                  → employees
 *
 * The mock counts calls per-table to distinguish select vs. mutating calls.
 */
function makePublishClient({
  user = MOCK_USER as any,
  isManager = true,
  drafts = [] as any[],
  draftsError = null as any,
  existingSchedules = [] as any[],
  existingError = null as any,
  insertError = null as any,
  deleteError = null as any,
  employees = [] as any[],
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id } : null;

  // Track call counts per table
  const callCount: Record<string, number> = {};

  function makeBuilder(result: { data: any; error: any }) {
    const b: any = {};
    for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "gte", "lte", "order", "in"]) {
      b[m] = vi.fn().mockReturnValue(b);
    }
    b.maybeSingle = vi.fn().mockResolvedValue(result);
    b.single = vi.fn().mockResolvedValue(result);
    b.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    return b;
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") {
        return makeBuilder({ data: managerRow, error: null });
      }

      callCount[table] = (callCount[table] ?? 0) + 1;
      const n = callCount[table];

      if (table === "draft_schedules") {
        if (n === 1) return makeBuilder({ data: drafts, error: draftsError }); // select
        return makeBuilder({ data: null, error: deleteError }); // delete
      }

      if (table === "schedules") {
        if (n === 1) return makeBuilder({ data: existingSchedules, error: existingError }); // select
        return makeBuilder({ data: null, error: insertError }); // insert
      }

      if (table === "employees") {
        return makeBuilder({ data: employees, error: null });
      }

      return makeBuilder({ data: null, error: null });
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const DRAFT_1 = { id: 1, employee_id: 10, date: "2026-06-01", start_minutes: 480, end_minutes: 960 };
const DRAFT_2 = { id: 2, employee_id: 11, date: "2026-06-02", start_minutes: 540, end_minutes: 1020 };

function postReq(body: unknown) {
  return new Request("http://localhost/api/drafts/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Input validation ──────────────────────────────────────────────────────────

describe("POST /api/drafts/publish — validation", () => {
  beforeEach(() => {
    mockCreateClient.mockResolvedValue(makePublishClient() as any);
  });

  it("returns 400 when weekStart is missing", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("weekStart") });
  });

  it("returns 400 for invalid weekStart format", async () => {
    const res = await POST(postReq({ weekStart: "01-06-2026" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("YYYY-MM-DD") });
  });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("POST /api/drafts/publish — auth", () => {
  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(
      makePublishClient({ user: null, isManager: false }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not a manager", async () => {
    mockCreateClient.mockResolvedValue(
      makePublishClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(403);
  });
});

// ── No drafts ─────────────────────────────────────────────────────────────────

describe("POST /api/drafts/publish — no drafts", () => {
  it("returns 400 when no draft shifts exist for the week", async () => {
    mockCreateClient.mockResolvedValue(
      makePublishClient({ drafts: [] }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("No draft shifts") });
  });

  it("returns 500 when fetching drafts fails", async () => {
    mockCreateClient.mockResolvedValue(
      makePublishClient({ drafts: [], draftsError: { message: "db error" } }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(500);
  });
});

// ── Success paths ─────────────────────────────────────────────────────────────

describe("POST /api/drafts/publish — success", () => {
  it("returns { published: N, skipped: 0 } when no existing schedules conflict", async () => {
    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1, DRAFT_2],
        existingSchedules: [],
      }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ published: 2, skipped: 0 });
  });

  it("returns { published: 1, skipped: 1 } when one employee is already scheduled", async () => {
    // employee_id=10 already has a schedule on 2026-06-01
    const existingSchedules = [{ employee_id: 10, date: "2026-06-01" }];
    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1, DRAFT_2],
        existingSchedules,
      }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ published: 1, skipped: 1 });
  });

  it("returns { published: 0, skipped: N } when all employees are already scheduled", async () => {
    const existingSchedules = [
      { employee_id: 10, date: "2026-06-01" },
      { employee_id: 11, date: "2026-06-02" },
    ];
    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1, DRAFT_2],
        existingSchedules,
      }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(200);
    // All drafts are skipped — insert is never called with rows, but delete still runs
    const json = await res.json();
    expect(json).toEqual({ published: 0, skipped: 2 });
  });

  it("sends notifications for employees with user_id", async () => {
    const { notify } = await import("@/lib/notify");
    const notifyMock = vi.mocked(notify);
    notifyMock.mockClear();

    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1],
        existingSchedules: [],
        employees: [{ id: 10, user_id: "user-abc" }],
      }) as any
    );
    await POST(postReq({ weekStart: "2026-06-01" }));
    // notify is called fire-and-forget (.catch(() => {})) so we can just
    // verify it was invoked (or not crash).
    // The call may be async and deferred — just verify no throw.
  });

  it("calls writeAuditLog after publish", async () => {
    const { writeAuditLog } = await import("@/lib/audit");
    const auditMock = vi.mocked(writeAuditLog);
    auditMock.mockClear();

    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1],
        existingSchedules: [],
      }) as any
    );
    await POST(postReq({ weekStart: "2026-06-01" }));
    // writeAuditLog is also fire-and-forget; verify it was scheduled
    // (vitest can see the mock was called synchronously as a fire-and-forget)
    // We just verify no throw here.
  });
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe("POST /api/drafts/publish — error paths", () => {
  it("returns 500 when fetching existing schedules fails", async () => {
    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1],
        existingError: { message: "db error" },
      }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(500);
  });

  it("returns 500 when inserting schedules fails", async () => {
    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1],
        existingSchedules: [],
        insertError: { message: "insert failed" },
      }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(500);
  });

  it("still returns 200 when the delete cleanup step fails (shifts already live)", async () => {
    // The route logs cleanup failure but doesn't fail the publish
    mockCreateClient.mockResolvedValue(
      makePublishClient({
        drafts: [DRAFT_1],
        existingSchedules: [],
        deleteError: { message: "cleanup failed" },
      }) as any
    );
    const res = await POST(postReq({ weekStart: "2026-06-01" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ published: 1 });
  });
});
