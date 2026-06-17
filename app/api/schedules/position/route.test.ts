import { describe, it, expect, vi } from "vitest";
import { PUT } from "./route";
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

function builder({ single = null as any } = {}) {
  const b: any = {};
  for (const m of ["select", "update", "delete", "insert", "eq", "neq", "in", "order", "limit"]) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue({ data: single, error: null });
  b.single = vi.fn().mockResolvedValue({ data: single, error: null });
  b.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return b;
}

function makeClient({
  user = MOCK_USER as any,
  isManager = true,
  schedule = { id: 10, employee_id: 1 } as any,
  position = { id: 2 } as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: null });
      if (table === "schedules") return builder({ single: schedule });
      if (table === "positions") return builder({ single: position });
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const req = (body: any) =>
  new Request("http://localhost/api/schedules/position", { method: "PUT", body: JSON.stringify(body) });

describe("PUT /api/schedules/position", () => {
  it("returns 400 when scheduleId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await PUT(req({ positionId: 2 }))).status).toBe(400);
  });

  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await PUT(req({ scheduleId: 10, positionId: 2 }))).status).toBe(403);
  });

  it("returns 404 when the schedule is not in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ schedule: null }) as any);
    expect((await PUT(req({ scheduleId: 10, positionId: 2 }))).status).toBe(404);
  });

  it("returns 400 when the position is not in the org", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ position: null }) as any);
    expect((await PUT(req({ scheduleId: 10, positionId: 99 }))).status).toBe(400);
  });

  it("assigns a position and returns ok", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await PUT(req({ scheduleId: 10, positionId: 2 }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("clears the position when positionId is null", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const res = await PUT(req({ scheduleId: 10, positionId: null }));
    expect(res.status).toBe(200);
  });
});
