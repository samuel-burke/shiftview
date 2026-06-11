import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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
vi.mock("@/lib/notify", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

const mockCreateClient = vi.mocked(createClient);

function makeNotifyEmployeeClient({
  user = MOCK_USER as any,
  isManager = false,
  empData = null as any,
  empError = null as any,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID } : null;
  const employeeRow = isManager ? null : (user ? { id: 1, org_id: MOCK_ORG_ID } : null);

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "neq", "gte", "lte", "in", "or", "not", "is",
        "order", "limit", "filter", "match", "insert", "update", "delete", "upsert"]) {
        b[m] = vi.fn().mockReturnValue(b);
      }
      b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      b.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject);

      if (table === "managers") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: managerRow, error: null });
        return b;
      }
      if (table === "employees") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: empData ?? employeeRow, error: empError });
        return b;
      }
      return b;
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe("POST /api/notify-employee", () => {
  it("returns 400 when employeeId is missing", async () => {
    mockCreateClient.mockResolvedValue(makeNotifyEmployeeClient({ isManager: true }) as any);
    const res = await POST(
      new Request("http://localhost/api/notify-employee", {
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockCreateClient.mockResolvedValue(makeNotifyEmployeeClient({ user: null }) as any);
    const res = await POST(
      new Request("http://localhost/api/notify-employee", {
        method: "POST",
        body: JSON.stringify({ employeeId: 1, message: "hello" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a manager", async () => {
    // isManager: false, user is authenticated but only has employee row, no manager row
    mockCreateClient.mockResolvedValue(
      makeNotifyEmployeeClient({ isManager: false, empData: { id: 1, org_id: MOCK_ORG_ID } }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/notify-employee", {
        method: "POST",
        body: JSON.stringify({ employeeId: 1, message: "hello" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when employee not found in org", async () => {
    // Manager, but employee lookup returns null (not in this org)
    mockCreateClient.mockResolvedValue(
      makeNotifyEmployeeClient({ isManager: true, empData: null }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/notify-employee", {
        method: "POST",
        body: JSON.stringify({ employeeId: 99, message: "hello" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("calls notify with orgId and returns ok when successful", async () => {
    const { notify } = await import("@/lib/notify");
    mockCreateClient.mockResolvedValue(
      makeNotifyEmployeeClient({
        isManager: true,
        empData: { user_id: "emp-user-id", name: "Alice" },
      }) as any
    );
    const res = await POST(
      new Request("http://localhost/api/notify-employee", {
        method: "POST",
        body: JSON.stringify({ employeeId: 5, message: "You are scheduled!" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: MOCK_ORG_ID, userId: "emp-user-id" })
    );
  });
});
