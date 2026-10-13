import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeSupabaseClient, MOCK_USER } from "../__tests__/helpers";

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

const mockCreateClient = vi.mocked(createClient);

describe("GET /api/managers", () => {
  it("returns 401 for unauthenticated requests", async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ user: null }) as any);
    const res = await GET(new Request("http://localhost/api/managers"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await GET(new Request("http://localhost/api/managers"));
    expect(res.status).toBe(403);
  });

  // The route's list query on managers resolves to `rows`; requireManager's
  // own maybeSingle lookup keeps the helper's membership row.
  function withManagerRows(client: any, rows: any[] | null, error: any = null) {
    const from = client.from.getMockImplementation();
    client.from.mockImplementation((table: string) => {
      const b = from(table);
      if (table === "managers")
        b.then = (resolve: any, reject: any) =>
          Promise.resolve({ data: rows, error }).then(resolve, reject);
      return b;
    });
    return client;
  }

  it("returns the org's manager user_ids from the managers table", async () => {
    const client = withManagerRows(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }),
      [
        { user_id: MOCK_USER.id, is_owner: false },
        { user_id: "other-manager-uuid", is_owner: false },
      ]
    );
    mockCreateClient.mockResolvedValue(client as any);

    const res = await GET(new Request("http://localhost/api/managers"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.managerUserIds).toEqual([MOCK_USER.id, "other-manager-uuid"]);
    expect(json.ownerUserIds).toEqual([]);
    // notify_get_manager_ids is service-role only (migration 0038).
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns the org owner in ownerUserIds when one exists", async () => {
    const client = withManagerRows(
      makeSupabaseClient({ user: MOCK_USER, isManager: true, ownerUserId: MOCK_USER.id }),
      [
        { user_id: MOCK_USER.id, is_owner: true },
        { user_id: "other-manager-uuid", is_owner: false },
      ]
    );
    mockCreateClient.mockResolvedValue(client as any);

    const res = await GET(new Request("http://localhost/api/managers"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ownerUserIds).toEqual([MOCK_USER.id]);
  });

  it("returns 500 on query error", async () => {
    const client = withManagerRows(
      makeSupabaseClient({ user: MOCK_USER, isManager: true }),
      null,
      { message: "db error" }
    );
    mockCreateClient.mockResolvedValue(client as any);

    const res = await GET(new Request("http://localhost/api/managers"));
    expect(res.status).toBe(500);
  });
});
