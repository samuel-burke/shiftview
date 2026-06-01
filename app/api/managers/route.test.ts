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
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-managers", async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseClient({ user: MOCK_USER, isManager: false }) as any
    );
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the list of manager user_ids via notify_get_manager_ids RPC", async () => {
    const rpcData = [{ user_id: MOCK_USER.id }, { user_id: "other-manager-uuid" }];
    const client = makeSupabaseClient({ user: MOCK_USER, isManager: true, rpcData });
    mockCreateClient.mockResolvedValue(client as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.managerUserIds).toContain(MOCK_USER.id);
    expect(json.managerUserIds).toContain("other-manager-uuid");
    expect(client.rpc).toHaveBeenCalledWith("notify_get_manager_ids");
  });

  it("returns 500 on RPC error", async () => {
    const client = makeSupabaseClient({
      user: MOCK_USER,
      isManager: true,
      rpcError: { message: "db error" },
    });
    mockCreateClient.mockResolvedValue(client as any);

    const res = await GET();
    expect(res.status).toBe(500);
  });
});
