import { describe, it, expect, vi } from "vitest";
import { GET, POST, DELETE } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../__tests__/helpers";

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
  positions = { thenData: [], single: null } as { thenData?: any; single?: any },
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "managers") return builder({ single: managerRow });
      if (table === "employees") return builder({ single: { id: 5, org_id: MOCK_ORG_ID } });
      if (table === "positions") return builder(positions);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

const postReq = (body: any) =>
  new Request("http://localhost/api/positions", { method: "POST", body: JSON.stringify(body) });
const delReq = (body: any) =>
  new Request("http://localhost/api/positions", { method: "DELETE", body: JSON.stringify(body) });

describe("GET /api/positions", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(new Request("http://localhost/api/positions"))).status).toBe(401);
  });

  it("returns the org's positions for any member", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ positions: { thenData: [{ id: 1, name: "Cashier", color: "#f00" }] } }) as any
    );
    const res = await GET(new Request("http://localhost/api/positions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.positions[0].name).toBe("Cashier");
  });
});

describe("POST /api/positions", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await POST(postReq({ name: "Cook" }))).status).toBe(403);
  });

  it("returns 400 for an empty name", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await POST(postReq({ name: "  " }))).status).toBe(400);
  });

  it("creates a position and returns 201 with id", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, positions: { single: { id: 9 } } }) as any
    );
    const res = await POST(postReq({ name: "Cook", color: "#0f0" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(9);
    expect(body.ok).toBe(true);
  });

  it("returns 409 on a duplicate name", async () => {
    const client = makeClient({ isManager: true }) as any;
    // Make the positions insert resolve with a unique-violation error.
    const origFrom = client.from;
    client.from = vi.fn().mockImplementation((table: string) => {
      if (table === "positions") {
        const b = origFrom("positions");
        b.single = vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } });
        return b;
      }
      return origFrom(table);
    });
    mockCreateClient.mockResolvedValue(client);
    const res = await POST(postReq({ name: "Cook" }));
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/positions", () => {
  it("returns 403 for a non-manager", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: false }) as any);
    expect((await DELETE(delReq({ id: 1 }))).status).toBe(403);
  });

  it("returns 400 when id is missing", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ isManager: true }) as any);
    expect((await DELETE(delReq({}))).status).toBe(400);
  });

  it("deletes a position and returns ok", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ isManager: true, positions: { single: { id: 1, name: "Cook" } } }) as any
    );
    const res = await DELETE(delReq({ id: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
