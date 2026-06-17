import { describe, it, expect, vi } from "vitest";
import { GET, PUT } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

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

function builder({ thenData = null as any, single = null as any } = {}) {
  const b: any = {};
  for (const m of [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gte", "lte", "order", "limit", "in",
  ]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: thenData, error: null }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  isManager = false,
  schedules = { thenData: [], single: null } as { thenData?: any; single?: any },
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: { id: 5, org_id: MOCK_ORG_ID } });
      if (table === "schedules") return builder(schedules);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const getReq = (qs = "") => new Request(`http://localhost/api/schedules/note${qs}`);
const putReq = (body: any) =>
  new Request("http://localhost/api/schedules/note", { method: "PUT", body: JSON.stringify(body) });

describe("GET /api/schedules/note", () => {
  it("returns 400 when date is missing or malformed", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(getReq())).status).toBe(400);
    expect((await GET(getReq("?date=nope"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(getReq("?date=2026-06-17"))).status).toBe(401);
  });

  it("returns notes for the day's shifts (any member)", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        schedules: { thenData: [{ id: 10, note: "Lock up" }, { id: 11, note: null }] },
      }) as any
    );
    const res = await GET(getReq("?date=2026-06-17"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toEqual([
      { scheduleId: 10, note: "Lock up" },
      { scheduleId: 11, note: null },
    ]);
  });
});

describe("PUT /api/schedules/note", () => {
  it("returns 400 when scheduleId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await PUT(putReq({ note: "x" }))).status).toBe(400);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await PUT(putReq({ scheduleId: 10, note: "x" }))).status).toBe(403);
  });

  it("returns 400 for an over-long note", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    const res = await PUT(putReq({ scheduleId: 10, note: "x".repeat(281) }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the schedule is not in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true, schedules: { single: null } }) as any);
    expect((await PUT(putReq({ scheduleId: 99, note: "x" }))).status).toBe(404);
  });

  it("sets a note and returns ok", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, schedules: { single: { id: 10 } } }) as any
    );
    const res = await PUT(putReq({ scheduleId: 10, note: "  Lock up " }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.note).toBe("Lock up");
  });

  it("clears a note when given null", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, schedules: { single: { id: 10 } } }) as any
    );
    const res = await PUT(putReq({ scheduleId: 10, note: null }));
    expect(res.status).toBe(200);
    expect((await res.json()).note).toBeNull();
  });
});
