import { describe, it, expect, vi } from "vitest";
import { GET, POST, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyManagers: vi.fn().mockResolvedValue(undefined) }));
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
    "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in",
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
  rpc = null as any,
  announcements = { thenData: [], single: null } as { thenData?: any; single?: any },
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: { id: 5, org_id: MOCK_ORG_ID } });
      if (table === "announcements") return builder(announcements);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: rpc, error: null }),
  };
}

const postReq = (body: any) =>
  new Request("http://localhost/api/announcements", { method: "POST", body: JSON.stringify(body) });
const delReq = (body: any) =>
  new Request("http://localhost/api/announcements", { method: "DELETE", body: JSON.stringify(body) });

describe("GET /api/announcements", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(new Request("http://localhost/api/announcements"))).status).toBe(401);
  });

  it("returns the org's announcements for any member", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        announcements: {
          thenData: [{ id: 1, title: "Inventory", body: "Closed Monday", created_at: "t", created_by: "u" }],
        },
      }) as any
    );
    const res = await GET(new Request("http://localhost/api/announcements"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.announcements[0].title).toBe("Inventory");
  });
});

describe("POST /api/announcements", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await POST(postReq({ title: "Hi", body: "There" }))).status).toBe(403);
  });

  it("returns 400 for an invalid announcement", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await POST(postReq({ title: "", body: "x" }))).status).toBe(400);
  });

  it("creates an announcement and returns 201 with id", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, announcements: { single: { id: 7 } } }) as any
    );
    const res = await POST(postReq({ title: "Inventory", body: "Closed Monday" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(7);
    expect(body.ok).toBe(true);
  });
});

describe("DELETE /api/announcements", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await DELETE(delReq({ id: 1 }))).status).toBe(403);
  });

  it("returns 400 when id is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await DELETE(delReq({}))).status).toBe(400);
  });

  it("deletes an announcement and returns ok", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, announcements: { single: { id: 1, title: "Inventory" } } }) as any
    );
    const res = await DELETE(delReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
